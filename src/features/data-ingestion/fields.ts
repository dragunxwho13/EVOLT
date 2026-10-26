import type { DatasetKind } from "@/config/domain";

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
  description: string;
}

export const DATASET_FIELDS: Record<DatasetKind, FieldDef[]> = {
  registry: [
    { key: "station_code", label: "Station code", required: true, aliases: ["station_id", "site_id", "site_code", "location_id"], description: "Stable identifier of the station/site." },
    { key: "station_name", label: "Station name", required: true, aliases: ["site_name", "name", "station"], description: "Display name." },
    { key: "address", label: "Address", required: false, aliases: ["street", "street_address"], description: "Street address." },
    { key: "city", label: "City", required: false, aliases: ["town"], description: "City or town." },
    { key: "region", label: "Region", required: false, aliases: ["state", "province", "district"], description: "State/region." },
    { key: "country", label: "Country", required: false, aliases: ["country_code"], description: "Country name or ISO code." },
    { key: "latitude", label: "Latitude", required: false, aliases: ["lat"], description: "WGS84 decimal degrees, −90 to 90. Leave both coordinates empty if unknown." },
    { key: "longitude", label: "Longitude", required: false, aliases: ["lon", "lng", "long"], description: "WGS84 decimal degrees, −180 to 180." },
    { key: "operator", label: "Operator", required: false, aliases: ["cpo", "network", "owner"], description: "Charge-point operator." },
    { key: "charger_code", label: "Charger code", required: true, aliases: ["charger_id", "evse_id", "connector_id", "charger"], description: "Stable identifier of the charger/connector." },
    { key: "connector_type", label: "Connector type", required: true, aliases: ["connector", "plug_type", "plug", "standard"], description: "CCS2, CCS1, CHAdeMO, Type2, GBT or NACS." },
    { key: "rated_power_kw", label: "Rated power (kW)", required: false, aliases: ["power_kw", "max_power_kw", "rated_power", "power"], description: "Nameplate power in kW." },
    { key: "operational_status", label: "Operational status", required: false, aliases: ["status", "availability", "state_of_charger"], description: "available, in_use, offline or unknown." },
  ],
  observations: [
    { key: "charger_code", label: "Charger code", required: true, aliases: ["charger_id", "evse_id", "connector_id", "charger"], description: "Must match a charger already in EVOLT." },
    { key: "observed_at", label: "Observed at", required: true, aliases: ["timestamp", "time", "datetime", "measured_at", "date", "recorded_at"], description: "ISO 8601 with timezone, e.g. 2026-05-01T10:00:00Z. Date-only values are read as 00:00 UTC." },
    { key: "metric", label: "Metric", required: true, aliases: ["measurement", "parameter", "quantity"], description: "contact_resistance, voltage_drop, fault_count or temperature_rise." },
    { key: "value", label: "Value", required: true, aliases: ["reading", "measurement_value", "val"], description: "Numeric value. Empty values are rejected, never treated as zero." },
    { key: "unit", label: "Unit", required: true, aliases: ["units", "uom"], description: "Unit of the value; converted to the metric's canonical unit." },
    { key: "temperature_c", label: "Contact temperature (°C)", required: false, aliases: ["temperature", "temp_c", "contact_temperature", "contact_temp_c", "measured_temperature_c", "temp"], description: "Contact temperature when measured, in °C. When every reading has one, resistance and voltage drop are restated at 20 °C." },
    { key: "provenance", label: "Provenance", required: false, aliases: ["data_type", "origin", "data_origin"], description: "observed, derived, estimated or sample." },
    { key: "source", label: "Source", required: false, aliases: ["source_name", "instrument", "device"], description: "Free-text source, e.g. instrument or system name." },
  ],
  sessions: [
    { key: "station_code", label: "Station", required: true, aliases: ["station_id", "site_id", "station", "location_id"], description: "Station identifier. Stations are created automatically." },
    { key: "observed_at", label: "Session time", required: true, aliases: ["timestamp", "time", "datetime", "start_time", "session_start", "date"], description: "When the session happened. Times without a timezone use the timezone chosen on import." },
    { key: "charging_mode", label: "Charging type", required: false, aliases: ["charging_type", "charger_type", "mode", "charge_type"], description: "e.g. Fast, Conventional, V2G. Each station + charging type becomes one charger." },
    { key: "charger_code", label: "Charger", required: false, aliases: ["charger_id", "evse_id", "connector_id"], description: "Charger identifier, if the file has one (otherwise station + charging type is used)." },
    { key: "connector_type", label: "Connector type", required: false, aliases: ["connector", "plug_type", "plug"], description: "CCS2, CHAdeMO, Type2… Recorded as “Not recorded” when absent." },
    { key: "area", label: "Area / location type", required: false, aliases: ["location", "area", "zone", "location_type"], description: "e.g. Urban, Suburban, Rural. Kept per session." },
    { key: "power_loss", label: "Power loss (kW)", required: false, aliases: ["power_loss_kw", "loss_kw", "energy_loss"], description: "Analysed for persistent deviations and trends per charger." },
    { key: "voltage_fluctuation", label: "Voltage fluctuation", required: false, aliases: ["voltage_fluctuation_pct", "voltage_variation"], description: "Supporting evidence only (unit assumed %, as the file states none)." },
    { key: "power_loss_label", label: "Power-loss category (label)", required: false, aliases: ["reduced_power_loss_category", "power_loss_category", "loss_category"], description: "Optional label. Used to train and test a classifier." },
    { key: "voltage_stability_label", label: "Voltage-stability category (label)", required: false, aliases: ["voltage_stability_category", "stability_category"], description: "Optional label. Used to train and test a classifier." },
  ],
};

/** Columns that identify a session file even when only a few are present. */
const SESSION_SIGNALS = ["power_loss", "voltage_level", "current_flow", "power_consumed", "charging_type", "charging_power", "charging_time", "battery_capacity", "voltage_fluctuation", "ev_id"];

export interface KindDetection {
  kind: DatasetKind;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/** Guesses what a file contains from its headers, so people do not have to know. */
export function detectKind(headers: string[]): KindDetection {
  const norm = new Set(headers.map(normalizeHeader));
  const has = (k: string) => norm.has(k);
  const score = (kind: DatasetKind) => {
    const m = suggestMapping(kind, headers);
    const req = DATASET_FIELDS[kind].filter((f) => f.required);
    const reqHit = req.filter((f) => m[f.key]).length;
    const optHit = DATASET_FIELDS[kind].filter((f) => !f.required && m[f.key]).length;
    return { complete: reqHit === req.length, hits: reqHit * 2 + optHit };
  };
  const sessionSignals = SESSION_SIGNALS.filter(has).length;
  const obs = score("observations");
  const reg = score("registry");
  const ses = score("sessions");
  if (obs.complete && has("metric")) return { kind: "observations", confidence: "high", reason: "It has charger, time, metric, value and unit columns." };
  if (reg.complete && (has("connector_type") || has("latitude"))) return { kind: "registry", confidence: "high", reason: "It lists stations with their chargers and connector types." };
  if (ses.complete && sessionSignals >= 2) return { kind: "sessions", confidence: "high", reason: `It has one row per charging session with ${sessionSignals} electrical/session measurements.` };
  const ranked = [
    ["sessions", ses] as const,
    ["registry", reg] as const,
    ["observations", obs] as const,
  ].sort((a, b) => Number(b[1].complete) - Number(a[1].complete) || b[1].hits - a[1].hits);
  const [kind, s] = ranked[0]!;
  return { kind, confidence: s.complete ? "medium" : "low", reason: s.complete ? "Best match by column names — please confirm." : "Columns do not clearly match any format; map them below." };
}

export type ColumnMapping = Record<string, string | null>;

export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Suggests a mapping from canonical fields to the file's headers. */
export function suggestMapping(kind: DatasetKind, headers: string[]): ColumnMapping {
  const byNorm = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n && !byNorm.has(n)) byNorm.set(n, h);
  }
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const f of DATASET_FIELDS[kind]) {
    const candidates = [f.key, ...f.aliases];
    let match: string | null = null;
    for (const c of candidates) {
      const h = byNorm.get(c);
      if (h && !used.has(h)) {
        match = h;
        break;
      }
    }
    if (match) used.add(match);
    mapping[f.key] = match;
  }
  return mapping;
}

export function missingRequiredFields(kind: DatasetKind, mapping: ColumnMapping): string[] {
  return DATASET_FIELDS[kind].filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
}
