import "server-only";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { alertEvents, alerts, chargers, healthObservations, sensorReadings, stations } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import type { AlertQuery, ChargerQuery } from "@/lib/validation/schemas";

export async function listChargers(q: ChargerQuery) {
  const db = getDb();
  const filters: SQL[] = [];
  if (q.connector) filters.push(eq(chargers.connectorType, q.connector));
  if (q.health) filters.push(eq(chargers.healthStatus, q.health));
  if (q.availability) filters.push(eq(chargers.operationalStatus, q.availability));
  if (q.q) {
    const text = `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    filters.push(or(ilike(chargers.code, text), ilike(stations.name, text), ilike(stations.city, text))!);
  }
  const where = filters.length ? and(...filters) : undefined;
  const total =
    (
      await db
        .select({ total: count() })
        .from(chargers)
        .innerJoin(stations, eq(stations.id, chargers.stationId))
        .where(where)
    )[0]?.total ?? 0;
  const rows = await db
    .select({
      id: chargers.id,
      code: chargers.code,
      connectorType: chargers.connectorType,
      ratedPowerKw: chargers.ratedPowerKw,
      operationalStatus: chargers.operationalStatus,
      healthStatus: chargers.healthStatus,
      healthEvaluatedAt: chargers.healthEvaluatedAt,
      lastObservationAt: chargers.lastObservationAt,
      isSynthetic: chargers.isSynthetic,
      stationId: stations.id,
      stationName: stations.name,
      city: stations.city,
    })
    .from(chargers)
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(where)
    .orderBy(asc(stations.name), asc(chargers.code))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { items: rows, total, page: q.page, pageSize: q.pageSize };
}

export async function getChargerDetail(id: string, observationLimit = 500) {
  const db = getDb();
  const [row] = await db
    .select({ charger: chargers, station: stations })
    .from(chargers)
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(eq(chargers.id, id));
  if (!row) throw notFound("Charger");
  const [observations, chargerAlerts, sensors, total] = await Promise.all([
    db
      .select()
      .from(healthObservations)
      .where(eq(healthObservations.chargerId, id))
      .orderBy(desc(healthObservations.observedAt))
      .limit(observationLimit),
    db.select().from(alerts).where(eq(alerts.chargerId, id)).orderBy(desc(alerts.windowEnd)),
    db
      .select()
      .from(sensorReadings)
      .where(eq(sensorReadings.chargerId, id))
      .orderBy(desc(sensorReadings.recordedAt))
      .limit(50),
    db
      .select({ total: count() })
      .from(healthObservations)
      .where(eq(healthObservations.chargerId, id))
      .then((r) => r[0]?.total ?? 0),
  ]);
  return {
    charger: row.charger,
    station: row.station,
    observations: observations.reverse(),
    observationTotal: total,
    alerts: chargerAlerts,
    sensorReadings: sensors,
  };
}

export async function listObservations(chargerId: string, limit: number) {
  const db = getDb();
  const [exists] = await db.select({ id: chargers.id }).from(chargers).where(eq(chargers.id, chargerId));
  if (!exists) throw notFound("Charger");
  return db
    .select()
    .from(healthObservations)
    .where(eq(healthObservations.chargerId, chargerId))
    .orderBy(desc(healthObservations.observedAt))
    .limit(limit);
}

export async function listAlerts(q: AlertQuery) {
  const db = getDb();
  const filters: SQL[] = [];
  const status = q.status ?? "active";
  if (status === "active") filters.push(inArray(alerts.status, ["open", "acknowledged"]));
  else if (status !== "all") filters.push(eq(alerts.status, status));
  if (q.severity) filters.push(eq(alerts.severity, q.severity));
  if (q.chargerId) filters.push(eq(alerts.chargerId, q.chargerId));
  const where = filters.length ? and(...filters) : undefined;
  const total = (await db.select({ total: count() }).from(alerts).where(where))[0]?.total ?? 0;
  const rows = await db
    .select({
      alert: alerts,
      chargerCode: chargers.code,
      connectorType: chargers.connectorType,
      stationId: stations.id,
      stationName: stations.name,
    })
    .from(alerts)
    .innerJoin(chargers, eq(chargers.id, alerts.chargerId))
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(where)
    .orderBy(sql`case ${alerts.severity} when 'inspection_recommended' then 0 else 1 end`, desc(alerts.windowEnd), asc(alerts.id))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  return { items: rows, total, page: q.page, pageSize: q.pageSize, status };
}

export async function getAlertDetail(id: string) {
  const db = getDb();
  const [row] = await db
    .select({ alert: alerts, charger: chargers, station: stations })
    .from(alerts)
    .innerJoin(chargers, eq(chargers.id, alerts.chargerId))
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(eq(alerts.id, id));
  if (!row) throw notFound("Alert");
  const events = await db.select().from(alertEvents).where(eq(alertEvents.alertId, id)).orderBy(asc(alertEvents.createdAt));
  return { ...row, events };
}
