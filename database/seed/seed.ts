/**
 * Idempotent seed of clearly labelled SYNTHETIC demonstration data.
 *
 *   npm run db:seed            # insert/refresh synthetic records, keep everything else
 *   npm run db:seed -- --reset # delete synthetic records first, then reseed
 *
 * Re-running is safe: stations/chargers are upserted by code and observations are
 * only generated for synthetic chargers that have none yet. Non-synthetic (imported)
 * data is never modified.
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../../src/lib/db/client";
import { chargers, healthObservations, stations, vehicleProfiles } from "../../src/lib/db/schema";
import {
  SYNTHETIC_SOURCE,
  SYNTHETIC_VEHICLE_PROFILES,
  syntheticChargers,
  syntheticObservations,
  syntheticStations,
} from "./synthetic";

loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  const reset = process.argv.includes("--reset");
  const { db, pool } = createDatabase(url, 2);
  const now = new Date();

  try {
    if (reset) {
      const deleted = await db.delete(stations).where(eq(stations.isSynthetic, true)).returning({ id: stations.id });
      await db.delete(vehicleProfiles).where(eq(vehicleProfiles.isSynthetic, true));
      console.info(`Removed ${deleted.length} demo station(s) and their chargers, observations and alerts.`);
    }

    const stationIds = new Map<string, string>();
    for (const s of syntheticStations()) {
      const [row] = await db
        .insert(stations)
        .values({ ...s, isSynthetic: true, source: SYNTHETIC_SOURCE })
        .onConflictDoUpdate({
          target: stations.code,
          set: { name: s.name, address: s.address, latitude: s.latitude, longitude: s.longitude, updatedAt: now },
          setWhere: eq(stations.isSynthetic, true),
        })
        .returning({ id: stations.id });
      if (!row) throw new Error(`Station code ${s.code} already exists as a non-synthetic record; refusing to overwrite it.`);
      stationIds.set(s.code, row.id);
    }

    const list = syntheticChargers();
    const chargerIds = new Map<string, string>();
    for (const c of list) {
      const [row] = await db
        .insert(chargers)
        .values({
          code: c.code,
          stationId: stationIds.get(c.stationCode)!,
          connectorType: c.connectorType,
          ratedPowerKw: c.ratedPowerKw,
          operationalStatus: c.operationalStatus,
          operationalStatusAt: now,
          isSynthetic: true,
        })
        .onConflictDoUpdate({
          target: chargers.code,
          set: { connectorType: c.connectorType, ratedPowerKw: c.ratedPowerKw, updatedAt: now },
          setWhere: eq(chargers.isSynthetic, true),
        })
        .returning({ id: chargers.id });
      if (!row) throw new Error(`Charger code ${c.code} already exists as a non-synthetic record; refusing to overwrite it.`);
      chargerIds.set(c.code, row.id);
    }

    const withData = await db
      .selectDistinct({ chargerId: healthObservations.chargerId })
      .from(healthObservations)
      .where(inArray(healthObservations.chargerId, [...chargerIds.values()]));
    const hasData = new Set(withData.map((r) => r.chargerId));

    let inserted = 0;
    for (const [i, c] of list.entries()) {
      const id = chargerIds.get(c.code)!;
      if (hasData.has(id)) continue;
      const obs = syntheticObservations(c, i, now);
      if (obs.length === 0) continue;
      await db.insert(healthObservations).values(
        obs.map((o) => ({
          chargerId: id,
          metric: o.metric,
          observedAt: o.observedAt,
          value: o.value,
          sourceUnit: o.sourceUnit,
          provenance: "simulated" as const,
          source: SYNTHETIC_SOURCE,
        })),
      );
      inserted += obs.length;
    }

    for (const v of SYNTHETIC_VEHICLE_PROFILES) {
      await db
        .insert(vehicleProfiles)
        .values({ ...v, isSynthetic: true })
        .onConflictDoUpdate({ target: vehicleProfiles.code, set: { name: v.name, connectorTypes: v.connectorTypes, maxDcPowerKw: v.maxDcPowerKw } });
    }

    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(chargers)
      .where(and(eq(chargers.isSynthetic, true)))) as [{ n: number }];
    console.info(`Demo data ready: ${stationIds.size} stations, ${n} chargers, ${inserted} new observations.`);
  } finally {
    await pool.end();
  }

  // Run the same analysis the app uses so health status and alerts are populated.
  const { recomputeHealth } = await import("../../src/features/connector-health/service");
  const result = await recomputeHealth(undefined, now);
  console.info(
    `Analysis complete: ${result.chargersEvaluated} chargers evaluated, ${result.alertsCreated} alert(s) created, ${result.alertsUpdated} updated.`,
  );
  process.exit(0);
}

main().catch((err) => {
  // Drizzle wraps database errors; the underlying cause holds the useful message.
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
  const message = cause?.message ?? (err instanceof Error ? err.message : String(err));
  console.error("Seed failed:", message.length > 600 ? `${message.slice(0, 600)}…` : message);
  process.exit(1);
});
