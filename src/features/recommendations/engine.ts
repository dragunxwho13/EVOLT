import {
  CONNECTOR_LABELS,
  HEALTH_LABELS,
  OPERATIONAL_LABELS,
  type ConnectorType,
  type HealthStatus,
  type OperationalStatus,
} from "@/config/domain";
import { haversineKm, isValidLatLng, type LatLng } from "@/features/station-discovery/geo";
import { formatDistanceKm, formatNumber } from "@/lib/utils/format";

export interface CandidateCharger {
  chargerId: string;
  chargerCode: string;
  stationId: string;
  stationName: string;
  latitude: number | null;
  longitude: number | null;
  connectorType: ConnectorType;
  ratedPowerKw: number | null;
  operationalStatus: OperationalStatus;
  healthStatus: HealthStatus;
  activeAlerts: number;
  /** When the operational status was last recorded; null means never reported. */
  statusAt?: string | null;
  /** Bundled demo record (not a real site). */
  isDemo?: boolean;
  city?: string | null;
}

export interface RecommendationRequest {
  origin: LatLng;
  /** Compatible connectors; null means compatibility is unknown and not filtered. */
  connectorTypes: ConnectorType[] | null;
  minPowerKw?: number;
  vehicleMaxKw?: number | null;
  radiusKm: number;
  includeInspection: boolean;
  /** Hard constraint: only chargers whose latest reported status is "available". */
  availableOnly?: boolean;
  excludeChargerId?: string;
  limit: number;
}

export interface Recommendation extends CandidateCharger {
  rank: number;
  distanceKm: number;
  effectivePowerKw: number | null;
  healthTier: number;
  reasons: string[];
  limitations: string[];
  /** One plain sentence built only from statements the records support. */
  summary: string;
}

export type ExclusionReason =
  | "no_coordinates"
  | "outside_radius"
  | "offline"
  | "incompatible_connector"
  | "below_min_power"
  | "inspection_recommended"
  | "reference_charger"
  | "unknown_connector"
  | "not_available";

export interface RecommendationResult {
  recommendations: Recommendation[];
  considered: number;
  excluded: Record<ExclusionReason, number>;
  rules: string[];
  /** Requirements a charger must meet to be listed at all. */
  hardConstraints: string[];
  /** Ordering preferences applied to the chargers that pass the constraints. */
  preferences: string[];
}

/** Lower is better. Health is the first sort key, so distance cannot outrank it. */
export const HEALTH_TIER: Record<HealthStatus, number> = {
  normal: 0,
  insufficient_data: 1,
  monitor: 2,
  inspection_recommended: 3,
};

const AVAILABILITY_RANK: Record<OperationalStatus, number> = { available: 0, in_use: 1, unknown: 2, offline: 3 };
export const DISTANCE_BAND_KM = 5;

export const HARD_CONSTRAINTS = [
  "Has a recorded location inside your search radius (straight-line distance, not driving distance).",
  "Is not reported offline.",
  "Uses your selected connector, if you chose one. Chargers whose connector is not recorded are left out, because compatibility cannot be confirmed.",
  "Meets your minimum power, if you set one.",
  "Is not flagged 'Inspection advised', unless you choose to include those.",
  "Is reported available, if you ask for available chargers only.",
];

export const PREFERENCES = [
  "Health evidence first: no issues in recorded data, then not yet assessed, then under observation, then inspection advised.",
  "Then the latest reported status: available, then in use, then unknown.",
  `Then distance in ${DISTANCE_BAND_KM} km bands, so a few hundred metres never outweighs the points above.`,
  "Then higher rated power, then exact distance.",
  "Price and opening hours are not used: the data does not contain them.",
];

export const RANKING_RULES = [
  "Only chargers with valid coordinates inside the search radius are considered; distance is straight-line, not driving distance.",
  "Offline chargers are excluded. Chargers flagged 'Inspection recommended' are excluded unless explicitly included.",
  "If a vehicle/connector is selected, only matching connectors are shown; otherwise compatibility is not checked and this is stated.",
  "1st: health tier — Normal in available data, then Insufficient data, then Monitor, then Inspection recommended.",
  "2nd: reported availability — Available, then In use, then Unknown.",
  `3rd: distance in ${DISTANCE_BAND_KM} km bands, so a few hundred metres never outweighs the keys above.`,
  "4th: usable power (rated power capped by the vehicle's maximum), higher first; then exact distance.",
  "Price is not considered because no reliable price data is available.",
];

export function recommend(candidates: CandidateCharger[], req: RecommendationRequest): RecommendationResult {
  const excluded: Record<ExclusionReason, number> = {
    no_coordinates: 0,
    outside_radius: 0,
    offline: 0,
    incompatible_connector: 0,
    below_min_power: 0,
    inspection_recommended: 0,
    reference_charger: 0,
    unknown_connector: 0,
    not_available: 0,
  };
  const kept: Recommendation[] = [];

  for (const c of candidates) {
    if (c.chargerId === req.excludeChargerId) {
      excluded.reference_charger++;
      continue;
    }
    if (!isValidLatLng(c.latitude, c.longitude)) {
      excluded.no_coordinates++;
      continue;
    }
    const distanceKm = haversineKm(req.origin, { lat: c.latitude!, lng: c.longitude! });
    if (distanceKm > req.radiusKm) {
      excluded.outside_radius++;
      continue;
    }
    if (c.operationalStatus === "offline") {
      excluded.offline++;
      continue;
    }
    if (req.connectorTypes && c.connectorType === "Unknown") {
      // Compatibility cannot be confirmed, so never present it as a compatible option.
      excluded.unknown_connector++;
      continue;
    }
    if (req.connectorTypes && !req.connectorTypes.includes(c.connectorType)) {
      excluded.incompatible_connector++;
      continue;
    }
    if (req.minPowerKw !== undefined && c.ratedPowerKw !== null && c.ratedPowerKw < req.minPowerKw) {
      excluded.below_min_power++;
      continue;
    }
    if (c.healthStatus === "inspection_recommended" && !req.includeInspection) {
      excluded.inspection_recommended++;
      continue;
    }
    if (req.availableOnly && c.operationalStatus !== "available") {
      excluded.not_available++;
      continue;
    }

    const reasons: string[] = [];
    const limitations: string[] = [];
    const effectivePowerKw =
      c.ratedPowerKw === null ? null : req.vehicleMaxKw ? Math.min(c.ratedPowerKw, req.vehicleMaxKw) : c.ratedPowerKw;

    reasons.push(`Health: ${HEALTH_LABELS[c.healthStatus]}.`);
    if (c.healthStatus === "insufficient_data") limitations.push("Not enough health evidence to judge this connector either way.");
    if (c.healthStatus === "monitor") limitations.push("Analysis flagged a pattern worth monitoring on this connector.");
    if (c.healthStatus === "inspection_recommended") limitations.push("Analysis recommends inspecting this connector; shown only because you asked to include it.");
    if (c.activeAlerts > 0) limitations.push(`${c.activeAlerts} unresolved alert(s).`);

    if (req.connectorTypes) reasons.push(`${CONNECTOR_LABELS[c.connectorType]} matches the selected vehicle/connector.`);
    else limitations.push(`Compatibility not checked — connector is ${CONNECTOR_LABELS[c.connectorType]}.`);

    reasons.push(`${OPERATIONAL_LABELS[c.operationalStatus]} (last reported status).`);
    if (c.operationalStatus === "unknown") limitations.push("Current availability is unknown.");

    reasons.push(`${formatDistanceKm(distanceKm)} straight-line.`);
    if (effectivePowerKw !== null) {
      reasons.push(
        req.vehicleMaxKw && c.ratedPowerKw! > req.vehicleMaxKw
          ? `Up to ${formatNumber(effectivePowerKw, 0)} kW (charger ${formatNumber(c.ratedPowerKw!, 0)} kW, limited by vehicle).`
          : `Rated ${formatNumber(effectivePowerKw, 0)} kW.`,
      );
    } else {
      limitations.push("Rated power unknown.");
    }

    kept.push({
      ...c,
      rank: 0,
      distanceKm,
      effectivePowerKw,
      healthTier: HEALTH_TIER[c.healthStatus],
      reasons,
      limitations,
      summary: "",
    });
  }

  kept.sort(
    (a, b) =>
      a.healthTier - b.healthTier ||
      AVAILABILITY_RANK[a.operationalStatus] - AVAILABILITY_RANK[b.operationalStatus] ||
      Math.floor(a.distanceKm / DISTANCE_BAND_KM) - Math.floor(b.distanceKm / DISTANCE_BAND_KM) ||
      (b.effectivePowerKw ?? -1) - (a.effectivePowerKw ?? -1) ||
      a.distanceKm - b.distanceKm ||
      a.chargerCode.localeCompare(b.chargerCode),
  );
  const top = kept.slice(0, req.limit);
  const closest = top.length > 1 ? Math.min(...top.map((r) => r.distanceKm)) : null;
  const recommendations = top.map((r, i) => {
    const ranked = { ...r, rank: i + 1 };
    return { ...ranked, summary: summarize(ranked, req, closest) };
  });
  return {
    recommendations,
    considered: candidates.length,
    excluded,
    rules: RANKING_RULES,
    hardConstraints: HARD_CONSTRAINTS,
    preferences: PREFERENCES,
  };
}

const DRIVER_HEALTH_PHRASE: Record<HealthStatus, string> = {
  normal: "has no issues in its recorded health data",
  insufficient_data: "has not been assessed yet (too little health data)",
  monitor: "is under observation for a pattern in its health data",
  inspection_recommended: "has an inspection advised by its health data",
};

/**
 * Builds the "why this charger" sentence. Every clause is derived from the record or the
 * driver's own inputs; nothing is claimed that the data does not contain.
 */
export function summarize(r: Recommendation, req: RecommendationRequest, closestKm: number | null): string {
  const parts: string[] = [];
  if (req.connectorTypes) parts.push(`matches your ${req.connectorTypes.map((c) => CONNECTOR_LABELS[c]).join(" / ")} connector`);
  parts.push(DRIVER_HEALTH_PHRASE[r.healthStatus]);
  if (r.operationalStatus === "available" || r.operationalStatus === "in_use") {
    parts.push(`was marked ${r.operationalStatus === "available" ? "available" : "in use"} in the latest reported status`);
  }
  const distance = `is ${formatDistanceKm(r.distanceKm)} away in a straight line`;
  parts.push(closestKm !== null && r.distanceKm === closestKm ? `${distance}, the closest of these results` : distance);
  if (r.effectivePowerKw !== null) parts.push(`is rated ${formatNumber(r.effectivePowerKw, 0)} kW`);
  const lead = r.rank === 1 ? "Top match: it" : "It";
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  return `${lead} ${sentence}.`;
}
