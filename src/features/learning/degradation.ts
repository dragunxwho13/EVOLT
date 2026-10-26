/**
 * What degradation can actually be predicted from the data EVOLT has — and what cannot.
 *
 * 1. The unified training dataset (1,000 rows). An audit checks how its Arduino-style columns
 *    relate to the session columns. A leakage-aware regression study then compares a baseline
 *    with ridge regression on three feature sets, under station-grouped cross-validation
 *    (device-aware) and a time-ordered hold-out (time-aware), with MAE / RMSE / R².
 * 2. The bench calibration: the only measured degradation signal, voltage → degradation %
 *    on the experimental circuit, fitted by least squares and checked on held-out time blocks
 *    and held-out connectors. It accepts experimental-scale (bench) volts only.
 *
 * Pure and deterministic; no randomness is used, so every number is reproducible.
 */
import { BENCH_RUN } from "@/config/scaling";
import type { BenchRecord } from "@/features/bench/parse";

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

export interface BenchCalibration {
  kind: "bench_linear_calibration";
  /** degradation % = intercept + slope × V, clipped to 0–100. */
  intercept: number;
  slope: number;
  fittedOn: number;
  inputRangeV: [number, number];
  inputScale: "experimental";
  /** Evaluation on data not used for fitting. */
  timeBlocked: RegressionMetrics;
  leaveOneConnectorOut: { connector: string; metrics: RegressionMetrics }[];
  /** The log's documented definition, for comparison: 100 × (1 − V / 4.0 V). */
  formulaIntercept: number;
  formulaSlope: number;
  maxDeviationFromFormula: number;
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

/** Rows usable for calibration: live, degradation logged, and below the reference (not clipped to 0). */
export function calibrationRows(records: readonly BenchRecord[]): BenchRecord[] {
  return records.filter((r) => r.voltageV > 0 && r.degradationPct !== null && r.voltageV <= BENCH_RUN.degradationReferenceV);
}

export function fitBenchCalibration(records: readonly BenchRecord[]): BenchCalibration {
  const rows = calibrationRows(records);
  const fit = ols(rows.map((r) => r.voltageV), rows.map((r) => r.degradationPct!));
  // Time-blocked: fit on the first half of the run, test on the second, then the reverse.
  const times = [...new Set(rows.map((r) => r.timeS))].sort((a, b) => a - b);
  const mid = times[Math.floor(times.length / 2)]!;
  const yT: number[] = [];
  const pT: number[] = [];
  for (const [train, test] of [
    [rows.filter((r) => r.timeS < mid), rows.filter((r) => r.timeS >= mid)],
    [rows.filter((r) => r.timeS >= mid), rows.filter((r) => r.timeS < mid)],
  ] as const) {
    const f = ols(train.map((r) => r.voltageV), train.map((r) => r.degradationPct!));
    for (const r of test) {
      yT.push(r.degradationPct!);
      pT.push(clip(f.a + f.b * r.voltageV));
    }
  }
  const loco = (["C1", "C2", "C3"] as const).map((c) => {
    const train = rows.filter((r) => r.connector !== c);
    const test = rows.filter((r) => r.connector === c);
    const f = ols(train.map((r) => r.voltageV), train.map((r) => r.degradationPct!));
    return { connector: c, metrics: regressionMetrics(test.map((r) => r.degradationPct!), test.map((r) => clip(f.a + f.b * r.voltageV))) };
  });
  const ref = BENCH_RUN.degradationReferenceV;
  const maxDev = Math.max(...rows.map((r) => Math.abs(r.degradationPct! - 100 * (1 - r.voltageV / ref))));
  const tb = regressionMetrics(yT, pT);
  return {
    kind: "bench_linear_calibration",
    intercept: fit.a,
    slope: fit.b,
    fittedOn: rows.length,
    inputRangeV: [Math.min(...rows.map((r) => r.voltageV)), Math.max(...rows.map((r) => r.voltageV))],
    inputScale: "experimental",
    timeBlocked: tb,
    leaveOneConnectorOut: loco,
    formulaIntercept: 100,
    formulaSlope: -100 / ref,
    maxDeviationFromFormula: maxDev,
    verdict:
      `Fitted degradation = ${fit.a.toFixed(2)} ${fit.b < 0 ? "−" : "+"} ${Math.abs(fit.b).toFixed(2)} × V, against the log's own definition 100 − ${(100 / ref).toFixed(0)} × V. ` +
      `On held-out time blocks the error is ${tb.mae.toFixed(2)} points (MAE). This recovers how the bench computes degradation; it converts a bench voltage into the bench's degradation index and says nothing about how fast a real connector wears.`,
  };
}

export interface CalibrationEstimate {
  voltageV: number;
  degradationPct: number;
  /** Outside the voltage range the calibration was fitted on (still within bench scale). */
  extrapolated: boolean;
}

/** Inference for an experimental-scale (bench) voltage. Real-charger voltages are refused. */
export function estimateFromBenchVoltage(cal: BenchCalibration, voltageV: number): CalibrationEstimate {
  if (!Number.isFinite(voltageV) || voltageV < 0) throw new RangeError("Voltage must be a non-negative number.");
  if (voltageV > BENCH_RUN.adcReferenceV) {
    throw new RangeError(
      `${voltageV} V is not a bench reading: the calibration accepts experimental-circuit voltages up to ${BENCH_RUN.adcReferenceV} V. Real-charger voltages must not be fed to it.`,
    );
  }
  const raw = voltageV > BENCH_RUN.degradationReferenceV ? 0 : cal.intercept + cal.slope * voltageV;
  return {
    voltageV,
    degradationPct: clip(raw),
    extrapolated: voltageV < cal.inputRangeV[0],
  };
}
