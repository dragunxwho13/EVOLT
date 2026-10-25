import { describe, expect, it } from "vitest";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { assessMetric, cleanSeries, isDeviation } from "@/features/anomaly-detection/assess-metric";
import { DAY, T0, nowAfter, weekly, wobble } from "../support/series";

describe("data-quality cleaning", () => {
  it("excludes implausible, non-finite, future and duplicate readings without substituting zero", () => {
    const obs = [
      { observedAt: new Date(T0), value: 0.3 },
      { observedAt: new Date(T0), value: 0.31 }, // duplicate timestamp
      { observedAt: new Date(T0 + DAY), value: Number.NaN },
      { observedAt: new Date(T0 + 2 * DAY), value: 500 }, // implausible for contact resistance
      { observedAt: new Date(T0 + 400 * DAY), value: 0.3 }, // future relative to now
      { observedAt: new Date(T0 + 3 * DAY), value: 0.29 },
    ];
    const res = cleanSeries("contact_resistance", obs, new Date(T0 + 10 * DAY));
    expect(res.points.map((p) => p.value)).toEqual([0.3, 0.29]);
    expect(res.excluded).toBe(4);
    expect(res.flags.map((f) => f.code).sort()).toEqual(
      ["duplicate_timestamp", "future_timestamp", "implausible_value", "non_finite_value"].sort(),
    );
    expect(res.points.some((p) => p.value === 0)).toBe(false);
  });
});

describe("assessMetric", () => {
  it("reports insufficient data when there is too little history", () => {
    const s = weekly(wobble(0.3, 5));
    const a = assessMetric("contact_resistance", s, nowAfter(s));
    expect(a.status).toBe("insufficient_data");
    expect(a.baseline).toBeNull();
    expect(a.qualityFlags.some((f) => f.code === "insufficient_history")).toBe(true);
  });

  it("reports insufficient data (not normal) when there are no valid readings", () => {
    const a = assessMetric("contact_resistance", [{ observedAt: new Date(T0), value: Number.NaN }], new Date(T0 + DAY));
    expect(a.status).toBe("insufficient_data");
    expect(a.validPoints).toBe(0);
  });

  it("classifies a stable series as normal", () => {
    const s = weekly(wobble(0.3, 20));
    const a = assessMetric("contact_resistance", s, nowAfter(s));
    expect(a.status).toBe("normal");
    expect(a.findings).toHaveLength(0);
    expect(a.baseline?.n).toBe(ANALYSIS_PARAMS.maxBaselinePoints);
  });

  it("does not alert on a single isolated spike but records it", () => {
    const values = wobble(0.3, 20);
    values[17] = 0.45;
    const s = weekly(values);
    const a = assessMetric("contact_resistance", s, nowAfter(s));
    expect(a.status).toBe("normal");
    expect(a.notes.join(" ")).toMatch(/isolated/);
  });

  it("flags a persistent deviation and escalates large ones", () => {
    const values = [...wobble(0.3, 15), 0.34, 0.35, 0.345, 0.35, 0.352];
    const s = weekly(values);
    const a = assessMetric("contact_resistance", s, nowAfter(s));
    const f = a.findings.find((x) => x.rule === "persistent_deviation");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("monitor");
    expect(f!.evidence.kind).toBe("persistent_deviation");

    const big = weekly([...wobble(0.3, 15), 0.45, 0.46, 0.47, 0.46, 0.48]);
    const b = assessMetric("contact_resistance", big, nowAfter(big));
    expect(b.status).toBe("inspection_recommended");
  });

  it("detects a sustained upward trend with Theil–Sen", () => {
    const base = wobble(0.3, 12);
    const drift = Array.from({ length: 10 }, (_, i) => 0.3 * (1 + 0.025 * (i + 1)));
    const s = weekly([...base, ...drift]);
    const a = assessMetric("contact_resistance", s, nowAfter(s));
    const trend = a.findings.find((f) => f.rule === "sustained_trend");
    expect(trend).toBeDefined();
    if (trend?.evidence.kind !== "sustained_trend") throw new Error("wrong evidence kind");
    expect(trend.evidence.consistency).toBeGreaterThanOrEqual(ANALYSIS_PARAMS.trendConsistency);
    expect(trend.explanation).toMatch(/Theil|rose/);
  });

  it("does not report a trend for a decreasing (improving) series", () => {
    const s = weekly([...wobble(0.3, 12), ...Array.from({ length: 10 }, (_, i) => 0.3 * (1 - 0.02 * (i + 1)))]);
    const a = assessMetric("contact_resistance", s, nowAfter(s));
    expect(a.findings).toHaveLength(0);
  });

  it("treats stale history as insufficient rather than normal", () => {
    const s = weekly(wobble(0.3, 20));
    const now = new Date(s[s.length - 1]!.observedAt.getTime() + (ANALYSIS_PARAMS.staleAfterDays + 10) * DAY);
    const a = assessMetric("contact_resistance", s, now);
    expect(a.status).toBe("insufficient_data");
    expect(a.qualityFlags.some((f) => f.code === "stale")).toBe(true);
  });

  it("flags recurring faults with thresholds and historical context", () => {
    const counts = [...Array(16).fill(0), 2, 3, 2, 1];
    const s = weekly(counts);
    const a = assessMetric("fault_count", s, nowAfter(s));
    expect(a.status).toBe("inspection_recommended");
    const f = a.findings[0]!;
    if (f.evidence.kind !== "fault_recurrence") throw new Error("wrong evidence kind");
    expect(f.evidence.total).toBeGreaterThanOrEqual(ANALYSIS_PARAMS.faultInspectTotal);
  });

  it("never raises findings from a supporting-only metric", () => {
    const s = weekly([...wobble(10, 15), 18, 19, 20, 21, 22]);
    const a = assessMetric("temperature_rise", s, nowAfter(s));
    expect(a.findings).toHaveLength(0);
    expect(a.notes.join(" ")).toMatch(/Supporting signal only/);
  });

  it("does not call a deviation when the baseline itself was already that high (regression)", () => {
    // Bimodal readings: the baseline already crosses the threshold in 4 of 11 readings.
    const values = [0.44, 0.34, 1.36, 0.3, 3.78, 2.83, 2.61, 0.29, 4.33, 0.55, 0.25, 3.26, 2.77, 4.82];
    const s = weekly(values);
    const a = assessMetric("power_loss", s, nowAfter(s));
    expect(a.findings.filter((f) => f.rule === "persistent_deviation")).toHaveLength(0);
    expect(a.notes.join(" ")).toMatch(/baseline is too variable/);
  });

  it("requires both a statistical and a relative deviation", () => {
    // 3% above a very tight baseline is statistically large but physically small.
    expect(isDeviation(0.309, 0.3, 0.001, 0.005, ANALYSIS_PARAMS)).toBe(false);
    expect(isDeviation(0.33, 0.3, 0.001, 0.005, ANALYSIS_PARAMS)).toBe(true);
  });

  it("is deterministic", () => {
    const s = weekly([...wobble(0.3, 15), 0.4, 0.41, 0.42, 0.43, 0.44]);
    const now = nowAfter(s);
    expect(assessMetric("contact_resistance", s, now)).toEqual(assessMetric("contact_resistance", s, now));
  });
});
