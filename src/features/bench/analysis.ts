/**
 * Experimental-circuit analysis: classifies every bench reading and summarises each connector
 * separately. Circuit parameters (each connector's load resistance and healthy reference voltage)
 * are measured from the readings, not assumed. Pure and deterministic.
 */
import { BENCH_RUN } from "@/config/scaling";
import { BENCH_CONNECTORS, type BenchConnector, type BenchRecord } from "./parse";

export type ReadingState = "open_circuit" | "healthy" | "moderate" | "severe" | "unreported";

export const READING_STATE_LABELS: Record<ReadingState, string> = {
  open_circuit: "Open circuit (0 V, 100 % logged)",
  healthy: `Near healthy (< ${BENCH_RUN.healthyBelowPct} %)`,
  moderate: `Moderate (${BENCH_RUN.healthyBelowPct}–${BENCH_RUN.severeFromPct} %)`,
  severe: `Severe (≥ ${BENCH_RUN.severeFromPct} %, still conducting)`,
  unreported: "Degradation not logged",
};

export interface ClassifiedReading extends BenchRecord {
  state: ReadingState;
  /** Sweep number: increases each time the connector reaches open circuit. 0 = before the first. */
  sweep: number;
}

export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function quantile(values: readonly number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo);
}
const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** Assigns each reading a state from what was logged, and numbers the sweeps. */
export function classifyReadings(records: readonly BenchRecord[]): ClassifiedReading[] {
  const out: ClassifiedReading[] = [];
  for (const c of BENCH_CONNECTORS) {
    const rows = records.filter((r) => r.connector === c).sort((a, b) => a.timeS - b.timeS);
    let sweep = 0;
    let wasOpen = false;
    for (const r of rows) {
      const open = r.voltageV === 0;
      if (open && !wasOpen) sweep++;
      wasOpen = open;
      let state: ReadingState;
      if (open) state = "open_circuit";
      else if (r.degradationPct === null) state = "unreported";
      else if (r.degradationPct < BENCH_RUN.healthyBelowPct) state = "healthy";
      else if (r.degradationPct < BENCH_RUN.severeFromPct) state = "moderate";
      else state = "severe";
      out.push({ ...r, state, sweep });
    }
  }
  return out;
}

/** Readings that define the connector's reference: conducting, logged, and not at either end of the scale. */
export function referenceRows<T extends BenchRecord>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.voltageV > 0 && r.degradationPct !== null && r.degradationPct >= 1 && r.degradationPct <= 95);
}

/** The healthy (0 %) voltage implied by the log's definition: median of V ÷ (1 − degradation/100). */
export function referenceVoltage(rows: readonly BenchRecord[]): number {
  const usable = referenceRows(rows);
  return usable.length ? median(usable.map((r) => r.voltageV / (1 - r.degradationPct! / 100))) : NaN;
}

export interface ConnectorSummary {
  connector: BenchConnector;
  readings: number;
  live: number;
  counts: Record<ReadingState, number>;
  /** Fixed load inferred as the median of V ÷ I over readings with I ≥ 1 mA (Ω). */
  loadOhm: number;
  /** Middle 50 % of V ÷ I (Ω): narrow means the load really is fixed. */
  loadIqrOhm: [number, number];
  /** Healthy (0 %) level of this connector, from the log's own definition (V). */
  referenceV: number;
  /** Current at the healthy level: V_ref ÷ R_load (mA). */
  healthyMa: number;
  maxLiveV: number;
  minLiveV: number;
  /** Lowest degradation logged (the closest the connector came to healthy). */
  minDegradationPct: number | null;
  degradationMean: number | null;
  degradationMedian: number | null;
  /** Largest |logged − 100 × (1 − V ÷ V_ref)| over conducting readings (points). */
  formulaMaxDeviation: number | null;
  /** Open-circuit episodes, and the median time between their starts (one full sweep). */
  sweeps: number;
  sweepPeriodS: number | null;
  /** Share of readings at open circuit, and at ≥ the severe threshold or open. */
  openShare: number;
  severeOrOpenShare: number;
}

export function summarizeConnector(readings: readonly ClassifiedReading[], connector: BenchConnector): ConnectorSummary {
  const rows = readings.filter((r) => r.connector === connector).sort((a, b) => a.timeS - b.timeS);
  const live = rows.filter((r) => r.voltageV > 0);
  const counts = { open_circuit: 0, healthy: 0, moderate: 0, severe: 0, unreported: 0 } as Record<ReadingState, number>;
  for (const r of rows) counts[r.state]++;
  const ratios = live.filter((r) => r.currentMa >= 1).map((r) => r.voltageV / (r.currentMa / 1000));
  const loadOhm = median(ratios);
  const referenceV = referenceVoltage(rows);
  const logged = rows.filter((r) => r.degradationPct !== null).map((r) => r.degradationPct!);
  const formulaRows = live.filter((r) => r.degradationPct !== null);
  const openStarts = rows.filter((r, i) => r.voltageV === 0 && (i === 0 || rows[i - 1]!.voltageV !== 0)).map((r) => r.timeS);
  const gaps = openStarts.slice(1).map((t, i) => t - openStarts[i]!);
  return {
    connector,
    readings: rows.length,
    live: live.length,
    counts,
    loadOhm,
    loadIqrOhm: ratios.length ? [quantile(ratios, 0.25), quantile(ratios, 0.75)] : [NaN, NaN],
    referenceV,
    healthyMa: (referenceV / loadOhm) * 1000,
    maxLiveV: live.length ? Math.max(...live.map((r) => r.voltageV)) : 0,
    minLiveV: live.length ? Math.min(...live.map((r) => r.voltageV)) : 0,
    minDegradationPct: logged.length ? Math.min(...logged) : null,
    degradationMean: logged.length ? mean(logged) : null,
    degradationMedian: logged.length ? median(logged) : null,
    formulaMaxDeviation: formulaRows.length
      ? Math.max(...formulaRows.map((r) => Math.abs(r.degradationPct! - 100 * (1 - r.voltageV / referenceV))))
      : null,
    sweeps: openStarts.length,
    sweepPeriodS: gaps.length ? median(gaps) : null,
    openShare: rows.length ? counts.open_circuit / rows.length : 0,
    severeOrOpenShare: rows.length ? (counts.open_circuit + counts.severe) / rows.length : 0,
  };
}

/** Bench voltage at a given level of the degradation index on this connector. */
export function voltageAtLevel(s: Pick<ConnectorSummary, "referenceV">, levelPct: number): number {
  return s.referenceV * (1 - levelPct / 100);
}

/** Extra series resistance that brings the connector to a given level: R_L × (V_ref ÷ V − 1). */
export function extraResistanceAtLevel(s: Pick<ConnectorSummary, "loadOhm">, levelPct: number): number {
  return s.loadOhm * (1 / (1 - levelPct / 100) - 1);
}

export interface ConnectorComparison {
  /** Highest minus lowest healthy reference voltage (V), and as a share of the mean. */
  referenceSpreadV: number;
  referenceSpreadPct: number;
  /** Highest minus lowest load resistance (Ω). */
  loadSpreadOhm: number;
  /** Error from using one pooled reference for all three connectors (median |Δ degradation|, points). */
  pooledReferenceError: number;
  lowestReference: BenchConnector;
  highestReference: BenchConnector;
}

export function compareConnectors(readings: readonly ClassifiedReading[], summaries: readonly ConnectorSummary[]): ConnectorComparison {
  const refs = summaries.map((s) => s.referenceV);
  const pooled = mean(refs);
  const errs = summaries.flatMap((s) =>
    referenceRows(readings.filter((r) => r.connector === s.connector)).map((r) => Math.abs(100 * (1 - r.voltageV / pooled) - r.degradationPct!)),
  );
  const byRef = [...summaries].sort((a, b) => a.referenceV - b.referenceV);
  const loads = summaries.map((s) => s.loadOhm);
  return {
    referenceSpreadV: Math.max(...refs) - Math.min(...refs),
    referenceSpreadPct: (Math.max(...refs) - Math.min(...refs)) / pooled,
    loadSpreadOhm: Math.max(...loads) - Math.min(...loads),
    pooledReferenceError: errs.length ? median(errs) : 0,
    lowestReference: byRef[0]!.connector,
    highestReference: byRef[byRef.length - 1]!.connector,
  };
}

export interface BenchAnalysis {
  readings: ClassifiedReading[];
  connectors: ConnectorSummary[];
  comparison: ConnectorComparison;
  timeSteps: number;
  startS: number;
  endS: number;
  stepS: number;
}

export function analyzeBench(records: readonly BenchRecord[]): BenchAnalysis {
  const readings = classifyReadings(records);
  const connectors = BENCH_CONNECTORS.map((c) => summarizeConnector(readings, c));
  const times = [...new Set(records.map((r) => r.timeS))].sort((a, b) => a - b);
  return {
    readings,
    connectors,
    comparison: compareConnectors(readings, connectors),
    timeSteps: times.length,
    startS: times[0] ?? 0,
    endS: times[times.length - 1] ?? 0,
    stepS: times.length > 1 ? median(times.slice(1).map((t, i) => t - times[i]!)) : 0,
  };
}
