import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { ConnectorType } from "@/config/domain";
import { isValidLatLng } from "@/features/station-discovery/geo";
import { getDb } from "@/lib/db/client";
import { alerts, chargers, stations, vehicleProfiles } from "@/lib/db/schema";
import { notFound, validationError } from "@/lib/errors";
import type { RecommendationQuery } from "@/lib/validation/schemas";
import { recommend, type CandidateCharger, type RecommendationResult } from "./engine";

export interface RecommendationResponse extends RecommendationResult {
  origin: { lat: number; lng: number; label: string };
  compatibility: { connectorTypes: ConnectorType[] | null; source: string };
  vehicleMaxKw: number | null;
  reference: { chargerId: string; chargerCode: string; stationName: string; healthStatus: string } | null;
}

export async function listVehicleProfiles() {
  return getDb().select().from(vehicleProfiles).orderBy(asc(vehicleProfiles.name));
}

export async function getRecommendations(q: RecommendationQuery): Promise<RecommendationResponse> {
  const db = getDb();
  let origin: RecommendationResponse["origin"];
  let reference: RecommendationResponse["reference"] = null;
  let referenceConnector: ConnectorType | null = null;

  if (q.fromCharger) {
    const [row] = await db
      .select({
        id: chargers.id,
        code: chargers.code,
        connectorType: chargers.connectorType,
        healthStatus: chargers.healthStatus,
        stationName: stations.name,
        lat: stations.latitude,
        lng: stations.longitude,
      })
      .from(chargers)
      .innerJoin(stations, eq(stations.id, chargers.stationId))
      .where(and(eq(chargers.id, q.fromCharger), eq(chargers.isSynthetic, false)));
    if (!row) throw notFound("Reference charger");
    reference = { chargerId: row.id, chargerCode: row.code, stationName: row.stationName, healthStatus: row.healthStatus };
    referenceConnector = row.connectorType;
    if (q.lat !== undefined && q.lng !== undefined) {
      origin = { lat: q.lat, lng: q.lng, label: "Your location" };
    } else if (isValidLatLng(row.lat, row.lng)) {
      origin = { lat: row.lat!, lng: row.lng!, label: `${row.stationName} (${row.code})` };
    } else {
      throw validationError("The reference charger's station has no coordinates. Provide a location instead.");
    }
  } else {
    origin = { lat: q.lat!, lng: q.lng!, label: "Your location" };
  }

  let connectorTypes: ConnectorType[] | null = null;
  let source = "Not specified — compatibility is not checked.";
  let vehicleMaxKw: number | null = null;
  if (q.vehicle) {
    const [profile] = await db.select().from(vehicleProfiles).where(eq(vehicleProfiles.code, q.vehicle));
    if (!profile) throw validationError("Unknown vehicle profile.");
    connectorTypes = profile.connectorTypes;
    vehicleMaxKw = profile.maxDcPowerKw;
    source = `Vehicle profile: ${profile.name}`;
  } else if (q.connector) {
    connectorTypes = [q.connector];
    source = `Selected connector: ${q.connector}`;
  } else if (referenceConnector && referenceConnector !== "Unknown") {
    connectorTypes = [referenceConnector];
    source = `Same connector as the reference charger (${referenceConnector}).`;
  } else if (referenceConnector === "Unknown") {
    source = "The reference charger's connector type is not recorded, so compatibility is not checked.";
  }

  const rows = await db
    .select({
      chargerId: chargers.id,
      chargerCode: chargers.code,
      stationId: stations.id,
      stationName: stations.name,
      latitude: stations.latitude,
      longitude: stations.longitude,
      connectorType: chargers.connectorType,
      ratedPowerKw: chargers.ratedPowerKw,
      operationalStatus: chargers.operationalStatus,
      healthStatus: chargers.healthStatus,
    })
    .from(chargers)
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(and(eq(chargers.isSynthetic, false), eq(stations.isSynthetic, false)));

  const alertCounts = await db
    .select({ chargerId: alerts.chargerId, n: count() })
    .from(alerts)
    .where(inArray(alerts.status, ["open", "acknowledged"]))
    .groupBy(alerts.chargerId);
  const alertMap = new Map(alertCounts.map((a) => [a.chargerId, a.n]));
  const candidates: CandidateCharger[] = rows.map((r) => ({ ...r, activeAlerts: alertMap.get(r.chargerId) ?? 0 }));

  const result = recommend(candidates, {
    origin,
    connectorTypes,
    minPowerKw: q.minPowerKw,
    vehicleMaxKw,
    radiusKm: q.radiusKm,
    includeInspection: q.includeInspection,
    excludeChargerId: q.fromCharger,
    limit: q.limit,
  });
  return { ...result, origin, compatibility: { connectorTypes, source }, vehicleMaxKw, reference };
}
