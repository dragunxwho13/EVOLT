CREATE TYPE "public"."alert_rule" AS ENUM('persistent_deviation', 'sustained_trend', 'fault_recurrence');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('monitor', 'inspection_recommended');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."connector_type" AS ENUM('CCS2', 'CCS1', 'CHAdeMO', 'Type2', 'GBT', 'NACS');--> statement-breakpoint
CREATE TYPE "public"."dataset_kind" AS ENUM('registry', 'observations');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('normal', 'monitor', 'inspection_recommended', 'insufficient_data');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."health_metric" AS ENUM('contact_resistance', 'voltage_drop', 'fault_count', 'temperature_rise');--> statement-breakpoint
CREATE TYPE "public"."operational_status" AS ENUM('available', 'in_use', 'offline', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('observed', 'derived', 'estimated', 'simulated');--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"from_status" "alert_status",
	"to_status" "alert_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" uuid NOT NULL,
	"metric" "health_metric" NOT NULL,
	"rule" "alert_rule" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"evidence" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"confidence_note" text NOT NULL,
	"suggested_action" text NOT NULL,
	"condition_active" boolean DEFAULT true NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chargers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"code" text NOT NULL,
	"connector_type" "connector_type" NOT NULL,
	"rated_power_kw" double precision,
	"operational_status" "operational_status" DEFAULT 'unknown' NOT NULL,
	"operational_status_at" timestamp with time zone,
	"health_status" "health_status" DEFAULT 'insufficient_data' NOT NULL,
	"health_evaluated_at" timestamp with time zone,
	"health_summary" jsonb,
	"last_observation_at" timestamp with time zone,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chargers_power_positive" CHECK ("chargers"."rated_power_kw" IS NULL OR "chargers"."rated_power_kw" > 0)
);
--> statement-breakpoint
CREATE TABLE "dataset_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "dataset_kind" NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"status" "import_status" NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"accepted_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_chargers" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" uuid NOT NULL,
	"metric" "health_metric" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"source_unit" text NOT NULL,
	"provenance" "provenance" NOT NULL,
	"source" text,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"charger_id" uuid,
	"sensor" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"region" text,
	"country" text,
	"latitude" double precision,
	"longitude" double precision,
	"operator" text,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_coordinates_valid" CHECK (("stations"."latitude" IS NULL AND "stations"."longitude" IS NULL) OR ("stations"."latitude" BETWEEN -90 AND 90 AND "stations"."longitude" BETWEEN -180 AND 180))
);
--> statement-breakpoint
CREATE TABLE "vehicle_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"connector_types" "connector_type"[] NOT NULL,
	"max_dc_power_kw" double precision,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargers" ADD CONSTRAINT "chargers_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_observations" ADD CONSTRAINT "health_observations_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_observations" ADD CONSTRAINT "health_observations_import_id_dataset_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."dataset_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_alert_idx" ON "alert_events" USING btree ("alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_active_dedupe_uq" ON "alerts" USING btree ("charger_id","metric","rule") WHERE "alerts"."status" IN ('open', 'acknowledged');--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alerts_charger_idx" ON "alerts" USING btree ("charger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chargers_code_uq" ON "chargers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "chargers_station_idx" ON "chargers" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "chargers_health_idx" ON "chargers" USING btree ("health_status");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_imports_completed_hash_uq" ON "dataset_imports" USING btree ("file_hash") WHERE "dataset_imports"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "dataset_imports_created_idx" ON "dataset_imports" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "health_obs_charger_metric_time_uq" ON "health_observations" USING btree ("charger_id","metric","observed_at");--> statement-breakpoint
CREATE INDEX "health_obs_charger_time_idx" ON "health_observations" USING btree ("charger_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sensor_readings_device_sensor_time_uq" ON "sensor_readings" USING btree ("device_id","sensor","recorded_at");--> statement-breakpoint
CREATE INDEX "sensor_readings_charger_idx" ON "sensor_readings" USING btree ("charger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_code_uq" ON "stations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "stations_name_idx" ON "stations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_profiles_code_uq" ON "vehicle_profiles" USING btree ("code");