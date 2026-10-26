import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { ANALYSIS_VERSION } from "@/config/analysis";
import type { AlertStatus } from "@/config/domain";
import { getDb } from "@/lib/db/client";
import { alertEvents, alerts, chargers, healthObservations, maintenanceEvents } from "@/lib/db/schema";
import { conflict, notFound, validationError } from "@/lib/errors";
import { canTransition, planAlertSync, type ExistingAlert } from "./alert-sync";
import { assessCharger, type ObservationsByMetric } from "./assess-charger";

export interface RecomputeResult {
  chargersEvaluated: number;
  alertsCreated: number;
  alertsUpdated: number;
  alertsDeactivated: number;
  alertsSuppressed: number;
}

/**
 * Re-runs the deterministic health analysis for the given chargers (or all) and
 * synchronises their alerts. Each charger is processed in its own transaction so a
 * failure cannot leave a charger half-updated.
 */
export async function recomputeHealth(chargerIds?: string[], now: Date = new Date()): Promise<RecomputeResult> {
  const db = getDb();
  const ids =
    chargerIds ?? (await db.select({ id: chargers.id }).from(chargers).orderBy(asc(chargers.code))).map((r) => r.id);
  const result: RecomputeResult = {
    chargersEvaluated: 0,
    alertsCreated: 0,
    alertsUpdated: 0,
    alertsDeactivated: 0,
    alertsSuppressed: 0,
  };

  for (const chargerId of ids) {
    await db.transaction(async (tx) => {
      const obs = await tx
        .select({
          metric: healthObservations.metric,
          observedAt: healthObservations.observedAt,
          value: healthObservations.value,
          temperatureC: healthObservations.temperatureC,
        })
        .from(healthObservations)
        .where(eq(healthObservations.chargerId, chargerId))
        .orderBy(asc(healthObservations.observedAt));
      const byMetric: ObservationsByMetric = {};
      for (const o of obs) (byMetric[o.metric] ??= []).push({ observedAt: o.observedAt, value: o.value, temperatureC: o.temperatureC });

      const [settings] = await tx
        .select({ limit: chargers.contactResistanceLimitMohm })
        .from(chargers)
        .where(eq(chargers.id, chargerId));
      const [lastWork] = await tx
        .select({ at: maintenanceEvents.performedAt })
        .from(maintenanceEvents)
        .where(and(eq(maintenanceEvents.chargerId, chargerId), sql`${maintenanceEvents.performedAt} <= ${now}`))
        .orderBy(desc(maintenanceEvents.performedAt))
        .limit(1);

      const summary = assessCharger(byMetric, now, undefined, {
        limits: { contact_resistance: settings?.limit ?? null },
        lastMaintenanceAt: lastWork?.at ?? null,
      });
      const findings = summary.metrics.flatMap((m) => m.findings);

      const existing = await tx
        .select({
          id: alerts.id,
          metric: alerts.metric,
          rule: alerts.rule,
          status: alerts.status,
          windowEnd: alerts.windowEnd,
          severity: alerts.severity,
        })
        .from(alerts)
        .where(eq(alerts.chargerId, chargerId));
      const active: ExistingAlert[] = existing.filter((a) => a.status === "open" || a.status === "acknowledged");
      const closed: ExistingAlert[] = existing.filter((a) => a.status === "resolved" || a.status === "dismissed");

      for (const action of planAlertSync(findings, active, closed)) {
        if (action.type === "create") {
          const f = action.finding;
          const [created] = await tx
            .insert(alerts)
            .values({
              chargerId,
              metric: f.metric,
              rule: f.rule,
              severity: f.severity,
              status: "open",
              windowStart: new Date(f.windowStart),
              windowEnd: new Date(f.windowEnd),
              evidence: f.evidence,
              explanation: f.explanation,
              confidenceNote: f.confidenceNote,
              suggestedAction: f.suggestedAction,
              analysisVersion: ANALYSIS_VERSION,
              firstDetectedAt: now,
              lastEvaluatedAt: now,
            })
            .returning({ id: alerts.id });
          await tx.insert(alertEvents).values({ alertId: created!.id, fromStatus: null, toStatus: "open", note: "Raised by analysis." });
          result.alertsCreated++;
        } else if (action.type === "update") {
          const f = action.finding;
          await tx
            .update(alerts)
            .set({
              severity: f.severity,
              windowStart: new Date(f.windowStart),
              windowEnd: new Date(f.windowEnd),
              evidence: f.evidence,
              explanation: f.explanation,
              confidenceNote: f.confidenceNote,
              suggestedAction: f.suggestedAction,
              conditionActive: true,
              lastEvaluatedAt: now,
              analysisVersion: ANALYSIS_VERSION,
              updatedAt: now,
              ...(action.newEvidence ? { occurrences: sql`${alerts.occurrences} + 1` } : {}),
            })
            .where(eq(alerts.id, action.alertId));
          result.alertsUpdated++;
        } else if (action.type === "deactivate") {
          await tx
            .update(alerts)
            .set({ conditionActive: false, lastEvaluatedAt: now, updatedAt: now })
            .where(eq(alerts.id, action.alertId));
          result.alertsDeactivated++;
        } else {
          result.alertsSuppressed++;
        }
      }

      await tx
        .update(chargers)
        .set({
          healthStatus: summary.status,
          healthEvaluatedAt: now,
          healthSummary: summary,
          lastObservationAt: summary.latestObservationAt ? new Date(summary.latestObservationAt) : null,
          updatedAt: now,
        })
        .where(eq(chargers.id, chargerId));
    });
    result.chargersEvaluated++;
  }
  return result;
}

export async function updateAlertStatus(alertId: string, to: AlertStatus, note: string | null) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: alerts.id, status: alerts.status, chargerId: alerts.chargerId, metric: alerts.metric, rule: alerts.rule })
      .from(alerts)
      .where(eq(alerts.id, alertId))
      .for("update");
    if (!current) throw notFound("Alert");
    if (current.status === to) throw validationError(`The alert is already ${to}.`);
    if (!canTransition(current.status, to)) {
      throw conflict(`An alert cannot move from ${current.status} to ${to}. Resolved and dismissed alerts are final.`);
    }
    if (to === "open") {
      // Re-opening must not collide with another unresolved alert for the same key.
      const [other] = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.chargerId, current.chargerId),
            eq(alerts.metric, current.metric),
            eq(alerts.rule, current.rule),
            inArray(alerts.status, ["open", "acknowledged"]),
            sql`${alerts.id} <> ${alertId}`,
          ),
        );
      if (other) throw conflict("Another unresolved alert already exists for this charger and rule.");
    }
    const now = new Date();
    const [updated] = await tx
      .update(alerts)
      .set({ status: to, updatedAt: now })
      .where(eq(alerts.id, alertId))
      .returning();
    await tx.insert(alertEvents).values({ alertId, fromStatus: current.status, toStatus: to, note });
    return updated!;
  });
}
