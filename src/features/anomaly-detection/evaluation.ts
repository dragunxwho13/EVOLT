import { ANALYSIS_PARAMS, type AnalysisParams } from "@/config/analysis";
import { METRICS } from "@/config/domain";
import type { ObservationInput } from "@/types/analysis";
import { assessMetric, isDeviation } from "./assess-metric";
import { gaussian, median, robustScale, seededRandom } from "./stats";

/**
 * Transparent comparison of EVOLT's trend-aware detector against a simple
 * single-point threshold detector, on SYNTHETIC scenarios with known ground truth.
 * The numbers describe behaviour on these generated series only — they are not an
 * estimate of real-world accuracy.
 */

export type ScenarioKind = "stable" | "stable_with_spikes" | "noisy_stable" | "gradual_drift" | "step_change";

export const SCENARIOS: Record<ScenarioKind, { label: string; degrading: boolean; description: string }> = {
  stable: { label: "Stable", degrading: false, description: "Constant level with measurement noise (σ ≈ 4% of level)." },
  stable_with_spikes: {
    label: "Stable + isolated spikes",
    degrading: false,
    description: "Stable series with two single-reading spikes of +40% (e.g. a bad contact during measurement).",
  },
  noisy_stable: { label: "Noisy, stable", degrading: false, description: "Constant level with heavier noise (σ ≈ 9% of level)." },
  gradual_drift: {
    label: "Gradual drift",
    degrading: true,
    description: "Stable for 14 readings, then rising by 2.5% of the level per reading.",
  },
  step_change: {
    label: "Step change",
    degrading: true,
    description: "Stable for 18 readings, then a sustained +30% shift.",
  },
};

const SERIES_LENGTH = 30;
const LEVEL = 0.3; // mΩ, synthetic contact-resistance level
const START = Date.UTC(2025, 0, 6);
const WEEK_MS = 7 * 86_400_000;

export interface GeneratedSeries {
  kind: ScenarioKind;
  seed: number;
  onset: number | null;
  points: ObservationInput[];
}

export function generateScenario(kind: ScenarioKind, seed: number): GeneratedSeries {
  const rand = seededRandom(seed * 7919 + kind.length * 104729);
  const sigma = kind === "noisy_stable" ? LEVEL * 0.09 : LEVEL * 0.04;
  const onset = kind === "gradual_drift" ? 14 : kind === "step_change" ? 18 : null;
  const spikeAt = new Set(kind === "stable_with_spikes" ? [12 + Math.floor(rand() * 6), 22 + Math.floor(rand() * 6)] : []);
  const points: ObservationInput[] = [];
  for (let i = 0; i < SERIES_LENGTH; i++) {
    let v = LEVEL + gaussian(rand) * sigma;
    if (kind === "gradual_drift" && i >= 14) v += LEVEL * 0.025 * (i - 13);
    if (kind === "step_change" && i >= 18) v += LEVEL * 0.3;
    if (spikeAt.has(i)) v += LEVEL * 0.4;
    points.push({ observedAt: new Date(START + i * WEEK_MS), value: Math.max(0.001, v) });
  }
  return { kind, seed, onset, points };
}

export type Detector = (points: ObservationInput[], now: Date, params: AnalysisParams) => boolean;

/** Simple baseline method: flag whenever the newest single reading exceeds the threshold. */
export const singlePointDetector: Detector = (points, _now, params) => {
  const needed = params.minBaselinePoints + params.minRecentPoints;
  if (points.length < needed) return false;
  const baselineN = Math.min(params.maxBaselinePoints, points.length - params.minRecentPoints);
  const base = points.slice(0, baselineN).map((p) => p.value);
  const m = median(base);
  const scale = robustScale(base, METRICS.contact_resistance.minScale);
  return isDeviation(points[points.length - 1]!.value, m, scale, METRICS.contact_resistance.minScale, params);
};

/** EVOLT's trend-aware method: persistence + sustained trend rules. */
export const trendAwareDetector: Detector = (points, now, params) => {
  const a = assessMetric("contact_resistance", points, now, params);
  return a.status === "monitor" || a.status === "inspection_recommended";
};

export interface DetectorResult {
  /** Degrading series flagged at or after onset. */
  detected: number;
  degradingSeries: number;
  /** Non-degrading series flagged at any point, plus degrading series flagged before onset. */
  falseAlarmSeries: number;
  nonDegradingSeries: number;
  earlyFlags: number;
  /** Median number of readings between onset and first flag (detected series only). */
  medianDelay: number | null;
  perScenario: Record<ScenarioKind, { series: number; flagged: number; medianDelay: number | null }>;
}

/**
 * Trend parameters were chosen while looking at seeds 1–40. The published
 * evaluation uses seeds starting at HELD_OUT_SEED_OFFSET so it is not graded on
 * the same series used for tuning.
 */
export const HELD_OUT_SEED_OFFSET = 1000;

export function evaluateDetector(
  detector: Detector,
  seeds: number,
  params: AnalysisParams = ANALYSIS_PARAMS,
  seedOffset = HELD_OUT_SEED_OFFSET,
): DetectorResult {
  const result: DetectorResult = {
    detected: 0,
    degradingSeries: 0,
    falseAlarmSeries: 0,
    nonDegradingSeries: 0,
    earlyFlags: 0,
    medianDelay: null,
    perScenario: {} as DetectorResult["perScenario"],
  };
  const delays: number[] = [];
  for (const kind of Object.keys(SCENARIOS) as ScenarioKind[]) {
    const scenarioDelays: number[] = [];
    let flaggedCount = 0;
    for (let s = 1; s <= seeds; s++) {
      const series = generateScenario(kind, s + seedOffset);
      let firstFlag: number | null = null;
      for (let k = 1; k <= series.points.length; k++) {
        const prefix = series.points.slice(0, k);
        const now = prefix[prefix.length - 1]!.observedAt;
        if (detector(prefix, now, params)) {
          firstFlag = k - 1;
          break;
        }
      }
      if (firstFlag !== null) flaggedCount++;
      if (SCENARIOS[kind].degrading) {
        result.degradingSeries++;
        if (firstFlag !== null && firstFlag < series.onset!) {
          result.earlyFlags++;
          result.falseAlarmSeries++;
        } else if (firstFlag !== null) {
          result.detected++;
          delays.push(firstFlag - series.onset!);
          scenarioDelays.push(firstFlag - series.onset!);
        }
      } else {
        result.nonDegradingSeries++;
        if (firstFlag !== null) result.falseAlarmSeries++;
      }
    }
    result.perScenario[kind] = {
      series: seeds,
      flagged: flaggedCount,
      medianDelay: scenarioDelays.length ? median(scenarioDelays) : null,
    };
  }
  result.medianDelay = delays.length ? median(delays) : null;
  return result;
}

export interface EvaluationReport {
  seedsPerScenario: number;
  seedOffset: number;
  seriesLength: number;
  singlePoint: DetectorResult;
  trendAware: DetectorResult;
}

export function runEvaluation(seeds = 40, params: AnalysisParams = ANALYSIS_PARAMS): EvaluationReport {
  return {
    seedsPerScenario: seeds,
    seedOffset: HELD_OUT_SEED_OFFSET,
    seriesLength: SERIES_LENGTH,
    singlePoint: evaluateDetector(singlePointDetector, seeds, params),
    trendAware: evaluateDetector(trendAwareDetector, seeds, params),
  };
}
