import "server-only";
import { loadSessions, type SessionFilter } from "@/features/sessions/service";
import { computePerformance, type Performance } from "./performance";

export async function getPerformance(filter: SessionFilter = {}): Promise<Performance> {
  const filtered = computePerformance(await loadSessions(filter));
  if (!filter.area && !filter.chargingMode) return filtered;
  // Keep the full list of filter options even when a filter narrows the data.
  const all = computePerformance(await loadSessions());
  return { ...filtered, filters: all.filters };
}
