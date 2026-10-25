/**
 * Pure, tested calculations over imported charging sessions.
 *
 * Every figure the company workspace shows is computed here from stored session values, with
 * an explicit definition. Columns are found by name (with aliases) because session files keep
 * their original headers. Nothing is estimated when a column is missing: the metric is null
 * and the UI says which data is absent.
 */
import { normalizeHeader } from "@/features/data-ingestion/fields";
import { median, theilSen } from "@/features/anomaly-detection/stats";

export interface SessionRecord {
  stationId: string;
  stationCode: string;
  stationName: string;
  chargerId: string;
  chargerCode: string;
  chargingMode: string | null;
  area: string | null;
  startedAt: Date;
  values: Record<string, number>;
  labels: Record<string, string>;
}

/** Column aliases (normalised header names). */
const COLUMN_ALIASES = {
  powerLossKw: ["power_loss", "power_loss_kw", "loss_kw"],
  powerConsumedKw: ["power_consumed", "power_consumed_kw", "consumed_kw"],
  chargingPowerKw: ["charging_power", "charging_power_kw", "avg_charging_power"],
  durationMin: ["charging_time", "charging_time_min", "charging_duration", "duration_min", "session_duration"],
  cost: ["charging_cost", "cost", "session_cost"],
  batteryKwh: ["battery_capacity", "battery_capacity_kwh"],
  voltageFluctuationPct: ["voltage_fluctuation", "voltage_fluctuation_pct", "voltage_variation"],
  gridStability: ["grid_stability_score", "grid_stability"],
} as const;

const LABEL_ALIASES = {
  lossCategory: ["reduced_power_loss_category", "power_loss_category", "loss_category", "power_loss_label"],
  stabilityCategory: ["voltage_stability_category", "voltage_stability", "voltage_stability_label"],
} as const;

export type SessionField = keyof typeof COLUMN_ALIASES;

export interface NormalizedSession {
  stationId: string;
  stationCode: string;
  stationName: string;
  chargerId: string;
  chargerCode: string;
  chargingMode: string | null;
  area: string | null;
  startedAt: Date;
  powerLossKw: number | null;
  powerConsumedKw: number | null;
  chargingPowerKw: number | null;
  /** Assumed to be minutes; the dataset does not state the unit. */
  durationMin: number | null;
  /** Derived: charging power (kW) × duration (h). Not a metered value. */
  energyKwh: number | null;
  cost: number | null;
  batteryKwh: number | null;
  voltageFluctuationPct: number | null;
  gridStability: number | null;
  lossCategory: string | null;
  stabilityCategory: string | null;
  /** Records that cannot all be true at once, which points at metering or data problems. */
  lossExceedsConsumed: boolean;
  energyExceedsBattery: boolean;
}

function pick(record: Record<string, number>, aliases: readonly string[]): number | null {
  for (const [k, v] of Object.entries(record)) {
    if (aliases.includes(normalizeHeader(k)) && Number.isFinite(v)) return v;
  }
  return null;
}

function pickLabel(record: Record<string, string>, aliases: readonly string[]): string | null {
  for (const [k, v] of Object.entries(record)) {
    if (aliases.includes(normalizeHeader(k)) && v.trim()) return v.trim();
  }
  return null;
}

export function normalizeSession(s: SessionRecord): NormalizedSession {
  const v = s.values;
  const powerLossKw = pick(v, COLUMN_ALIASES.powerLossKw);
  const powerConsumedKw = pick(v, COLUMN_ALIASES.powerConsumedKw);
  const chargingPowerKw = pick(v, COLUMN_ALIASES.chargingPowerKw);
  const durationMin = pick(v, COLUMN_ALIASES.durationMin);
  const batteryKwh = pick(v, COLUMN_ALIASES.batteryKwh);
  const energyKwh = chargingPowerKw !== null && durationMin !== null && durationMin >= 0 ? (chargingPowerKw * durationMin) / 60 : null;
  return {
    stationId: s.stationId,
    stationCode: s.stationCode,
    stationName: s.stationName,
    chargerId: s.chargerId,
    chargerCode: s.chargerCode,
    chargingMode: s.chargingMode,
    area: s.area,
    startedAt: s.startedAt,
    powerLossKw,
    powerConsumedKw,
    chargingPowerKw,
    durationMin,
    energyKwh,
    cost: pick(v, COLUMN_ALIASES.cost),
    batteryKwh,
    voltageFluctuationPct: pick(v, COLUMN_ALIASES.voltageFluctuationPct),
    gridStability: pick(v, COLUMN_ALIASES.gridStability),
    lossCategory: pickLabel(s.labels, LABEL_ALIASES.lossCategory),
    stabilityCategory: pickLabel(s.labels, LABEL_ALIASES.stabilityCategory),
    lossExceedsConsumed: powerLossKw !== null && powerConsumedKw !== null && powerLossKw > powerConsumedKw,
    energyExceedsBattery: energyKwh !== null && batteryKwh !== null && batteryKwh > 0 && energyKwh > batteryKwh,
  };
}

/** Inverse standard-normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("p must be in (0, 1)");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * z for a two-sided 95 % interval after a Bonferroni correction for `comparisons` tests, so
 * checking many stations at once does not flag one by chance alone.
 */
export function bonferroniZ(comparisons: number, alpha = 0.05): number {
  return normalQuantile(1 - alpha / (2 * Math.max(1, comparisons)));
}

/** Wilson score interval for a binomial proportion (z = 1.96 → 95 %). */
export function wilson(successes: number, n: number, z = 1.96): { rate: number; low: number; high: number } {
  if (n === 0) return { rate: 0, low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface Rate {
  count: number;
  /** Sessions that carry the label/fields needed to decide. */
  of: number;
  rate: number | null;
  low: number | null;
  high: number | null;
}

function rate(count: number, of: number): Rate {
  if (of === 0) return { count, of, rate: null, low: null, high: null };
  const w = wilson(count, of);
  return { count, of, rate: w.rate, low: w.low, high: w.high };
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function present<T>(xs: (T | null)[]): T[] {
  return xs.filter((x): x is T => x !== null);
}

export interface SessionSummary {
  sessions: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Sum of derived energy (kWh) over sessions that have both power and duration. */
  energyKwh: number | null;
  energySessions: number;
  avgDurationMin: number | null;
  avgChargingPowerKw: number | null;
  medianPowerLossKw: number | null;
  /** Median of power_loss / power_consumed over sessions with consumed > 0. */
  medianLossShare: number | null;
  highLoss: Rate;
  poorStability: Rate;
  avgVoltageFluctuationPct: number | null;
  avgGridStability: number | null;
  lossExceedsConsumed: Rate;
  energyExceedsBattery: Rate;
  /** Median cost per derived kWh, in the dataset's (unstated) currency. */
  costPerKwh: number | null;
  chargingModes: Record<string, number>;
}

export function summarizeSessions(sessions: readonly NormalizedSession[]): SessionSummary {
  const times = sessions.map((s) => s.startedAt.getTime());
  const energies = present(sessions.map((s) => s.energyKwh));
  const shares = present(
    sessions.map((s) => (s.powerLossKw !== null && s.powerConsumedKw !== null && s.powerConsumedKw > 0 ? s.powerLossKw / s.powerConsumedKw : null)),
  );
  const losses = present(sessions.map((s) => s.powerLossKw));
  const lossLabelled = sessions.filter((s) => s.lossCategory !== null);
  const stabilityLabelled = sessions.filter((s) => s.stabilityCategory !== null);
  const lossComparable = sessions.filter((s) => s.powerLossKw !== null && s.powerConsumedKw !== null);
  const batteryComparable = sessions.filter((s) => s.energyKwh !== null && s.batteryKwh !== null && s.batteryKwh > 0);
  const tariffs = present(sessions.map((s) => (s.cost !== null && s.energyKwh !== null && s.energyKwh > 0 ? s.cost / s.energyKwh : null)));
  const chargingModes: Record<string, number> = {};
  for (const s of sessions) {
    const m = s.chargingMode ?? "Not recorded";
    chargingModes[m] = (chargingModes[m] ?? 0) + 1;
  }
  return {
    sessions: sessions.length,
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    energyKwh: energies.length ? energies.reduce((a, b) => a + b, 0) : null,
    energySessions: energies.length,
    avgDurationMin: mean(present(sessions.map((s) => s.durationMin))),
    avgChargingPowerKw: mean(present(sessions.map((s) => s.chargingPowerKw))),
    medianPowerLossKw: losses.length ? median(losses) : null,
    medianLossShare: shares.length ? median(shares) : null,
    highLoss: rate(lossLabelled.filter((s) => s.lossCategory!.toLowerCase() === "high").length, lossLabelled.length),
    poorStability: rate(stabilityLabelled.filter((s) => s.stabilityCategory!.toLowerCase() === "poor").length, stabilityLabelled.length),
    avgVoltageFluctuationPct: mean(present(sessions.map((s) => s.voltageFluctuationPct))),
    avgGridStability: mean(present(sessions.map((s) => s.gridStability))),
    lossExceedsConsumed: rate(lossComparable.filter((s) => s.lossExceedsConsumed).length, lossComparable.length),
    energyExceedsBattery: rate(batteryComparable.filter((s) => s.energyExceedsBattery).length, batteryComparable.length),
    costPerKwh: tariffs.length ? median(tariffs) : null,
    chargingModes,
  };
}

export function groupBy<T>(items: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export interface DailyPoint {
  day: string;
  sessions: number;
  energyKwh: number | null;
  highLossRate: number | null;
  medianLossShare: number | null;
}

/** One point per UTC day. */
export function dailySeries(sessions: readonly NormalizedSession[]): DailyPoint[] {
  const byDay = groupBy(sessions, (s) => s.startedAt.toISOString().slice(0, 10));
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => {
      const s = summarizeSessions(list);
      return { day, sessions: s.sessions, energyKwh: s.energyKwh, highLossRate: s.highLoss.rate, medianLossShare: s.medianLossShare };
    });
}

/** Theil–Sen slope per day of a daily series value; null when fewer than 4 points. */
export function dailySlope(points: readonly DailyPoint[], value: (p: DailyPoint) => number | null): number | null {
  const pts = points
    .map((p) => ({ t: Date.parse(`${p.day}T00:00:00Z`), value: value(p) }))
    .filter((p): p is { t: number; value: number } => p.value !== null);
  if (pts.length < 4) return null;
  return theilSen(pts)?.slopePerDay ?? null;
}

/** Whether a set of sessions has the columns each metric needs. */
export function coverage(sessions: readonly NormalizedSession[]): Record<SessionField | "lossCategory" | "stabilityCategory", boolean> {
  const any = (f: (s: NormalizedSession) => unknown) => sessions.some((s) => f(s) !== null);
  return {
    powerLossKw: any((s) => s.powerLossKw),
    powerConsumedKw: any((s) => s.powerConsumedKw),
    chargingPowerKw: any((s) => s.chargingPowerKw),
    durationMin: any((s) => s.durationMin),
    cost: any((s) => s.cost),
    batteryKwh: any((s) => s.batteryKwh),
    voltageFluctuationPct: any((s) => s.voltageFluctuationPct),
    gridStability: any((s) => s.gridStability),
    lossCategory: any((s) => s.lossCategory),
    stabilityCategory: any((s) => s.stabilityCategory),
  };
}
