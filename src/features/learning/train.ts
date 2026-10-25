/**
 * Trains and cross-validates classifiers for one labelled target. Pure and
 * deterministic: the same rows and seed always give the same report.
 *
 * Honesty rules:
 *  - Every model is scored on folds it did not see (stratified k-fold), including the
 *    choice of feature and thresholds.
 *  - A target only counts as learnable when the best model beats the majority-class
 *    baseline clearly (by ≥ 5 points of accuracy and by more than 2 fold-standard-deviations).
 *    Otherwise the report says so and no predictive model is offered.
 */
import {
  classMetrics,
  confusionMatrix,
  fitLogistic,
  fitMajority,
  fitThreshold,
  mean,
  predictLogistic,
  predictThreshold,
  std,
  stratifiedFolds,
  type Sample,
} from "./models";
import type { FittedModel, ModelEvaluation, ModelKind, TargetReport } from "./types";

export const TRAINING = { folds: 5, seed: 20260425, minRows: 40, minLift: 0.05 } as const;

const DESCRIPTIONS: Record<ModelKind, { name: string; description: string }> = {
  majority: { name: "Majority-class baseline", description: "Always predicts the most common class. Any useful model must beat this." },
  threshold: {
    name: "Learned thresholds (one measurement)",
    description: "Finds the single measurement and cut points that best separate the classes. Fully explainable.",
  },
  logistic: {
    name: "Multinomial logistic regression",
    description: "Uses every numeric column and the area/charging-mode categories together.",
  },
};

export function humanize(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function evaluate(kind: ModelKind, samples: Sample[], folds: number[], k: number, features: string[], classes: string[]): ModelEvaluation {
  const truth: string[] = [];
  const pred: string[] = [];
  const foldAcc: number[] = [];
  for (let f = 0; f < k; f++) {
    const train = samples.filter((_, i) => folds[i] !== f);
    const test = samples.filter((_, i) => folds[i] === f);
    if (!test.length) continue;
    let predict: (x: Record<string, number>) => string;
    if (kind === "majority") {
      const label = fitMajority(train);
      predict = () => label;
    } else if (kind === "threshold") {
      const m = fitThreshold(train, features, classes);
      const fallback = fitMajority(train);
      predict = m ? (x) => predictThreshold(m, x) : () => fallback;
    } else {
      const m = fitLogistic(train, features, classes);
      predict = (x) => predictLogistic(m, x);
    }
    let correct = 0;
    for (const s of test) {
      const p = predict(s.x);
      truth.push(s.y);
      pred.push(p);
      if (p === s.y) correct++;
    }
    foldAcc.push(correct / test.length);
  }
  const confusion = confusionMatrix(truth, pred, classes);
  const perClass = classMetrics(confusion, classes);
  return {
    model: kind,
    ...DESCRIPTIONS[kind],
    accuracy: mean(foldAcc),
    accuracyStd: std(foldAcc),
    macroF1: mean(perClass.map((c) => c.f1)),
    foldAccuracies: foldAcc,
    confusion,
    perClass,
  };
}

/** Reduces a list to at most `max` evenly spaced items (for plotting). */
function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  return Array.from({ length: max }, (_, i) => items[Math.floor(i * step)]!);
}

export function trainTarget(target: string, samples: Sample[], features: string[], now: Date = new Date()): TargetReport {
  const counts: Record<string, number> = {};
  for (const s of samples) counts[s.y] = (counts[s.y] ?? 0) + 1;
  const classes = Object.keys(counts).sort();
  const k = TRAINING.folds;
  const folds = stratifiedFolds(samples, k, TRAINING.seed);
  const baselineAccuracy = Math.max(...Object.values(counts)) / samples.length;

  const evaluations = (["majority", "threshold", "logistic"] as const).map((kind) => evaluate(kind, samples, folds, k, features, classes));
  const [, ...candidates] = evaluations;
  const bestCandidate = [...candidates].sort((a, b) => b.macroF1 - a.macroF1 || b.accuracy - a.accuracy)[0]!;
  const lift = bestCandidate.accuracy - baselineAccuracy;
  const learnable = lift >= TRAINING.minLift && bestCandidate.accuracy - 2 * bestCandidate.accuracyStd > baselineAccuracy;
  // Prefer the explainable threshold model when it is within one point of the best.
  const thresholdEval = evaluations[1]!;
  const chosen: ModelEvaluation = learnable
    ? thresholdEval.accuracy >= bestCandidate.accuracy - 0.01
      ? thresholdEval
      : bestCandidate
    : evaluations[0]!;

  const thresholdModel = fitThreshold(samples, features, classes);
  let finalModel: FittedModel | null = null;
  if (learnable) finalModel = chosen.model === "threshold" ? thresholdModel : fitLogistic(samples, features, classes);

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const label = humanize(target);
  let verdict: string;
  if (learnable && chosen.model === "threshold" && thresholdModel) {
    const cuts = thresholdModel.cuts.map((c) => c.toFixed(2)).join(" and ");
    verdict =
      `${label} can be predicted: ${pct(chosen.accuracy)} accuracy on unseen data versus ${pct(baselineAccuracy)} for always guessing ` +
      `the most common class. Almost all of the signal is in ${humanize(thresholdModel.feature).toLowerCase()} — the learned cut points ` +
      `${cuts} reproduce the label as well as a model using every column (${pct(evaluations[2]!.accuracy)}).`;
  } else if (learnable) {
    verdict = `${label} can be predicted: ${pct(chosen.accuracy)} accuracy on unseen data versus a ${pct(baselineAccuracy)} baseline, using all columns together.`;
  } else {
    const topAccuracy = Math.max(...candidates.map((c) => c.accuracy));
    verdict =
      `${label} could not be predicted from this data. The best model reached ${pct(topAccuracy)} on unseen data, ` +
      `not meaningfully better than always guessing the most common class (${pct(baselineAccuracy)}). The label appears unrelated to the ` +
      `recorded measurements, so EVOLT offers no prediction for it.`;
  }

  const distribution = thresholdModel
    ? (thresholdModel.order.map((c) => ({
        label: c,
        values: sample(
          samples.filter((s) => s.y === c).map((s) => s.x[thresholdModel.feature]!),
          300,
        ),
      })) as TargetReport["distribution"])
    : [];

  return {
    target,
    targetLabel: label,
    rows: samples.length,
    classes,
    classCounts: counts,
    folds: k,
    seed: TRAINING.seed,
    features,
    baselineAccuracy,
    evaluations,
    best: chosen.model,
    learnable,
    verdict,
    finalModel,
    thresholdModel,
    distribution,
    trainedAt: now.toISOString(),
  };
}

export interface SessionRow {
  values: Record<string, number>;
  labels: Record<string, string>;
  area: string | null;
  chargingMode: string | null;
}

export interface TrainingOutcome {
  reports: TargetReport[];
  skipped: { target: string; reason: string }[];
  rows: number;
}

export function variantKey(target: string, excluded: string): string {
  return `${target}::without::${excluded}`;
}

function ranges(vectors: Record<string, number>[], features: string[]): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const f of features) {
    if (f.includes("=")) continue;
    let min = Infinity;
    let max = -Infinity;
    for (const v of vectors) {
      const x = v[f]!;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    out[f] = { min, max };
  }
  return out;
}

/**
 * Trains every labelled target in a set of sessions (pure; shared by the app and the CLI).
 * When a label is reproduced by a single measurement, a follow-up test trains it again without
 * that measurement, answering whether the label can be anticipated from operating conditions.
 */
export function trainSessionTargets(rows: readonly SessionRow[], now: Date = new Date()): TrainingOutcome {
  const labelledRows = rows.filter((r) => Object.keys(r.labels).length > 0);
  const targets = [...new Set(labelledRows.flatMap((r) => Object.keys(r.labels)))].sort();
  const outcome: TrainingOutcome = { reports: [], skipped: [], rows: labelledRows.length };
  for (const target of targets) {
    const labelled = labelledRows.filter((r) => r.labels[target]);
    const counts = new Map<string, number>();
    for (const r of labelled) counts.set(r.labels[target]!, (counts.get(r.labels[target]!) ?? 0) + 1);
    if (labelled.length < TRAINING.minRows) {
      outcome.skipped.push({ target, reason: `Only ${labelled.length} labelled sessions; at least ${TRAINING.minRows} are needed.` });
      continue;
    }
    if (counts.size < 2) {
      outcome.skipped.push({ target, reason: "Every session has the same label, so there is nothing to learn." });
      continue;
    }
    if ([...counts.values()].some((n) => n < TRAINING.folds)) {
      outcome.skipped.push({ target, reason: `Some classes have fewer than ${TRAINING.folds} sessions, too few to test fairly.` });
      continue;
    }
    const { features, vectors } = buildFeatures(labelled);
    if (!features.length) {
      outcome.skipped.push({ target, reason: "No numeric measurements are present in every labelled session." });
      continue;
    }
    const samples = vectors.map((x, i) => ({ x, y: labelled[i]!.labels[target]! }));
    const report = { ...trainTarget(target, samples, features, now), featureRanges: ranges(vectors, features) };
    report.question = `Can ${humanize(target).toLowerCase()} be predicted from the session's recorded values?`;
    outcome.reports.push(report);

    if (report.learnable && report.best === "threshold" && report.thresholdModel) {
      const excluded = report.thresholdModel.feature;
      const reduced = features.filter((f) => f !== excluded);
      if (reduced.length) {
        const without = trainTarget(
          variantKey(target, excluded),
          samples.map((s) => ({ x: Object.fromEntries(reduced.map((f) => [f, s.x[f]!])), y: s.y })),
          reduced,
          now,
        );
        const question = `Can ${humanize(target).toLowerCase()} be anticipated without measuring ${humanize(excluded).toLowerCase()}?`;
        const answer = without.learnable
          ? `Yes: without ${humanize(excluded).toLowerCase()}, the best model still reaches ${(without.evaluations.find((e) => e.model === without.best)!.accuracy * 100).toFixed(1)}% on unseen sessions.`
          : `Without ${humanize(excluded).toLowerCase()}, the best model reaches ${(Math.max(...without.evaluations.slice(1).map((e) => e.accuracy)) * 100).toFixed(1)}% on unseen sessions — no better than always guessing the most common class (${(without.baselineAccuracy * 100).toFixed(1)}%). The other recorded conditions carry no usable signal, so ${humanize(excluded).toLowerCase()} has to be measured.`;
        outcome.reports.push({
          ...without,
          targetLabel: `${humanize(target)} — without ${humanize(excluded).toLowerCase()}`,
          verdict: answer,
          variantOf: target,
          excludedFeatures: [excluded],
          question,
          featureRanges: ranges(vectors, reduced),
        });
      }
    }
  }
  return outcome;
}

export function predict(model: FittedModel, x: Record<string, number>): string {
  return model.kind === "threshold" ? predictThreshold(model, x) : predictLogistic(model, x);
}

/** Builds feature vectors: numeric columns present in every row, plus one-hot categories. */
export function buildFeatures(
  rows: { values: Record<string, number>; area: string | null; chargingMode: string | null }[],
): { features: string[]; vectors: Record<string, number>[] } {
  const idLike = /(^|_)(id|code)$/i;
  const numeric = rows.length
    ? Object.keys(rows[0]!.values).filter((k) => !idLike.test(k) && rows.every((r) => Number.isFinite(r.values[k])))
    : [];
  const areas = [...new Set(rows.map((r) => r.area).filter((v): v is string => Boolean(v)))].sort();
  const modes = [...new Set(rows.map((r) => r.chargingMode).filter((v): v is string => Boolean(v)))].sort();
  const oneHot = [...areas.map((a) => `area=${a}`), ...modes.map((m) => `mode=${m}`)];
  const features = [...numeric.sort(), ...(oneHot.length > 1 ? oneHot : [])];
  const vectors = rows.map((r) => {
    const v: Record<string, number> = {};
    for (const k of numeric) v[k] = r.values[k]!;
    if (oneHot.length > 1) {
      for (const a of areas) v[`area=${a}`] = r.area === a ? 1 : 0;
      for (const m of modes) v[`mode=${m}`] = r.chargingMode === m ? 1 : 0;
    }
    return v;
  });
  return { features, vectors };
}
