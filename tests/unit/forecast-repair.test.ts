import { describe, expect, it } from "vitest";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { assessMetric } from "@/features/anomaly-detection/assess-metric";
import { forecastServiceLimit, senSlopeInterval } from "@/features/anomaly-detection/forecast";
import { analysedValue, applyTemperatureCorrection, correctToReference } from "@/features/anomaly-detection/temperature";
import { verifyChargerRepairs } from "@/features/connector-health/charger-repairs";
import { summarizeRepairs, verifyRepairs } from "@/features/connector-health/repair-verification";
import { planObservations } from "@/features/data-ingestion/plan";
import { forecastInsights } from "@/features/insights/rules";
import type { ChargerHealthSummary, ServiceForecast } from "@/types/analysis";
import { DAY, T0, nowAfter, weekly, wobble } from "../support/series";

const pts = (values: number[], start = T0, stepDays = 7) => values.map((value, i) => ({ t: start + i * stepDays * DAY, value }));

describe("temperature correction", () => {
  it("restates a reading at 20 °C with the copper coefficient", () => {
    expect(correctToReference(0.3, 45)).toBeCloseTo(0.3 / (1 + 0.00393 * 25), 10);
    expect(correctToReference(0.3, 20)).toBe(0.3);
    expect(correctToReference(0.3, 0)).toBeGreaterThan(0.3);
  });

  it("removes a heat-only rise that would otherwise raise an alert", () => {
    // True resistance is flat; the last six readings were taken at 60 °C instead of 25 °C.
    const truth = wobble(0.3, 18);
    const temps = truth.map((_, i) => (i < 12 ? 25 : 60));
    const raw = truth.map((v, i) => v * (1 + 0.00393 * (temps[i]! - 20)));
    const withTemp = weekly(raw).map((o, i) => ({ ...o, temperatureC: temps[i]! }));
    const withoutTemp = weekly(raw);

    const uncorrected = assessMetric("contact_resistance", withoutTemp, nowAfter(withoutTemp));
    expect(uncorrected.status).not.toBe("normal");
    expect(uncorrected.temperatureCorrection?.applied).toBe(false);

    const corrected = assessMetric("contact_resistance", withTemp, nowAfter(withTemp));
    expect(corrected.status).toBe("normal");
    expect(corrected.temperatureCorrection?.applied).toBe(true);
    expect(corrected.temperatureCorrection?.maxTempC).toBe(60);
    expect(corrected.notes.join(" ")).toMatch(/restated at 20 °C/);
  });

  it("does not mix corrected and uncorrected readings", () => {
    const obs = weekly(wobble(0.3, 10)).map((o, i) => ({ ...o, temperatureC: i % 2 ? 30 : null }));
    const res = applyTemperatureCorrection("contact_resistance", obs);
    expect(res.info?.applied).toBe(false);
    expect(res.info?.withTemperature).toBe(5);
    expect(res.info?.explanation).toMatch(/Only 5 of 10/);
    expect(res.observations.map((o) => o.value)).toEqual(obs.map((o) => o.value));
  });

  it("treats an implausible temperature as missing", () => {
    const obs = weekly([0.3, 0.31, 0.3]).map((o, i) => ({ ...o, temperatureC: i === 1 ? 400 : 25 }));
    expect(applyTemperatureCorrection("contact_resistance", obs).info?.applied).toBe(false);
  });

  it("leaves metrics that do not depend on temperature alone", () => {
    const obs = weekly([1, 2, 3]).map((o) => ({ ...o, temperatureC: 50 }));
    const res = applyTemperatureCorrection("fault_count", obs);
    expect(res.info).toBeNull();
    expect(res.observations.map((o) => o.value)).toEqual([1, 2, 3]);
    expect(analysedValue("fault_count", 3, 50, true)).toBe(3);
    expect(analysedValue("contact_resistance", 0.3, 45, false)).toBe(0.3);
    expect(analysedValue("contact_resistance", 0.3, 45, true)).toBeCloseTo(correctToReference(0.3, 45), 12);
  });
});

describe("service-limit forecast", () => {
  it("recovers an exact slope with a zero-width interval on a perfect line", () => {
    const ci = senSlopeInterval(pts([0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36, 0.37]), 0.8)!;
    expect(ci.slope).toBeCloseTo(0.01 / 7, 12);
    expect(ci.low).toBeCloseTo(ci.slope, 12);
    expect(ci.high).toBeCloseTo(ci.slope, 12);
  });

  it("projects a date with an ordered range for a clear rise", () => {
    const values = Array.from({ length: 12 }, (_, i) => 0.3 + 0.01 * i + (i % 2 ? 0.002 : -0.002));
    const f = forecastServiceLimit({ metric: "contact_resistance", points: pts(values), baselineMedian: 0.3 })!;
    expect(f.status).toBe("projected");
    expect(f.limit).toBeCloseTo(0.45, 10);
    expect(f.limitSource).toBe("default");
    // Current level ≈ 0.40 rising 0.01/week → about 5 weeks to 0.45.
    expect(f.daysToLimit!).toBeGreaterThan(28);
    expect(f.daysToLimit!).toBeLessThan(42);
    expect(f.daysEarliest!).toBeLessThanOrEqual(f.daysToLimit!);
    expect(f.daysLatest!).toBeGreaterThanOrEqual(f.daysToLimit!);
    expect(new Date(f.earliestDate!).getTime()).toBeLessThanOrEqual(new Date(f.expectedDate!).getTime());
    expect(f.explanation).toMatch(/range/);
  });

  it("gives no date when the rise is not statistically clear", () => {
    const f = forecastServiceLimit({ metric: "contact_resistance", points: pts(wobble(0.3, 12, 0.03)), baselineMedian: 0.3 })!;
    expect(f.status).toBe("not_rising");
    expect(f.expectedDate).toBeNull();
    expect(f.explanation).toMatch(/no statistically clear rise/);
  });

  it("reports when the connector is already above the limit", () => {
    const f = forecastServiceLimit({ metric: "contact_resistance", points: pts([0.3, 0.35, 0.4, 0.46, 0.47, 0.48, 0.5]), baselineMedian: 0.3 })!;
    expect(f.status).toBe("already_above");
  });

  it("uses the operator's limit and only readings after the latest maintenance", () => {
    const values = Array.from({ length: 12 }, (_, i) => 0.3 + 0.01 * i);
    const opLimit = forecastServiceLimit({ metric: "contact_resistance", points: pts(values), baselineMedian: 0.3, operatorLimit: 0.6 })!;
    expect(opLimit.limit).toBe(0.6);
    expect(opLimit.limitSource).toBe("operator");
    const since = new Date(T0 + 8 * 7 * DAY + DAY);
    const recent = forecastServiceLimit({ metric: "contact_resistance", points: pts(values), baselineMedian: 0.3, since })!;
    expect(recent.status).toBe("insufficient_data");
    expect(recent.pointsUsed).toBe(3);
    expect(recent.explanation).toMatch(/since the maintenance/);
  });

  it("does not give a date more than a year ahead", () => {
    const values = Array.from({ length: 12 }, (_, i) => 0.3 + 0.0002 * i);
    const f = forecastServiceLimit({ metric: "contact_resistance", points: pts(values), baselineMedian: 0.3 })!;
    expect(f.status).toBe("projected");
    expect(f.beyondHorizon).toBe(true);
    expect(f.expectedDate).toBeNull();
  });

  it("is attached by the analysis to forecastable metrics only", () => {
    const s = weekly(Array.from({ length: 14 }, (_, i) => (i < 8 ? 0.3 : 0.3 + 0.015 * (i - 7))));
    expect(assessMetric("contact_resistance", s, nowAfter(s)).forecast?.status).toBe("projected");
    const faults = weekly(Array.from({ length: 14 }, () => 0));
    expect(assessMetric("fault_count", faults, nowAfter(faults)).forecast).toBeNull();
  });
});

describe("repair verification", () => {
  const baseline = { median: 0.3, scale: 0.006 };
  const ev = (days: number, id = "e1") => ({ id, performedAt: new Date(T0 + days * DAY), action: "cleaned" as const });
  const at = (days: number, value: number) => ({ t: T0 + days * DAY, value });
  const before = [at(0, 0.41), at(7, 0.42), at(14, 0.43)];

  it("says a fix held when readings return to normal and stay there", () => {
    const [r] = verifyRepairs({ metric: "contact_resistance", points: [...before, at(18, 0.3), at(25, 0.301), at(32, 0.299), at(39, 0.3)], baseline, events: [ev(15)] });
    expect(r!.outcome).toBe("held");
    expect(r!.before).toBeCloseTo(0.42, 10);
    expect(r!.improvement!).toBeGreaterThan(0.9);
  });

  it("detects a relapse and when it happened", () => {
    const [r] = verifyRepairs({ metric: "contact_resistance", points: [...before, at(18, 0.3), at(25, 0.302), at(32, 0.39), at(39, 0.41)], baseline, events: [ev(15)] });
    expect(r!.outcome).toBe("relapsed");
    expect(r!.daysToRelapse).toBe(17);
  });

  it("separates partial improvement from no effect", () => {
    const high = [at(0, 0.5), at(7, 0.5), at(14, 0.5)];
    const [partial] = verifyRepairs({ metric: "contact_resistance", points: [...high, at(18, 0.38)], baseline, events: [ev(15)] });
    expect(partial!.outcome).toBe("partial");
    const [none] = verifyRepairs({ metric: "contact_resistance", points: [...high, at(18, 0.49)], baseline, events: [ev(15)] });
    expect(none!.outcome).toBe("no_effect");
  });

  it("waits for readings before concluding", () => {
    const [waiting] = verifyRepairs({ metric: "contact_resistance", points: before, baseline, events: [ev(15)] });
    expect(waiting!.outcome).toBe("awaiting_measurement");
    const [pending] = verifyRepairs({ metric: "contact_resistance", points: [...before, at(18, 0.3)], baseline, events: [ev(15)] });
    expect(pending!.outcome).toBe("restored_pending");
  });

  it("attributes readings to the most recent work only", () => {
    const res = verifyRepairs({
      metric: "contact_resistance",
      points: [...before, at(18, 0.44), at(25, 0.45), at(32, 0.3), at(39, 0.3), at(46, 0.3), at(53, 0.3)],
      baseline,
      events: [ev(15, "first"), ev(28, "second")],
    });
    expect(res.find((r) => r.eventId === "first")!.outcome).toBe("no_effect");
    expect(res.find((r) => r.eventId === "second")!.outcome).toBe("held");
  });

  it("summarises success by kind of work, excluding unconfirmed jobs", () => {
    const rows = [
      ...verifyRepairs({ metric: "contact_resistance", points: [...before, at(18, 0.3), at(25, 0.3), at(32, 0.3)], baseline, events: [ev(15, "a")] }),
      ...verifyRepairs({ metric: "contact_resistance", points: [...before, at(18, 0.3), at(25, 0.4), at(32, 0.41)], baseline, events: [ev(15, "b")] }),
      ...verifyRepairs({ metric: "contact_resistance", points: before, baseline, events: [ev(15, "c")] }),
    ];
    const [cleaned] = summarizeRepairs(rows);
    expect(cleaned).toMatchObject({ action: "cleaned", recorded: 3, conclusive: 2, held: 1, relapsed: 1, pending: 1, successRate: 0.5 });
  });

  it("uses the same temperature-corrected values as the analysis", () => {
    const summary = {
      metrics: [{ metric: "contact_resistance", baseline: { median: 0.3, scale: 0.006, n: 12, from: "", to: "" }, temperatureCorrection: { applied: true } }],
    } as unknown as ChargerHealthSummary;
    // Raw 0.32 at 40 °C restates to ≈ 0.297: back in range, so the fix counts as restored.
    const obs = [
      { metric: "contact_resistance" as const, observedAt: new Date(T0), value: 0.45, temperatureC: 20 },
      { metric: "contact_resistance" as const, observedAt: new Date(T0 + 20 * DAY), value: 0.32, temperatureC: 40 },
    ];
    const r = verifyChargerRepairs(summary, obs, [ev(10)]);
    expect(r.metric).toBe("contact_resistance");
    expect(r.results[0]!.outcome).toBe("restored_pending");
    expect(verifyChargerRepairs(null, obs, [ev(10)]).reason).toMatch(/baseline/);
  });
});

describe("forecast action items", () => {
  const now = new Date(T0);
  const forecast = (over: Partial<ServiceForecast>): ServiceForecast => ({
    status: "projected",
    limit: 0.45,
    limitSource: "default",
    unit: "mΩ",
    pointsUsed: 10,
    spanDays: 63,
    since: null,
    slopePerDay: 0.001,
    slopeLowPerDay: 0.0008,
    slopeHighPerDay: 0.0012,
    confidence: 0.8,
    currentLevel: 0.4,
    latestAt: now.toISOString(),
    daysToLimit: 10,
    daysEarliest: 8,
    daysLatest: 13,
    expectedDate: new Date(T0 + 10 * DAY).toISOString(),
    earliestDate: new Date(T0 + 8 * DAY).toISOString(),
    latestDate: new Date(T0 + 13 * DAY).toISOString(),
    beyondHorizon: false,
    extrapolated: false,
    explanation: "test",
    ...over,
  });
  const charger = (f: ServiceForecast, historical = false) => ({
    id: "c1",
    code: "C-1",
    stationName: "S",
    isDemo: false,
    summary: { historical, metrics: [{ metric: "contact_resistance", forecast: f }] } as unknown as ChargerHealthSummary,
  });

  it("raises a high-priority item for a limit expected within two weeks", () => {
    const [item] = forecastInsights([charger(forecast({}))], now);
    expect(item!.priority).toBe("high");
    expect(item!.source).toBe("dataset");
    expect(item!.headline).toMatch(/service limit/);
  });

  it("raises a medium item within the action window and nothing beyond it", () => {
    const medium = forecast({ expectedDate: new Date(T0 + 25 * DAY).toISOString(), earliestDate: new Date(T0 + 20 * DAY).toISOString() });
    expect(forecastInsights([charger(medium)], now)[0]!.priority).toBe("medium");
    const far = forecast({ earliestDate: new Date(T0 + (ANALYSIS_PARAMS.forecastActionDays + 5) * DAY).toISOString() });
    expect(forecastInsights([charger(far)], now)).toHaveLength(0);
  });

  it("flags connectors already above the limit, and ignores historical data and flat trends", () => {
    expect(forecastInsights([charger(forecast({ status: "already_above" }))], now)[0]!.priority).toBe("high");
    expect(forecastInsights([charger(forecast({}), true)], now)).toHaveLength(0);
    expect(forecastInsights([charger(forecast({ status: "not_rising", earliestDate: null }))], now)).toHaveLength(0);
  });
});

describe("importing contact temperature", () => {
  const mapping = { charger_code: "c", observed_at: "t", metric: "m", value: "v", unit: "u", temperature_c: "temp" };
  const ids = new Map([["CH-1", "id-1"]]);

  it("stores an optional temperature and rejects impossible ones", () => {
    const rows = [
      { c: "CH-1", t: "2026-05-01T00:00:00Z", m: "contact_resistance", v: "0.3", u: "mΩ", temp: "41.5" },
      { c: "CH-1", t: "2026-05-02T00:00:00Z", m: "contact_resistance", v: "0.3", u: "mΩ", temp: "" },
      { c: "CH-1", t: "2026-05-03T00:00:00Z", m: "contact_resistance", v: "0.3", u: "mΩ", temp: "900" },
      { c: "CH-1", t: "2026-05-04T00:00:00Z", m: "contact_resistance", v: "0.3", u: "mΩ", temp: "hot" },
    ];
    const plan = planObservations(rows, mapping, ids, new Set(), new Date("2026-06-01T00:00:00Z"), "observed");
    expect(plan.candidates.map((c) => c.temperatureC)).toEqual([41.5, null]);
    expect(plan.issues.filter((i) => i.field === "temperature_c")).toHaveLength(2);
  });
});
