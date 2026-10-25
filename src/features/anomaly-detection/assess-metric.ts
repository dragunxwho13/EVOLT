import { ANALYSIS_PARAMS, type AnalysisParams } from "@/config/analysis";
import { METRICS, type HealthStatus, type MetricKey } from "@/config/domain";
import type {
  BaselineSummary,
  Finding,
  MetricAssessment,
  ObservationInput,
  PointEvidence,
  QualityFlag,
} from "@/types/analysis";
import { formatMetricValue, formatNumber, formatPercent } from "@/lib/utils/format";
import { median, robustScale, theilSen } from "./stats";

const DAY_MS = 86_400_000;

interface CleanPoint {
  t: number;
  value: number;
}

export interface CleanSeries {
  points: CleanPoint[];
  flags: QualityFlag[];
  excluded: number;
}

/**
 * Validates and orders one metric's observations. Invalid values are excluded and
 * reported — never replaced with zero or any other stand-in.
 */
export function cleanSeries(
  metric: MetricKey,
  observations: readonly ObservationInput[],
  now: Date,
  params: AnalysisParams = ANALYSIS_PARAMS,
): CleanSeries {
  const [lo, hi] = METRICS[metric].plausible;
  const futureLimit = now.getTime() + params.futureToleranceMinutes * 60_000;
  let nonFinite = 0;
  let implausible = 0;
  let future = 0;
  let duplicates = 0;
  const kept: CleanPoint[] = [];

  for (const o of observations) {
    const t = o.observedAt.getTime();
    if (!Number.isFinite(o.value) || Number.isNaN(t)) {
      nonFinite++;
      continue;
    }
    if (o.value < lo || o.value > hi) {
      implausible++;
      continue;
    }
    if (t > futureLimit) {
      future++;
      continue;
    }
    kept.push({ t, value: o.value });
  }
  kept.sort((a, b) => a.t - b.t);
  const points: CleanPoint[] = [];
  for (const p of kept) {
    if (points.length > 0 && points[points.length - 1]!.t === p.t) {
      duplicates++;
      continue;
    }
    points.push(p);
  }

  const flags: QualityFlag[] = [];
  if (nonFinite) flags.push({ code: "non_finite_value", count: nonFinite, message: `${nonFinite} non-numeric or missing value(s) excluded.` });
  if (implausible)
    flags.push({
      code: "implausible_value",
      count: implausible,
      message: `${implausible} value(s) outside the plausible range ${lo}–${hi} ${METRICS[metric].unit} excluded.`,
    });
  if (future) flags.push({ code: "future_timestamp", count: future, message: `${future} observation(s) timestamped in the future excluded.` });
  if (duplicates)
    flags.push({ code: "duplicate_timestamp", count: duplicates, message: `${duplicates} duplicate timestamp(s) ignored; the first value was kept.` });

  return { points, flags, excluded: nonFinite + implausible + future + duplicates };
}

function toEvidence(p: CleanPoint, baseline?: { median: number; scale: number }): PointEvidence {
  const ev: PointEvidence = { at: new Date(p.t).toISOString(), value: p.value };
  if (baseline) ev.z = round((p.value - baseline.median) / baseline.scale, 2);
  return ev;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function medianIntervalDays(points: CleanPoint[]): number | null {
  if (points.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) gaps.push((points[i]!.t - points[i - 1]!.t) / DAY_MS);
  return round(median(gaps), 2);
}

const STATUS_RANK: Record<HealthStatus, number> = {
  insufficient_data: 0,
  normal: 1,
  monitor: 2,
  inspection_recommended: 3,
};

/** The value above which a single reading counts as deviating from the baseline. */
export function deviationThreshold(baselineMedian: number, scale: number, minScale: number, params: AnalysisParams): number {
  const relFloor = baselineMedian + params.minRelativeDeviation * Math.max(Math.abs(baselineMedian), minScale);
  return Math.max(baselineMedian + params.deviationZ * scale, relFloor);
}

export function isDeviation(value: number, baselineMedian: number, scale: number, minScale: number, params: AnalysisParams): boolean {
  return value > deviationThreshold(baselineMedian, scale, minScale, params);
}

export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc), "insufficient_data");
}

/**
 * Assesses a single metric's history for one charger. Deterministic: the same
 * inputs and `now` always produce the same output.
 */
export function assessMetric(
  metric: MetricKey,
  observations: readonly ObservationInput[],
  now: Date,
  params: AnalysisParams = ANALYSIS_PARAMS,
): MetricAssessment {
  const def = METRICS[metric];
  const { points, flags, excluded } = cleanSeries(metric, observations, now, params);
  const notes: string[] = [];
  const base: MetricAssessment = {
    metric,
    status: "insufficient_data",
    validPoints: points.length,
    excludedPoints: excluded,
    latest: points.length ? toEvidence(points[points.length - 1]!) : null,
    baseline: null,
    medianIntervalDays: medianIntervalDays(points),
    findings: [],
    qualityFlags: flags,
    notes,
  };

  if (points.length === 0) {
    notes.push(`No valid ${def.label.toLowerCase()} observations are available.`);
    return base;
  }

  const latest = points[points.length - 1]!;
  const ageDays = (now.getTime() - latest.t) / DAY_MS;
  const stale = ageDays > params.staleAfterDays;
  if (stale) {
    flags.push({
      code: "stale",
      message: `Latest observation is ${Math.floor(ageDays)} days old (stale after ${params.staleAfterDays} days).`,
    });
  }

  if (base.medianIntervalDays && points.length >= 4) {
    let maxGap = 0;
    for (let i = 1; i < points.length; i++) maxGap = Math.max(maxGap, (points[i]!.t - points[i - 1]!.t) / DAY_MS);
    if (maxGap > base.medianIntervalDays * 5 && maxGap > 7) {
      flags.push({
        code: "irregular_sampling",
        message: `Irregular sampling: largest gap ${formatNumber(maxGap, 0)} days vs typical ${formatNumber(base.medianIntervalDays, 1)} days.`,
      });
    }
  }

  const findings = metric === "fault_count" ? assessFaults(points, params, notes) : assessContinuous(metric, points, params, notes, base);
  if (findings === null) {
    flags.push({ code: "insufficient_history", message: notes[notes.length - 1] ?? "Insufficient history." });
    return base;
  }

  const confidenceSuffix = stale
    ? ` The newest data point is ${Math.floor(ageDays)} days old, so the current condition may differ.`
    : "";

  if (def.supporting) {
    // Supporting metrics never raise alerts on their own; keep the observation as context.
    for (const f of findings) {
      notes.push(`Supporting signal only (not alerted): ${f.explanation}`);
    }
    base.status = stale ? "insufficient_data" : findings.length ? "monitor" : "normal";
    return base;
  }

  for (const f of findings) f.confidenceNote += confidenceSuffix;
  base.findings = findings;

  if (findings.length > 0) {
    base.status = worstStatus(findings.map((f) => f.severity));
  } else if (stale) {
    base.status = "insufficient_data";
    notes.push("Earlier data showed no flagged pattern, but it is too old to describe the current condition.");
  } else {
    base.status = "normal";
  }
  return base;
}

function assessContinuous(
  metric: MetricKey,
  points: CleanPoint[],
  params: AnalysisParams,
  notes: string[],
  out: MetricAssessment,
): Finding[] | null {
  const def = METRICS[metric];
  const needed = params.minBaselinePoints + params.minRecentPoints;
  if (points.length < needed) {
    notes.push(
      `${points.length} valid observation(s); at least ${needed} are needed (${params.minBaselinePoints} for a baseline plus ${params.minRecentPoints} to compare).`,
    );
    return null;
  }

  const baselineN = Math.min(params.maxBaselinePoints, points.length - params.minRecentPoints);
  const basePts = points.slice(0, baselineN);
  const recent = points.slice(baselineN);
  const m = median(basePts.map((p) => p.value));
  const scale = robustScale(
    basePts.map((p) => p.value),
    def.minScale,
  );
  const baseline: BaselineSummary = {
    median: round(m, 6),
    scale: round(scale, 6),
    n: baselineN,
    from: new Date(basePts[0]!.t).toISOString(),
    to: new Date(basePts[basePts.length - 1]!.t).toISOString(),
  };
  out.baseline = baseline;
  const z = (v: number) => (v - m) / scale;
  const rel = (v: number) => (v - m) / Math.max(Math.abs(m), def.minScale);
  const findings: Finding[] = [];

  // Rule 1: persistent deviation across the most recent observations.
  const windowPts = recent.slice(-params.persistenceWindow);
  const exceed = windowPts.filter((p) => isDeviation(p.value, m, scale, def.minScale, params));
  const severe = exceed.filter((p) => rel(p.value) >= params.severeRelativeDeviation);
  const required = Math.min(params.persistenceMinCount, windowPts.length);
  const thresholdValue = deviationThreshold(m, scale, def.minScale, params);
  const baselineExceed = basePts.filter((p) => isDeviation(p.value, m, scale, def.minScale, params)).length;
  const unstableBaseline = baselineExceed / basePts.length > params.maxBaselineExceedFraction;
  if (exceed.length >= required && unstableBaseline) {
    notes.push(
      `${exceed.length} recent reading(s) are above ${formatMetricValue(metric, thresholdValue)}, but so were ${baselineExceed} of the ` +
        `${basePts.length} baseline readings. The baseline is too variable to call this a deviation, so no alert was raised.`,
    );
  } else if (exceed.length >= required) {
    const maxZ = Math.max(...windowPts.map((p) => z(p.value)));
    const maxRel = Math.max(...windowPts.map((p) => rel(p.value)));
    const severity = severe.length >= required ? "inspection_recommended" : "monitor";
    findings.push({
      metric,
      rule: "persistent_deviation",
      severity,
      windowStart: new Date(windowPts[0]!.t).toISOString(),
      windowEnd: new Date(windowPts[windowPts.length - 1]!.t).toISOString(),
      evidence: {
        kind: "persistent_deviation",
        unit: def.unit,
        baseline,
        thresholdZ: params.deviationZ,
        thresholdValue: round(thresholdValue, 6),
        windowSize: windowPts.length,
        exceedCount: exceed.length,
        requiredCount: required,
        maxZ: round(maxZ, 2),
        points: windowPts.map((p) => toEvidence(p, { median: m, scale })),
      },
      explanation:
        `${exceed.length} of the last ${windowPts.length} ${def.label.toLowerCase()} observations exceeded ` +
        `${formatMetricValue(metric, thresholdValue)} — the larger of the baseline median ${formatMetricValue(metric, m)} ` +
        `plus ${params.deviationZ} robust spreads (spread ${formatNumber(scale)} ${def.unit}, from the first ${baselineN} observations) ` +
        `and +${formatPercent(params.minRelativeDeviation)} of the median. ` +
        `The largest deviation was ${formatNumber(maxZ, 1)} spreads (${formatPercent(maxRel)}) above baseline` +
        (severity === "inspection_recommended"
          ? `; ${severe.length} reading(s) were at least ${formatPercent(params.severeRelativeDeviation)} above it.`
          : "."),
      confidenceNote:
        `Based on ${points.length} valid observations. A deviation from this charger's own history is not proof of physical degradation; ` +
        `measurement method changes, sensor faults or operating conditions can produce the same pattern.`,
      suggestedAction:
        severity === "inspection_recommended"
          ? "Schedule a physical inspection of the connector (contacts, pins, latch, cable strain relief) and repeat the measurement."
          : "Keep monitoring; confirm the next measurement uses the same method and conditions.",
    });
  } else if (exceed.length > 0) {
    notes.push(
      `${exceed.length} isolated reading(s) above ${formatMetricValue(metric, thresholdValue)} in the last ${windowPts.length}; ` +
        `not persistent (needs ${required}), so no alert was raised.`,
    );
  }

  // Rule 2: sustained adverse trend over the trend window.
  const trendPts = points.slice(-params.trendWindow);
  const trend = theilSen(trendPts);
  if (trend && trend.spanDays > 0) {
    const projected = trend.slopePerDay * trend.spanDays;
    const denom = Math.max(Math.abs(m), def.minScale);
    const relChange = projected / denom;
    const meets =
      trend.slopePerDay > 0 &&
      trend.positiveFraction >= params.trendConsistency &&
      relChange >= params.trendMinRelativeChange &&
      projected >= params.trendMinScaleMultiple * scale;
    if (meets) {
      const latest = trendPts[trendPts.length - 1]!.value;
      const severity =
        relChange >= params.trendSevereRelativeChange && isDeviation(latest, m, scale, def.minScale, params)
          ? "inspection_recommended"
          : "monitor";
      findings.push({
        metric,
        rule: "sustained_trend",
        severity,
        windowStart: new Date(trendPts[0]!.t).toISOString(),
        windowEnd: new Date(trendPts[trendPts.length - 1]!.t).toISOString(),
        evidence: {
          kind: "sustained_trend",
          unit: def.unit,
          baseline,
          slopePerDay: round(trend.slopePerDay, 6),
          consistency: round(trend.positiveFraction, 3),
          requiredConsistency: params.trendConsistency,
          relativeChange: round(relChange, 3),
          requiredRelativeChange: params.trendMinRelativeChange,
          points: trendPts.map((p) => toEvidence(p, { median: m, scale })),
        },
        explanation:
          `Over the last ${trendPts.length} observations (${formatNumber(trend.spanDays, 0)} days), ${def.label.toLowerCase()} rose by about ` +
          `${formatMetricValue(metric, projected)} (${formatPercent(relChange)} of the baseline median ${formatMetricValue(metric, m)}). ` +
          `${formatPercent(trend.positiveFraction)} of point-to-point comparisons were increases (threshold ${formatPercent(params.trendConsistency)}).`,
        confidenceNote:
          `Trend estimated with the Theil–Sen median slope, which tolerates a minority of outliers. ` +
          `${trendPts.length} points is a short series; the trend may not continue.`,
        suggestedAction:
          severity === "inspection_recommended"
            ? "Inspect the connector and compare against the operator's maintenance limits; consider increasing measurement frequency."
            : "Increase measurement frequency to confirm or rule out the trend.",
      });
    }
  }

  if (findings.length === 0) {
    notes.push(
      `Latest value ${formatMetricValue(metric, recent[recent.length - 1]!.value)} is consistent with the baseline ` +
        `${formatMetricValue(metric, m)}; no persistent deviation or sustained trend was found.`,
    );
  }
  return findings;
}

function assessFaults(points: CleanPoint[], params: AnalysisParams, notes: string[]): Finding[] | null {
  const def = METRICS.fault_count;
  if (points.length < params.minRecentPoints) {
    notes.push(`${points.length} fault report(s); at least ${params.minRecentPoints} reporting periods are needed.`);
    return null;
  }
  const end = points[points.length - 1]!.t;
  const windowStartT = end - params.faultWindowDays * DAY_MS;
  const inWindow = points.filter((p) => p.t > windowStartT);
  const before = points.filter((p) => p.t <= windowStartT);
  const total = inWindow.reduce((s, p) => s + p.value, 0);

  let baselineTotal: number | null = null;
  if (before.length > 0) {
    const spanDays = (windowStartT - before[0]!.t) / DAY_MS;
    if (spanDays >= params.faultWindowDays) {
      const sum = before.reduce((s, p) => s + p.value, 0);
      baselineTotal = round((sum / spanDays) * params.faultWindowDays, 2);
    }
  }

  const aboveBaseline = baselineTotal === null || total > baselineTotal * 1.5;
  let severity: "monitor" | "inspection_recommended" | null = null;
  if (total >= params.faultInspectTotal) severity = "inspection_recommended";
  else if (total >= params.faultMonitorTotal && aboveBaseline) severity = "monitor";

  if (!severity) {
    notes.push(
      `${formatNumber(total, 0)} connector-related fault(s) in the ${params.faultWindowDays}-day window ending at the latest report` +
        (baselineTotal !== null ? ` (historical rate ≈ ${formatNumber(baselineTotal, 1)} per window).` : "."),
    );
    return [];
  }

  return [
    {
      metric: "fault_count",
      rule: "fault_recurrence",
      severity,
      windowStart: new Date(windowStartT).toISOString(),
      windowEnd: new Date(end).toISOString(),
      evidence: {
        kind: "fault_recurrence",
        unit: def.unit,
        windowDays: params.faultWindowDays,
        total,
        monitorThreshold: params.faultMonitorTotal,
        inspectThreshold: params.faultInspectTotal,
        baselineTotal,
        points: inWindow.map((p) => toEvidence(p)),
      },
      explanation:
        `${formatNumber(total, 0)} connector-related faults were logged in the ${params.faultWindowDays} days ending ` +
        `${new Date(end).toISOString().slice(0, 10)} (monitor at ${params.faultMonitorTotal}, inspection at ${params.faultInspectTotal})` +
        (baselineTotal !== null
          ? `, versus a historical rate of about ${formatNumber(baselineTotal, 1)} per ${params.faultWindowDays} days.`
          : "; no earlier history is available for comparison."),
      confidenceNote:
        "Fault codes are logged by the charger and may include causes unrelated to the connector (vehicle-side, network or user handling).",
      suggestedAction:
        severity === "inspection_recommended"
          ? "Review the fault codes with the operator and inspect the connector and cable assembly."
          : "Review the logged fault codes for a common cause before the next maintenance visit.",
    },
  ];
}
