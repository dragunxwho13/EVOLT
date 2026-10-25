/**
 * Reproducible, database-free training run on a session file.
 *
 *   npm run model:train                         # the bundled dataset
 *   npm run model:train -- path/to/sessions.csv  # any session file
 *
 * Uses exactly the same parsing, validation and training code as the app, and writes the
 * full cross-validated report (including the fitted model parameters) to
 * models/session-models.json. Timestamps without a timezone are read as UTC.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { suggestMapping } from "../src/features/data-ingestion/fields";
import { parseDatasetText } from "../src/features/data-ingestion/parse";
import { planSessions } from "../src/features/data-ingestion/plan";
import { trainSessionTargets } from "../src/features/learning/train";

const file = process.argv[2] ?? "public/samples/ev-charging-grid-sessions.csv";
const out = path.join("models", "session-models.json");
const text = readFileSync(file, "utf8");
const parsed = parseDatasetText(text, file.toLowerCase().endsWith(".json") ? "json" : "csv");
const plan = planSessions(parsed.rows, parsed.headers, suggestMapping("sessions", parsed.headers), new Set(), new Date(), 0);
console.log(`Read ${parsed.rows.length} rows from ${file}: ${plan.counts.accepted} accepted, ${plan.counts.rejected} rejected, ${plan.counts.duplicate} duplicate.`);

// A fixed timestamp keeps the artifact byte-for-byte reproducible.
const outcome = trainSessionTargets(
  plan.sessions.map((s) => ({ values: s.values, labels: s.labels, area: s.area, chargingMode: s.chargingMode })),
  new Date(Date.UTC(2026, 0, 1)),
);
mkdirSync("models", { recursive: true });
writeFileSync(out, `${JSON.stringify({ source: path.basename(file), rows: outcome.rows, skipped: outcome.skipped, reports: outcome.reports }, null, 2)}\n`);

for (const r of outcome.reports) {
  const best = r.evaluations.find((e) => e.model === r.best)!;
  const top = Math.max(...r.evaluations.slice(1).map((e) => e.accuracy));
  console.log(
    `${r.targetLabel}: ${r.learnable ? `LEARNABLE — ${best.name} ${(best.accuracy * 100).toFixed(1)}%` : `not learnable — best ${(top * 100).toFixed(1)}%`} vs baseline ${(r.baselineAccuracy * 100).toFixed(1)}%`,
  );
}
for (const s of outcome.skipped) console.log(`Skipped ${s.target}: ${s.reason}`);
console.log(`Wrote ${out}`);
