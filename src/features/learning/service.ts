import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { notFound, validationError } from "@/lib/errors";
import { chargingSessions, modelRuns } from "@/lib/db/schema";
import { predict, trainSessionTargets } from "./train";
import type { FittedModel, TargetReport } from "./types";

export interface TrainingSummary {
  rows: number;
  targets: { target: string; label: string; learnable: boolean; accuracy: number; baseline: number; best: string }[];
  skipped: { target: string; reason: string }[];
}

/**
 * Trains every labelled target found in the stored sessions and saves the reports.
 * Runs in well under a second per target for thousands of rows.
 */
export async function trainModels(now: Date = new Date()): Promise<TrainingSummary> {
  const db = getDb();
  const rows = await db
    .select({ values: chargingSessions.values, labels: chargingSessions.labels, area: chargingSessions.area, chargingMode: chargingSessions.chargingMode })
    .from(chargingSessions)
    .where(sql`${chargingSessions.labels} <> '{}'::jsonb`);
  const outcome = trainSessionTargets(rows, now);
  const summary: TrainingSummary = { rows: outcome.rows, targets: [], skipped: outcome.skipped };
  for (const report of outcome.reports) {
    await db.insert(modelRuns).values({ target: report.target, rows: report.rows, learnable: report.learnable, result: report });
    const chosen = report.evaluations.find((e) => e.model === report.best)!;
    summary.targets.push({
      target: report.target,
      label: report.targetLabel,
      learnable: report.learnable,
      accuracy: chosen.accuracy,
      baseline: report.baselineAccuracy,
      best: chosen.name,
    });
  }
  return summary;
}

/** The most recent report for each target. */
export async function latestReports(): Promise<TargetReport[]> {
  const db = getDb();
  const runs = await db
    .selectDistinctOn([modelRuns.target], { result: modelRuns.result })
    .from(modelRuns)
    .orderBy(modelRuns.target, desc(modelRuns.createdAt));
  return runs.map((r) => r.result);
}

export async function sessionStats() {
  const [row] = await getDb()
    .execute<{ sessions: number; labelled: number; chargers: number; first: string | null; last: string | null }>(sql`
      select count(*)::int as sessions,
             count(*) filter (where labels <> '{}'::jsonb)::int as labelled,
             count(distinct charger_id)::int as chargers,
             min(started_at)::text as first, max(started_at)::text as last
      from charging_sessions`)
    .then((r) => r.rows);
  return row ?? { sessions: 0, labelled: 0, chargers: 0, first: null, last: null };
}

function vectorFor(
  s: { values: Record<string, number>; area: string | null; chargingMode: string | null },
  features: string[],
): Record<string, number> | null {
  const x: Record<string, number> = {};
  for (const f of features) {
    if (f.startsWith("area=")) x[f] = s.area === f.slice(5) ? 1 : 0;
    else if (f.startsWith("mode=")) x[f] = s.chargingMode === f.slice(5) ? 1 : 0;
    else if (Number.isFinite(s.values[f])) x[f] = s.values[f]!;
    else return null;
  }
  return x;
}

function featuresOf(m: FittedModel): string[] {
  return m.kind === "threshold" ? [m.feature] : m.features;
}

export interface ChargerModelView {
  target: string;
  targetLabel: string;
  modelName: string;
  accuracy: number;
  sessions: number;
  predicted: Record<string, number>;
  /** Share of sessions where the prediction matches the dataset's own label (when present). */
  agreement: { matched: number; labelled: number } | null;
  recent: { at: string; predicted: string; actual: string | null; feature: number | null }[];
}

/** Applies each learnable model to one charger's sessions. */
export async function chargerModelViews(chargerId: string): Promise<ChargerModelView[]> {
  const reports = (await latestReports()).filter((r) => r.learnable && r.finalModel && !r.variantOf);
  if (!reports.length) return [];
  const sessions = await getDb()
    .select()
    .from(chargingSessions)
    .where(eq(chargingSessions.chargerId, chargerId))
    .orderBy(desc(chargingSessions.startedAt));
  if (!sessions.length) return [];
  return reports.map((r) => {
    const model = r.finalModel!;
    const predicted: Record<string, number> = {};
    let matched = 0;
    let labelled = 0;
    const recent: ChargerModelView["recent"] = [];
    for (const s of sessions) {
      const x = vectorFor(s, featuresOf(model));
      if (!x) continue;
      const p = predict(model, x);
      predicted[p] = (predicted[p] ?? 0) + 1;
      const actual = s.labels[r.target] ?? null;
      if (actual) {
        labelled++;
        if (actual === p) matched++;
      }
      if (recent.length < 8) {
        recent.push({ at: s.startedAt.toISOString(), predicted: p, actual, feature: model.kind === "threshold" ? (x[model.feature] ?? null) : null });
      }
    }
    const chosen = r.evaluations.find((e) => e.model === r.best)!;
    return {
      target: r.target,
      targetLabel: r.targetLabel,
      modelName: chosen.name,
      accuracy: chosen.accuracy,
      sessions: sessions.length,
      predicted,
      agreement: labelled ? { matched, labelled } : null,
      recent,
    };
  });
}

export interface PredictionInput {
  target: string;
  values: Record<string, number>;
  area?: string | null;
  chargingMode?: string | null;
}

export interface PredictionResult {
  target: string;
  targetLabel: string;
  predicted: string;
  modelName: string;
  /** Cross-validated accuracy of this model on unseen sessions. */
  accuracy: number;
  baselineAccuracy: number;
  explanation: string;
  warnings: string[];
  trainedAt: string;
}

/**
 * Classifies one session with the stored model for `target`. Refuses when the label was not
 * learnable (no prediction is better than a guess dressed up as one) or when inputs are missing.
 */
export async function predictSession(input: PredictionInput): Promise<PredictionResult> {
  const report = (await latestReports()).find((r) => r.target === input.target);
  if (!report) throw notFound("Model for this label");
  if (!report.learnable || !report.finalModel) {
    throw validationError(`${report.targetLabel} could not be learned from the data, so EVOLT does not make predictions for it.`);
  }
  const model = report.finalModel;
  const needed = featuresOf(model);
  const missing = needed.filter((f) => !f.includes("=") && !Number.isFinite(input.values[f]));
  if (missing.length) throw validationError(`Missing or invalid value for: ${missing.join(", ")}.`, { missing });
  const x = vectorFor({ values: input.values, area: input.area ?? null, chargingMode: input.chargingMode ?? null }, needed);
  if (!x) throw validationError("The inputs do not match what the model needs.");

  const warnings: string[] = [];
  for (const f of needed) {
    const range = report.featureRanges?.[f];
    const v = input.values[f];
    if (range && v !== undefined && (v < range.min || v > range.max)) {
      warnings.push(`${f} = ${v} is outside the range seen in training (${range.min.toFixed(2)}–${range.max.toFixed(2)}); treat this prediction with extra caution.`);
    }
  }
  const predicted = predict(model, x);
  const chosen = report.evaluations.find((e) => e.model === report.best)!;
  let explanation: string;
  if (model.kind === "threshold") {
    const v = x[model.feature]!;
    const idx = model.order.indexOf(predicted);
    const lo = idx > 0 ? model.cuts[idx - 1] : null;
    const hi = idx < model.cuts.length ? model.cuts[idx] : null;
    const range = lo === null ? `≤ ${hi!.toFixed(2)}` : hi === null ? `> ${lo.toFixed(2)}` : `between ${lo.toFixed(2)} and ${hi.toFixed(2)}`;
    explanation = `${model.feature} = ${v} is ${range}, which the learned rule assigns to “${predicted}”.`;
  } else {
    explanation = `Multinomial logistic regression over ${model.features.length} inputs assigned the highest probability to “${predicted}”.`;
  }
  return {
    target: report.target,
    targetLabel: report.targetLabel,
    predicted,
    modelName: chosen.name,
    accuracy: chosen.accuracy,
    baselineAccuracy: report.baselineAccuracy,
    explanation,
    warnings,
    trainedAt: report.trainedAt,
  };
}
