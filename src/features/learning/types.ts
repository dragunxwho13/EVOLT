/** Types for models trained on imported, labelled session data. Dependency-free. */

export type ModelKind = "majority" | "threshold" | "logistic";

export interface ClassMetrics {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ModelEvaluation {
  model: ModelKind;
  name: string;
  description: string;
  /** Mean accuracy over the cross-validation folds. */
  accuracy: number;
  accuracyStd: number;
  macroF1: number;
  foldAccuracies: number[];
  /** Rows = true class, columns = predicted class (order of `classes`), summed over folds. */
  confusion: number[][];
  perClass: ClassMetrics[];
}

/** value <= cuts[0] → order[0]; cuts[0] < value <= cuts[1] → order[1]; … */
export interface ThresholdModel {
  kind: "threshold";
  feature: string;
  order: string[];
  cuts: number[];
}

export interface LogisticModel {
  kind: "logistic";
  features: string[];
  mean: number[];
  std: number[];
  classes: string[];
  weights: number[][];
  bias: number[];
}

export type FittedModel = ThresholdModel | LogisticModel;

export interface TargetReport {
  target: string;
  targetLabel: string;
  rows: number;
  classes: string[];
  classCounts: Record<string, number>;
  folds: number;
  seed: number;
  features: string[];
  baselineAccuracy: number;
  evaluations: ModelEvaluation[];
  best: ModelKind;
  learnable: boolean;
  verdict: string;
  /** Model fitted on all rows; used for predictions. Null when nothing beats the baseline. */
  finalModel: FittedModel | null;
  /** Threshold model fitted on all rows, kept for explanation even when not chosen. */
  thresholdModel: ThresholdModel | null;
  /** Sample of the threshold feature per true class, for plotting. */
  distribution: { label: string; values: number[] }[];
  trainedAt: string;
  /** Set on a follow-up test: the same label, trained without the listed measurement(s). */
  variantOf?: string;
  excludedFeatures?: string[];
  /** The question this report answers, in plain words. */
  question?: string;
  /** Observed range of each numeric feature, used to warn about out-of-range predictions. */
  featureRanges?: Record<string, { min: number; max: number }>;
}
