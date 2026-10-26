/**
 * Reproducible degradation study and bench calibration (no database needed).
 *
 *   npm run model:degradation
 *
 * Reads the unified training dataset and the Arduino bench log, runs the leakage-aware study
 * and fits the bench calibration with exactly the code the app uses, and writes
 * models/degradation-report.json (study + saved calibration model). Deterministic: running it
 * twice gives the same file.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BENCH_RUN, SCALING_VERSION } from "../src/config/scaling";
import { parseBenchCsv } from "../src/features/bench/parse";
import { parseDatasetText } from "../src/features/data-ingestion/parse";
import { fitBenchCalibration, studyUnifiedDataset } from "../src/features/learning/degradation";

export const UNIFIED_FILE = "database/data/unified-evolt-arduino-training-dataset.csv";
const OUT = "models/degradation-report.json";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export function buildReport() {
  const unifiedText = readFileSync(UNIFIED_FILE, "utf8");
  const benchText = readFileSync(BENCH_RUN.file, "utf8");
  const unified = parseDatasetText(unifiedText, "csv");
  const study = studyUnifiedDataset(unified.rows, unified.headers);
  const calibration = fitBenchCalibration(parseBenchCsv(benchText).records);
  return {
    version: SCALING_VERSION,
    sources: {
      unified: { file: UNIFIED_FILE, sha256: sha(unifiedText), rows: unified.rows.length },
      bench: { file: BENCH_RUN.file, sha256: sha(benchText) },
    },
    study,
    calibration,
  };
}

if (process.argv[1]?.endsWith("train-degradation.ts")) {
  const report = buildReport();
  mkdirSync("models", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  for (const fs of report.study.featureSets) {
    for (const r of fs.results) {
      console.log(
        `${fs.featureSet.id.padEnd(20)} ${r.split.padEnd(20)} baseline MAE ${r.baseline.mae.toFixed(2)} RMSE ${r.baseline.rmse.toFixed(2)} | ridge MAE ${r.ridge.mae.toFixed(2)} RMSE ${r.ridge.rmse.toFixed(2)} R² ${r.ridge.r2.toFixed(3)}`,
      );
    }
  }
  for (const c of report.study.audit.checks) console.log(`audit ${c.id}: ${c.holds ? "HOLDS" : "differs"} (max |Δ| ${c.maxAbsDifference.toExponential(2)})`);
  console.log(report.calibration.verdict);
  console.log(`Wrote ${OUT}`);
}
