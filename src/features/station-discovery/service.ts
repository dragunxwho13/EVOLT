import "server-only";
import { and, asc, count, eq, ilike, inArray, or } from "drizzle-orm";
import type { ConnectorType, HealthStatus } from "@/config/domain";
import { worstStatus } from "@/features/anomaly-detection/assess-metric";
import { getDb } from "@/lib/db/client";
import { alerts, chargers, stations, type Charger, type Station } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import type { StationQuery } from "@/lib/validation/schemas";
import { haversineKm, isValidLatLng } from "./geo";

export interface StationListItem {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  operator: string | null;
  latitude: number | null;
  longitude: number | null;
  isSynthetic: boolean;
  chargerCount: number;
  matchingChargerCount: number;
  connectorTypes: ConnectorType[];
  maxPowerKw: number | null;
  availableCount: number;
  worstHealth: HealthStatus;
  healthCounts: Record<HealthStatus, number>;
  distanceKm: number | null;
  chargers: Array<{
    id: string;
    code: string;
    connectorType: ConnectorType;
    ratedPowerKw: number | null;
    operationalStatus: ChargerLite["operationalStatus"];
    healthStatus: HealthStatus;
    activeAlerts: number;
  }>;
}

export interface StationListResult {
  items: StationListItem[];
  total: number;
  limit: number;
  offset: number;
  withoutCoordinates: number;
  sortedByDistance: boolean;
}

const MAX_SCAN = 5000;

type ChargerLite = Pick<Charger, "id" | "stationId" | "code" | "connectorType" | "ratedPowerKw" | "operationalStatus" | "healthStatus"> & {
  activeAlerts: number;
};

function chargerMatches(c: ChargerLite, q: StationQuery): boolean {
  if (q.connector && c.connectorType !== q.connector) return false;
  if (q.minPowerKw !== undefined && (c.ratedPowerKw === null || c.ratedPowerKw < q.minPowerKw)) return false;
  if (q.availability && c.operationalStatus !== q.availability) return false;
  if (q.health && c.healthStatus !== q.health) return false;
  return true;
}

export function summarizeStation(s: Station, all: ChargerLite[], matching: ChargerLite[], distanceKm: number | null): StationListItem {
  const healthCounts: Record<HealthStatus, number> = { normal: 0, monitor: 0, inspection_recommended: 0, insufficient_data: 0 };
  for (const c of all) healthCounts[c.healthStatus]++;
  const powers = all.map((c) => c.ratedPowerKw).filter((p): p is number => p !== null);
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    city: s.city,
    region: s.region,
    operator: s.operator,
    latitude: s.latitude,
    longitude: s.longitude,
    isSynthetic: s.isSynthetic,
    chargerCount: all.length,
    matchingChargerCount: matching.length,
    connectorTypes: [...new Set(all.map((c) => c.connectorType))].sort(),
    maxPowerKw: powers.length ? Math.max(...powers) : null,
    availableCount: all.filter((c) => c.operationalStatus === "available").length,
    worstHealth: worstStatus(all.map((c) => c.healthStatus)),
    healthCounts,
    distanceKm,
    chargers: all
      .map((c) => ({
        id: c.id,
        code: c.code,
        connectorType: c.connectorType,
        ratedPowerKw: c.ratedPowerKw,
        operationalStatus: c.operationalStatus,
        healthStatus: c.healthStatus,
        activeAlerts: c.activeAlerts,
      }))
      .sort((a, b) => {
        const healthOrder: Record<HealthStatus, number> = { inspection_recommended: 0, monitor: 1, insufficient_data: 2, normal: 3 };
        return healthOrder[a.healthStatus] - healthOrder[b.healthStatus] || a.code.localeCompare(b.code);
      }),
  };
}

export async function listStations(q: StationQuery): Promise<StationListResult> {
  const db = getDb();
  const text = q.q ? `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null;
  const stationRows = await db
    .select()
    .from(stations)
    .where(
      and(
        q.includeSynthetic ? undefined : eq(stations.isSynthetic, false),
        text
          ? or(ilike(stations.name, text), ilike(stations.code, text), ilike(stations.city, text), ilike(stations.address, text), ilike(stations.operator, text))
          : undefined,
      ),
    )
    .orderBy(asc(stations.name))
    .limit(MAX_SCAN);

  const chargerRows = stationRows.length
    ? await db
        .select({
          id: chargers.id,
          stationId: chargers.stationId,
          code: chargers.code,
          connectorType: chargers.connectorType,
          ratedPowerKw: chargers.ratedPowerKw,
          operationalStatus: chargers.operationalStatus,
          healthStatus: chargers.healthStatus,
        })
        .from(chargers)
        .where(inArray(chargers.stationId, stationRows.map((s) => s.id)))
    : [];
  const alertCounts = chargerRows.length
    ? await db
        .select({ chargerId: alerts.chargerId, n: count() })
        .from(alerts)
        .where(and(inArray(alerts.chargerId, chargerRows.map((c) => c.id)), inArray(alerts.status, ["open", "acknowledged"])))
        .groupBy(alerts.chargerId)
    : [];
  const alertMap = new Map(alertCounts.map((a) => [a.chargerId, a.n]));
  const enrichedChargerRows: ChargerLite[] = chargerRows.map((c) => ({ ...c, activeAlerts: alertMap.get(c.id) ?? 0 }));
  const byStation = new Map<string, ChargerLite[]>();
  for (const c of enrichedChargerRows) {
    const list = byStation.get(c.stationId) ?? [];
    list.push(c);
    byStation.set(c.stationId, list);
  }

  const hasChargerFilter = Boolean(q.connector || q.minPowerKw !== undefined || q.availability || q.health);
  const origin = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;

  let items: StationListItem[] = [];
  for (const s of stationRows) {
    const all = enrichedChargerRows.filter((c) => c.stationId === s.id);
    const matching = all.filter((c) => chargerMatches(c, q));
    if (hasChargerFilter && matching.length === 0) continue;
    const hasCoords = isValidLatLng(s.latitude, s.longitude);
    const distance = origin && hasCoords ? haversineKm(origin, { lat: s.latitude!, lng: s.longitude! }) : null;
    items.push(summarizeStation(s, all, matching, distance));
  }

  if (origin) {
    // Stations without coordinates cannot be ranked by distance; they go last.
    items = items.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }
  const total = items.length;
  const withoutCoordinates = items.filter((i) => !isValidLatLng(i.latitude, i.longitude)).length;
  return {
    items: items.slice(q.offset, q.offset + q.limit),
    total,
    limit: q.limit,
    offset: q.offset,
    withoutCoordinates,
    sortedByDistance: Boolean(origin),
  };
}

export interface StationDetail {
  station: Station;
  chargers: (Charger & { activeAlerts: number })[];
}

export async function getStation(id: string, options: { includeSynthetic?: boolean } = {}): Promise<StationDetail> {
  const db = getDb();
  const [station] = await db
    .select()
    .from(stations)
    .where(and(eq(stations.id, id), options.includeSynthetic ? undefined : eq(stations.isSynthetic, false)));
  if (!station) throw notFound("Station");
  const rows = await db.select().from(chargers).where(eq(chargers.stationId, id)).orderBy(asc(chargers.code));
  const alertCounts = rows.length
    ? await db
        .select({ chargerId: alerts.chargerId, n: count() })
        .from(alerts)
        .where(and(inArray(alerts.chargerId, rows.map((r) => r.id)), inArray(alerts.status, ["open", "acknowledged"])))
        .groupBy(alerts.chargerId)
    : [];
  const countMap = new Map(alertCounts.map((a) => [a.chargerId, a.n]));
  return { station, chargers: rows.map((c) => ({ ...c, activeAlerts: countMap.get(c.id) ?? 0 })) };
}
