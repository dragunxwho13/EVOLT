-- 1) Neutral, honest naming for the bundled demo records. They stay flagged
--    is_synthetic = true; only the visible wording changes ("Demo Site", "DEMO-").
UPDATE stations
SET code = regexp_replace(code, '^SYN-', 'DEMO-'),
    name = replace(name, 'Synthetic Site', 'Demo Site'),
    address = replace(replace(address, 'Synthetic demonstration location', 'Demo location'), 'Synthetic demonstration record', 'Demo record'),
    operator = replace(operator, 'Demo operator (synthetic)', 'Demo operator'),
    source = replace(source, 'EVOLT synthetic generator v1', 'EVOLT demo generator v1'),
    updated_at = now()
WHERE is_synthetic;
--> statement-breakpoint
UPDATE chargers SET code = regexp_replace(code, '^SYN-', 'DEMO-'), updated_at = now() WHERE is_synthetic AND code LIKE 'SYN-%';
--> statement-breakpoint
UPDATE health_observations SET source = 'EVOLT demo generator v1' WHERE source = 'EVOLT synthetic generator v1';
--> statement-breakpoint
-- 2) Workflow status for company action items derived from imported data.
--    Workflow status is what a person decided; it never claims a charger was repaired.
CREATE TABLE "insight_reviews" (
  "key" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "note" text,
  "evidence_digest" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "insight_reviews_status_check" CHECK ("status" IN ('reviewed', 'resolved', 'dismissed')),
  CONSTRAINT "insight_reviews_note_length" CHECK ("note" IS NULL OR char_length("note") <= 500)
);
