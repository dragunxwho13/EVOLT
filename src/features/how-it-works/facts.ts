import "server-only";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { BOOKING } from "@/config/booking";
import { ASSUMPTIONS, BENCH_RUN, REFERENCE_VALUES, SCENARIOS } from "@/config/scaling";
import type { BenchAnalysis } from "@/features/bench/analysis";
import { scalingReport } from "@/features/bench/scaling";
import report from "../../../models/degradation-report.json";

/**
 * Every number on the "How it works" page, derived from the repository itself: the committed
 * saved model report (built from the bench log) and the configuration. Read once at build time, so the page
 * can never disagree with the code that serves the app.
 */
export function howItWorksFacts() {
  // The per-connector summary is saved by `npm run model:degradation` from the bench log; a unit
  // test checks the saved report equals a fresh run, so it cannot drift from the data.
  const summary = report.benchSummary;
  const analysis = { ...summary, readings: [] } as unknown as BenchAnalysis;
  const ac7 = scalingReport(analysis, "ac-7", "C1", 50);
  const dc50 = analysis.connectors.map((c) => ({ connector: c.connector, report: scalingReport(analysis, "dc-50", c.connector, 50) }));
  const cal = report.calibration;
  const study = report.study;
  const featureSets = study.featureSets.map((f) => ({
    label: f.featureSet.label,
    results: f.results.map((r) => ({ split: r.split, baseline: r.baseline.mae, ridgeMae: r.ridge.mae, r2: r.ridge.r2 })),
  }));
  return {
    bench: {
      run: BENCH_RUN,
      rows: summary.timeSteps,
      readings: summary.readings,
      analysis,
      ac7,
      dc50,
    },
    model: {
      intercept: cal.intercept,
      slope: cal.slope,
      references: cal.references,
      fittedOn: cal.fittedOn,
      lso: cal.evaluation.leaveOneSweepOut,
      loco: cal.evaluation.leaveOneConnectorOut,
      maxDeviation: cal.maxDeviationFromDefinition,
    },
    study: { rows: report.sources.unified.rows, featureSets, deployable: study.deployable },
    params: ANALYSIS_PARAMS,
    booking: BOOKING,
    scenarios: SCENARIOS,
    assumptions: ASSUMPTIONS,
    referenceValues: REFERENCE_VALUES,
  };
}

export type HowItWorksFacts = ReturnType<typeof howItWorksFacts>;
