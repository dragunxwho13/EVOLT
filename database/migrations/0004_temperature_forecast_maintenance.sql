-- 1) Contact temperature recorded with a reading, used to restate resistance at 20 °C.
ALTER TABLE "health_observations" ADD COLUMN "temperature_c" double precision;
--> statement-breakpoint
ALTER TABLE "health_observations" ADD CONSTRAINT "health_obs_temperature_range" CHECK ("temperature_c" IS NULL OR ("temperature_c" >= -40 AND "temperature_c" <= 150));
--> statement-breakpoint
-- 2) Operator-set contact-resistance service limit (the forecast target).
ALTER TABLE "chargers" ADD COLUMN "contact_resistance_limit_mohm" double precision;
--> statement-breakpoint
ALTER TABLE "chargers" ADD CONSTRAINT "chargers_cr_limit_range" CHECK ("contact_resistance_limit_mohm" IS NULL OR ("contact_resistance_limit_mohm" > 0 AND "contact_resistance_limit_mohm" <= 100));
--> statement-breakpoint
-- 3) Maintenance log, so EVOLT can verify whether work had a measurable, lasting effect.
CREATE TABLE "maintenance_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "charger_id" uuid NOT NULL REFERENCES "chargers"("id") ON DELETE CASCADE,
  "performed_at" timestamp with time zone NOT NULL,
  "action" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "maintenance_action_check" CHECK ("action" IN ('cleaned', 'contacts_replaced', 'connector_replaced', 'adjusted', 'other')),
  CONSTRAINT "maintenance_note_length" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
--> statement-breakpoint
CREATE INDEX "maintenance_charger_time_idx" ON "maintenance_events" ("charger_id", "performed_at");
