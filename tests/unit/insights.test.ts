import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestMapping } from "@/features/data-ingestion/fields";
import { parseDatasetText } from "@/features/data-ingestion/parse";
import { planSessions } from "@/features/data-ingestion/plan";
import { compareRates, computePerformance, performanceCsv } from "@/features/insights/performance";
import { alertInsights, coverageInsights, sessionInsights, sortInsights, type AlertInput } from "@/features/insights/rules";
import { trainSessionTargets } from "@/features/learning/train";
import { recommend, type CandidateCharger } from "@/features/recommendations/engine";
import {
  bonferroniZ,
  normalQuantile,
  normalizeSession,
  summarizeSessions,
  wilson,
  type NormalizedSession,
  type SessionRecord,
} from "@/features/sessions/metrics";

const NOW = new Date("2026-10-25T00:00:00Z");

/** The bundled dataset, normalised exactly as the app does after import. */
function datasetSessions(): NormalizedSession[] {
  const parsed = parseDatasetText(readFileSync("public/samples/ev-charging-grid-sessions.csv", "utf8"), "csv");
  const plan = planSessions(parsed.rows, parsed.headers, suggestMapping("sessions", parsed.headers), new Set(), NOW, 0);
  return plan.sessions.map((s) =>
    normalizeSession({
      stationId: s.stationCode,
      stationCode: s.stationCode,
      stationName: s.stationCode,
      chargerId: s.chargerCode,
      chargerCode: s.chargerCode,
      chargingMode: s.chargingMode,
      area: s.area,
      startedAt: s.startedAt,
      values: s.values,
      labels: s.labels,
    }),
  );
}
const sessions = datasetSessions();

function record(over: Partial<SessionRecord> & { values: Record<string, number> }): SessionRecord {
  return {
    stationId: "s1",
    stationCode: "S1",
    stationName: "Station 1",
    chargerId: "c1",
    chargerCode: "C1",
    chargingMode: "Fast",
    area: "Urban",
    startedAt: new Date("2024-01-01T00:00:00Z"),
    labels: {},
    ...over,
  };
}

describe("statistics helpers", () => {
  it("matches SciPy's normal quantiles and the Wilson interval", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
    expect(bonferroniZ(19)).toBeCloseTo(3.007787, 5);
    const w = wilson(256, 1000);
    expect(w.low).toBeCloseTo(0.22992, 4);
    expect(w.high).toBeCloseTo(0.283947, 4);
    const small = wilson(3, 10);
    expect(small.low).toBeCloseTo(0.107791, 4);
    expect(small.high).toBeCloseTo(0.603222, 4);
  });
});

describe("session metrics", () => {
  it("reproduces figures computed independently with pandas", () => {
    const s = summarizeSessions(sessions);
    expect(s.sessions).toBe(1000);
    expect(s.energyKwh).toBeCloseTo(43065.897, 1);
    expect(s.avgDurationMin).toBeCloseTo(94.9403, 3);
    expect(s.avgChargingPowerKw).toBeCloseTo(26.4898, 3);
    expect(s.medianLossShare).toBeCloseTo(0.194011, 5);
    expect(s.medianPowerLossKw).toBeCloseTo(2.428011, 5);
    expect(s.highLoss).toMatchObject({ count: 256, of: 1000 });
    expect(s.poorStability).toMatchObject({ count: 245, of: 1000 });
    expect(s.lossExceedsConsumed.count).toBe(35);
    expect(s.energyExceedsBattery.count).toBe(302);
    expect(s.costPerKwh).toBeCloseTo(0.147658, 5);
    expect(s.chargingModes).toEqual({ Conventional: 331, Fast: 352, V2G: 317 });
  });

  it("finds columns by alias and leaves missing metrics empty instead of guessing", () => {
    const n = normalizeSession(record({ values: { "Charging Power (kW)": 50, Charging_Time: 30, power_loss: 2, power_consumed: 1 } }));
    expect(n.energyKwh).toBe(25);
    expect(n.lossExceedsConsumed).toBe(true);
    expect(n.cost).toBeNull();
    expect(n.energyExceedsBattery).toBe(false);
    const s = summarizeSessions([n]);
    expect(s.costPerKwh).toBeNull();
    expect(s.highLoss.rate).toBeNull();
  });
});

describe("action-item rules", () => {
  const alert = (over: Partial<AlertInput>): AlertInput => ({
    id: "a1",
    chargerId: "c1",
    chargerCode: "C1",
    stationName: "Station",
    isDemo: false,
    metric: "contact_resistance",
    rule: "persistent_deviation",
    severity: "inspection_recommended",
    status: "open",
    explanation: "Contact resistance has stayed above its baseline.",
    confidenceNote: "Based on 5 readings.",
    suggestedAction: "Inspect the connector.",
    conditionActive: true,
    windowStart: new Date("2026-10-01T00:00:00Z"),
    windowEnd: new Date("2026-10-20T00:00:00Z"),
    occurrences: 2,
    ...over,
  });

  it("maps alert severity to priority and demotes alerts whose pattern is gone", () => {
    const items = alertInsights([
      alert({}),
      alert({ id: "a2", severity: "monitor" }),
      alert({ id: "a3", conditionActive: false }),
      alert({ id: "a4", status: "resolved" }),
    ]);
    expect(items.map((i) => [i.key, i.priority])).toEqual([
      ["alert:a1", "high"],
      ["alert:a2", "medium"],
      ["alert:a3", "low"],
    ]);
    expect(items[2]!.headline).toMatch(/^No longer detected/);
    expect(items[2]!.action).toMatch(/Confirm/);
  });

  it("does not flag any dataset station once the many-stations comparison is accounted for", () => {
    // Station 5 has 25/64 poor-stability sessions (39 % vs 24.5 % fleet). Its plain 95 % interval
    // clears the fleet rate, but with 19 stations tested that is expected by chance; the
    // Bonferroni-adjusted interval does not, so no supply-quality item is raised.
    const items = sessionInsights(sessions);
    expect(items.filter((i) => i.category === "supply_quality" || i.category === "energy_loss")).toEqual([]);
  });

  it("flags a station whose high-loss share is clearly above the fleet", () => {
    const make = (station: string, high: boolean, i: number) =>
      normalizeSession(
        record({
          stationId: station,
          stationName: station,
          startedAt: new Date(Date.UTC(2024, 0, 1 + (i % 5))),
          values: { power_loss: 1, power_consumed: 10 },
          labels: { reduced_power_loss_category: high ? "High" : "Low" },
        }),
      );
    const data = [
      ...Array.from({ length: 60 }, (_, i) => make("Hot", i < 45, i)),
      ...["A", "B", "C", "D"].flatMap((s) => Array.from({ length: 60 }, (_, i) => make(s, i < 9, i))),
    ];
    const flagged = sessionInsights(data).filter((i) => i.category === "energy_loss");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ key: "high-loss:Hot", priority: "medium", subject: { kind: "station", label: "Hot" } });
    expect(flagged[0]!.evidence[0]).toMatch(/45 of 60/);
    expect(flagged[0]!.rule).toMatch(/Bonferroni/);
    expect(flagged[0]!.trend?.values.length).toBe(5);
  });

  it("reports the dataset's data-quality problems with their counts", () => {
    const items = sessionInsights(sessions);
    const battery = items.find((i) => i.key === "energy-exceeds-battery:fleet")!;
    expect(battery.priority).toBe("medium");
    expect(battery.evidence[0]).toMatch(/302 of 1000/);
    const lossItems = items.filter((i) => i.key.startsWith("loss-exceeds-consumed:"));
    const total = lossItems.reduce((n, i) => n + Number((i.evidence.join(" ").match(/(\d+) of \d+ sessions have/) ?? [, 0])[1]), 0);
    const minor = lossItems.find((i) => i.key === "loss-exceeds-consumed:minor");
    const minorCount = minor ? Number(minor.headline.match(/^(\d+)/)![1]) : 0;
    expect(total + minorCount).toBe(35);
    expect(items.find((i) => i.key === "mode-power-indistinct:fleet")?.priority).toBe("low");
    // Session counts per station (41–71) are not unusual enough to call any station low-demand.
    expect(items.some((i) => i.category === "demand")).toBe(false);
  });

  it("summarises evidence coverage and sorts by priority", () => {
    const cov = coverageInsights([
      { id: "1", code: "A", stationName: "S", isDemo: false, healthStatus: "insufficient_data", lastObservationAt: null, historical: false },
      { id: "2", code: "B", stationName: "S", isDemo: false, healthStatus: "normal", lastObservationAt: new Date("2024-01-10"), historical: true },
    ]);
    expect(cov.map((c) => c.key)).toEqual(["coverage:insufficient", "coverage:historical"]);
    const sorted = sortInsights([...cov, ...alertInsights([alert({})])]);
    expect(sorted[0]!.priority).toBe("high");
  });
});

describe("performance takeaways", () => {
  const perf = computePerformance(sessions);

  it("states that area and charging-type differences are within noise for this dataset", () => {
    expect(perf.byArea.map((r) => r.label)).toEqual(["Rural", "Suburban", "Urban"]);
    expect(perf.takeaways.area).toMatch(/intervals overlap/);
    expect(perf.takeaways.mode).toMatch(/intervals overlap/);
    expect(perf.takeaways.stations).toMatch(/None is clearly above the fleet/);
    expect(perf.takeaways.dailySessions).toMatch(/ranged from 40 to 96 over 11 days/);
    expect(perf.takeaways.dailyLoss).toMatch(/no consistent upward or downward trend/);
  });

  it("says when groups clearly differ", () => {
    const row = (label: string, count: number, of: number) => {
      const w = wilson(count, of);
      return { key: label, label, summary: { highLoss: { count, of, rate: count / of, low: w.low, high: w.high } } } as never;
    };
    expect(compareRates([row("A", 10, 200), row("B", 120, 200)], "high-loss share", "areas")).toMatch(/B has a clearly higher/);
  });

  it("exports one CSV row per station", () => {
    const lines = performanceCsv(perf).trim().split("\r\n");
    expect(lines).toHaveLength(20);
    expect(lines[0]!.split(",")).toContain("high_loss_share");
  });
});

describe("driver recommendation summaries", () => {
  const base: CandidateCharger = {
    chargerId: "a",
    chargerCode: "A",
    stationId: "s",
    stationName: "Near",
    latitude: 13.0,
    longitude: 80.2,
    connectorType: "CCS2",
    ratedPowerKw: 60,
    operationalStatus: "available",
    healthStatus: "normal",
    activeAlerts: 0,
    statusAt: "2026-10-24T10:00:00Z",
  };
  const req = { origin: { lat: 13.0, lng: 80.2 }, connectorTypes: ["CCS2" as const], radiusKm: 25, includeInspection: false, limit: 10 };

  it("explains a recommendation only with facts the record supports", () => {
    const r = recommend([base, { ...base, chargerId: "b", chargerCode: "B", stationName: "Far", latitude: 13.05, operationalStatus: "unknown", statusAt: null }], req);
    expect(r.recommendations[0]!.summary).toMatch(/^Top match: it matches your CCS2/);
    expect(r.recommendations[0]!.summary).toMatch(/marked available in the latest reported status/);
    expect(r.recommendations[0]!.summary).toMatch(/the closest of these results/);
    expect(r.recommendations[1]!.summary).not.toMatch(/available/);
    expect(r.hardConstraints.length).toBeGreaterThan(0);
    expect(r.preferences.join(" ")).toMatch(/not used/);
  });

  it("treats 'available only' as a hard constraint", () => {
    const r = recommend([base, { ...base, chargerId: "b", operationalStatus: "in_use" }], { ...req, availableOnly: true });
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["a"]);
    expect(r.excluded.not_available).toBe(1);
  });
});

describe("model follow-up test", () => {
  it("finds that the loss category cannot be anticipated without measuring power loss", () => {
    const parsed = parseDatasetText(readFileSync("public/samples/ev-charging-grid-sessions.csv", "utf8"), "csv");
    const plan = planSessions(parsed.rows, parsed.headers, suggestMapping("sessions", parsed.headers), new Set(), NOW, 0);
    const outcome = trainSessionTargets(plan.sessions, NOW);
    const targets = outcome.reports.map((r) => [r.target, r.learnable]);
    expect(targets).toEqual([
      ["reduced_power_loss_category", true],
      ["reduced_power_loss_category::without::power_loss", false],
      ["voltage_stability_category", false],
    ]);
    const without = outcome.reports[1]!;
    expect(without.features).not.toContain("power_loss");
    expect(without.verdict).toMatch(/no better than always guessing/);
    expect(without.featureRanges?.power_loss).toBeUndefined();
    expect(outcome.reports[0]!.featureRanges?.power_loss?.max).toBeCloseTo(4.994085, 5);
  });
});
