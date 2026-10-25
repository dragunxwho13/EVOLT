import "server-only";
import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, lt, max, or, isNull } from "drizzle-orm";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import {
  HEALTH_STATUSES,
  METRIC_KEYS,
  OPERATIONAL_STATUSES,
  PROVENANCES,
  type HealthStatus,
  type MetricKey,
  type OperationalStatus,
  type Provenance,
} from "@/config/domain";
import { worstStatus } from "@/features/anomaly-detection/assess-metric";
import { isValidLatLng } from "@/features/station-discovery/geo";
import { getDb } from "@/lib/db/client";
import { alerts, chargers, healthObservations, stations } from "@/lib/db/schema";
import type { QualityFlagCode } from "@/types/analysis";

const zeroed = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export interface MapPoint {
  id: string;
  name: string;
  code: string;
  latitude: number;
  longitude: number;
  worstHealth: HealthStatus;
  chargerCount: number;
  isSynthetic: boolean;
}

export async function getOverview(now: Date) {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - ANALYSIS_PARAMS.staleAfterDays * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [stationRows, chargerRows, healthRows, opRows, alertRows, latestObs, recentObs, staleRows, attention, recentAlerts, recentlyUpdated] =
    await Promise.all([
      db.select({ id: stations.id, name: stations.name, code: stations.code, lat: stations.latitude, lng: stations.longitude, isSynthetic: stations.isSynthetic }).from(stations),
      db.select({ total: count() }).from(chargers),
      db.select({ status: chargers.healthStatus, n: count() }).from(chargers).groupBy(chargers.healthStatus),
      db.select({ status: chargers.operationalStatus, n: count() }).from(chargers).groupBy(chargers.operationalStatus),
      db
        .select({ severity: alerts.severity, n: count() })
        .from(alerts)
        .where(inArray(alerts.status, ["open", "acknowledged"]))
        .groupBy(alerts.severity),
      db.select({ at: max(healthObservations.observedAt) }).from(healthObservations),
      db.select({ n: count() }).from(healthObservations).where(gte(healthObservations.observedAt, monthAgo)),
      db
        .select({ n: count() })
        .from(chargers)
        .where(or(isNull(chargers.lastObservationAt), lt(chargers.lastObservationAt, staleBefore))),
      db
        .select({
          id: chargers.id,
          code: chargers.code,
          healthStatus: chargers.healthStatus,
          healthEvaluatedAt: chargers.healthEvaluatedAt,
          stationName: stations.name,
          connectorType: chargers.connectorType,
        })
        .from(chargers)
        .innerJoin(stations, eq(stations.id, chargers.stationId))
        .where(inArray(chargers.healthStatus, ["monitor", "inspection_recommended"]))
        .orderBy(desc(chargers.healthStatus), desc(chargers.lastObservationAt))
        .limit(8),
      db
        .select({ alert: alerts, chargerCode: chargers.code, stationName: stations.name })
        .from(alerts)
        .innerJoin(chargers, eq(chargers.id, alerts.chargerId))
        .innerJoin(stations, eq(stations.id, chargers.stationId))
        .orderBy(desc(alerts.lastEvaluatedAt), desc(alerts.windowEnd))
        .limit(6),
      db
        .select({
          id: chargers.id,
          code: chargers.code,
          healthStatus: chargers.healthStatus,
          lastObservationAt: chargers.lastObservationAt,
          stationName: stations.name,
        })
        .from(chargers)
        .innerJoin(stations, eq(stations.id, chargers.stationId))
        .where(isNotNull(chargers.lastObservationAt))
        .orderBy(desc(chargers.lastObservationAt))
        .limit(6),
    ]);

  const healthDistribution = zeroed(HEALTH_STATUSES);
  for (const r of healthRows) healthDistribution[r.status] = r.n;
  const operationalDistribution = zeroed(OPERATIONAL_STATUSES) as Record<OperationalStatus, number>;
  for (const r of opRows) operationalDistribution[r.status] = r.n;
  const activeAlerts = { monitor: 0, inspection_recommended: 0 };
  for (const r of alertRows) activeAlerts[r.severity] = r.n;

  const chargerHealthByStation = await db
    .select({ stationId: chargers.stationId, status: chargers.healthStatus, n: count() })
    .from(chargers)
    .groupBy(chargers.stationId, chargers.healthStatus);
  const stationStatuses = new Map<string, { statuses: HealthStatus[]; n: number }>();
  for (const r of chargerHealthByStation) {
    const e = stationStatuses.get(r.stationId) ?? { statuses: [], n: 0 };
    e.statuses.push(r.status);
    e.n += r.n;
    stationStatuses.set(r.stationId, e);
  }
  const mapPoints: MapPoint[] = stationRows
    .filter((s) => isValidLatLng(s.lat, s.lng))
    .map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      latitude: s.lat!,
      longitude: s.lng!,
      worstHealth: worstStatus(stationStatuses.get(s.id)?.statuses ?? []),
      chargerCount: stationStatuses.get(s.id)?.n ?? 0,
      isSynthetic: s.isSynthetic,
    }));

  const syntheticChargers = await db.select({ n: count() }).from(chargers).where(eq(chargers.isSynthetic, true));

  return {
    stations: {
      total: stationRows.length,
      withoutCoordinates: stationRows.length - mapPoints.length,
      synthetic: stationRows.filter((s) => s.isSynthetic).length,
    },
    chargers: { total: chargerRows[0]?.total ?? 0, synthetic: syntheticChargers[0]?.n ?? 0 },
    healthDistribution,
    operationalDistribution,
    activeAlerts,
    attention,
    freshness: {
      latestObservationAt: latestObs[0]?.at ?? null,
      observationsLast30Days: recentObs[0]?.n ?? 0,
      chargersStaleOrEmpty: staleRows[0]?.n ?? 0,
      staleAfterDays: ANALYSIS_PARAMS.staleAfterDays,
    },
    recentAlerts,
    recentlyUpdated,
    mapPoints,
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;

export async function getDataQualityReport() {
  const db = getDb();
  const [coverageRows, provenanceRows, summaries] = await Promise.all([
    db
      .select({ metric: healthObservations.metric, observations: count(), chargers: countDistinct(healthObservations.chargerId) })
      .from(healthObservations)
      .groupBy(healthObservations.metric),
    db.select({ provenance: healthObservations.provenance, n: count() }).from(healthObservations).groupBy(healthObservations.provenance),
    db.select({ summary: chargers.healthSummary }).from(chargers).where(and(isNotNull(chargers.healthSummary))),
  ]);
  const coverage = Object.fromEntries(METRIC_KEYS.map((k) => [k, { observations: 0, chargers: 0 }])) as Record<
    MetricKey,
    { observations: number; chargers: number }
  >;
  for (const r of coverageRows) coverage[r.metric] = { observations: r.observations, chargers: r.chargers };
  const provenance = zeroed(PROVENANCES) as Record<Provenance, number>;
  for (const r of provenanceRows) provenance[r.provenance] = r.n;

  const flagCounts: Partial<Record<QualityFlagCode, { chargers: number; message: string }>> = {};
  for (const { summary } of summaries) {
    if (!summary) continue;
    const seen = new Set<QualityFlagCode>();
    for (const m of summary.metrics) for (const f of m.qualityFlags) seen.add(f.code);
    for (const code of seen) {
      const entry = flagCounts[code] ?? { chargers: 0, message: "" };
      entry.chargers++;
      flagCounts[code] = entry;
    }
  }
  return { coverage, provenance, flagCounts, evaluatedChargers: summaries.length };
}
