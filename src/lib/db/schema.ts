import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import {
  ALERT_RULES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  CONNECTOR_TYPES,
  DATASET_KINDS,
  HEALTH_STATUSES,
  METRIC_KEYS,
  OPERATIONAL_STATUSES,
  PROVENANCES,
  type MetricKey,
} from "@/config/domain";
import type { TargetReport } from "@/features/learning/types";
import type { AlertEvidence, ChargerHealthSummary, ImportRowIssue } from "@/types/analysis";

export const connectorTypeEnum = pgEnum("connector_type", CONNECTOR_TYPES);
export const operationalStatusEnum = pgEnum("operational_status", OPERATIONAL_STATUSES);
export const healthStatusEnum = pgEnum("health_status", HEALTH_STATUSES);
export const provenanceEnum = pgEnum("provenance", PROVENANCES);
export const alertStatusEnum = pgEnum("alert_status", ALERT_STATUSES);
export const alertSeverityEnum = pgEnum("alert_severity", ALERT_SEVERITIES);
export const alertRuleEnum = pgEnum("alert_rule", ALERT_RULES);
export const datasetKindEnum = pgEnum("dataset_kind", DATASET_KINDS);
export const metricEnum = pgEnum("health_metric", METRIC_KEYS as [MetricKey, ...MetricKey[]]);
export const importStatusEnum = pgEnum("import_status", ["completed", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const datasetImports = pgTable(
  "dataset_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: datasetKindEnum("kind").notNull(),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    status: importStatusEnum("status").notNull(),
    totalRows: integer("total_rows").notNull().default(0),
    acceptedRows: integer("accepted_rows").notNull().default(0),
    rejectedRows: integer("rejected_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    /** Row-level problems, capped to keep the row small. */
    issues: jsonb("issues").$type<ImportRowIssue[]>().notNull().default([]),
    affectedChargers: integer("affected_chargers").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The same file content can only be successfully imported once.
    uniqueIndex("dataset_imports_completed_hash_uq").on(t.fileHash).where(sql`${t.status} = 'completed'`),
    index("dataset_imports_created_idx").on(t.createdAt),
  ],
);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable external identifier used by imports. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    operator: text("operator"),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    source: text("source"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stations_code_uq").on(t.code),
    index("stations_name_idx").on(t.name),
    check(
      "stations_coordinates_valid",
      // Written without NULL-propagating comparisons: a CHECK that evaluates to NULL passes.
      sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180)`,
    ),
  ],
);

export const chargers = pgTable(
  "chargers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    connectorType: connectorTypeEnum("connector_type").notNull(),
    ratedPowerKw: doublePrecision("rated_power_kw"),
    /** Charging mode reported by session datasets (e.g. Fast, Conventional, V2G). */
    chargingMode: text("charging_mode"),
    operationalStatus: operationalStatusEnum("operational_status").notNull().default("unknown"),
    operationalStatusAt: timestamp("operational_status_at", { withTimezone: true }),
    healthStatus: healthStatusEnum("health_status").notNull().default("insufficient_data"),
    healthEvaluatedAt: timestamp("health_evaluated_at", { withTimezone: true }),
    healthSummary: jsonb("health_summary").$type<ChargerHealthSummary>(),
    lastObservationAt: timestamp("last_observation_at", { withTimezone: true }),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("chargers_code_uq").on(t.code),
    index("chargers_station_idx").on(t.stationId),
    index("chargers_health_idx").on(t.healthStatus),
    check("chargers_power_positive", sql`${t.ratedPowerKw} IS NULL OR ${t.ratedPowerKw} > 0`),
  ],
);

export const healthObservations = pgTable(
  "health_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargerId: uuid("charger_id")
      .notNull()
      .references(() => chargers.id, { onDelete: "cascade" }),
    metric: metricEnum("metric").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    /** Always stored in the metric's canonical unit (see config/domain.ts). */
    value: doublePrecision("value").notNull(),
    /** Unit as supplied by the source, kept for traceability. */
    sourceUnit: text("source_unit").notNull(),
    provenance: provenanceEnum("provenance").notNull(),
    source: text("source"),
    importId: uuid("import_id").references(() => datasetImports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_obs_charger_metric_time_uq").on(t.chargerId, t.metric, t.observedAt),
    index("health_obs_charger_time_idx").on(t.chargerId, t.observedAt),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargerId: uuid("charger_id")
      .notNull()
      .references(() => chargers.id, { onDelete: "cascade" }),
    metric: metricEnum("metric").notNull(),
    rule: alertRuleEnum("rule").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    status: alertStatusEnum("status").notNull().default("open"),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    evidence: jsonb("evidence").$type<AlertEvidence>().notNull(),
    explanation: text("explanation").notNull(),
    confidenceNote: text("confidence_note").notNull(),
    suggestedAction: text("suggested_action").notNull(),
    /** False once the latest analysis no longer finds the triggering condition. */
    conditionActive: boolean("condition_active").notNull().default(true),
    occurrences: integer("occurrences").notNull().default(1),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    analysisVersion: text("analysis_version").notNull(),
    ...timestamps,
  },
  (t) => [
    // At most one unresolved alert per charger/metric/rule — this is the de-duplication key.
    uniqueIndex("alerts_active_dedupe_uq")
      .on(t.chargerId, t.metric, t.rule)
      .where(sql`${t.status} IN ('open', 'acknowledged')`),
    index("alerts_status_idx").on(t.status),
    index("alerts_charger_idx").on(t.chargerId),
  ],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    fromStatus: alertStatusEnum("from_status"),
    toStatus: alertStatusEnum("to_status").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alert_events_alert_idx").on(t.alertId)],
);

export const vehicleProfiles = pgTable(
  "vehicle_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    connectorTypes: connectorTypeEnum("connector_types").array().notNull(),
    maxDcPowerKw: doublePrecision("max_dc_power_kw"),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vehicle_profiles_code_uq").on(t.code)],
);

/**
 * Optional bench-sensor readings (e.g. an Arduino demo rig). Kept separate from
 * health observations: they are supporting context and never drive health status.
 */
export const sensorReadings = pgTable(
  "sensor_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    chargerId: uuid("charger_id").references(() => chargers.id, { onDelete: "set null" }),
    sensor: text("sensor").notNull(),
    value: doublePrecision("value").notNull(),
    unit: text("unit").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sensor_readings_device_sensor_time_uq").on(t.deviceId, t.sensor, t.recordedAt),
    index("sensor_readings_charger_idx").on(t.chargerId),
  ],
);

/**
 * Charging sessions from session/telemetry datasets, kept whole so that models can be
 * trained on exactly what was imported. `values` holds every numeric column of the row.
 */
export const chargingSessions = pgTable(
  "charging_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargerId: uuid("charger_id")
      .notNull()
      .references(() => chargers.id, { onDelete: "cascade" }),
    importId: uuid("import_id").references(() => datasetImports.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    area: text("area"),
    chargingMode: text("charging_mode"),
    values: jsonb("values").$type<Record<string, number>>().notNull(),
    /** Labels supplied by the dataset, if any — training targets, never invented. */
    labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
    provenance: provenanceEnum("provenance").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("charging_sessions_charger_time_uq").on(t.chargerId, t.startedAt),
    index("charging_sessions_import_idx").on(t.importId),
  ],
);

/** Results of training and cross-validating models on the stored sessions. */
export const modelRuns = pgTable(
  "model_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    target: text("target").notNull(),
    rows: integer("rows").notNull(),
    learnable: boolean("learnable").notNull(),
    result: jsonb("result").$type<TargetReport>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("model_runs_target_created_idx").on(t.target, t.createdAt)],
);

export const INSIGHT_REVIEW_STATUSES = ["reviewed", "resolved", "dismissed"] as const;
export type InsightReviewStatus = (typeof INSIGHT_REVIEW_STATUSES)[number];

/**
 * Workflow status a person set on a company action item. It records a decision, not the
 * physical state of a charger: "resolved" never means the charger was verified as repaired.
 * `evidenceDigest` lets the UI say when the evidence changed after the review.
 */
export const insightReviews = pgTable("insight_reviews", {
  key: text("key").primaryKey(),
  status: text("status").$type<InsightReviewStatus>().notNull(),
  note: text("note"),
  evidenceDigest: text("evidence_digest").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stationsRelations = relations(stations, ({ many }) => ({ chargers: many(chargers) }));
export const chargersRelations = relations(chargers, ({ one, many }) => ({
  station: one(stations, { fields: [chargers.stationId], references: [stations.id] }),
  observations: many(healthObservations),
  alerts: many(alerts),
}));
export const observationsRelations = relations(healthObservations, ({ one }) => ({
  charger: one(chargers, { fields: [healthObservations.chargerId], references: [chargers.id] }),
}));
export const alertsRelations = relations(alerts, ({ one, many }) => ({
  charger: one(chargers, { fields: [alerts.chargerId], references: [chargers.id] }),
  events: many(alertEvents),
}));
export const alertEventsRelations = relations(alertEvents, ({ one }) => ({
  alert: one(alerts, { fields: [alertEvents.alertId], references: [alerts.id] }),
}));

export type Station = typeof stations.$inferSelect;
export type Charger = typeof chargers.$inferSelect;
export type HealthObservation = typeof healthObservations.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;
export type DatasetImport = typeof datasetImports.$inferSelect;
export type VehicleProfile = typeof vehicleProfiles.$inferSelect;
export type SensorReading = typeof sensorReadings.$inferSelect;
export type ChargingSession = typeof chargingSessions.$inferSelect;
export type ModelRun = typeof modelRuns.$inferSelect;
