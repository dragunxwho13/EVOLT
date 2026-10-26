/**
 * Repair verification for one charger, from data the charger page already has. Pure, so it
 * can run on the server page, in the fleet view and in tests alike.
 */
import { METRICS, REPAIR_METRICS, type MetricKey } from "@/config/domain";
import { analysedValue } from "@/features/anomaly-detection/temperature";
import type { ChargerHealthSummary } from "@/types/analysis";
import { verifyRepairs, type MaintenanceEventInput, type RepairVerification } from "./repair-verification";

export interface StoredObservation {
  metric: MetricKey;
  observedAt: Date;
  value: number;
  temperatureC: number | null;
}

export interface ChargerRepairs {
  metric: MetricKey | null;
  results: RepairVerification[];
  /** Why nothing could be verified, when `metric` is null. */
  reason: string | null;
}

export function verifyChargerRepairs(
  summary: ChargerHealthSummary | null,
  observations: readonly StoredObservation[],
  events: readonly MaintenanceEventInput[],
): ChargerRepairs {
  if (events.length === 0) return { metric: null, results: [], reason: null };
  for (const metric of REPAIR_METRICS) {
    const assessment = summary?.metrics.find((m) => m.metric === metric);
    if (!assessment?.baseline) continue;
    const applied = Boolean(assessment.temperatureCorrection?.applied);
    const points = observations
      .filter((o) => o.metric === metric && Number.isFinite(o.value))
      .map((o) => ({ t: o.observedAt.getTime(), value: analysedValue(metric, o.value, o.temperatureC, applied) }));
    return {
      metric,
      results: verifyRepairs({ metric, points, baseline: assessment.baseline, events }),
      reason: null,
    };
  }
  return {
    metric: null,
    results: [],
    reason: `Repairs are checked against ${REPAIR_METRICS.map((m) => METRICS[m].label.toLowerCase()).join(" or ")}, and neither has an established baseline for this charger yet.`,
  };
}
