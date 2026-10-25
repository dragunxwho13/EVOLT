import { ANALYSIS_PARAMS } from "@/config/analysis";
import { METRICS, type ConnectorType, type MetricKey, type OperationalStatus, type Provenance } from "@/config/domain";
import { normalizeHeader } from "./fields";
import type { ImportRowIssue } from "@/types/analysis";
import type { ColumnMapping } from "./fields";
import type { RawRow } from "./parse";
import {
  cleanText,
  convertToCanonical,
  isValidCode,
  normalizeConnector,
  normalizeMetric,
  normalizeOperationalStatus,
  normalizeProvenance,
  parseNumber,
  parseOptionalNumber,
  parseTimestamp,
} from "./normalize";

export interface ImportCounts {
  total: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  skipped: number;
}

function get(row: RawRow, mapping: ColumnMapping, key: string): string {
  const header = mapping[key];
  return header ? (row[header] ?? "") : "";
}

function isBlank(row: RawRow): boolean {
  return Object.values(row).every((v) => v.trim() === "");
}

/* ───────────────────────── Observations ───────────────────────── */

export interface ObservationCandidate {
  row: number;
  chargerId: string;
  chargerCode: string;
  metric: MetricKey;
  observedAt: Date;
  value: number;
  sourceUnit: string;
  provenance: Provenance;
  source: string | null;
}

export function observationKey(chargerId: string, metric: string, observedAt: Date): string {
  return `${chargerId}|${metric}|${observedAt.toISOString()}`;
}

export interface ObservationPlan {
  candidates: ObservationCandidate[];
  issues: ImportRowIssue[];
  counts: ImportCounts;
}

/**
 * Validates and normalises observation rows. Pure: database lookups are passed in.
 * `existingKeys` holds keys already stored, so re-imports are reported as duplicates.
 */
export function planObservations(
  rows: RawRow[],
  mapping: ColumnMapping,
  chargerIdByCode: ReadonlyMap<string, string>,
  existingKeys: ReadonlySet<string>,
  now: Date,
  defaultProvenance: Provenance,
  assumeOffsetMinutes: number | null = null,
): ObservationPlan {
  const issues: ImportRowIssue[] = [];
  const candidates: ObservationCandidate[] = [];
  const seen = new Set<string>();
  const counts: ImportCounts = { total: rows.length, accepted: 0, rejected: 0, duplicate: 0, skipped: 0 };
  const futureLimit = now.getTime() + ANALYSIS_PARAMS.futureToleranceMinutes * 60_000;

  rows.forEach((raw, i) => {
    const row = i + 1;
    if (isBlank(raw)) {
      counts.skipped++;
      issues.push({ row, kind: "skipped", message: "Blank row." });
      return;
    }
    const reject = (field: string, message: string) => {
      counts.rejected++;
      issues.push({ row, kind: "rejected", field, message });
    };

    const code = get(raw, mapping, "charger_code").trim();
    if (!code) return reject("charger_code", "Charger code is missing.");
    const chargerId = chargerIdByCode.get(code);
    if (!chargerId) return reject("charger_code", `Unknown charger "${code}". Import it in a registry file first.`);

    const ts = parseTimestamp(get(raw, mapping, "observed_at"), assumeOffsetMinutes);
    if (!ts.ok) return reject("observed_at", ts.error);
    if (ts.value.getTime() > futureLimit) return reject("observed_at", "Timestamp is in the future.");

    const metric = normalizeMetric(get(raw, mapping, "metric"));
    if (!metric.ok) return reject("metric", metric.error);

    const value = parseNumber(get(raw, mapping, "value"), "Value");
    if (!value.ok) return reject("value", value.error);

    const unitRaw = get(raw, mapping, "unit");
    const canonical = convertToCanonical(metric.value, value.value, unitRaw);
    if (!canonical.ok) return reject("unit", canonical.error);

    const [lo, hi] = METRICS[metric.value].plausible;
    if (canonical.value < lo || canonical.value > hi) {
      return reject(
        "value",
        `Implausible ${metric.value} value ${canonical.value} ${METRICS[metric.value].unit} (expected ${lo}–${hi}).`,
      );
    }
    if (metric.value === "fault_count" && !Number.isInteger(canonical.value)) {
      return reject("value", "Fault counts must be whole numbers.");
    }

    const provenance = normalizeProvenance(get(raw, mapping, "provenance"), defaultProvenance);
    if (!provenance.ok) return reject("provenance", provenance.error);

    const key = observationKey(chargerId, metric.value, ts.value);
    if (seen.has(key)) {
      counts.duplicate++;
      issues.push({ row, kind: "duplicate", message: "Same charger, metric and timestamp as an earlier row in this file." });
      return;
    }
    seen.add(key);
    if (existingKeys.has(key)) {
      counts.duplicate++;
      issues.push({ row, kind: "duplicate", message: "This observation is already stored." });
      return;
    }

    counts.accepted++;
    candidates.push({
      row,
      chargerId,
      chargerCode: code,
      metric: metric.value,
      observedAt: ts.value,
      value: canonical.value,
      sourceUnit: unitRaw.trim(),
      provenance: provenance.value,
      source: cleanText(get(raw, mapping, "source"), 120),
    });
  });

  return { candidates, issues, counts };
}

/* ───────────────────────── Registry ───────────────────────── */

export interface StationCandidate {
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  operator: string | null;
}

export interface ChargerCandidate {
  row: number;
  code: string;
  stationCode: string;
  connectorType: ConnectorType;
  ratedPowerKw: number | null;
  operationalStatus: OperationalStatus;
  /** True when the charger code already exists and will be updated. */
  isUpdate: boolean;
}

export interface RegistryPlan {
  stations: StationCandidate[];
  chargers: ChargerCandidate[];
  issues: ImportRowIssue[];
  counts: ImportCounts;
}

export function planRegistry(
  rows: RawRow[],
  mapping: ColumnMapping,
  existingChargerStation: ReadonlyMap<string, string>,
): RegistryPlan {
  const issues: ImportRowIssue[] = [];
  const stations = new Map<string, StationCandidate>();
  const chargers: ChargerCandidate[] = [];
  const seenChargers = new Set<string>();
  const counts: ImportCounts = { total: rows.length, accepted: 0, rejected: 0, duplicate: 0, skipped: 0 };

  rows.forEach((raw, i) => {
    const row = i + 1;
    if (isBlank(raw)) {
      counts.skipped++;
      issues.push({ row, kind: "skipped", message: "Blank row." });
      return;
    }
    const reject = (field: string, message: string) => {
      counts.rejected++;
      issues.push({ row, kind: "rejected", field, message });
    };

    const stationCode = get(raw, mapping, "station_code").trim();
    if (!stationCode) return reject("station_code", "Station code is missing.");
    if (!isValidCode(stationCode)) return reject("station_code", `Station code "${stationCode}" contains unsupported characters.`);
    const stationName = cleanText(get(raw, mapping, "station_name"));
    if (!stationName) return reject("station_name", "Station name is missing.");

    const lat = parseOptionalNumber(get(raw, mapping, "latitude"), "Latitude");
    if (!lat.ok) return reject("latitude", lat.error);
    const lng = parseOptionalNumber(get(raw, mapping, "longitude"), "Longitude");
    if (!lng.ok) return reject("longitude", lng.error);
    if ((lat.value === null) !== (lng.value === null)) {
      return reject("latitude", "Provide both latitude and longitude, or neither.");
    }
    if (lat.value !== null && (lat.value < -90 || lat.value > 90)) return reject("latitude", "Latitude must be between −90 and 90.");
    if (lng.value !== null && (lng.value < -180 || lng.value > 180)) return reject("longitude", "Longitude must be between −180 and 180.");
    if (lat.value === 0 && lng.value === 0) return reject("latitude", "Coordinates 0,0 are almost certainly a placeholder; leave them empty if unknown.");

    const chargerCode = get(raw, mapping, "charger_code").trim();
    if (!chargerCode) return reject("charger_code", "Charger code is missing.");
    if (!isValidCode(chargerCode)) return reject("charger_code", `Charger code "${chargerCode}" contains unsupported characters.`);
    const connector = normalizeConnector(get(raw, mapping, "connector_type"));
    if (!connector.ok) return reject("connector_type", connector.error);
    const power = parseOptionalNumber(get(raw, mapping, "rated_power_kw"), "Rated power");
    if (!power.ok) return reject("rated_power_kw", power.error);
    if (power.value !== null && (power.value <= 0 || power.value > 1500)) {
      return reject("rated_power_kw", "Rated power must be greater than 0 and at most 1500 kW.");
    }
    const status = normalizeOperationalStatus(get(raw, mapping, "operational_status"));
    if (!status.ok) return reject("operational_status", status.error);

    const station: StationCandidate = {
      code: stationCode,
      name: stationName,
      address: cleanText(get(raw, mapping, "address")),
      city: cleanText(get(raw, mapping, "city"), 100),
      region: cleanText(get(raw, mapping, "region"), 100),
      country: cleanText(get(raw, mapping, "country"), 100),
      latitude: lat.value,
      longitude: lng.value,
      operator: cleanText(get(raw, mapping, "operator"), 120),
    };
    const prior = stations.get(stationCode);
    if (prior && (prior.name !== station.name || prior.latitude !== station.latitude || prior.longitude !== station.longitude)) {
      return reject("station_code", `Station "${stationCode}" appears earlier in the file with a different name or location.`);
    }

    if (seenChargers.has(chargerCode)) {
      counts.duplicate++;
      issues.push({ row, kind: "duplicate", message: `Charger "${chargerCode}" appears earlier in this file.` });
      return;
    }
    const existingStation = existingChargerStation.get(chargerCode);
    if (existingStation && existingStation !== stationCode) {
      return reject("charger_code", `Charger "${chargerCode}" already belongs to station "${existingStation}"; moving chargers is not supported.`);
    }

    if (!prior) stations.set(stationCode, station);
    seenChargers.add(chargerCode);
    counts.accepted++;
    chargers.push({
      row,
      code: chargerCode,
      stationCode,
      connectorType: connector.value,
      ratedPowerKw: power.value,
      operationalStatus: status.value,
      isUpdate: Boolean(existingStation),
    });
  });

  return { stations: [...stations.values()], chargers, issues, counts };
}

/* ───────────── Sessions (one row per charging session) ───────────── */

export interface SessionCandidate {
  row: number;
  stationCode: string;
  chargerCode: string;
  chargingMode: string | null;
  connectorType: ConnectorType;
  startedAt: Date;
  area: string | null;
  values: Record<string, number>;
  labels: Record<string, string>;
}

export interface SessionStation {
  code: string;
  name: string;
}

export interface SessionCharger {
  code: string;
  stationCode: string;
  chargingMode: string | null;
  connectorType: ConnectorType;
  sessions: number;
}

export interface DataQualityFinding {
  level: "info" | "warning";
  message: string;
}

export interface SessionPlan {
  stations: SessionStation[];
  chargers: SessionCharger[];
  sessions: SessionCandidate[];
  issues: ImportRowIssue[];
  counts: ImportCounts;
  /** Numeric columns captured into each session's values. */
  numericColumns: string[];
  labelColumns: { field: string; column: string; classes: string[] }[];
  findings: DataQualityFinding[];
  /** What the file contains (valid rows, including ones already stored). */
  file: { stations: number; chargers: number; sessions: number; times: number[] };
}

export function sessionKey(chargerCode: string, startedAt: Date): string {
  return `${chargerCode}|${startedAt.toISOString()}`;
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

function slug(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "X";
}

/**
 * Validates a session file and turns it into stations, chargers (one per station and
 * charging type unless the file names chargers) and sessions. Every numeric column is
 * kept with each session so models can be trained on exactly what was imported.
 */
export function planSessions(
  rows: RawRow[],
  headers: string[],
  mapping: ColumnMapping,
  existingKeys: ReadonlySet<string>,
  now: Date,
  assumeOffsetMinutes: number | null,
): SessionPlan {
  const issues: ImportRowIssue[] = [];
  const counts: ImportCounts = { total: rows.length, accepted: 0, rejected: 0, duplicate: 0, skipped: 0 };
  const futureLimit = now.getTime() + ANALYSIS_PARAMS.futureToleranceMinutes * 60_000;
  const mapped = new Set(Object.values(mapping).filter((v): v is string => Boolean(v)));
  const labelFields = ["power_loss_label", "voltage_stability_label"].filter((f) => mapping[f]);

  // Numeric columns = unmapped columns whose non-empty values are all numbers (plus mapped measurements).
  const numericColumns = headers.filter((h) => {
    if (mapped.has(h) && h !== mapping.power_loss && h !== mapping.voltage_fluctuation) return false;
    let seen = 0;
    for (const r of rows) {
      const v = (r[h] ?? "").trim();
      if (!v) continue;
      if (!NUMBER_RE.test(v)) return false;
      seen++;
    }
    return seen > 0;
  });

  const seen = new Set<string>();
  const sessions: SessionCandidate[] = [];
  const fileSessions: SessionCandidate[] = [];
  const fileStations = new Set<string>();
  const fileChargers = new Set<string>();
  const stationMap = new Map<string, SessionStation>();
  const chargerMap = new Map<string, SessionCharger>();
  const areasByStation = new Map<string, Set<string>>();
  const modesByStation = new Map<string, Set<string>>();

  rows.forEach((raw, i) => {
    const row = i + 1;
    if (isBlank(raw)) {
      counts.skipped++;
      issues.push({ row, kind: "skipped", message: "Blank row." });
      return;
    }
    const reject = (field: string, message: string) => {
      counts.rejected++;
      issues.push({ row, kind: "rejected", field, message });
    };
    const stationRaw = get(raw, mapping, "station_code").trim();
    if (!stationRaw) return reject("station_code", "Station is missing.");
    const stationCode = /^\d+$/.test(stationRaw) ? `ST-${stationRaw.padStart(2, "0")}` : stationRaw;
    if (!isValidCode(stationCode)) return reject("station_code", `Station "${stationRaw}" contains unsupported characters.`);

    const ts = parseTimestamp(get(raw, mapping, "observed_at"), assumeOffsetMinutes);
    if (!ts.ok) return reject("observed_at", ts.error);
    if (ts.value.getTime() > futureLimit) return reject("observed_at", "Session time is in the future.");

    const mode = cleanText(get(raw, mapping, "charging_mode"), 40);
    let connectorType: ConnectorType = "Unknown";
    const connRaw = get(raw, mapping, "connector_type");
    if (connRaw.trim()) {
      const c = normalizeConnector(connRaw);
      if (!c.ok) return reject("connector_type", c.error);
      connectorType = c.value;
    }
    const chargerRaw = get(raw, mapping, "charger_code").trim();
    const chargerCode = chargerRaw ? chargerRaw : mode ? `${stationCode}-${slug(mode)}` : `${stationCode}-C1`;
    if (!isValidCode(chargerCode)) return reject("charger_code", `Charger "${chargerCode}" contains unsupported characters.`);

    const values: Record<string, number> = {};
    for (const col of numericColumns) {
      const v = (raw[col] ?? "").trim();
      if (!v) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) return reject(col, `${col} is not a finite number.`);
      values[col] = n;
    }
    // Validate the analysed measurements against their plausible ranges.
    for (const metric of ["power_loss", "voltage_fluctuation"] as const) {
      const col = mapping[metric];
      if (!col) continue;
      const v = values[col];
      if (v === undefined) continue; // missing is allowed; it is simply not observed
      const [lo, hi] = METRICS[metric].plausible;
      if (v < lo || v > hi) return reject(col, `Implausible ${metric} value ${v} ${METRICS[metric].unit} (expected ${lo}–${hi}).`);
    }
    const labels: Record<string, string> = {};
    for (const f of labelFields) {
      const v = cleanText(get(raw, mapping, f), 40);
      if (v) labels[mapping[f]!] = v;
    }

    const key = sessionKey(chargerCode, ts.value);
    if (seen.has(key)) {
      counts.duplicate++;
      issues.push({ row, kind: "duplicate", message: "Same charger and time as an earlier row in this file." });
      return;
    }
    seen.add(key);
    // Every valid row describes the file, even if it is already stored, so the
    // summary and data-quality findings stay meaningful on a re-import.
    const area = cleanText(get(raw, mapping, "area"), 60);
    const session = { row, stationCode, chargerCode, chargingMode: mode, connectorType, startedAt: ts.value, area, values, labels };
    fileSessions.push(session);
    fileStations.add(stationCode);
    fileChargers.add(chargerCode);
    if (area) (areasByStation.get(stationCode) ?? areasByStation.set(stationCode, new Set()).get(stationCode)!).add(area);
    if (mode) (modesByStation.get(stationCode) ?? modesByStation.set(stationCode, new Set()).get(stationCode)!).add(mode);
    if (existingKeys.has(key)) {
      counts.duplicate++;
      issues.push({ row, kind: "duplicate", message: "This session is already stored." });
      return;
    }

    if (!stationMap.has(stationCode)) stationMap.set(stationCode, { code: stationCode, name: /^ST-/.test(stationCode) ? `Station ${stationRaw}` : stationRaw });
    const ch = chargerMap.get(chargerCode) ?? { code: chargerCode, stationCode, chargingMode: mode, connectorType, sessions: 0 };
    ch.sessions++;
    chargerMap.set(chargerCode, ch);
    counts.accepted++;
    sessions.push(session);
  });

  // ── Data-quality findings, stated plainly for the importer ──
  const findings: DataQualityFinding[] = [];
  const multiArea = [...areasByStation.values()].filter((s) => s.size > 1).length;
  if (multiArea > 0) {
    findings.push({
      level: "warning",
      message: `${multiArea} of ${fileStations.size} stations appear with more than one area/location type, so the area cannot describe a fixed site. It is kept per session and stations are not placed on the map.`,
    });
  } else if (fileStations.size) {
    findings.push({ level: "info", message: "The file has no coordinates, so stations are listed but not placed on the map." });
  }
  const multiMode = [...modesByStation.values()].filter((s) => s.size > 1).length;
  if (multiMode > 0) findings.push({ level: "info", message: `${multiMode} stations have sessions with several charging types; each station + charging type becomes its own charger.` });
  if (!mapping.connector_type) findings.push({ level: "info", message: "No connector type column: chargers are recorded with connector “Not recorded” and excluded when you filter alternatives by connector." });
  const lossCol = mapping.power_loss;
  const consumedCol = headers.find((h) => normalizeHeader(h) === "power_consumed");
  if (lossCol && consumedCol) {
    const impossible = fileSessions.filter((s) => s.values[lossCol] !== undefined && s.values[consumedCol] !== undefined && s.values[lossCol]! > s.values[consumedCol]!).length;
    if (impossible) {
      findings.push({
        level: "warning",
        message: `${impossible} session(s) report more power lost than consumed, which cannot happen in a correct measurement. Treat this file as unverified — consider choosing “Demo / sample data” as its source.`,
      });
    }
  }
  const vCol = headers.find((h) => normalizeHeader(h) === "voltage_level");
  const iCol = headers.find((h) => normalizeHeader(h) === "current_flow");
  if (vCol && iCol && consumedCol) {
    const exact = fileSessions.filter((s) => {
      const v = s.values[vCol];
      const a = s.values[iCol];
      const p = s.values[consumedCol];
      return v !== undefined && a !== undefined && p !== undefined && Math.abs((v * a) / 1000 - p) < 1e-6 * Math.max(1, p);
    }).length;
    if (exact === fileSessions.length && exact > 0) {
      findings.push({ level: "info", message: `${humanizeCol(consumedCol)} equals ${humanizeCol(vCol)} × ${humanizeCol(iCol)} ÷ 1000 in every row — it is derived, not an independent measurement.` });
    }
  }
  if (!lossCol) findings.push({ level: "warning", message: "No power-loss column was mapped, so connector-health analysis has nothing to assess for these chargers." });

  const labelColumns = labelFields.map((f) => ({
    field: f,
    column: mapping[f]!,
    classes: [...new Set(fileSessions.map((s) => s.labels[mapping[f]!]).filter((v): v is string => Boolean(v)))].sort(),
  }));

  return {
    stations: [...stationMap.values()],
    chargers: [...chargerMap.values()],
    sessions,
    issues,
    counts,
    numericColumns,
    labelColumns,
    findings,
    file: {
      stations: fileStations.size,
      chargers: fileChargers.size,
      sessions: fileSessions.length,
      times: fileSessions.map((s) => s.startedAt.getTime()),
    },
  };
}

function humanizeCol(c: string): string {
  return c.replace(/_/g, " ");
}
