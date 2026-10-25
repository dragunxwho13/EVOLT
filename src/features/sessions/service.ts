import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chargers, chargingSessions, stations } from "@/lib/db/schema";
import { normalizeSession, type NormalizedSession } from "./metrics";

export interface SessionFilter {
  stationId?: string;
  chargingMode?: string;
  area?: string;
}

/** Loads stored sessions with their charger and station, normalised for analysis. */
export async function loadSessions(filter: SessionFilter = {}): Promise<NormalizedSession[]> {
  const where: SQL[] = [];
  if (filter.stationId) where.push(eq(stations.id, filter.stationId));
  if (filter.chargingMode) where.push(eq(chargingSessions.chargingMode, filter.chargingMode));
  if (filter.area) where.push(eq(chargingSessions.area, filter.area));
  const rows = await getDb()
    .select({
      stationId: stations.id,
      stationCode: stations.code,
      stationName: stations.name,
      chargerId: chargers.id,
      chargerCode: chargers.code,
      chargingMode: chargingSessions.chargingMode,
      area: chargingSessions.area,
      startedAt: chargingSessions.startedAt,
      values: chargingSessions.values,
      labels: chargingSessions.labels,
    })
    .from(chargingSessions)
    .innerJoin(chargers, eq(chargers.id, chargingSessions.chargerId))
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(chargingSessions.startedAt);
  return rows.map(normalizeSession);
}
