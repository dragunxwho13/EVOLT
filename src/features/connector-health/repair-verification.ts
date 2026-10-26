/**
 * Did the repair work, and did it last?
 *
 * Maintenance logs record that work was done; they rarely record whether it worked. For each
 * recorded maintenance event this compares the readings after it with the connector's own
 * baseline and deviation threshold (the same ones the health analysis uses):
 *
 *  - awaiting_measurement  no reading since the work
 *  - restored_pending      back within the normal range, but too few readings / days to say it held
 *  - held                  back within range for ≥ N readings over ≥ D days
 *  - relapsed              back within range at first, then above the threshold again
 *  - partial               improved by at least half of the excess, but still above the threshold
 *  - no_effect             still above the threshold and not meaningfully lower than before
 *
 * Readings after the next maintenance belong to that event. Outcomes describe the
 * measurements, not the quality of anyone's work.
 */
import { ANALYSIS_PARAMS, type AnalysisParams } from "@/config/analysis";
import { MAINTENANCE_ACTIONS, METRICS, type MaintenanceAction, type MetricKey } from "@/config/domain";
import { deviationThreshold } from "@/features/anomaly-detection/assess-metric";
import { median } from "@/features/anomaly-detection/stats";
import { formatDate, formatMetricValue, formatNumber, formatPercent } from "@/lib/utils/format";

const DAY_MS = 86_400_000;

export const REPAIR_OUTCOMES = ["held", "relapsed", "partial", "no_effect", "restored_pending", "awaiting_measurement"] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

export const REPAIR_OUTCOME_LABELS: Record<RepairOutcome, string> = {
  held: "Fix held",
  relapsed: "Relapsed",
  partial: "Partly improved",
  no_effect: "No measurable effect",
  restored_pending: "Restored — still confirming",
  awaiting_measurement: "Awaiting a new reading",
};

/** Outcomes that count as a conclusion (used for success rates). */
export const CONCLUSIVE_OUTCOMES: readonly RepairOutcome[] = ["held", "relapsed", "partial", "no_effect"];

export interface MaintenanceEventInput {
  id: string;
  performedAt: Date;
  action: MaintenanceAction;
}

export interface RepairVerification {
  eventId: string;
  action: MaintenanceAction;
  performedAt: string;
  metric: MetricKey;
  outcome: RepairOutcome;
  threshold: number;
  baselineMedian: number;
  /** Median of up to three readings before the work. */
  before: number | null;
  /** First reading after the work (its immediate effect). */
  after: number | null;
  readingsAfter: number;
  daysObserved: number;
  relapseAt: string | null;
  daysToRelapse: number | null;
  /** Share of the excess over baseline removed by the work (null when there was no excess). */
  improvement: number | null;
  explanation: string;
}

export interface VerifyInput {
  metric: MetricKey;
  /** Time-ordered readings in canonical units, temperature-corrected when the assessment was. */
  points: readonly { t: number; value: number }[];
  baseline: { median: number; scale: number };
  events: readonly MaintenanceEventInput[];
  params?: AnalysisParams;
}

export function verifyRepairs(input: VerifyInput): RepairVerification[] {
  const params = input.params ?? ANALYSIS_PARAMS;
  const def = METRICS[input.metric];
  const m = input.baseline.median;
  const threshold = deviationThreshold(m, input.baseline.scale, def.minScale, params);
  const fmt = (v: number) => formatMetricValue(input.metric, v);
  const events = [...input.events].sort((a, b) => a.performedAt.getTime() - b.performedAt.getTime());
  const points = [...input.points].sort((a, b) => a.t - b.t);

  return events.map((ev, i) => {
    const t0 = ev.performedAt.getTime();
    const t1 = events[i + 1]?.performedAt.getTime() ?? Infinity;
    const beforePts = points.filter((p) => p.t <= t0).slice(-3);
    const afterPts = points.filter((p) => p.t > t0 && p.t <= t1);
    const before = beforePts.length ? median(beforePts.map((p) => p.value)) : null;
    const after = afterPts.length ? afterPts[0]!.value : null;
    const daysObserved = afterPts.length ? (afterPts[afterPts.length - 1]!.t - t0) / DAY_MS : 0;
    const excess = before !== null ? before - m : null;
    const improvement = before !== null && after !== null && excess !== null && excess > 0 ? (before - after) / excess : null;

    const result: RepairVerification = {
      eventId: ev.id,
      action: ev.action,
      performedAt: ev.performedAt.toISOString(),
      metric: input.metric,
      outcome: "awaiting_measurement",
      threshold,
      baselineMedian: m,
      before,
      after,
      readingsAfter: afterPts.length,
      daysObserved,
      relapseAt: null,
      daysToRelapse: null,
      improvement,
      explanation: "",
    };
    const was = before !== null ? `from ${fmt(before)} before the work` : "with no reading before the work";

    if (after === null) {
      result.explanation = `No ${def.label.toLowerCase()} reading has been taken since ${formatDate(ev.performedAt)}. Measure again to confirm the work had an effect.`;
      return result;
    }

    if (after <= threshold) {
      // Restored. Look for a later return above the threshold: two consecutive readings, or the latest one.
      let relapseIdx = -1;
      for (let k = 1; k < afterPts.length; k++) {
        const above = afterPts[k]!.value > threshold;
        const nextAbove = k + 1 < afterPts.length ? afterPts[k + 1]!.value > threshold : true;
        if (above && nextAbove) {
          relapseIdx = k;
          break;
        }
      }
      if (relapseIdx >= 0) {
        const rp = afterPts[relapseIdx]!;
        result.outcome = "relapsed";
        result.relapseAt = new Date(rp.t).toISOString();
        result.daysToRelapse = (rp.t - t0) / DAY_MS;
        result.explanation =
          `Readings fell ${was} to ${fmt(after)}, within the normal range (≤ ${fmt(threshold)}), ` +
          `but rose above it again ${formatNumber(result.daysToRelapse, 0)} days later (${fmt(rp.value)} on ${formatDate(new Date(rp.t))}). ` +
          "The underlying cause may not have been removed.";
      } else if (afterPts.length >= params.repairVerifyMinReadings && daysObserved >= params.repairVerifyMinDays) {
        result.outcome = "held";
        result.explanation =
          `Readings fell ${was} to ${fmt(after)} and stayed within the normal range (≤ ${fmt(threshold)}) ` +
          `for ${afterPts.length} readings over ${formatNumber(daysObserved, 0)} days.`;
      } else {
        result.outcome = "restored_pending";
        result.explanation =
          `Readings fell ${was} to ${fmt(after)}, within the normal range. ` +
          `${params.repairVerifyMinReadings} readings over at least ${params.repairVerifyMinDays} days are needed to say the fix held ` +
          `(so far ${afterPts.length} over ${formatNumber(daysObserved, 0)} days).`;
      }
      return result;
    }

    if (improvement !== null && improvement >= params.repairPartialFraction) {
      result.outcome = "partial";
      result.explanation =
        `Readings fell ${was} to ${fmt(after)}, removing ${formatPercent(improvement)} of the excess over the baseline ${fmt(m)}, ` +
        `but they are still above the normal range (${fmt(threshold)}).`;
    } else {
      result.outcome = "no_effect";
      result.explanation =
        `Readings after the work (${fmt(after)}) are still above the normal range (${fmt(threshold)})` +
        (before !== null ? ` and not meaningfully lower than before (${fmt(before)}).` : ".") +
        " Re-inspect: the work may not have reached the cause, or the measurement method changed.";
    }
    return result;
  });
}

export interface RepairSummaryRow {
  action: MaintenanceAction;
  recorded: number;
  conclusive: number;
  held: number;
  relapsed: number;
  partial: number;
  noEffect: number;
  pending: number;
  /** held / conclusive, or null with no conclusive outcome yet. */
  successRate: number | null;
  medianDaysToRelapse: number | null;
}

/** Success rate per kind of work. Pending outcomes are counted but never in the rate. */
export function summarizeRepairs(results: readonly RepairVerification[]): RepairSummaryRow[] {
  return MAINTENANCE_ACTIONS.map((action) => {
    const rows = results.filter((r) => r.action === action);
    const count = (o: RepairOutcome) => rows.filter((r) => r.outcome === o).length;
    const conclusive = rows.filter((r) => CONCLUSIVE_OUTCOMES.includes(r.outcome)).length;
    const relapseDays = rows.filter((r) => r.daysToRelapse !== null).map((r) => r.daysToRelapse!);
    return {
      action,
      recorded: rows.length,
      conclusive,
      held: count("held"),
      relapsed: count("relapsed"),
      partial: count("partial"),
      noEffect: count("no_effect"),
      pending: count("restored_pending") + count("awaiting_measurement"),
      successRate: conclusive ? count("held") / conclusive : null,
      medianDaysToRelapse: relapseDays.length ? median(relapseDays) : null,
    };
  }).filter((r) => r.recorded > 0);
}
