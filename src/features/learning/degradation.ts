/**
 * What degradation can actually be predicted from the data EVOLT has — and what cannot.
 *
 * 1. The unified training dataset (1,000 rows). An audit checks how its Arduino-style columns
 *    relate to the session columns. A leakage-aware regression study then compares a baseline
 *    with ridge regression on three feature sets, under station-grouped cross-validation
 *    (device-aware) and a time-ordered hold-out (time-aware), with MAE / RMSE / R².
 * 2. The bench calibration: the only measured degradation signal. Relative voltage (V ÷ the
 *    connector's healthy reference) → degradation %, fitted by least squares and checked on
 *    held-out sweeps and held-out connectors against two simpler models. It accepts
 *    experimental-scale (bench) volts only.
 *
 * Pure and deterministic; no randomness is used, so every number is reproducible.
 */
import { BENCH_RUN } from "@/config/scaling";
import { classifyReadings, referenceVoltage, type ClassifiedReading } from "@/features/bench/analysis";
import { BENCH_CONNECTORS, type BenchConnector, type BenchRecord } from "@/features/bench/parse";

/* ───────────── shared numerics ───────────── */

export interface RegressionMetrics {
  mae: number;
  rmse: number;
  r2: number;
  n: number;
}

export function regressionMetrics(y: readonly number[], p: readonly number[]): RegressionMetrics {
  const n = y.length;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  let ae = 0;
  let se = 0;
  let st = 0;
  for (let i = 0; i < n; i++) {
    ae += Math.abs(y[i]! - p[i]!);
    se += (y[i]! - p[i]!) ** 2;
    st += (y[i]! - mean) ** 2;
  }
  return { mae: ae / n, rmse: Math.sqrt(se / n), r2: st === 0 ? 0 : 1 - se / st, n };
}

/** Solves (A) x = b by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[n]! / row[i]!));
}

export interface RidgeModel {
  features: string[];
  mean: number[];
  std: number[];
  weights: number[];
  intercept: number;
  lambda: number;
}

/** Ridge regression on standardised features (intercept not penalised). */
export function fitRidge(X: readonly number[][], y: readonly number[], features: string[], lambda = 1): RidgeModel {
  const n = X.length;
  const d = features.length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j]!, 0) / n);
  const std = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j]! - mean[j]!) ** 2, 0) / n) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]!) / std[j]!));
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((s, r) => s + r[i]! * r[j]!, 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: d }, (_, i) => Z.reduce((s, r, k) => s + r[i]! * (y[k]! - yMean), 0));
  return { features, mean, std, weights: solve(A, b), intercept: yMean, lambda };
}

export function predictRidge(m: RidgeModel, x: readonly number[]): number {
  return m.intercept + m.weights.reduce((s, w, j) => s + (w * (x[j]! - m.mean[j]!)) / m.std[j]!, 0);
}

function medianOf(v: readonly number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/* ───────────── 1. unified training dataset ───────────── */

export type UnifiedRow = Record<string, string>;

const num = (r: UnifiedRow, k: string) => Number(r[k]);

export interface AuditCheck {
  id: string;
  finding: string;
  maxAbsDifference: number;
  holds: boolean;
}

export interface UnifiedAudit {
  rows: number;
  columns: number;
  missingCells: number;
  duplicateRecordIds: number;
  provenance: Record<string, number>;
  connectorTypes: Record<string, number>;
  lossExceedsConsumption: number;
  checks: AuditCheck[];
}

function countBy(rows: readonly UnifiedRow[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r[key] ?? ""] = (out[r[key] ?? ""] ?? 0) + 1;
  return out;
}

/** The loss share the degradation columns turn out to be: 100 × loss / consumed, clipped to [0, 100]. */
export function lossSharePct(r: UnifiedRow): number {
  return Math.min(100, Math.max(0, (100 * num(r, "power_loss")) / num(r, "power_consumed")));
}

export function auditUnified(rows: readonly UnifiedRow[], headers: readonly string[]): UnifiedAudit {
  const maxDiff = (f: (r: UnifiedRow) => number) => rows.reduce((m, r) => Math.max(m, Math.abs(f(r))), 0);
  const ratioSpread = (f: (r: UnifiedRow) => number) => {
    const v = rows.map(f);
    return Math.max(...v) - Math.min(...v);
  };
  const c1Ratio = medianOf(rows.map((r) => num(r, "C1_mA") / num(r, "current_flow")));
  const checks: AuditCheck[] = [
    {
      id: "c1_voltage",
      finding: "C1_V equals the session's voltage_level.",
      maxAbsDifference: maxDiff((r) => num(r, "C1_V") - num(r, "voltage_level")),
      holds: false,
    },
    {
      id: "c1_current",
      finding: `C1_mA equals ${c1Ratio.toFixed(1)} × the session's current_flow (A) — a fixed factor, not a measurement.`,
      maxAbsDifference: ratioSpread((r) => num(r, "C1_mA") / num(r, "current_flow")),
      holds: false,
    },
    {
      id: "c1_degradation",
      finding: "C1_Deg_pct equals 100 × power_loss ÷ power_consumed, clipped to 0–100 %.",
      maxAbsDifference: maxDiff((r) => num(r, "C1_Deg_pct") - lossSharePct(r)),
      holds: false,
    },
    {
      id: "c2_copy",
      finding: "C2 is C1 with fixed factors (voltage × 0.998, current × 0.971, degradation × 0.98).",
      maxAbsDifference: Math.max(
        ratioSpread((r) => num(r, "C2_V") / num(r, "C1_V")),
        ratioSpread((r) => num(r, "C2_mA") / num(r, "C1_mA")),
        ratioSpread((r) => (num(r, "C1_Deg_pct") > 0 ? num(r, "C2_Deg_pct") / num(r, "C1_Deg_pct") : 0.98)),
      ),
      holds: false,
    },
    {
      id: "c3_copy",
      finding: "C3 is C1 with fixed factors (voltage × 1.002, current × 0.971, degradation × 1.02 before clipping).",
      maxAbsDifference: Math.max(ratioSpread((r) => num(r, "C3_V") / num(r, "C1_V")), ratioSpread((r) => num(r, "C3_mA") / num(r, "C1_mA"))),
      holds: false,
    },
    {
      id: "avg_mean",
      finding: "Avg_Deg_pct is the mean of C1–C3 degradation.",
      maxAbsDifference: maxDiff((r) => num(r, "Avg_Deg_pct") - (num(r, "C1_Deg_pct") + num(r, "C2_Deg_pct") + num(r, "C3_Deg_pct")) / 3),
      holds: false,
    },
  ];
  for (const c of checks) c.holds = c.maxAbsDifference < 1e-3;
  return {
    rows: rows.length,
    columns: headers.length,
    missingCells: rows.reduce((s, r) => s + headers.filter((h) => (r[h] ?? "").trim() === "").length, 0),
    duplicateRecordIds: rows.length - new Set(rows.map((r) => r.record_id)).size,
    provenance: countBy(rows, "provenance"),
    connectorTypes: countBy(rows, "connector_type"),
    lossExceedsConsumption: rows.filter((r) => num(r, "power_loss") > num(r, "power_consumed")).length,
    checks,
  };
}

export const TARGET = "Avg_Deg_pct";

/** Session measurements that are not ingredients of the target. Arduino-style C* columns are copies and excluded. */
const SESSION_FEATURES = [
  "voltage_level",
  "current_flow",
  "power_consumed",
  "voltage_fluctuation",
  "battery_capacity",
  "charging_time",
  "charging_power",
  "charging_cost",
  "predicted_power_demand",
  "optimized_charging_power",
  "grid_stability_score",
  "num_chargers",
] as const;

const CURRENT_LINKED = ["current_flow", "power_consumed", "predicted_power_demand", "optimized_charging_power", "inverse_current"];

export interface FeatureSet {
  id: string;
  label: string;
  question: string;
  features: string[];
}

export const FEATURE_SETS: FeatureSet[] = [
  {
    id: "definition",
    label: "Loss and consumption (the target's own inputs)",
    question: "Is the target just a formula of two columns?",
    features: ["loss_share_pct"],
  },
  {
    id: "no_loss",
    label: "All session measurements except power loss",
    question: "Can degradation be predicted without measuring the loss?",
    features: [...SESSION_FEATURES, "inverse_current"],
  },
  {
    id: "no_loss_no_current",
    label: "…and without current or power (which sit in the target's denominator)",
    question: "Does anything else carry information about degradation?",
    features: SESSION_FEATURES.filter((f) => !CURRENT_LINKED.includes(f)),
  },
];

function featureValue(r: UnifiedRow, f: string): number {
  if (f === "loss_share_pct") return lossSharePct(r);
  if (f === "inverse_current") return 1 / num(r, "current_flow");
  return num(r, f);
}

export interface SplitResult {
  split: "station_grouped_cv" | "time_holdout";
  baseline: RegressionMetrics;
  ridge: RegressionMetrics;
}

export interface FeatureSetResult {
  featureSet: FeatureSet;
  results: SplitResult[];
  /** Standardised ridge weights fitted on all rows, largest first. */
  topWeights: { feature: string; weight: number }[];
}

/** Deterministic grouped folds: stations sorted by code, dealt round-robin into k folds. */
export function stationFolds(rows: readonly UnifiedRow[], k = 5): number[] {
  const stations = [...new Set(rows.map((r) => r.station_code!))].sort();
  const foldOf = new Map(stations.map((s, i) => [s, i % k]));
  return rows.map((r) => foldOf.get(r.station_code!)!);
}

function evaluate(rows: readonly UnifiedRow[], fs: FeatureSet, k: number): SplitResult[] {
  const X = rows.map((r) => fs.features.map((f) => featureValue(r, f)));
  const y = rows.map((r) => num(r, TARGET));
  const out: SplitResult[] = [];

  // Station-grouped CV: every station's sessions are entirely in train or entirely in test.
  const folds = stationFolds(rows, k);
  const yAll: number[] = [];
  const pBase: number[] = [];
  const pRidge: number[] = [];
  for (let f = 0; f < k; f++) {
    const tr = rows.map((_, i) => i).filter((i) => folds[i] !== f);
    const te = rows.map((_, i) => i).filter((i) => folds[i] === f);
    if (te.length === 0) continue;
    const med = medianOf(tr.map((i) => y[i]!));
    const m = fitRidge(tr.map((i) => X[i]!), tr.map((i) => y[i]!), fs.features);
    for (const i of te) {
      yAll.push(y[i]!);
      pBase.push(med);
      pRidge.push(predictRidge(m, X[i]!));
    }
  }
  out.push({ split: "station_grouped_cv", baseline: regressionMetrics(yAll, pBase), ridge: regressionMetrics(yAll, pRidge) });

  // Time-ordered hold-out: train on the earliest 80 %, test on the latest 20 %.
  const order = rows.map((_, i) => i).sort((a, b) => rows[a]!.observed_at!.localeCompare(rows[b]!.observed_at!));
  const cut = Math.floor(order.length * 0.8);
  const tr = order.slice(0, cut);
  const te = order.slice(cut);
  const med = medianOf(tr.map((i) => y[i]!));
  const m = fitRidge(tr.map((i) => X[i]!), tr.map((i) => y[i]!), fs.features);
  out.push({
    split: "time_holdout",
    baseline: regressionMetrics(te.map((i) => y[i]!), te.map(() => med)),
    ridge: regressionMetrics(te.map((i) => y[i]!), te.map((i) => predictRidge(m, X[i]!))),
  });
  return out;
}

export interface DegradationStudy {
  target: string;
  audit: UnifiedAudit;
  folds: number;
  featureSets: FeatureSetResult[];
  verdict: string[];
  deployable: false;
}

export function studyUnifiedDataset(rows: readonly UnifiedRow[], headers: readonly string[], k = 5): DegradationStudy {
  const audit = auditUnified(rows, headers);
  const featureSets = FEATURE_SETS.map((fs) => {
    const X = rows.map((r) => fs.features.map((f) => featureValue(r, f)));
    const all = fitRidge(X, rows.map((r) => num(r, TARGET)), fs.features);
    return {
      featureSet: fs,
      results: evaluate(rows, fs, k),
      topWeights: all.weights
        .map((w, j) => ({ feature: fs.features[j]!, weight: w }))
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
        .slice(0, 4),
    };
  });
  const r2 = (id: string) => featureSets.find((f) => f.featureSet.id === id)!.results[0]!.ridge.r2;
  return {
    target: TARGET,
    audit,
    folds: k,
    featureSets,
    verdict: [
      `The degradation columns are a formula, not a measurement: Avg_Deg_pct = clip(100 × power_loss ÷ power_consumed) (R² ${r2("definition").toFixed(3)} on held-out stations).`,
      `Without power loss, ridge regression explains R² ${r2("no_loss").toFixed(2)} — but only because current and power sit in the formula's denominator (largest weight: ${featureSets[1]!.topWeights[0]!.feature}). That is arithmetic, not wear.`,
      `Removing those too leaves R² ${r2("no_loss_no_current").toFixed(2)}: no other column carries information about degradation.`,
      "The dataset has no independently measured degradation label, so no degradation predictor is deployed from it.",
    ],
    deployable: false,
  };
}

/* ───────────── 2. bench calibration ───────────── */

/**
 * The deployed bench model: degradation % = intercept + slope × (V ÷ V_ref), where V_ref is the
 * connector's own healthy level. Using the RELATIVE voltage is what lets one model serve three
 * connectors with different loads and references — and a new connector after one commissioning
 * sweep. Evaluated on whole sweeps and whole connectors the model never saw.
 */
export interface BenchCalibration {
  kind: "bench_relative_voltage";
  intercept: number;
  slope: number;
  /** Healthy reference voltage per connector (V), measured from the log. */
  references: Record<BenchConnector, number>;
  fittedOn: number;
  /** Range of V ÷ V_ref the model was fitted on. */
  inputRatioRange: [number, number];
  inputScale: "experimental";
  evaluation: {
    /** Each sweep of each connector held out in turn; metrics pooled over all held-out readings. */
    leaveOneSweepOut: { pooledVoltage: RegressionMetrics; perConnectorVoltage: RegressionMetrics; relativeVoltage: RegressionMetrics };
    /**
     * Each connector held out entirely. The relative model gets only the held-out connector's
     * first sweep (commissioning) to set its V_ref, and is tested on its remaining sweeps.
     */
    leaveOneConnectorOut: {
      connector: BenchConnector;
      commissioningReferenceV: number;
      tested: number;
      pooledVoltage: RegressionMetrics;
      relativeVoltage: RegressionMetrics;
    }[];
  };
  /** Largest |logged − 100 × (1 − V ÷ V_ref)| over the calibration readings (points). */
  maxDeviationFromDefinition: number;
  verdict: string;
}

function ols(x: readonly number[], y: readonly number[]): { a: number; b: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

const clip = (v: number) => Math.min(100, Math.max(0, v));

/** Rows usable for calibration: conducting (V > 0), degradation logged, below 100 %. */
export function calibrationRows(records: readonly BenchRecord[]): ClassifiedReading[] {
  return classifyReadings(records).filter((r) => r.voltageV > 0 && r.degradationPct !== null && r.degradationPct < 100);
}

function referencesOf(rows: readonly BenchRecord[]): Partial<Record<BenchConnector, number>> {
  const out: Partial<Record<BenchConnector, number>> = {};
  for (const c of BENCH_CONNECTORS) {
    const mine = rows.filter((r) => r.connector === c);
    if (mine.length) out[c] = referenceVoltage(mine);
  }
  return out;
}

function fitRelative(rows: readonly BenchRecord[], refs: Partial<Record<BenchConnector, number>>) {
  return ols(rows.map((r) => r.voltageV / refs[r.connector]!), rows.map((r) => r.degradationPct!));
}

export function fitBenchCalibration(records: readonly BenchRecord[]): BenchCalibration {
  const rows = calibrationRows(records);
  const refs = referencesOf(rows) as Record<BenchConnector, number>;
  const fit = fitRelative(rows, refs);
  const ratios = rows.map((r) => r.voltageV / refs[r.connector]);

  // Leave one sweep out.
  const groups = [...new Set(rows.map((r) => `${r.connector}#${r.sweep}`))];
  const acc = { pooledVoltage: { y: [] as number[], p: [] as number[] }, perConnectorVoltage: { y: [] as number[], p: [] as number[] }, relativeVoltage: { y: [] as number[], p: [] as number[] } };
  for (const g of groups) {
    const test = rows.filter((r) => `${r.connector}#${r.sweep}` === g);
    const train = rows.filter((r) => `${r.connector}#${r.sweep}` !== g);
    const c = test[0]!.connector;
    const pooled = ols(train.map((r) => r.voltageV), train.map((r) => r.degradationPct!));
    const own = train.filter((r) => r.connector === c);
    const per = ols(own.map((r) => r.voltageV), own.map((r) => r.degradationPct!));
    const trainRefs = referencesOf(train);
    const rel = fitRelative(train, trainRefs);
    for (const r of test) {
      for (const k of ["pooledVoltage", "perConnectorVoltage", "relativeVoltage"] as const) acc[k].y.push(r.degradationPct!);
      acc.pooledVoltage.p.push(clip(pooled.a + pooled.b * r.voltageV));
      acc.perConnectorVoltage.p.push(clip(per.a + per.b * r.voltageV));
      acc.relativeVoltage.p.push(clip(rel.a + rel.b * (r.voltageV / trainRefs[c]!)));
    }
  }

  // Leave one connector out, with a commissioning sweep for the relative model.
  const loco = BENCH_CONNECTORS.map((c) => {
    const train = rows.filter((r) => r.connector !== c);
    const mine = rows.filter((r) => r.connector === c);
    const firstSweep = Math.min(...mine.map((r) => r.sweep));
    const commissioning = mine.filter((r) => r.sweep === firstSweep);
    const test = mine.filter((r) => r.sweep !== firstSweep);
    const pooled = ols(train.map((r) => r.voltageV), train.map((r) => r.degradationPct!));
    const rel = fitRelative(train, referencesOf(train));
    const commissioningReferenceV = referenceVoltage(commissioning);
    const y = test.map((r) => r.degradationPct!);
    return {
      connector: c,
      commissioningReferenceV,
      tested: test.length,
      pooledVoltage: regressionMetrics(y, test.map((r) => clip(pooled.a + pooled.b * r.voltageV))),
      relativeVoltage: regressionMetrics(y, test.map((r) => clip(rel.a + rel.b * (r.voltageV / commissioningReferenceV)))),
    };
  });

  const lso = {
    pooledVoltage: regressionMetrics(acc.pooledVoltage.y, acc.pooledVoltage.p),
    perConnectorVoltage: regressionMetrics(acc.perConnectorVoltage.y, acc.perConnectorVoltage.p),
    relativeVoltage: regressionMetrics(acc.relativeVoltage.y, acc.relativeVoltage.p),
  };
  const locoPooled = loco.map((l) => l.pooledVoltage.mae);
  const locoRel = loco.map((l) => l.relativeVoltage.mae);
  const maxDev = Math.max(...rows.map((r) => Math.abs(r.degradationPct! - 100 * (1 - r.voltageV / refs[r.connector]))));
  const f2 = (v: number) => v.toFixed(2);
  return {
    kind: "bench_relative_voltage",
    intercept: fit.a,
    slope: fit.b,
    references: refs,
    fittedOn: rows.length,
    inputRatioRange: [Math.min(...ratios), Math.max(...ratios)],
    inputScale: "experimental",
    evaluation: { leaveOneSweepOut: lso, leaveOneConnectorOut: loco },
    maxDeviationFromDefinition: maxDev,
    verdict:
      `Degradation = ${f2(fit.a)} ${fit.b < 0 ? "−" : "+"} ${f2(Math.abs(fit.b))} × (V ÷ V_ref), with V_ref measured per connector ` +
      `(C1 ${refs.C1.toFixed(3)} V, C2 ${refs.C2.toFixed(3)} V, C3 ${refs.C3.toFixed(3)} V). On sweeps it never saw the error is ${f2(lso.relativeVoltage.mae)} points (MAE), ` +
      `against ${f2(lso.pooledVoltage.mae)} for one voltage line shared by all connectors. On a connector it never saw — given only that connector's first sweep — ` +
      `it errs by ${f2(Math.min(...locoRel))}–${f2(Math.max(...locoRel))} points, against ${f2(Math.min(...locoPooled))}–${f2(Math.max(...locoPooled))} for the shared line. ` +
      "It converts a bench voltage into the bench's degradation index; it says nothing about how fast a real connector wears.",
  };
}

export interface CalibrationEstimate {
  voltageV: number;
  referenceV: number;
  ratio: number;
  degradationPct: number;
  /** At or above the connector's healthy level: reported as 0 %. */
  aboveReference: boolean;
  /** V ÷ V_ref below the fitted range (near open circuit), still within bench scale. */
  extrapolated: boolean;
}

/**
 * Inference for an experimental-scale (bench) voltage on a known connector, or on a new one
 * whose healthy reference voltage is given. Real-charger voltages are refused.
 */
export function estimateFromBenchVoltage(
  cal: BenchCalibration,
  voltageV: number,
  target: { connector: BenchConnector } | { referenceV: number },
): CalibrationEstimate {
  if (!Number.isFinite(voltageV) || voltageV < 0) throw new RangeError("Voltage must be a non-negative number.");
  if (voltageV > BENCH_RUN.adcReferenceV) {
    throw new RangeError(
      `${voltageV} V is not a bench reading: the calibration accepts experimental-circuit voltages up to ${BENCH_RUN.adcReferenceV} V. Real-charger voltages must not be fed to it.`,
    );
  }
  const referenceV = "connector" in target ? cal.references[target.connector] : target.referenceV;
  if (!(referenceV > 0) || referenceV > BENCH_RUN.adcReferenceV) {
    throw new RangeError(`The reference voltage must be above 0 V and at most ${BENCH_RUN.adcReferenceV} V (a bench level).`);
  }
  const ratio = voltageV / referenceV;
  const aboveReference = ratio >= 1;
  return {
    voltageV,
    referenceV,
    ratio,
    degradationPct: aboveReference ? 0 : clip(cal.intercept + cal.slope * ratio),
    aboveReference,
    extrapolated: !aboveReference && ratio < cal.inputRatioRange[0],
  };
}
