/**
 * When will this connector reach its service limit?
 *
 * The rise is measured with the Theil–Sen slope (median of all pairwise slopes) over the
 * most recent readings since the latest maintenance. Its uncertainty is Sen's (1968)
 * distribution-free confidence interval, read off the sorted pairwise slopes. The date range
 * is the time for the current level (median of the last three readings) to reach the limit
 * at the fast and slow ends of that interval.
 *
 * No date is given unless the whole interval is above zero, i.e. the rise is statistically
 * clear. A forecast is an extrapolation of the recent rate: wear can speed up, slow down or
 * be reset by maintenance, and the explanation says so.
 */
import { ANALYSIS_PARAMS, type AnalysisParams } from "@/config/analysis";
import { METRICS, type MetricKey } from "@/config/domain";
import { normalQuantile } from "@/features/sessions/metrics";
import { formatDate, formatMetricValue, formatNumber, formatPercent } from "@/lib/utils/format";
import type { ServiceForecast } from "@/types/analysis";
import { median } from "./stats";

const DAY_MS = 86_400_000;

export interface SlopeInterval {
  slope: number;
  low: number;
  high: number;
  pairs: number;
}

/** Theil–Sen slope (per day) with Sen's rank-based confidence interval. */
export function senSlopeInterval(points: readonly { t: number; value: number }[], confidence: number): SlopeInterval | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = (points[j]!.t - points[i]!.t) / DAY_MS;
      if (dt > 0) slopes.push((points[j]!.value - points[i]!.value) / dt);
    }
  }
  const n = points.length;
  const N = slopes.length;
  if (n < 3 || N < 3) return null;
  slopes.sort((a, b) => a - b);
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const c = z * Math.sqrt((n * (n - 1) * (2 * n + 5)) / 18);
  // 1-based ranks M1 = (N − C)/2 and M2 + 1 = (N + C)/2 + 1, clamped to the available slopes.
  const lowRank = Math.max(1, Math.min(N, Math.round((N - c) / 2)));
  const highRank = Math.max(1, Math.min(N, Math.round((N + c) / 2) + 1));
  return { slope: median(slopes), low: slopes[lowRank - 1]!, high: slopes[highRank - 1]!, pairs: N };
}

export interface ForecastInput {
  metric: MetricKey;
  /** Clean, time-ordered readings (already temperature-corrected where applicable). */
  points: readonly { t: number; value: number }[];
  baselineMedian: number | null;
  /** Operator-set absolute limit in the metric's canonical unit, if any. */
  operatorLimit?: number | null;
  /** Only readings after this time are used (latest maintenance). */
  since?: Date | null;
  params?: AnalysisParams;
}

function iso(t: number): string {
  return new Date(t).toISOString();
}

export function forecastServiceLimit(input: ForecastInput): ServiceForecast | null {
  const params = input.params ?? ANALYSIS_PARAMS;
  const def = METRICS[input.metric];
  if (!def.forecast) return null;
  const operator = input.operatorLimit !== null && input.operatorLimit !== undefined && input.operatorLimit > 0;
  if (!operator && (input.baselineMedian === null || input.baselineMedian <= 0)) return null;
  const limit = operator ? input.operatorLimit! : input.baselineMedian! * (1 + params.forecastLimitRelative);
  const limitText = operator
    ? `the operator's service limit of ${formatMetricValue(input.metric, limit)}`
    : `the default service limit of ${formatMetricValue(input.metric, limit)} (baseline + ${formatPercent(params.forecastLimitRelative)}; set your own on this charger)`;

  const sinceT = input.since ? input.since.getTime() : null;
  const usable = input.points.filter((p) => sinceT === null || p.t > sinceT);
  const pts = usable.slice(-params.forecastWindow);
  const latest = pts[pts.length - 1];
  const spanDays = pts.length > 1 ? (pts[pts.length - 1]!.t - pts[0]!.t) / DAY_MS : 0;
  const currentLevel = pts.length ? median(pts.slice(-3).map((p) => p.value)) : null;

  const empty: ServiceForecast = {
    status: "insufficient_data",
    limit,
    limitSource: operator ? "operator" : "default",
    unit: def.unit,
    pointsUsed: pts.length,
    spanDays,
    since: input.since ? input.since.toISOString() : null,
    slopePerDay: null,
    slopeLowPerDay: null,
    slopeHighPerDay: null,
    confidence: params.forecastConfidence,
    currentLevel,
    latestAt: latest ? iso(latest.t) : null,
    daysToLimit: null,
    daysEarliest: null,
    daysLatest: null,
    expectedDate: null,
    earliestDate: null,
    latestDate: null,
    beyondHorizon: false,
    extrapolated: false,
    explanation: "",
  };

  if (currentLevel !== null && currentLevel >= limit) {
    return {
      ...empty,
      status: "already_above",
      explanation: `The current level, ${formatMetricValue(input.metric, currentLevel)} (median of the last three readings), is already at or above ${limitText}.`,
    };
  }
  if (pts.length < params.forecastMinPoints || spanDays <= 0) {
    return {
      ...empty,
      explanation:
        `${pts.length} reading(s) ${input.since ? `since the maintenance on ${formatDate(input.since)}` : "available"}; ` +
        `at least ${params.forecastMinPoints} are needed to forecast when ${limitText} would be reached.`,
    };
  }

  const ci = senSlopeInterval(pts, params.forecastConfidence);
  if (!ci) return { ...empty, explanation: "Too few distinct readings to estimate a rate of change." };
  const withSlope = { ...empty, slopePerDay: ci.slope, slopeLowPerDay: ci.low, slopeHighPerDay: ci.high };
  const conf = formatPercent(params.forecastConfidence);

  if (!(ci.low > 0)) {
    return {
      ...withSlope,
      status: "not_rising",
      explanation:
        `Over the last ${pts.length} readings (${formatNumber(spanDays, 0)} days) there is no statistically clear rise ` +
        `(${conf} range of the rate: ${formatNumber(ci.low * 30, 4)} to ${formatNumber(ci.high * 30, 4)} ${def.unit} per 30 days), so no date is forecast.`,
    };
  }

  const gap = limit - currentLevel!;
  const days = gap / ci.slope;
  const earliest = gap / ci.high;
  const latestDays = gap / ci.low;
  const horizon = params.forecastHorizonDays;
  const base = latest!.t;
  const beyondHorizon = earliest > horizon;
  const out: ServiceForecast = {
    ...withSlope,
    status: "projected",
    daysToLimit: days,
    daysEarliest: earliest,
    daysLatest: latestDays > horizon ? null : latestDays,
    expectedDate: days > horizon ? null : iso(base + days * DAY_MS),
    earliestDate: beyondHorizon ? null : iso(base + earliest * DAY_MS),
    latestDate: latestDays > horizon ? null : iso(base + latestDays * DAY_MS),
    beyondHorizon,
    extrapolated: days > spanDays,
    explanation: "",
  };

  const rate = `${formatMetricValue(input.metric, ci.slope * 30)} per 30 days`;
  if (beyondHorizon) {
    out.explanation =
      `Rising by about ${rate}, but even at the fast end of the ${conf} range it would take more than ${horizon} days to reach ${limitText}.`;
  } else {
    const range = out.latestDate
      ? `${formatDate(out.earliestDate)} to ${formatDate(out.latestDate)}`
      : `${formatDate(out.earliestDate)} or later`;
    out.explanation =
      `At the recent rate (about ${rate}, from ${pts.length} readings over ${formatNumber(spanDays, 0)} days` +
      `${input.since ? ` since the maintenance on ${formatDate(input.since)}` : ""}), ` +
      `the level would reach ${limitText} ` +
      (out.expectedDate ? `around ${formatDate(out.expectedDate)} ` : "") +
      `(${conf} range: ${range}).` +
      (out.extrapolated ? " This looks further ahead than the readings cover, so treat the date as indicative." : "");
  }
  return out;
}
