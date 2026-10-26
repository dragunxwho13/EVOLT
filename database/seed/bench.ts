/**
 * Loads the Arduino experimental-circuit log (database/data/arduino-bench-readings.csv,
 * converted cell-for-cell from database/data/raw/degradation_data.xlsx) into bench_readings.
 *
 *   npm run db:seed:bench
 *
 * Values are stored exactly as logged. Safe to re-run: a run already stored is left alone,
 * and a changed file is refused rather than silently merged.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/lib/db/client";
import { benchReadings } from "../../src/lib/db/schema";
import { BENCH_RUN } from "../../src/config/scaling";
import { parseBenchCsv } from "../../src/features/bench/parse";

loadEnvConfig(process.cwd());

export async function loadBench(url: string): Promise<string> {
  const text = readFileSync(BENCH_RUN.file, "utf8");
  const sha = createHash("sha256").update(text).digest("hex");
  const parsed = parseBenchCsv(text);
  const { db, pool } = createDatabase(url, 2);
  try {
    const existing = await db.select({ sha: benchReadings.sourceSha256 }).from(benchReadings).where(eq(benchReadings.runId, BENCH_RUN.id)).limit(1);
    if (existing[0]) {
      if (existing[0].sha !== sha) throw new Error(`Bench run ${BENCH_RUN.id} is stored from a different file version; refusing to merge.`);
      return `Bench run ${BENCH_RUN.id} already stored (${parsed.records.length} readings); nothing to load.`;
    }
    await db.insert(benchReadings).values(
      parsed.records.map((r) => ({ ...r, runId: BENCH_RUN.id, sourceFile: BENCH_RUN.file, sourceSha256: sha })),
    );
    return `Bench run ${BENCH_RUN.id} loaded: ${parsed.rows} time steps × 3 connectors = ${parsed.records.length} readings.`;
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("bench.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  loadBench(url)
    .then((m) => {
      console.info(m);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Bench load failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
