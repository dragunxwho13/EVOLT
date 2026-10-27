import "server-only";
import { asc, eq } from "drizzle-orm";
import { BENCH_RUN, DEFAULT_SCENARIO, REFERENCES, SCENARIOS } from "@/config/scaling";
import report from "../../../models/degradation-report.json";
import { fitBenchCalibration, type BenchCalibration } from "@/features/learning/degradation";
import { getDb } from "@/lib/db/client";
import { benchReadings } from "@/lib/db/schema";
import { notFound } from "@/lib/errors";
import { analyzeBench } from "./analysis";
import { benchInsights } from "./insights";
import { BENCH_CONNECTORS, type BenchConnector, type BenchRecord } from "./parse";
import { scalingReport } from "./scaling";

/** The saved calibration model and study, produced by `npm run model:degradation`. */
export const savedCalibration = report.calibration as BenchCalibration;
export const degradationStudy = report.study;
export const degradationSources = report.sources;

export async function loadBenchRecords(runId: string = BENCH_RUN.id): Promise<{ records: BenchRecord[]; sourceSha256: string | null }> {
  const rows = await getDb()
    .select()
    .from(benchReadings)
    .where(eq(benchReadings.runId, runId))
    .orderBy(asc(benchReadings.timeS), asc(benchReadings.connector));
  return {
    records: rows.map((r) => ({
      connector: r.connector as BenchConnector,
      timeS: r.timeS,
      voltageV: r.voltageV,
      currentMa: r.currentMa,
      degradationPct: r.degradationPct,
      sourceRow: r.sourceRow,
    })),
    sourceSha256: rows[0]?.sourceSha256 ?? null,
  };
}

/** Everything the bench page shows, computed from the stored raw readings. */
export async function benchOverview(
  scenarioId: string = DEFAULT_SCENARIO,
  connector: BenchConnector = "C1",
  levelPct: number = BENCH_RUN.defaultScalingLevelPct,
) {
  const { records, sourceSha256 } = await loadBenchRecords();
  if (records.length === 0) throw notFound("Bench run");
  const analysis = analyzeBench(records);
  const scaling = scalingReport(analysis, scenarioId, connector, levelPct);
  // The app re-fits the calibration from the database and checks it matches the saved model.
  const refit = fitBenchCalibration(records);
  const calibrationConsistent =
    Math.abs(refit.intercept - savedCalibration.intercept) < 1e-9 &&
    Math.abs(refit.slope - savedCalibration.slope) < 1e-9 &&
    BENCH_CONNECTORS.every((c) => Math.abs(refit.references[c] - savedCalibration.references[c]) < 1e-9);
  return {
    run: { id: BENCH_RUN.id, description: BENCH_RUN.description, file: BENCH_RUN.file, rawFile: BENCH_RUN.rawFile, sourceSha256, savedFrom: degradationSources.bench.sha256 },
    analysis,
    scaling,
    insights: benchInsights(analysis, scaling),
    scenarios: SCENARIOS,
    references: REFERENCES,
    calibration: savedCalibration,
    calibrationConsistent,
  };
}

export type BenchOverview = Awaited<ReturnType<typeof benchOverview>>;
