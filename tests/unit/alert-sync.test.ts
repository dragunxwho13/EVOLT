import { describe, expect, it } from "vitest";
import { canTransition, planAlertSync, type ExistingAlert } from "@/features/connector-health/alert-sync";
import type { Finding } from "@/types/analysis";

function finding(windowEnd: string, rule: Finding["rule"] = "persistent_deviation"): Finding {
  return {
    metric: "contact_resistance",
    rule,
    severity: "monitor",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd,
    evidence: {
      kind: "fault_recurrence",
      unit: "count",
      windowDays: 30,
      total: 3,
      monitorThreshold: 3,
      inspectThreshold: 8,
      baselineTotal: null,
      points: [],
    },
    explanation: "x",
    confidenceNote: "y",
    suggestedAction: "z",
  };
}

const existing = (id: string, status: ExistingAlert["status"], windowEnd: string, rule: ExistingAlert["rule"] = "persistent_deviation"): ExistingAlert => ({
  id,
  metric: "contact_resistance",
  rule,
  status,
  windowEnd: new Date(windowEnd),
  severity: "monitor",
});

describe("planAlertSync", () => {
  it("creates an alert for a new finding", () => {
    expect(planAlertSync([finding("2026-02-01T00:00:00Z")], [], [])).toEqual([{ type: "create", finding: expect.any(Object) }]);
  });

  it("updates instead of duplicating when an unresolved alert exists", () => {
    const actions = planAlertSync([finding("2026-02-08T00:00:00Z")], [existing("a1", "open", "2026-02-01T00:00:00Z")], []);
    expect(actions).toEqual([{ type: "update", alertId: "a1", finding: expect.any(Object), newEvidence: true }]);
    const same = planAlertSync([finding("2026-02-01T00:00:00Z")], [existing("a1", "acknowledged", "2026-02-01T00:00:00Z")], []);
    expect(same[0]).toMatchObject({ type: "update", newEvidence: false });
  });

  it("marks active alerts inactive when the condition disappears, without closing them", () => {
    expect(planAlertSync([], [existing("a1", "open", "2026-02-01T00:00:00Z")], [])).toEqual([{ type: "deactivate", alertId: "a1" }]);
  });

  it("suppresses re-creation after resolution until newer evidence arrives", () => {
    const closed = [existing("c1", "dismissed", "2026-02-01T00:00:00Z")];
    expect(planAlertSync([finding("2026-02-01T00:00:00Z")], [], closed)[0]).toMatchObject({ type: "suppressed" });
    expect(planAlertSync([finding("2026-02-15T00:00:00Z")], [], closed)[0]).toMatchObject({ type: "create" });
  });

  it("keeps different rules separate", () => {
    const actions = planAlertSync([finding("2026-02-01T00:00:00Z", "sustained_trend")], [existing("a1", "open", "2026-02-01T00:00:00Z")], []);
    expect(actions.map((a) => a.type).sort()).toEqual(["create", "deactivate"]);
  });
});

describe("alert status transitions", () => {
  it("allows review transitions and treats closed alerts as final", () => {
    expect(canTransition("open", "acknowledged")).toBe(true);
    expect(canTransition("acknowledged", "resolved")).toBe(true);
    expect(canTransition("acknowledged", "open")).toBe(true);
    expect(canTransition("resolved", "open")).toBe(false);
    expect(canTransition("dismissed", "acknowledged")).toBe(false);
  });
});
