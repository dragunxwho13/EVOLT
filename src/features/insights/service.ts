import "server-only";
import { eq, inArray } from "drizzle-orm";
import { loadSessions } from "@/features/sessions/service";
import { getDb } from "@/lib/db/client";
import { alerts, chargers, insightReviews, stations, type InsightReviewStatus } from "@/lib/db/schema";
import { notFound, validationError } from "@/lib/errors";
import { alertInsights, coverageInsights, forecastInsights, sessionInsights, sortInsights, type Insight, type Priority } from "./rules";

export type WorkflowStatus = "new" | InsightReviewStatus | "acknowledged";

export interface InsightWithWorkflow extends Insight {
  workflow: {
    status: WorkflowStatus;
    note: string | null;
    updatedAt: string | null;
    /** The evidence differs from what it was when someone last reviewed the item. */
    evidenceChanged: boolean;
  };
}

export interface InsightList {
  items: InsightWithWorkflow[];
  counts: Record<Priority, number>;
  generatedAt: string;
}

async function computeInsights(): Promise<Insight[]> {
  const db = getDb();
  const [sessions, chargerRows, alertRows] = await Promise.all([
    loadSessions(),
    db
      .select({
        id: chargers.id,
        code: chargers.code,
        stationName: stations.name,
        isDemo: stations.isSynthetic,
        healthStatus: chargers.healthStatus,
        lastObservationAt: chargers.lastObservationAt,
        summary: chargers.healthSummary,
      })
      .from(chargers)
      .innerJoin(stations, eq(stations.id, chargers.stationId)),
    db
      .select({
        id: alerts.id,
        chargerId: alerts.chargerId,
        chargerCode: chargers.code,
        stationName: stations.name,
        isDemo: stations.isSynthetic,
        metric: alerts.metric,
        rule: alerts.rule,
        severity: alerts.severity,
        status: alerts.status,
        explanation: alerts.explanation,
        confidenceNote: alerts.confidenceNote,
        suggestedAction: alerts.suggestedAction,
        conditionActive: alerts.conditionActive,
        windowStart: alerts.windowStart,
        windowEnd: alerts.windowEnd,
        occurrences: alerts.occurrences,
      })
      .from(alerts)
      .innerJoin(chargers, eq(chargers.id, alerts.chargerId))
      .innerJoin(stations, eq(stations.id, chargers.stationId))
      .where(inArray(alerts.status, ["open", "acknowledged"])),
  ]);
  return sortInsights([
    ...alertInsights(alertRows),
    ...forecastInsights(chargerRows, new Date()),
    ...sessionInsights(sessions),
    ...coverageInsights(chargerRows.map(({ summary, ...c }) => ({ ...c, historical: Boolean(summary?.historical) }))),
  ]);
}

export async function listInsights(now: Date = new Date()): Promise<InsightList> {
  const items = await computeInsights();
  const reviews = await getDb().select().from(insightReviews);
  const byKey = new Map(reviews.map((r) => [r.key, r]));
  const withWorkflow: InsightWithWorkflow[] = items.map((i) => {
    if (i.source === "health_alert") {
      return {
        ...i,
        workflow: { status: i.alertStatus === "acknowledged" ? "acknowledged" : "new", note: null, updatedAt: null, evidenceChanged: false },
      };
    }
    const r = byKey.get(i.key);
    return {
      ...i,
      workflow: r
        ? { status: r.status, note: r.note, updatedAt: r.updatedAt.toISOString(), evidenceChanged: r.evidenceDigest !== i.digest }
        : { status: "new", note: null, updatedAt: null, evidenceChanged: false },
    };
  });
  const counts: Record<Priority, number> = { high: 0, medium: 0, low: 0 };
  for (const i of withWorkflow) {
    if (i.workflow.status === "resolved" || i.workflow.status === "dismissed") continue;
    counts[i.priority]++;
  }
  return { items: withWorkflow, counts, generatedAt: now.toISOString() };
}

/**
 * Records a person's decision on a dataset-derived action item. Health-alert items are
 * changed through the alert workflow instead. "open" clears the review.
 */
export async function setInsightReview(key: string, status: InsightReviewStatus | "open", note: string | null): Promise<InsightWithWorkflow> {
  if (key.startsWith("alert:")) throw validationError("Health-alert items are updated from the alert itself.");
  const current = (await listInsights()).items.find((i) => i.key === key);
  if (!current) throw notFound("Action item");
  const db = getDb();
  if (status === "open") {
    await db.delete(insightReviews).where(eq(insightReviews.key, key));
  } else {
    const now = new Date();
    await db
      .insert(insightReviews)
      .values({ key, status, note, evidenceDigest: current.digest, updatedAt: now })
      .onConflictDoUpdate({ target: insightReviews.key, set: { status, note, evidenceDigest: current.digest, updatedAt: now } });
  }
  const updated = (await listInsights()).items.find((i) => i.key === key);
  if (!updated) throw notFound("Action item");
  return updated;
}
