import type { AlertRule, AlertStatus, MetricKey } from "@/config/domain";
import type { Finding } from "@/types/analysis";

export interface ExistingAlert {
  id: string;
  metric: MetricKey;
  rule: AlertRule;
  status: AlertStatus;
  windowEnd: Date;
  severity: Finding["severity"];
}

export type AlertSyncAction =
  | { type: "create"; finding: Finding }
  | { type: "update"; alertId: string; finding: Finding; newEvidence: boolean }
  | { type: "deactivate"; alertId: string }
  | { type: "suppressed"; finding: Finding; closedAlertId: string };

const keyOf = (metric: string, rule: string) => `${metric}|${rule}`;

/**
 * Decides how fresh findings map onto stored alerts. Pure, so it is unit-tested.
 *
 * - One unresolved (open/acknowledged) alert per charger + metric + rule: repeated
 *   detections update it instead of creating duplicates.
 * - If the condition is no longer found, the alert is marked inactive but left for a
 *   person to resolve — it is never silently closed.
 * - A resolved or dismissed alert suppresses re-creation until newer evidence arrives
 *   (a finding whose window ends after the closed alert's window).
 */
export function planAlertSync(findings: Finding[], active: ExistingAlert[], latestClosed: ExistingAlert[]): AlertSyncAction[] {
  const actions: AlertSyncAction[] = [];
  const activeByKey = new Map(active.map((a) => [keyOf(a.metric, a.rule), a]));
  const closedByKey = new Map<string, ExistingAlert>();
  for (const c of latestClosed) {
    const k = keyOf(c.metric, c.rule);
    const prev = closedByKey.get(k);
    if (!prev || c.windowEnd > prev.windowEnd) closedByKey.set(k, c);
  }
  const matched = new Set<string>();

  for (const f of findings) {
    const k = keyOf(f.metric, f.rule);
    const existing = activeByKey.get(k);
    if (existing) {
      matched.add(existing.id);
      actions.push({
        type: "update",
        alertId: existing.id,
        finding: f,
        newEvidence: new Date(f.windowEnd).getTime() > existing.windowEnd.getTime(),
      });
      continue;
    }
    const closed = closedByKey.get(k);
    if (closed && new Date(f.windowEnd).getTime() <= closed.windowEnd.getTime()) {
      actions.push({ type: "suppressed", finding: f, closedAlertId: closed.id });
      continue;
    }
    actions.push({ type: "create", finding: f });
  }

  for (const a of active) {
    if (!matched.has(a.id)) actions.push({ type: "deactivate", alertId: a.id });
  }
  return actions;
}

const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  open: ["acknowledged", "resolved", "dismissed"],
  acknowledged: ["open", "resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
