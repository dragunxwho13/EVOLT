ALTER TYPE "public"."connector_type" ADD VALUE 'Unknown';--> statement-breakpoint
ALTER TYPE "public"."dataset_kind" ADD VALUE 'sessions';--> statement-breakpoint
ALTER TYPE "public"."health_metric" ADD VALUE 'power_loss' BEFORE 'temperature_rise';--> statement-breakpoint
ALTER TYPE "public"."health_metric" ADD VALUE 'voltage_fluctuation' BEFORE 'temperature_rise';--> statement-breakpoint
CREATE TABLE "charging_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"charger_id" uuid NOT NULL,
	"import_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"area" text,
	"charging_mode" text,
	"values" jsonb NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" "provenance" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"rows" integer NOT NULL,
	"learnable" boolean NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chargers" ADD COLUMN "charging_mode" text;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_charger_id_chargers_id_fk" FOREIGN KEY ("charger_id") REFERENCES "public"."chargers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_import_id_dataset_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."dataset_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charging_sessions_charger_time_uq" ON "charging_sessions" USING btree ("charger_id","started_at");--> statement-breakpoint
CREATE INDEX "charging_sessions_import_idx" ON "charging_sessions" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "model_runs_target_created_idx" ON "model_runs" USING btree ("target","created_at");