-- Driver slot and queue bookings. A booking reserves [start_at, end_at) on one charger plus
-- buffer_minutes after it; the service refuses overlaps inside a per-charger advisory lock.
-- There are no driver accounts: a booking is found and cancelled with its booking code, of
-- which only a SHA-256 hash is stored. Several vehicles booked together share one code.
CREATE TABLE "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "charger_id" uuid NOT NULL REFERENCES "chargers"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "group_size" integer DEFAULT 1 NOT NULL,
  "kind" text DEFAULT 'slot' NOT NULL,
  "driver_name" text NOT NULL,
  "vehicle_label" text,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "buffer_minutes" integer NOT NULL,
  "status" text DEFAULT 'booked' NOT NULL,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bookings_window_check" CHECK ("end_at" > "start_at" AND "end_at" <= "start_at" + interval '8 hours'),
  CONSTRAINT "bookings_buffer_check" CHECK ("buffer_minutes" >= 0 AND "buffer_minutes" <= 60),
  CONSTRAINT "bookings_status_check" CHECK ("status" IN ('booked', 'cancelled')),
  CONSTRAINT "bookings_kind_check" CHECK ("kind" IN ('slot', 'queue', 'fleet')),
  CONSTRAINT "bookings_group_size_check" CHECK ("group_size" >= 1 AND "group_size" <= 20),
  CONSTRAINT "bookings_name_length" CHECK (char_length("driver_name") BETWEEN 1 AND 60),
  CONSTRAINT "bookings_vehicle_length" CHECK ("vehicle_label" IS NULL OR char_length("vehicle_label") <= 40),
  CONSTRAINT "bookings_cancel_check" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "bookings_charger_time_idx" ON "bookings" ("charger_id", "start_at") WHERE "status" = 'booked';
--> statement-breakpoint
CREATE INDEX "bookings_code_idx" ON "bookings" ("code_hash");
