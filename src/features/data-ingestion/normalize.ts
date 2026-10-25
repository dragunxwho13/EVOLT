import {
  CONNECTOR_TYPES,
  METRICS,
  PROVENANCES,
  isMetricKey,
  type ConnectorType,
  type MetricKey,
  type OperationalStatus,
  type Provenance,
} from "@/config/domain";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d{1,6})?)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a timestamp. Values with a timezone are used as given; date-only values mean
 * 00:00 UTC. Values without a timezone ("2024-01-01 00:15:00") are accepted only when
 * the importer chose which timezone they are in (`assumeOffsetMinutes`, e.g. 330 for IST).
 */
export function parseTimestamp(raw: string, assumeOffsetMinutes: number | null = null): Result<Date> {
  const s = raw.trim();
  if (!s) return fail("Timestamp is missing.");
  let d: Date;
  const naive = ISO_NAIVE.exec(s);
  if (DATE_ONLY.test(s)) d = new Date(`${s}T00:00:00Z`);
  else if (ISO_WITH_ZONE.test(s)) d = new Date(s.replace(" ", "T"));
  else if (naive && assumeOffsetMinutes !== null) {
    d = new Date(Date.parse(`${naive[1]}T${naive[2]}${naive[3] ?? ":00"}Z`) - assumeOffsetMinutes * 60_000);
  } else if (naive) {
    return fail(`"${s}" has no timezone. Choose the file's timezone on the import screen, or add one (e.g. 2026-05-01T10:00:00Z).`);
  } else return fail(`"${s}" is not an ISO 8601 timestamp (e.g. 2026-05-01T10:00:00Z or 2026-05-01 10:00:00).`);
  if (Number.isNaN(d.getTime())) return fail(`"${s}" is not a valid date.`);
  if (d.getUTCFullYear() < 2000) return fail(`"${s}" is before the year 2000.`);
  return ok(d);
}

/** Parses a finite number. Empty strings are an error — never silently zero. */
export function parseNumber(raw: string, label: string): Result<number> {
  const s = raw.trim();
  if (!s) return fail(`${label} is missing.`);
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return fail(`${label} "${s}" is not a number.`);
  const n = Number(s);
  if (!Number.isFinite(n)) return fail(`${label} "${s}" is not a finite number.`);
  return ok(n);
}

export function parseOptionalNumber(raw: string, label: string): Result<number | null> {
  return raw.trim() === "" ? ok(null) : parseNumber(raw, label);
}

const CONNECTOR_ALIASES: Record<string, ConnectorType> = {
  ccs2: "CCS2",
  ccs_2: "CCS2",
  combo2: "CCS2",
  combo_2: "CCS2",
  ccs1: "CCS1",
  ccs_1: "CCS1",
  combo1: "CCS1",
  combo_1: "CCS1",
  chademo: "CHAdeMO",
  type2: "Type2",
  type_2: "Type2",
  mennekes: "Type2",
  iec_62196_2: "Type2",
  gbt: "GBT",
  gb_t: "GBT",
  nacs: "NACS",
  j3400: "NACS",
  sae_j3400: "NACS",
};

export function normalizeConnector(raw: string): Result<ConnectorType> {
  const s = raw.trim();
  if (!s) return fail("Connector type is missing.");
  if ((CONNECTOR_TYPES as readonly string[]).includes(s)) return ok(s as ConnectorType);
  const key = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const match = CONNECTOR_ALIASES[key] ?? CONNECTOR_ALIASES[key.replace(/_/g, "")];
  return match ? ok(match) : fail(`Unknown connector type "${s}". Use one of ${CONNECTOR_TYPES.join(", ")}.`);
}

const STATUS_ALIASES: Record<string, OperationalStatus> = {
  available: "available",
  free: "available",
  operational: "available",
  in_use: "in_use",
  inuse: "in_use",
  occupied: "in_use",
  charging: "in_use",
  busy: "in_use",
  offline: "offline",
  out_of_service: "offline",
  faulted: "offline",
  unavailable: "offline",
  unknown: "unknown",
};

export function normalizeOperationalStatus(raw: string): Result<OperationalStatus> {
  const s = raw.trim();
  if (!s) return ok("unknown");
  const key = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const match = STATUS_ALIASES[key];
  return match ? ok(match) : fail(`Unknown operational status "${s}". Use available, in_use, offline or unknown.`);
}

export function normalizeMetric(raw: string): Result<MetricKey> {
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!key) return fail("Metric is missing.");
  if (isMetricKey(key)) return ok(key);
  // Accept common unit-suffixed spellings such as contact_resistance_mohm.
  for (const m of Object.keys(METRICS) as MetricKey[]) {
    if (key.startsWith(`${m}_`)) return ok(m);
  }
  return fail(`Unknown metric "${raw.trim()}". Use one of ${Object.keys(METRICS).join(", ")}.`);
}

/** Converts a value to the metric's canonical unit. Unknown units are rejected. */
export function convertToCanonical(metric: MetricKey, value: number, unitRaw: string): Result<number> {
  const unit = unitRaw.trim();
  if (!unit) return fail("Unit is missing.");
  const accepted = METRICS[metric].acceptedUnits as Record<string, number>;
  const factor = accepted[unit] ?? accepted[unit.toLowerCase()];
  if (factor === undefined) {
    return fail(`Unit "${unit}" is not valid for ${metric}. Accepted: ${Object.keys(accepted).join(", ")}.`);
  }
  return ok(value * factor);
}

export function normalizeProvenance(raw: string, fallback: Provenance): Result<Provenance> {
  const s = raw.trim().toLowerCase();
  if (!s) return ok(fallback);
  // "sample" / "demo" / "test" are the documented words for example data (stored as "simulated").
  if (s === "sample" || s === "demo" || s === "test") return ok("simulated");
  return (PROVENANCES as readonly string[]).includes(s)
    ? ok(s as Provenance)
    : fail(`Unknown provenance "${raw.trim()}". Use observed, derived, estimated or sample.`);
}

export function cleanText(raw: string | undefined, max = 200): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
}

export function isValidCode(code: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:\-/]{0,63}$/.test(code);
}
