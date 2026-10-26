/**
 * Experimental-circuit analysis: classifies every bench reading and summarises each connector
 * separately. Circuit parameters (load resistance, healthy level, degraded level) are measured
 * from the readings, not assumed. Pure and deterministic.
 */
import { BENCH_RUN } from "@/config/scaling";
import { BENCH_CONNECTORS, type BenchConnector, type BenchRecord } from "./parse";

export type ReadingState = "no_signal" | "dropout" | "healthy" | "transition" | "degraded" | "unreported";

export const READING_STATE_LABELS: Record<ReadingState, string> = {
  no_signal: "No signal (start of run)",
  dropout: "Single-sample dropout",
  healthy: "Healthy (0 % logged)",
  transition: "Transition",
  degraded: `Degraded (≥ ${BENCH_RUN.degradedFromPct} % logged)`,
  unreported: "Degradation not logged",
};

export interface ClassifiedReading extends BenchRecord {
  state: ReadingState;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** Assigns each reading a state using only what was logged. */
export function classifyReadings(records: readonly BenchRecord[]): ClassifiedReading[] {
  const out: ClassifiedReading[] = [];
  for (const c of BENCH_CONNECTORS) {
    const rows = records.filter((r) => r.connector === c).sort((a, b) => a.timeS - b.timeS);
    const firstLive = rows.findIndex((r) => r.voltageV > 0);
    rows.forEach((r, i) => {
      let state: ReadingState;
      if (r.voltageV === 0 && r.currentMa === 0) state = firstLive === -1 || i < firstLive ? "no_signal" : "dropout";
      else if (r.degradationPct === null) state = "unreported";
      else if (r.degradationPct === 0) state = "healthy";
      else if (r.degradationPct >= BENCH_RUN.degradedFromPct) state = "degraded";
      else state = "transition";
      out.push({ ...r, state });
    });
  }
  return out;
}

export interface ConnectorSummary {
  connector: BenchConnector;
  readings: number;
  live: number;
  counts: Record<ReadingState, number>;
  /** Fixed load inferred as the median of V / I over live readings (Ω). */
  loadOhm: number;
  /** Spread of V / I (max − min, Ω): small means the load really is fixed. */
  loadSpreadOhm: number;
  healthyMeanV: number | null;
  healthyMeanMa: number | null;
  degradedMedianV: number | null;
  degradedMedianMa: number | null;
  /** Extra series resistance implied by the degraded state: R_L × (V_healthy / V_degraded − 1). */
  extraResistanceOhm: number | null;
  /** Share of the healthy voltage lost in the connector when degraded: 1 − V_deg / V_healthy. */
  degradedVoltageShare: number | null;
  minLiveV: number;
  degradationMean: number | null;
  degradationMedian: number | null;
  /** Share of logged degradation values at or above 40 %. */
  shareAtLeast40: number | null;
  /** Largest |logged − 100 × (1 − V / 4.0 V)| where V ≤ 4.0 V, in percentage points. */
  formulaMaxDeviation: number | null;
  firstDegradedAt: number | null;
}

export function summarizeConnector(readings: readonly ClassifiedReading[], connector: BenchConnector): ConnectorSummary {
  const rows = readings.filter((r) => r.connector === connector);
  const live = rows.filter((r) => r.voltageV > 0 && r.currentMa > 0);
  const counts = { no_signal: 0, dropout: 0, healthy: 0, transition: 0, degraded: 0, unreported: 0 } as Record<ReadingState, number>;
  for (const r of rows) counts[r.state]++;
  const ratios = live.map((r) => r.voltageV / (r.currentMa / 1000));
  const loadOhm = median(ratios);
  const healthy = rows.filter((r) => r.state === "healthy");
  const degraded = rows.filter((r) => r.state === "degraded");
  const healthyMeanV = healthy.length ? mean(healthy.map((r) => r.voltageV)) : null;
  const degradedMedianV = degraded.length ? median(degraded.map((r) => r.voltageV)) : null;
  const logged = rows.filter((r) => r.degradationPct !== null && r.voltageV > 0).map((r) => r.degradationPct!);
  const formulaRows = rows.filter((r) => r.degradationPct !== null && r.voltageV > 0 && r.voltageV <= BENCH_RUN.degradationReferenceV);
  const formulaMaxDeviation = formulaRows.length
    ? Math.max(...formulaRows.map((r) => Math.abs(r.degradationPct! - 100 * (1 - r.voltageV / BENCH_RUN.degradationReferenceV))))
    : null;
  return {
    connector,
    readings: rows.length,
    live: live.length,
    counts,
    loadOhm,
    loadSpreadOhm: ratios.length ? Math.max(...ratios) - Math.min(...ratios) : 0,
    healthyMeanV,
    healthyMeanMa: healthy.length ? mean(healthy.map((r) => r.currentMa)) : null,
    degradedMedianV,
    degradedMedianMa: degraded.length ? median(degraded.map((r) => r.currentMa)) : null,
    extraResistanceOhm: healthyMeanV !== null && degradedMedianV ? loadOhm * (healthyMeanV / degradedMedianV - 1) : null,
    degradedVoltageShare: healthyMeanV !== null && degradedMedianV ? 1 - degradedMedianV / healthyMeanV : null,
    minLiveV: live.length ? Math.min(...live.map((r) => r.voltageV)) : 0,
    degradationMean: logged.length ? mean(logged) : null,
    degradationMedian: logged.length ? median(logged) : null,
    shareAtLeast40: logged.length ? logged.filter((v) => v >= 40).length / logged.length : null,
    formulaMaxDeviation,
    firstDegradedAt: degraded.length ? Math.min(...degraded.map((r) => r.timeS)) : null,
  };
}

export interface ConnectorComparison {
  /** Mean over time steps of the largest minus smallest logged degradation (points). */
  meanDegradationGap: number;
  /** Mean over live time steps of the largest minus smallest voltage (V). */
  meanVoltageGap: number;
  /** Connector with the lowest healthy-window voltage and its gap to the others' mean. */
  healthyOutlier: { connector: BenchConnector; gapV: number; gapPct: number } | null;
}

export function compareConnectors(readings: readonly ClassifiedReading[], summaries: readonly ConnectorSummary[]): ConnectorComparison {
  const times = [...new Set(readings.map((r) => r.timeS))];
  const degGaps: number[] = [];
  const vGaps: number[] = [];
  for (const t of times) {
    const at = readings.filter((r) => r.timeS === t);
    const d = at.filter((r) => r.degradationPct !== null).map((r) => r.degradationPct!);
    if (d.length === 3) degGaps.push(Math.max(...d) - Math.min(...d));
    const v = at.filter((r) => r.voltageV > 0).map((r) => r.voltageV);
    if (v.length === 3) vGaps.push(Math.max(...v) - Math.min(...v));
  }
  const withHealthy = summaries.filter((s) => s.healthyMeanV !== null);
  let healthyOutlier: ConnectorComparison["healthyOutlier"] = null;
  if (withHealthy.length === 3) {
    const lowest = withHealthy.reduce((a, b) => (b.healthyMeanV! < a.healthyMeanV! ? b : a));
    const others = withHealthy.filter((s) => s !== lowest).map((s) => s.healthyMeanV!);
    const othersMean = mean(others);
    healthyOutlier = { connector: lowest.connector, gapV: othersMean - lowest.healthyMeanV!, gapPct: (othersMean - lowest.healthyMeanV!) / othersMean };
  }
  return { meanDegradationGap: degGaps.length ? mean(degGaps) : 0, meanVoltageGap: vGaps.length ? mean(vGaps) : 0, healthyOutlier };
}

export interface BenchAnalysis {
  readings: ClassifiedReading[];
  connectors: ConnectorSummary[];
  comparison: ConnectorComparison;
  timeSteps: number;
  durationS: number;
  /** Circuit values pooled over the three connectors, used as the scaling baseline. */
  circuit: { loadOhm: number; healthyV: number; healthyMa: number; degradedV: number; degradedMa: number };
}

export function analyzeBench(records: readonly BenchRecord[]): BenchAnalysis {
  const readings = classifyReadings(records);
  const connectors = BENCH_CONNECTORS.map((c) => summarizeConnector(readings, c));
  const times = [...new Set(records.map((r) => r.timeS))].sort((a, b) => a - b);
  const pooled = (pick: (s: ConnectorSummary) => number | null) => {
    const v = connectors.map(pick).filter((x): x is number => x !== null);
    return v.length ? mean(v) : NaN;
  };
  return {
    readings,
    connectors,
    comparison: compareConnectors(readings, connectors),
    timeSteps: times.length,
    durationS: times.length ? times[times.length - 1]! : 0,
    circuit: {
      loadOhm: pooled((s) => s.loadOhm),
      healthyV: pooled((s) => s.healthyMeanV),
      healthyMa: pooled((s) => s.healthyMeanMa),
      degradedV: pooled((s) => s.degradedMedianV),
      degradedMa: pooled((s) => s.degradedMedianMa),
    },
  };
}
