import type { InsightWithWorkflow } from "./service";

/**
 * Counts open action items per station: station-level items directly, charger-level items
 * (health alerts) through the charger's station. Fleet-wide items are not attributed.
 */
export function actionCountsByStation(items: InsightWithWorkflow[], chargerStation: Map<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    if (i.workflow.status === "resolved" || i.workflow.status === "dismissed") continue;
    const stationId = i.subject.kind === "station" ? i.subject.id : i.subject.kind === "charger" && i.subject.id ? chargerStation.get(i.subject.id) : undefined;
    if (stationId) out[stationId] = (out[stationId] ?? 0) + 1;
  }
  return out;
}
