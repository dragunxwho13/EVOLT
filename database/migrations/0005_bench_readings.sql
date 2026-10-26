-- Raw readings from the Arduino experimental circuit (three connectors), stored as logged.
CREATE TABLE "bench_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" text NOT NULL,
  "connector" text NOT NULL,
  "time_s" double precision NOT NULL,
  "voltage_v" double precision NOT NULL,
  "current_ma" double precision NOT NULL,
  "degradation_pct" double precision,
  "source_row" integer NOT NULL,
  "source_file" text NOT NULL,
  "source_sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bench_connector_check" CHECK ("connector" IN ('C1', 'C2', 'C3'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bench_run_connector_time_uq" ON "bench_readings" ("run_id", "connector", "time_s");
