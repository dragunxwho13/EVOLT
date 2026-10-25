/**
 * Loads the supplied charging-session dataset (public/samples/ev-charging-grid-sessions.csv)
 * through the same import pipeline the Data import page uses: validation, duplicate checks,
 * charger creation, health analysis and model training.
 *
 *   npm run db:seed:dataset
 *
 * Safe to re-run: it does nothing when sessions already exist, except retrain models whose
 * stored reports predate the current report format. Records are stored with provenance
 * "simulated" (shown as "Demo / sample data"), because the file's origin is unverified and it
 * contains physically inconsistent rows.
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const FILE = "public/samples/ev-charging-grid-sessions.csv";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const { commitImport, dataInventory } = await import("../../src/features/data-ingestion/service");
  const { latestReports, trainModels } = await import("../../src/features/learning/service");

  const inventory = await dataInventory();
  if (inventory.sessions > 0) {
    const reports = await latestReports();
    if (reports.length === 0 || reports.some((r) => !r.question)) {
      const t = await trainModels();
      console.info(`Models retrained on ${t.rows} stored sessions (${t.targets.length} reports).`);
    } else {
      console.info(`Session data already present (${inventory.sessions} sessions); nothing to load.`);
    }
    process.exit(0);
  }

  const bytes = new Uint8Array(readFileSync(FILE));
  const result = await commitImport({
    fileName: "ev-charging-grid-sessions.csv",
    mimeType: "text/csv",
    bytes,
    kind: "auto",
    defaultProvenance: "simulated",
    assumeOffsetMinutes: 0,
  });
  console.info(
    `Dataset loaded: ${result.counts.accepted} sessions, ${result.stationsTouched} stations, ${result.chargersTouched} chargers; ` +
      `${result.analysis.chargersEvaluated} chargers analysed; ${result.training?.targets.length ?? 0} model reports.`,
  );
  process.exit(0);
}

main().catch((err) => {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
  const message = cause?.message ?? (err instanceof Error ? err.message : String(err));
  if (/already been imported/i.test(message)) {
    console.info("The dataset file was imported before; nothing to load.");
    process.exit(0);
  }
  console.error("Dataset load failed:", message.length > 600 ? `${message.slice(0, 600)}…` : message);
  process.exit(1);
});
