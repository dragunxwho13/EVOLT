import { ANALYSIS_PARAMS, ANALYSIS_VERSION } from "@/config/analysis";
import { runEvaluation, SCENARIOS } from "@/features/anomaly-detection/evaluation";
import { dynamicGet, json } from "@/lib/http/route";

/** Synthetic-scenario comparison of the trend-aware detector and a single-point baseline. */
export const GET = dynamicGet(async () =>
  json({
    analysisVersion: ANALYSIS_VERSION,
    params: ANALYSIS_PARAMS,
    scenarios: SCENARIOS,
    report: runEvaluation(),
    disclaimer:
      "Results are computed on synthetic series with known ground truth. They describe detector behaviour on these scenarios only and are not a measure of real-world accuracy.",
  }),
);
