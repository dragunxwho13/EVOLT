import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSUMPTIONS, BENCH_RUN, REFERENCE_VALUES, REFERENCES, SCENARIOS } from "@/config/scaling";
import { analyzeBench } from "@/features/bench/analysis";
import { benchInsights } from "@/features/bench/insights";
import { parseBenchCsv } from "@/features/bench/parse";
import { contactPhysics, deliveredPowerW, proportional, scaleFactors, scalingReport } from "@/features/bench/scaling";
import { parseDatasetText } from "@/features/data-ingestion/parse";
import {
  auditUnified,
  estimateFromBenchVoltage,
  fitBenchCalibration,
  fitRidge,
  predictRidge,
  regressionMetrics,
  stationFolds,
  studyUnifiedDataset,
} from "@/features/learning/degradation";
import { buildReport } from "../../scripts/train-degradation";
import saved from "../../models/degradation-report.json";

const benchText = readFileSync(BENCH_RUN.file, "utf8");
const parsed = parseBenchCsv(benchText);
const analysis = analyzeBench(parsed.records);
const sums = Object.fromEntries(
  readFileSync("database/data/SHA256SUMS", "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/\s+/).reverse()),
);

describe("raw bench data", () => {
  it("is the checksummed file, parsed without changing any value", () => {
    expect(createHash("sha256").update(benchText).digest("hex")).toBe(sums["arduino-bench-readings.csv"]);
    expect(parsed.rows).toBe(95);
    expect(parsed.records).toHaveLength(285);
    const at = (c: string, t: number) => parsed.records.find((r) => r.connector === c && r.timeS === t)!;
    expect(at("C1", 14)).toMatchObject({ voltageV: 4.21, currentMa: 15.6, degradationPct: 0 });
    expect(at("C2", 14)).toMatchObject({ voltageV: 4.13, currentMa: 15.3, degradationPct: 0 });
    expect(at("C3", 31.5)).toMatchObject({ voltageV: 1.74, currentMa: 6.5, degradationPct: null });
    expect(at("C1", 0.5)).toMatchObject({ voltageV: 0, currentMa: 0, degradationPct: null });
    // Blanks stay blank: 10 no-signal + 1 dropout + 5 unreported per connector.
    expect(parsed.records.filter((r) => r.degradationPct === null)).toHaveLength(48);
  });

  it("refuses malformed logs instead of guessing", () => {
    expect(() => parseBenchCsv("Time_s,C1_V\n1,2")).toThrow(/missing column/);
    const head = "Time_s,C1_V,C1_mA,C1_Deg_pct,C2_V,C2_mA,C2_Deg_pct,C3_V,C3_mA,C3_Deg_pct";
    expect(() => parseBenchCsv(`${head}\n1,1,1,,1,1,,1,1,\n1,1,1,,1,1,,1,1,`)).toThrow(/duplicate/);
    expect(() => parseBenchCsv(`${head}\n1,x,1,,1,1,,1,1,`)).toThrow(/not a number/);
    expect(() => parseBenchCsv(`${head}\n1,,1,,1,1,,1,1,`)).toThrow(/missing/);
  });
});

describe("experimental-circuit analysis", () => {
  it("measures the circuit parameters from the readings", () => {
    expect(analysis.circuit.loadOhm).toBeCloseTo(270, 0);
    expect(analysis.circuit.healthyV).toBeCloseTo(4.21, 2);
    expect(analysis.circuit.healthyMa).toBeCloseTo(15.6, 1);
    expect(analysis.circuit.degradedV).toBeCloseTo(2.2, 2);
    expect(analysis.durationS).toBe(47.5);
  });

  it("summarises each connector separately and finds the one real difference", () => {
    const [c1, c2, c3] = analysis.connectors;
    for (const c of analysis.connectors) {
      expect(c.counts).toEqual({ no_signal: 10, dropout: 1, healthy: 6, transition: 2, degraded: 71, unreported: 5 });
      expect(c.formulaMaxDeviation!).toBeLessThanOrEqual(0.15 + 1e-9);
    }
    expect(c1!.healthyMeanV).not.toBe(c2!.healthyMeanV);
    expect(analysis.comparison.meanDegradationGap).toBeCloseTo(0.071, 2);
    expect(analysis.comparison.healthyOutlier).toMatchObject({ connector: "C2" });
    expect(analysis.comparison.healthyOutlier!.gapV).toBeCloseTo(0.0933, 3);
    expect(c3!.extraResistanceOhm!).toBeCloseTo(270 * (c3!.healthyMeanV! / c3!.degradedMedianV! - 1), 9);
  });
});

describe("real-world scaling", () => {
  const base = { loadOhm: 270, healthyV: 4.21, healthyMa: 15.6, degradedV: 2.19 };

  it("scales each quantity by its own law", () => {
    for (const s of SCENARIOS) {
      const f = scaleFactors(base, s);
      expect(f.kV).toBeCloseTo(s.pathVoltage / 4.21, 9);
      expect(f.kI).toBeCloseTo(s.current / 0.0156, 6);
      expect(f.kR).toBeCloseTo(f.kV / f.kI, 12);
      expect(f.kP).toBeCloseTo(f.kV * f.kI, 6);
    }
  });

  it("keeps Ohm's law, I²R and dimensionless shares consistent after scaling", () => {
    for (const s of SCENARIOS) {
      const p = proportional(base, s, base.degradedV);
      expect(p.realVoltageLostV).toBeCloseTo(p.realCurrentA * p.realExtraOhm, 6);
      expect(p.realHeatW).toBeCloseTo(s.paths * p.realCurrentA ** 2 * p.realExtraOhm, 6);
      expect(p.voltageShareLost).toBeCloseTo(1 - 2.19 / 4.21, 12);
      if (s.powerFactor === 1) expect(p.realHeatW / (p.realHeatW + p.realDeliveredW)).toBeCloseTo(p.voltageShareLost, 9);
    }
    // The report's worked example: about 113 V lost at 235 V.
    const at235 = proportional(base, { ...SCENARIOS[0]!, pathVoltage: 235, current: 55 }, 2.19);
    expect(at235.realVoltageLostV).toBeCloseTo(112.8, 0);
  });

  it("uses only operating points inside the IEC 62196-1 ratings", () => {
    for (const s of SCENARIOS) {
      const maxV = s.kind === "AC" ? REFERENCE_VALUES.acMaxVoltage.value : REFERENCE_VALUES.dcMaxVoltage.value;
      const maxA = s.kind === "AC" ? REFERENCE_VALUES.acMaxCurrent.value : REFERENCE_VALUES.dcMaxCurrent.value;
      expect(s.pathVoltage).toBeLessThanOrEqual(maxV);
      expect(s.current).toBeLessThanOrEqual(maxA);
    }
    expect(deliveredPowerW(SCENARIOS.find((s) => s.id === "ac-22")!)).toBeCloseTo(3 * 230 * 32 * 0.99, 6);
  });

  it("models real contacts with I²R and maps them back to the bench's resolution", () => {
    const s = SCENARIOS.find((x) => x.id === "dc-50")!;
    const rows = contactPhysics(base, s);
    expect(rows.map((r) => r.wearMultiple)).toEqual([...ASSUMPTIONS.wearMultiples]);
    const first = rows[0]!;
    expect(first.resistanceMohm).toBe(0.5);
    expect(first.heatPerContactW).toBeCloseTo(125 ** 2 * 0.0005, 9);
    expect(first.heatTotalW).toBeCloseTo(2 * first.heatPerContactW, 9);
    expect(first.voltageDropMv).toBeCloseTo(62.5, 9);
    expect(first.adcStepMv).toBeCloseTo(4.8828, 3);
    expect(first.temperatureRiseK).toBeNull();
    expect(rows.every((r, i) => i === 0 || r.benchEquivalentDropMv > rows[i - 1]!.benchEquivalentDropMv)).toBe(true);
    expect(contactPhysics(base, s, [1], 2)[0]!.temperatureRiseK).toBeCloseTo(first.heatPerContactW * 2, 9);
  });

  it("builds a table whose references all exist and whose temperature is never invented", () => {
    for (const s of SCENARIOS) {
      for (const c of ["C1", "C2", "C3"] as const) {
        const r = scalingReport(analysis, s.id, c);
        expect(r.rows).toHaveLength(10);
        for (const row of r.rows) for (const id of row.referenceIds) expect(REFERENCES[id]).toBeDefined();
        expect(r.rows.find((x) => x.key === "temperature")!.scaled).toBeNull();
        expect(r.rows.find((x) => x.key === "degradation")!.scaled).toBeNull();
      }
    }
    for (const v of Object.values(REFERENCE_VALUES)) expect(REFERENCES[v.ref]).toBeDefined();
    expect(() => scalingReport(analysis, "nope", "C1")).toThrow(/Unknown scenario/);
  });

  it("produces complete insight cards with no unsupported wording", () => {
    const cards = benchInsights(analysis, scalingReport(analysis, "ac-7", "C1"));
    expect(cards.length).toBeGreaterThanOrEqual(5);
    for (const c of cards) {
      for (const k of ["title", "observed", "evidence", "why", "next"] as const) expect(c[k].length).toBeGreaterThan(10);
      expect(JSON.stringify(c)).not.toMatch(/synthetic|simulated/i);
    }
  });
});

describe("degradation study", () => {
  const unified = parseDatasetText(readFileSync("database/data/unified-evolt-arduino-training-dataset.csv", "utf8"), "csv");

  it("audits how the training dataset's degradation columns were made", () => {
    const audit = auditUnified(unified.rows, unified.headers);
    expect(audit.rows).toBe(1000);
    expect(audit.missingCells).toBe(0);
    expect(audit.duplicateRecordIds).toBe(0);
    expect(audit.lossExceedsConsumption).toBe(35);
    expect(audit.checks.every((c) => c.holds)).toBe(true);
  });

  it("evaluates without leakage between stations or from the future", () => {
    const folds = stationFolds(unified.rows);
    const stationToFold = new Map<string, Set<number>>();
    unified.rows.forEach((r, i) => (stationToFold.get(r.station_code!) ?? stationToFold.set(r.station_code!, new Set()).get(r.station_code!)!).add(folds[i]!));
    for (const set of stationToFold.values()) expect(set.size).toBe(1);

    const study = studyUnifiedDataset(unified.rows, unified.headers);
    const r2 = (id: string) => study.featureSets.find((f) => f.featureSet.id === id)!.results.map((r) => r.ridge.r2);
    expect(Math.min(...r2("definition"))).toBeGreaterThan(0.999);
    expect(Math.max(...r2("no_loss_no_current"))).toBeLessThan(0.05);
    expect(study.deployable).toBe(false);
    expect(study.featureSets[1]!.topWeights[0]!.feature).toMatch(/current|power_consumed/);
  });

  it("has correct regression primitives", () => {
    expect(regressionMetrics([1, 2, 3], [1, 2, 3])).toMatchObject({ mae: 0, rmse: 0, r2: 1 });
    const X = [[1], [2], [3], [4]];
    const m = fitRidge(X, [3, 5, 7, 9], ["x"], 0);
    expect(predictRidge(m, [5])).toBeCloseTo(11, 9);
  });

  it("fits the bench calibration, tests it on held-out data and refuses real-charger voltages", () => {
    const cal = fitBenchCalibration(parsed.records);
    expect(cal.slope).toBeCloseTo(-25, 0);
    expect(cal.intercept).toBeCloseTo(100, 0);
    expect(cal.timeBlocked.mae).toBeLessThan(0.2);
    expect(cal.leaveOneConnectorOut).toHaveLength(3);
    expect(estimateFromBenchVoltage(cal, 4.2).degradationPct).toBe(0);
    expect(estimateFromBenchVoltage(cal, 2.2).degradationPct).toBeCloseTo(45, 0);
    expect(estimateFromBenchVoltage(cal, 0.5).extrapolated).toBe(true);
    expect(() => estimateFromBenchVoltage(cal, 230)).toThrow(/not a bench reading/);
    expect(() => estimateFromBenchVoltage(cal, -1)).toThrow(RangeError);
  });

  it("matches the committed model file exactly (reproducible training)", () => {
    expect(JSON.parse(JSON.stringify(buildReport()))).toEqual(saved);
  });
});
