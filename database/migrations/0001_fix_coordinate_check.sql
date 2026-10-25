ALTER TABLE "stations" DROP CONSTRAINT "stations_coordinates_valid";--> statement-breakpoint
-- The original constraint let a single coordinate through (NULL comparisons pass a CHECK).
-- Half-specified locations are unusable, so clear them rather than keep a misleading point.
UPDATE "stations" SET "latitude" = NULL, "longitude" = NULL WHERE ("latitude" IS NULL) <> ("longitude" IS NULL);--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_coordinates_valid" CHECK (("stations"."latitude" IS NULL AND "stations"."longitude" IS NULL) OR ("stations"."latitude" IS NOT NULL AND "stations"."longitude" IS NOT NULL AND "stations"."latitude" BETWEEN -90 AND 90 AND "stations"."longitude" BETWEEN -180 AND 180));