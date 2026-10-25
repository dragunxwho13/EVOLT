/**
 * Deterministic demonstration data. Every station, charger and observation produced here
 * is fictional: names say "Demo Site", codes start with "DEMO-", records are flagged
 * is_synthetic = true and observations carry provenance = "simulated" (shown in the UI as
 * "Demo data"). Coordinates are placed near Chennai and Vellore only so distance-based
 * discovery can be demonstrated — they do not correspond to real charging stations.
 */
import type { ConnectorType, MetricKey, OperationalStatus } from "../../src/config/domain";
import { gaussian, seededRandom } from "../../src/features/anomaly-detection/stats";

export const SYNTHETIC_SOURCE = "EVOLT demo generator v1";

export interface SyntheticStation {
  code: string;
  name: string;
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  operator: string;
}

export type Scenario =
  | "healthy"
  | "healthy_spike"
  | "cr_drift"
  | "cr_mild_drift"
  | "vd_step"
  | "fault_burst"
  | "corroborated"
  | "sparse"
  | "stale"
  | "temperature_only"
  | "no_data";

export interface SyntheticCharger {
  code: string;
  stationCode: string;
  connectorType: ConnectorType;
  ratedPowerKw: number | null;
  operationalStatus: OperationalStatus;
  scenario: Scenario;
}

export interface SyntheticObservation {
  chargerCode: string;
  metric: MetricKey;
  observedAt: Date;
  value: number;
  sourceUnit: string;
}

const AREAS: [string, string, number, number][] = [
  ["Guindy area", "Chennai", 13.0067, 80.2206],
  ["T. Nagar area", "Chennai", 13.0418, 80.2341],
  ["Adyar area", "Chennai", 13.0012, 80.2565],
  ["Velachery area", "Chennai", 12.9815, 80.2180],
  ["Anna Nagar area", "Chennai", 13.0850, 80.2101],
  ["OMR / Sholinganallur area", "Chennai", 12.9010, 80.2279],
  ["Tambaram area", "Chennai", 12.9249, 80.1000],
  ["Porur area", "Chennai", 13.0382, 80.1565],
  ["Katpadi area", "Vellore", 12.9692, 79.1559],
  ["Vellore central area", "Vellore", 12.9165, 79.1325],
  ["Sriperumbudur corridor", "Kanchipuram", 12.9675, 79.9419],
];

export function syntheticStations(): SyntheticStation[] {
  const list: SyntheticStation[] = AREAS.map(([area, city, lat, lng], i) => ({
    code: `DEMO-${String(i + 1).padStart(2, "0")}`,
    name: `Demo Site ${String.fromCharCode(65 + i)} — ${area}`,
    address: "Demo location — not a real charging station",
    city,
    region: "Tamil Nadu",
    country: "India",
    latitude: lat,
    longitude: lng,
    operator: "Demo operator",
  }));
  // One station deliberately lacks coordinates to exercise honest missing-location handling.
  list.push({
    code: "DEMO-12",
    name: "Demo Site L — location not recorded",
    address: "Demo record — coordinates intentionally missing",
    city: "Chennai",
    region: "Tamil Nadu",
    country: "India",
    latitude: null,
    longitude: null,
    operator: "Demo operator",
  });
  return list;
}

const LAYOUT: [ConnectorType, number | null, OperationalStatus, Scenario][][] = [
  [["CCS2", 60, "available", "healthy"], ["CCS2", 60, "in_use", "cr_drift"], ["Type2", 22, "available", "healthy"]],
  [["CCS2", 120, "available", "healthy_spike"], ["CHAdeMO", 50, "available", "healthy"]],
  [["CCS2", 150, "available", "vd_step"], ["CCS2", 150, "available", "healthy"], ["Type2", 7.4, "offline", "no_data"]],
  [["CCS2", 30, "available", "fault_burst"], ["GBT", 60, "unknown", "sparse"]],
  [["CCS2", 60, "available", "healthy"], ["CCS2", 60, "available", "cr_mild_drift"]],
  [["CCS2", 180, "in_use", "corroborated"], ["CCS2", 180, "available", "healthy"], ["CHAdeMO", 50, "available", "healthy"]],
  [["CCS2", 50, "available", "stale"], ["Type2", 22, "available", "temperature_only"]],
  [["CCS2", 60, "available", "healthy"], ["Type2", 22, "in_use", "healthy"]],
  [["CCS2", 60, "available", "healthy"], ["CCS2", 30, "available", "sparse"]],
  [["CCS2", 120, "available", "healthy"], ["CHAdeMO", 50, "offline", "healthy"]],
  [["CCS2", 60, "unknown", "healthy"], ["CCS2", null, "available", "no_data"]],
  [["CCS2", 60, "available", "healthy"]],
];

export function syntheticChargers(): SyntheticCharger[] {
  const stations = syntheticStations();
  const out: SyntheticCharger[] = [];
  LAYOUT.forEach((chargers, si) => {
    chargers.forEach(([connectorType, ratedPowerKw, operationalStatus, scenario], ci) => {
      out.push({
        code: `${stations[si]!.code}-C${ci + 1}`,
        stationCode: stations[si]!.code,
        connectorType,
        ratedPowerKw,
        operationalStatus,
        scenario,
      });
    });
  });
  return out;
}

const DAY = 86_400_000;
const WEEKS = 26;

/** Generates weekly observations ending shortly before `anchor`. */
export function syntheticObservations(charger: SyntheticCharger, index: number, anchor: Date): SyntheticObservation[] {
  const rand = seededRandom(1000 + index * 31);
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()) - 2 * DAY + 10 * 3_600_000);
  const s = charger.scenario;
  if (s === "no_data") return [];

  const weeks = s === "sparse" ? 4 : WEEKS;
  const shift = s === "stale" ? 100 * DAY : 0;
  const crBase = 0.2 + rand() * 0.12;
  const vdBase = 28 + rand() * 14;
  const tBase = 8 + rand() * 5;
  const obs: SyntheticObservation[] = [];
  const push = (metric: MetricKey, i: number, value: number, unit: string) =>
    obs.push({
      chargerCode: charger.code,
      metric,
      observedAt: new Date(end.getTime() - shift - (weeks - 1 - i) * 7 * DAY),
      value: Math.max(0, Math.round(value * 10_000) / 10_000),
      sourceUnit: unit,
    });

  for (let i = 0; i < weeks; i++) {
    const late = i - (weeks - 1); // 0 for newest, negative before
    if (s !== "temperature_only") {
      let cr = crBase * (1 + gaussian(rand) * 0.03);
      if (s === "cr_drift" && i >= 15) cr += crBase * 0.06 * (i - 14);
      if (s === "cr_mild_drift" && i >= 14) cr += crBase * 0.022 * (i - 13);
      if (s === "corroborated" && i >= 17) cr += crBase * 0.03 * (i - 16);
      if (s === "healthy_spike" && i === WEEKS - 6) cr *= 1.6;
      push("contact_resistance", i, cr, "mΩ");

      if (s !== "sparse") {
        let vd = vdBase * (1 + gaussian(rand) * 0.03);
        if (s === "vd_step" && i >= 20) vd *= 1.45;
        if (s === "corroborated" && i >= 17) vd += vdBase * 0.025 * (i - 16);
        push("voltage_drop", i, vd, "mV");

        let faults = rand() < 0.05 ? 1 : 0;
        if (s === "fault_burst" && late >= -3) faults = 3 + Math.floor(rand() * 2);
        push("fault_count", i, faults, "count");
      }
    }
    if (s === "vd_step" || s === "temperature_only" || s === "corroborated") {
      let t = tBase + gaussian(rand) * 0.6;
      if (s === "vd_step" && i >= 20) t += 4;
      push("temperature_rise", i, t, "°C");
    }
  }
  return obs;
}

export const SYNTHETIC_VEHICLE_PROFILES = [
  { code: "generic-ccs2-60", name: "Generic CCS2 vehicle (max 60 kW DC)", connectorTypes: ["CCS2", "Type2"] as ConnectorType[], maxDcPowerKw: 60 },
  { code: "generic-ccs2-150", name: "Generic CCS2 vehicle (max 150 kW DC)", connectorTypes: ["CCS2", "Type2"] as ConnectorType[], maxDcPowerKw: 150 },
  { code: "generic-chademo-50", name: "Generic CHAdeMO vehicle (max 50 kW DC)", connectorTypes: ["CHAdeMO", "Type2"] as ConnectorType[], maxDcPowerKw: 50 },
  { code: "generic-gbt-60", name: "Generic GB/T vehicle (max 60 kW DC)", connectorTypes: ["GBT"] as ConnectorType[], maxDcPowerKw: 60 },
  { code: "generic-ac-only", name: "Generic AC-only vehicle (Type 2)", connectorTypes: ["Type2"] as ConnectorType[], maxDcPowerKw: null },
];
