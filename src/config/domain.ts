/**
 * Domain vocabulary shared by the database schema, validation, analytics and UI.
 * Keep this file dependency-free so it can be imported anywhere (server or client).
 */

export const CONNECTOR_TYPES = ["CCS2", "CCS1", "CHAdeMO", "Type2", "GBT", "NACS", "Unknown"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];
/** Connector types a vehicle can actually require ("Unknown" is only a data state). */
export const KNOWN_CONNECTOR_TYPES = ["CCS2", "CCS1", "CHAdeMO", "Type2", "GBT", "NACS"] as const satisfies readonly ConnectorType[];

export const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  CCS2: "CCS2 (Combo 2)",
  CCS1: "CCS1 (Combo 1)",
  CHAdeMO: "CHAdeMO",
  Type2: "Type 2 (AC)",
  GBT: "GB/T",
  NACS: "NACS (J3400)",
  Unknown: "Not recorded",
};

export const OPERATIONAL_STATUSES = ["available", "in_use", "offline", "unknown"] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

export const OPERATIONAL_LABELS: Record<OperationalStatus, string> = {
  available: "Available",
  in_use: "In use",
  offline: "Offline",
  unknown: "Unknown",
};

/** Evidence-based health categories. These are NOT safety certifications. */
export const HEALTH_STATUSES = ["normal", "monitor", "inspection_recommended", "insufficient_data"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  normal: "Normal in available data",
  monitor: "Monitor",
  inspection_recommended: "Inspection recommended",
  insufficient_data: "Insufficient data",
};

export const HEALTH_SHORT_LABELS: Record<HealthStatus, string> = {
  normal: "Normal",
  monitor: "Monitor",
  inspection_recommended: "Inspect",
  insufficient_data: "Insufficient",
};

/** Health in words a driver can act on (the same evidence categories, phrased for choosing a charger). */
export const DRIVER_HEALTH_LABELS: Record<HealthStatus, string> = {
  normal: "No reported issues",
  insufficient_data: "Not yet assessed",
  monitor: "Under observation",
  inspection_recommended: "Inspection advised",
};

/** Availability for drivers: "unknown" is said plainly, never shown as available. */
export const DRIVER_AVAILABILITY_LABELS: Record<OperationalStatus, string> = {
  available: "Available",
  in_use: "In use",
  offline: "Offline",
  unknown: "Availability unknown",
};

/** How a value came to exist. Displayed next to every observation. */
export const PROVENANCES = ["observed", "derived", "estimated", "simulated"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/**
 * Display labels. The stored value "simulated" is shown as "Demo / sample data": records with
 * it are generated or unverified example data and must never be presented as field telemetry.
 */
export const PROVENANCE_LABELS: Record<Provenance, string> = {
  observed: "Measured",
  derived: "Derived",
  estimated: "Estimated",
  simulated: "Demo / sample data",
};

export const PROVENANCE_DESCRIPTIONS: Record<Provenance, string> = {
  observed: "Directly measured or logged by equipment",
  derived: "Calculated from other measured values",
  estimated: "Approximated or inferred, not measured",
  simulated: "Example or unverified data — not field measurements",
};

export const ALERT_STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_SEVERITIES = ["monitor", "inspection_recommended"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_RULES = [
  "persistent_deviation",
  "sustained_trend",
  "fault_recurrence",
] as const;
export type AlertRule = (typeof ALERT_RULES)[number];

export const ALERT_RULE_LABELS: Record<AlertRule, string> = {
  persistent_deviation: "Persistent deviation from baseline",
  sustained_trend: "Sustained adverse trend",
  fault_recurrence: "Recurring fault evidence",
};

export const DATASET_KINDS = ["registry", "observations", "sessions"] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

/**
 * Catalogue of health metrics EVOLT knows how to analyse.
 * - `direction`: which way is adverse. All current metrics: higher is worse.
 * - `plausible`: values outside this closed range are rejected as implausible.
 * - `minScale`: floor for the robust spread estimate, in canonical units, so that a
 *   perfectly flat baseline does not make every tiny wobble look extreme.
 * - `supporting`: supporting-only metrics are displayed but never drive alerts alone.
 */
export const METRICS = {
  contact_resistance: {
    label: "Contact resistance",
    unit: "mΩ",
    acceptedUnits: { "mohm": 1, "mΩ": 1, "milliohm": 1, "ohm": 1000, "Ω": 1000, "uohm": 0.001, "µΩ": 0.001 },
    plausible: [0, 100],
    minScale: 0.005,
    direction: "higher_is_worse",
    supporting: false,
    description:
      "Resistance across the mated connector contact path, typically from a periodic four-wire (Kelvin) inspection measurement.",
  },
  voltage_drop: {
    label: "Connector voltage drop",
    unit: "mV",
    acceptedUnits: { "mV": 1, "mv": 1, "V": 1000, "v": 1000 },
    plausible: [0, 10000],
    minScale: 0.5,
    direction: "higher_is_worse",
    supporting: false,
    description:
      "Voltage drop across the connector at a recorded current, typically normalised by the operator to a reference current.",
  },
  fault_count: {
    label: "Connector-related faults",
    unit: "count",
    acceptedUnits: { "count": 1, "faults": 1, "n": 1 },
    plausible: [0, 10000],
    minScale: 0.5,
    direction: "higher_is_worse",
    supporting: false,
    description:
      "Number of connector-related fault codes (e.g. communication loss, interlock, isolation) logged in the reporting period that ends at the timestamp.",
  },
  power_loss: {
    label: "Charging-path power loss",
    unit: "kW",
    acceptedUnits: { "kW": 1, "kw": 1, "W": 0.001, "w": 0.001 },
    plausible: [0, 500],
    minScale: 0.05,
    direction: "higher_is_worse",
    supporting: false,
    description:
      "Power lost between supply and vehicle during a session. A sustained rise at one charger is consistent with extra resistance in the charging path, but has other possible causes.",
  },
  voltage_fluctuation: {
    label: "Voltage fluctuation (supporting)",
    unit: "%",
    acceptedUnits: { "%": 1, "pct": 1, "percent": 1 },
    plausible: [0, 100],
    minScale: 0.25,
    direction: "higher_is_worse",
    supporting: true,
    description:
      "Supply-voltage variation during a session. Mostly reflects the grid rather than the connector, so it is supporting evidence only.",
  },
  temperature_rise: {
    label: "Temperature rise (supporting)",
    unit: "°C",
    acceptedUnits: { "C": 1, "°C": 1, "degC": 1, "K": 1 },
    plausible: [-20, 150],
    minScale: 0.5,
    direction: "higher_is_worse",
    supporting: true,
    description:
      "Connector temperature above ambient. Supporting evidence only: it depends heavily on current, ambient conditions and sensor placement.",
  },
} as const satisfies Record<
  string,
  {
    label: string;
    unit: string;
    acceptedUnits: Record<string, number>;
    plausible: readonly [number, number];
    minScale: number;
    direction: "higher_is_worse";
    supporting: boolean;
    description: string;
  }
>;

export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function isMetricKey(value: string): value is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRICS, value);
}
