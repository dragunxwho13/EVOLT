import "server-only";
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { ConnectorType, HealthStatus, OperationalStatus } from "@/config/domain";
import { haversineKm, isValidLatLng, type LatLng } from "@/features/station-discovery/geo";
import { summarizeSessions, type SessionSummary } from "@/features/sessions/metrics";
import { loadSessions } from "@/features/sessions/service";
import { getDb } from "@/lib/db/client";
import { alerts, chargers, chargingSessions, stations } from "@/lib/db/schema";

export interface StartingPoint {
  city: string;
  lat: number;
  lng: number;
  stations: number;
}

/**
 * Starting points for drivers who do not share their location: the centre of the recorded
 * station coordinates in each city. Derived from the data, never a guessed location.
 */
export async function cityStartingPoints(): Promise<StartingPoint[]> {
  const rows = await getDb()
    .select({
      city: stations.city,
      lat: sql<number>`avg(${stations.latitude})::float8`,
      lng: sql<number>`avg(${stations.longitude})::float8`,
      stations: sql<number>`count(*)::int`,
    })
    .from(stations)
    .where(and(isNotNull(stations.latitude), isNotNull(stations.city)))
    .groupBy(stations.city)
    .orderBy(sql`count(*) desc`, stations.city);
  return rows.filter((r): r is StartingPoint => r.city !== null && isValidLatLng(r.lat, r.lng));
}

export interface UnlocatedStation {
  id: string;
  code: string;
  name: string;
  isDemo: boolean;
  chargers: number;
  sessions: number;
  lastSessionAt: string | null;
}

/** Stations that cannot be ranked by distance because no coordinates are recorded. */
export async function stationsWithoutLocation(): Promise<UnlocatedStation[]> {
  const db = getDb();
  const rows = await db
    .select({ id: stations.id, code: stations.code, name: stations.name, isDemo: stations.isSynthetic })
    .from(stations)
    .where(isNull(stations.latitude))
    .orderBy(stations.code);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const chargerCounts = await db
    .select({ stationId: chargers.stationId, n: count() })
    .from(chargers)
    .where(inArray(chargers.stationId, ids))
    .groupBy(chargers.stationId);
  const sessionStats = await db
    .select({
      stationId: chargers.stationId,
      n: sql<number>`count(${chargingSessions.id})::int`,
      last: sql<string | null>`max(${chargingSessions.startedAt})`,
    })
    .from(chargingSessions)
    .innerJoin(chargers, eq(chargers.id, chargingSessions.chargerId))
    .where(inArray(chargers.stationId, ids))
    .groupBy(chargers.stationId);
  const cMap = new Map(chargerCounts.map((c) => [c.stationId, c.n]));
  const sMap = new Map(sessionStats.map((s) => [s.stationId, s]));
  return rows.map((r) => {
    const s = sMap.get(r.id);
    return {
      ...r,
      chargers: cMap.get(r.id) ?? 0,
      sessions: s?.n ?? 0,
      lastSessionAt: s?.last ? new Date(s.last).toISOString() : null,
    };
  });
}

export interface ComparedCharger {
  id: string;
  code: string;
  stationId: string;
  stationName: string;
  city: string | null;
  isDemo: boolean;
  connectorType: ConnectorType;
  ratedPowerKw: number | null;
  chargingMode: string | null;
  operationalStatus: OperationalStatus;
  statusAt: string | null;
  healthStatus: HealthStatus;
  lastObservationAt: string | null;
  activeAlerts: number;
  distanceKm: number | null;
}

export const MAX_COMPARE = 4;

/** Side-by-side facts for up to four chargers; distance only when the driver gave a location. */
export async function compareChargers(ids: string[], origin: LatLng | null): Promise<ComparedCharger[]> {
  const unique = [...new Set(ids)].slice(0, MAX_COMPARE);
  if (unique.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: chargers.id,
      code: chargers.code,
      stationId: stations.id,
      stationName: stations.name,
      city: stations.city,
      isDemo: stations.isSynthetic,
      latitude: stations.latitude,
      longitude: stations.longitude,
      connectorType: chargers.connectorType,
      ratedPowerKw: chargers.ratedPowerKw,
      chargingMode: chargers.chargingMode,
      operationalStatus: chargers.operationalStatus,
      statusAt: chargers.operationalStatusAt,
      healthStatus: chargers.healthStatus,
      lastObservationAt: chargers.lastObservationAt,
    })
    .from(chargers)
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(inArray(chargers.id, unique));
  const alertCounts = await db
    .select({ chargerId: alerts.chargerId, n: count() })
    .from(alerts)
    .where(and(inArray(alerts.chargerId, unique), inArray(alerts.status, ["open", "acknowledged"])))
    .groupBy(alerts.chargerId);
  const aMap = new Map(alertCounts.map((a) => [a.chargerId, a.n]));
  const order = new Map(unique.map((id, i) => [id, i]));
  return rows
    .map(({ latitude, longitude, statusAt, lastObservationAt, ...r }) => ({
      ...r,
      statusAt: statusAt ? statusAt.toISOString() : null,
      lastObservationAt: lastObservationAt ? lastObservationAt.toISOString() : null,
      activeAlerts: aMap.get(r.id) ?? 0,
      distanceKm: origin && isValidLatLng(latitude, longitude) ? haversineKm(origin, { lat: latitude!, lng: longitude! }) : null,
    }))
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Historical session figures for one station (empty summary when it has no sessions). */
export async function stationHistory(stationId: string): Promise<SessionSummary> {
  return summarizeSessions(await loadSessions({ stationId }));
}

export interface NearbyStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  health: HealthStatus;
  chargers: number;
  distanceKm: number | null;
}

/** The nearest stations with coordinates to a point (for station-page maps). */
export async function nearbyStations(origin: LatLng, excludeId: string, limit = 6): Promise<NearbyStation[]> {
  const { listStations } = await import("@/features/station-discovery/service");
  const r = await listStations({ lat: origin.lat, lng: origin.lng, limit: limit + 1, offset: 0 });
  return r.items
    .filter((s) => s.id !== excludeId && s.latitude !== null && s.longitude !== null)
    .slice(0, limit)
    .map((s) => ({ id: s.id, name: s.name, lat: s.latitude!, lng: s.longitude!, health: s.worstHealth, chargers: s.chargerCount, distanceKm: s.distanceKm }));
}
