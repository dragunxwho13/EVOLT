import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { seededRandom } from "@/features/anomaly-detection/stats";
import { confusionMatrix, fitThreshold, predictThreshold, stratifiedFolds, type Sample } from "@/features/learning/models";
import { buildFeatures, predict, trainTarget } from "@/features/learning/train";

function synthetic(n: number, seed: number, informative: boolean): Sample[] {
  const rand = seededRandom(seed);
  return Array.from({ length: n }, () => {
    const signal = rand() * 5;
    const noise = rand() * 10;
    const y = informative ? (signal < 1.5 ? "Low" : signal < 3.5 ? "Medium" : "High") : ["Low", "Medium", "High"][Math.floor(rand() * 3)]!;
    return { x: { signal, noise }, y };
  });
}

describe("threshold model", () => {
  it("recovers the true cut points and ordering on a cleanly separable label", () => {
    const data = synthetic(600, 1, true);
    const m = fitThreshold(data, ["signal", "noise"], ["High", "Low", "Medium"])!;
    expect(m.feature).toBe("signal");
    expect(m.order).toEqual(["Low", "Medium", "High"]);
    expect(m.cuts[0]).toBeCloseTo(1.5, 1);
    expect(m.cuts[1]).toBeCloseTo(3.5, 1);
    expect(predictThreshold(m, { signal: 0.2, noise: 0 })).toBe("Low");
    expect(predictThreshold(m, { signal: 4.9, noise: 0 })).toBe("High");
    expect(JSON.parse(JSON.stringify(m)).cuts.every(Number.isFinite)).toBe(true);
  });
});

describe("evaluation", () => {
  it("builds stratified folds that keep class proportions", () => {
    const data = synthetic(300, 2, true);
    const folds = stratifiedFolds(data, 5, 7);
    for (let f = 0; f < 5; f++) {
      const fold = data.filter((_, i) => folds[i] === f);
      expect(fold.length).toBeGreaterThanOrEqual(58);
      expect(fold.length).toBeLessThanOrEqual(62);
    }
    expect(stratifiedFolds(data, 5, 7)).toEqual(folds);
  });

  it("computes confusion matrices with true classes as rows", () => {
    expect(confusionMatrix(["a", "a", "b"], ["a", "b", "b"], ["a", "b"])).toEqual([
      [1, 1],
      [0, 1],
    ]);
  });

  it("reports a learnable label with high held-out accuracy", () => {
    const r = trainTarget("level", synthetic(500, 3, true), ["signal", "noise"]);
    expect(r.learnable).toBe(true);
    expect(r.best).toBe("threshold");
    expect(r.evaluations[1]!.accuracy).toBeGreaterThan(0.95);
    expect(r.finalModel).not.toBeNull();
    expect(predict(r.finalModel!, { signal: 0.5, noise: 3 })).toBe("Low");
  });

  it("refuses to claim accuracy for a label that is pure noise", () => {
    const r = trainTarget("random", synthetic(500, 4, false), ["signal", "noise"]);
    expect(r.learnable).toBe(false);
    expect(r.finalModel).toBeNull();
    expect(r.verdict).toMatch(/could not be predicted/);
  });

  it("excludes identifier columns and one-hot encodes categories", () => {
    const { features, vectors } = buildFeatures([
      { values: { ev_id: 1, power_loss: 2 }, area: "Urban", chargingMode: "Fast" },
      { values: { ev_id: 2, power_loss: 3 }, area: "Rural", chargingMode: "V2G" },
    ]);
    expect(features).toEqual(["power_loss", "area=Rural", "area=Urban", "mode=Fast", "mode=V2G"]);
    expect(vectors[0]).toMatchObject({ "area=Urban": 1, "area=Rural": 0 });
  });
});

describe("bundled EV grid dataset", () => {
  const text = readFileSync("public/samples/ev-charging-grid-sessions.csv", "utf8");
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const numeric = ["num_chargers", "voltage_level", "current_flow", "power_consumed", "power_loss", "voltage_fluctuation", "battery_capacity", "charging_time", "charging_power", "charging_cost", "predicted_power_demand", "optimized_charging_power", "grid_stability_score"];
  const rows = data.map((r) => ({ values: Object.fromEntries(numeric.map((c) => [c, Number(r[c])])), area: r.location!, chargingMode: r.charging_type! }));
  const { features, vectors } = buildFeatures(rows);

  it("learns the power-loss category from power loss alone (~92%, matching scikit-learn's ~91%)", () => {
    const r = trainTarget("reduced_power_loss_category", vectors.map((x, i) => ({ x, y: data[i]!.reduced_power_loss_category! })), features);
    expect(r.learnable).toBe(true);
    expect(r.thresholdModel!.feature).toBe("power_loss");
    expect(r.thresholdModel!.order).toEqual(["Low", "Medium", "High"]);
    const acc = r.evaluations.find((e) => e.model === r.best)!.accuracy;
    expect(acc).toBeGreaterThan(0.89);
    expect(acc).toBeLessThan(0.95);
  });

  it("finds the voltage-stability category unpredictable", () => {
    const r = trainTarget("voltage_stability_category", vectors.map((x, i) => ({ x, y: data[i]!.voltage_stability_category! })), features);
    expect(r.learnable).toBe(false);
    expect(Math.max(...r.evaluations.slice(1).map((e) => e.accuracy))).toBeLessThan(r.baselineAccuracy + 0.05);
  });
});
