import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ASSUMPTIONS, BENCH_RUN, REFERENCE_VALUES, REFERENCES, SCENARIOS } from "@/config/scaling";
import { analyzeBench, extraResistanceAtLevel, voltageAtLevel } from "@/features/bench/analysis";
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

describe("raw bench data (run 2)", () => {
  it("is the checksummed file, converted cell for cell from the raw workbook", () => {
    expect(createHash("sha256").update(benchText).digest("hex")).toBe(sums["arduino-bench-run-2.csv"]);
    expect(createHash("sha256").update(readFileSync(BENCH_RUN.rawFile)).digest("hex")).toBe(sums["raw/arduino-bench-run-2.xlsx"]);
    expect(parsed.rows).toBe(127);
    expect(parsed.records).toHaveLength(381);
    const at = (c: string, t: number) => parsed.records.find((r) => r.connector === c && r.timeS === t)!;
    expect(at("C1", 1.2)).toMatchObject({ voltageV: 0, currentMa: 0, degradationPct: 100 });
    expect(at("C2", 1.2)).toMatchObject({ voltageV: 0.81, currentMa: 2.3, degradationPct: 73.5 });
    expect(at("C3", 1.2)).toMatchObject({ voltageV: 3.06, currentMa: 8, degradationPct: 4 });
    expect(at("C1", 64.2)).toMatchObject({ voltageV: 0.64, currentMa: 1.3, degradationPct: 81.4 });
    expect(parsed.records.filter((r) => r.degradationPct === null)).toHaveLength(0);
  });

  it("refuses malformed logs instead of guessing", () => {
    expect(() => parseBenchCsv("Time_s,Connector1_V\n1,2")).toThrow(/missing column/);
    const head = "Time_s,Connector1_V,Connector1_mA,Connector1_Deg_%,Connector2_V,Connector2_mA,Connector2_Deg_%,Connector3_V,Connector3_mA,Connector3_Deg_%";
    expect(() => parseBenchCsv(`${head}\n1,1,1,,1,1,,1,1,\n1,1,1,,1,1,,1,1,`)).toThrow(/duplicate/);
    expect(() => parseBenchCsv(`${head}\n1,x,1,,1,1,,1,1,`)).toThrow(/not a number/);
    expect(() => parseBenchCsv(`${head}\n1,,1,,1,1,,1,1,`)).toThrow(/missing/);
    // The earlier log's column names are not accepted.
    expect(() => parseBenchCsv("Time_s,C1_V,C1_mA,C1_Deg_pct,C2_V,C2_mA,C2_Deg_pct,C3_V,C3_mA,C3_Deg_pct\n1,1,1,0,1,1,0,1,1,0")).toThrow(/missing column/);
  });
});

describe("experimental-circuit analysis", () => {
  it("covers the run's time span on a 0.5 s step", () => {
    expect(analysis).toMatchObject({ timeSteps: 127, startS: 1.2, endS: 64.2, stepS: 0.5 });
  });

  it("measures each connector's own load and healthy level (checked independently with pandas)", () => {
    const [c1, c2, c3] = analysis.connectors;
    expect(c1!.loadOhm).toBeCloseTo(493, 0);
    expect(c2!.loadOhm).toBeCloseTo(350, 0);
    expect(c3!.loadOhm).toBeCloseTo(388.2, 0);
    expect(c1!.referenceV).toBeCloseTo(3.455, 3);
    expect(c2!.referenceV).toBeCloseTo(3.067, 3);
    expect(c3!.referenceV).toBeCloseTo(3.193, 3);
    for (const c of analysis.connectors) {
      expect(c.healthyMa).toBeCloseTo((c.referenceV / c.loadOhm) * 1000, 9);
      expect(c.formulaMaxDeviation!).toBeLessThan(0.5);
    }
  });

  it("finds the repeated sweeps and the open-circuit readings", () => {
    const [c1, c2, c3] = analysis.connectors;
    expect([c1!.counts.open_circuit, c2!.counts.open_circuit, c3!.counts.open_circuit]).toEqual([28, 24, 15]);
    expect([c1!.sweeps, c2!.sweeps, c3!.sweeps]).toEqual([5, 3, 3]);
    expect([c1!.sweepPeriodS, c2!.sweepPeriodS, c3!.sweepPeriodS]).toEqual([15, 20, 22.5]);
    for (const c of analysis.connectors) {
      const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
      expect(total).toBe(127);
      expect(c.counts.unreported).toBe(0);
    }
  });

  it("shows why one shared healthy level would be wrong", () => {
    expect(analysis.comparison.lowestReference).toBe("C2");
    expect(analysis.comparison.highestReference).toBe("C1");
    expect(analysis.comparison.referenceSpreadV).toBeCloseTo(3.455 - 3.067, 2);
    expect(analysis.comparison.pooledReferenceError).toBeCloseTo(1.664, 2); // pandas: 1.6636
  });

  it("maps a degradation level to a bench voltage and an extra resistance", () => {
    const c1 = analysis.connectors[0]!;
    expect(voltageAtLevel(c1, 50)).toBeCloseTo(c1.referenceV / 2, 12);
    expect(extraResistanceAtLevel(c1, 50)).toBeCloseTo(c1.loadOhm, 9);
    expect(extraResistanceAtLevel(c1, 75)).toBeCloseTo(3 * c1.loadOhm, 9);
  });
});

describe("real-world scaling", () => {
  const c1 = analysis.connectors[0]!;
  const base = { loadOhm: c1.loadOhm, healthyV: c1.referenceV, healthyMa: c1.healthyMa, degradedV: voltageAtLevel(c1, 50) };

  it("scales each quantity by its own law", () => {
    for (const s of SCENARIOS) {
      const f = scaleFactors(base, s);
      expect(f.kV).toBeCloseTo(s.pathVoltage / c1.referenceV, 9);
      expect(f.kI).toBeCloseTo(s.current / (c1.healthyMa / 1000), 6);
      expect(f.kR).toBeCloseTo(f.kV / f.kI, 12);
      expect(f.kP).toBeCloseTo(f.kV * f.kI, 6);
    }
  });

  it("keeps Ohm's law, I²R and dimensionless shares consistent after scaling", () => {
    for (const s of SCENARIOS) {
      const p = proportional(base, s, base.degradedV);
      expect(p.realVoltageLostV).toBeCloseTo(p.realCurrentA * p.realExtraOhm, 6);
      expect(p.realHeatW).toBeCloseTo(s.paths * p.realCurrentA ** 2 * p.realExtraOhm, 6);
      expect(p.voltageShareLost).toBeCloseTo(0.5, 12);
      if (s.powerFactor === 1) expect(p.realHeatW / (p.realHeatW + p.realDeliveredW)).toBeCloseTo(p.voltageShareLost, 9);
    }
    // At 50 % the connector takes half the path voltage, so its extra resistance equals the load.
    const ac7 = proportional(base, SCENARIOS[0]!, base.degradedV);
    expect(ac7.realVoltageLostV).toBeCloseTo(115, 9);
    expect(ac7.realExtraOhm).toBeCloseTo(ac7.realLoadOhm, 9);
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
        for (const level of BENCH_RUN.scalingLevelsPct) {
          const r = scalingReport(analysis, s.id, c, level);
          expect(r.rows).toHaveLength(10);
          expect(r.rows.find((x) => x.key === "degradation")!.bench).toBe(level);
          expect(r.proportional.voltageShareLost).toBeCloseTo(level / 100, 9);
        }
        const r = scalingReport(analysis, s.id, c);
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

  it("fits the relative-voltage model and shows it beats simpler models on unseen data", () => {
    const cal = fitBenchCalibration(parsed.records);
    expect(cal.kind).toBe("bench_relative_voltage");
    expect(cal.intercept).toBeCloseTo(100, 0);
    expect(cal.slope).toBeCloseTo(-100, 0);
    expect(cal.fittedOn).toBe(314); // conducting readings below 100 %
    const lso = cal.evaluation.leaveOneSweepOut;
    expect(lso.relativeVoltage.mae).toBeLessThan(0.15);
    expect(lso.pooledVoltage.mae).toBeGreaterThan(2);
    expect(lso.relativeVoltage.mae).toBeLessThan(lso.pooledVoltage.mae / 10);
    expect(cal.evaluation.leaveOneConnectorOut).toHaveLength(3);
    for (const l of cal.evaluation.leaveOneConnectorOut) {
      expect(l.relativeVoltage.mae).toBeLessThan(0.2);
      expect(l.relativeVoltage.mae).toBeLessThan(l.pooledVoltage.mae);
      // Commissioning uses only the first sweep, and lands close to the full-run reference.
      expect(l.commissioningReferenceV).toBeCloseTo(cal.references[l.connector], 1);
    }
  });

  it("estimates per connector, for a new connector, and refuses real-charger voltages", () => {
    const cal = fitBenchCalibration(parsed.records);
    const half = estimateFromBenchVoltage(cal, cal.references.C2 / 2, { connector: "C2" });
    expect(half.degradationPct).toBeCloseTo(50, 0);
    // The same voltage means different degradation on different connectors.
    const v = 1.7;
    const d1 = estimateFromBenchVoltage(cal, v, { connector: "C1" }).degradationPct;
    const d2 = estimateFromBenchVoltage(cal, v, { connector: "C2" }).degradationPct;
    expect(d1 - d2).toBeGreaterThan(5);
    expect(estimateFromBenchVoltage(cal, 3.3, { referenceV: 3.3 })).toMatchObject({ degradationPct: 0, aboveReference: true });
    expect(estimateFromBenchVoltage(cal, 3.6, { connector: "C1" }).aboveReference).toBe(true);
    expect(estimateFromBenchVoltage(cal, 0.02, { connector: "C1" }).extrapolated).toBe(true);
    expect(() => estimateFromBenchVoltage(cal, 230, { connector: "C1" })).toThrow(/not a bench reading/);
    expect(() => estimateFromBenchVoltage(cal, -1, { connector: "C1" })).toThrow(RangeError);
    expect(() => estimateFromBenchVoltage(cal, 1, { referenceV: 0 })).toThrow(RangeError);
    expect(() => estimateFromBenchVoltage(cal, 1, { referenceV: 230 })).toThrow(RangeError);
  });

  it("matches the committed model file exactly (reproducible training)", () => {
    expect(JSON.parse(JSON.stringify(buildReport()))).toEqual(saved);
  });
});
