/** Small, dependency-free robust statistics used by the health analysis. */

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of empty array");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Median absolute deviation (unscaled). */
export function mad(values: readonly number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/** Consistency constant that makes MAD estimate σ for normally distributed data. */
export const MAD_TO_SIGMA = 1.4826;

/**
 * Robust spread estimate with floors so a perfectly flat baseline does not turn
 * negligible changes into enormous z-scores.
 */
export function robustScale(values: readonly number[], minScale: number): number {
  const m = median(values);
  return Math.max(MAD_TO_SIGMA * mad(values), minScale, Math.abs(m) * 0.02);
}

export interface TrendEstimate {
  /** Theil–Sen slope in value units per day. */
  slopePerDay: number;
  /** Fraction of point pairs whose slope is strictly positive (adverse for higher-is-worse). */
  positiveFraction: number;
  spanDays: number;
}

const DAY_MS = 86_400_000;

/**
 * Theil–Sen estimator: the median of all pairwise slopes. Robust to a minority of
 * outliers, which matters because a single bad reading must not create a "trend".
 */
export function theilSen(points: readonly { t: number; value: number }[]): TrendEstimate | null {
  if (points.length < 3) return null;
  const slopes: number[] = [];
  let positive = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dtDays = (points[j]!.t - points[i]!.t) / DAY_MS;
      if (dtDays <= 0) continue;
      const slope = (points[j]!.value - points[i]!.value) / dtDays;
      slopes.push(slope);
      if (slope > 0) positive++;
    }
  }
  if (slopes.length === 0) return null;
  const spanDays = (points[points.length - 1]!.t - points[0]!.t) / DAY_MS;
  return { slopePerDay: median(slopes), positiveFraction: positive / slopes.length, spanDays };
}

/** Deterministic PRNG (mulberry32) for reproducible synthetic data and tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample using Box–Muller on a supplied uniform source. */
export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
