import { ANALYSIS_PARAMS, ANALYSIS_VERSION, type AnalysisParams } from "@/config/analysis";
import { HEALTH_LABELS, METRICS, METRIC_KEYS, type HealthStatus, type MetricKey } from "@/config/domain";
import { assessMetric, worstStatus } from "@/features/anomaly-detection/assess-metric";
import type { ChargerHealthSummary, MetricAssessment, ObservationInput } from "@/types/analysis";

export type ObservationsByMetric = Partial<Record<MetricKey, ObservationInput[]>>;

export const NEXT_ACTIONS: Record<HealthStatus, string> = {
  normal:
    "No action indicated by the available data. Continue routine maintenance and measurements; this is not a safety certification.",
  monitor:
    "Keep in service but watch closely: collect the next scheduled measurements promptly and review fault logs.",
  inspection_recommended:
    "Arrange a physical inspection of the connector by qualified personnel. Until then, prefer alternatives where convenient.",
  insufficient_data:
    "Collect more measurements (or more recent ones) before drawing any conclusion about this connector.",
};

/**
 * Combines per-metric assessments into one charger-level status.
 *
 * Rules (documented on the Analytics page):
 *  1. Supporting metrics (e.g. temperature rise) never set the status on their own.
 *  2. The status is the worst status among primary metrics that could be assessed.
 *  3. If two or more independent primary metrics each show "monitor", the charger is
 *     escalated to "inspection recommended" (corroborating evidence).
 *  4. If no primary metric could be assessed, the status is "insufficient data" —
 *     missing data is never treated as evidence of health.
 */
export function assessCharger(
  observations: ObservationsByMetric,
  now: Date,
  params: AnalysisParams = ANALYSIS_PARAMS,
): ChargerHealthSummary {
  // Historical data (nothing recent) is still analysed — as of its newest reading — and
  // clearly labelled as historical. It never stands in for the connector's current state.
  const tolerance = params.futureToleranceMinutes * 60_000;
  let newest: number | null = null;
  for (const key of METRIC_KEYS) {
    for (const o of observations[key] ?? []) {
      const t = o.observedAt.getTime();
      if (Number.isFinite(o.value) && t <= now.getTime() + tolerance) newest = Math.max(newest ?? t, t);
    }
  }
  const historical = newest !== null && now.getTime() - newest > params.staleAfterDays * 86_400_000;
  const asOf = historical ? new Date(newest! + 60_000) : now;

  const metrics: MetricAssessment[] = [];
  for (const key of METRIC_KEYS) {
    const obs = observations[key];
    if (obs && obs.length > 0) metrics.push(assessMetric(key, obs, asOf, params));
  }

  const primary = metrics.filter((m) => !METRICS[m.metric].supporting);
  const assessable = primary.filter((m) => m.status !== "insufficient_data");
  const reasons: string[] = [];

  let status: HealthStatus;
  if (assessable.length === 0) {
    status = "insufficient_data";
    if (metrics.length === 0) reasons.push("No health observations have been recorded for this charger.");
    else if (primary.length === 0) reasons.push("Only supporting measurements are available; they cannot establish connector health alone.");
    else reasons.push("Available primary measurements are too few or too old to establish a baseline.");
  } else {
    status = worstStatus(assessable.map((m) => m.status));
    const monitorCount = assessable.filter((m) => m.status === "monitor").length;
    if (status === "monitor" && monitorCount >= 2) {
      status = "inspection_recommended";
      reasons.push(`${monitorCount} independent metrics show concerning patterns at the same time.`);
    }
    for (const m of assessable) {
      for (const f of m.findings) reasons.push(`${METRICS[m.metric].label}: ${f.explanation}`);
    }
    if (status === "normal") reasons.push("No persistent deviation, sustained trend or recurring fault pattern in the assessed metrics.");
  }

  const assessedLabels = assessable.map((m) => METRICS[m.metric].label.toLowerCase());
  const missing = METRIC_KEYS.filter((k) => !METRICS[k].supporting && !assessable.some((m) => m.metric === k)).map((k) =>
    METRICS[k].label.toLowerCase(),
  );
  const coverageNote =
    (assessedLabels.length ? `Assessed: ${assessedLabels.join(", ")}.` : "No primary metric could be assessed.") +
    (missing.length ? ` No usable data for: ${missing.join(", ")}.` : "") +
    ` "${HEALTH_LABELS[status]}" describes the available evidence only.`;
  if (historical) {
    const asOfDay = new Date(newest!).toISOString().slice(0, 10);
    for (const m of metrics) for (const f of m.findings) f.confidenceNote += ` Based on historical data up to ${asOfDay}; nothing recent is available.`;
    reasons.unshift(
      `Historical assessment: the newest reading is from ${new Date(newest!).toISOString().slice(0, 10)}, ` +
        `more than ${params.staleAfterDays} days ago. It describes the connector at that time, not today.`,
    );
  }

  let latest: number | null = null;
  for (const m of metrics) {
    if (m.latest) latest = Math.max(latest ?? 0, new Date(m.latest.at).getTime());
  }
  const stale = latest === null || now.getTime() - latest > params.staleAfterDays * 86_400_000;

  return {
    status,
    evaluatedAt: now.toISOString(),
    assessedAsOf: asOf.toISOString(),
    historical,
    analysisVersion: ANALYSIS_VERSION,
    latestObservationAt: latest === null ? null : new Date(latest).toISOString(),
    stale,
    reasons,
    coverageNote,
    nextAction: historical
      ? `${NEXT_ACTIONS[status]} Collect current measurements before acting: this assessment is based on old data.`
      : NEXT_ACTIONS[status],
    metrics,
  };
}
