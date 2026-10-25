import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chargingSessions, modelRuns } from "@/lib/db/schema";
import { buildFeatures, predict, TRAINING, trainTarget } from "./train";
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
  const targets = [...new Set(rows.flatMap((r) => Object.keys(r.labels)))].sort();
  const summary: TrainingSummary = { rows: rows.length, targets: [], skipped: [] };

  for (const target of targets) {
    const labelled = rows.filter((r) => r.labels[target]);
    const counts = new Map<string, number>();
    for (const r of labelled) counts.set(r.labels[target]!, (counts.get(r.labels[target]!) ?? 0) + 1);
    if (labelled.length < TRAINING.minRows) {
      summary.skipped.push({ target, reason: `Only ${labelled.length} labelled sessions; at least ${TRAINING.minRows} are needed.` });
      continue;
    }
    if (counts.size < 2) {
      summary.skipped.push({ target, reason: "Every session has the same label, so there is nothing to learn." });
      continue;
    }
    if ([...counts.values()].some((n) => n < TRAINING.folds)) {
      summary.skipped.push({ target, reason: `Some classes have fewer than ${TRAINING.folds} sessions, too few to test fairly.` });
      continue;
    }
    const { features, vectors } = buildFeatures(labelled);
    if (!features.length) {
      summary.skipped.push({ target, reason: "No numeric measurements are present in every labelled session." });
      continue;
    }
    const report = trainTarget(
      target,
      vectors.map((x, i) => ({ x, y: labelled[i]!.labels[target]! })),
      features,
      now,
    );
    await db.insert(modelRuns).values({ target, rows: report.rows, learnable: report.learnable, result: report });
    const chosen = report.evaluations.find((e) => e.model === report.best)!;
    summary.targets.push({
      target,
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
  const reports = (await latestReports()).filter((r) => r.learnable && r.finalModel);
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
