import { z } from "zod";
import { DEFAULT_SCENARIO, SCENARIOS } from "@/config/scaling";
import { analyzeBench } from "@/features/bench/analysis";
import { findScenario, proportional } from "@/features/bench/scaling";
import { loadBenchRecords, savedCalibration } from "@/features/bench/service";
import { estimateFromBenchVoltage } from "@/features/learning/degradation";
import { validationError } from "@/lib/errors";
import { dynamicGet, json } from "@/lib/http/route";

const query = z
  .object({
    voltage: z.coerce.number(),
    connector: z.enum(["C1", "C2", "C3"]).default("C1"),
    scenario: z.enum(SCENARIOS.map((s) => s.id) as [string, ...string[]]).default(DEFAULT_SCENARIO),
  })
  .strict();

/**
 * Inference with the saved bench calibration: a bench (experimental-scale) voltage → the
 * bench's degradation index, plus what that state would mean at charger scale (Method A).
 */
export const GET = dynamicGet(async (request: Request) => {
  const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  let estimate;
  try {
    estimate = estimateFromBenchVoltage(savedCalibration, q.voltage);
  } catch (err) {
    throw validationError(err instanceof Error ? err.message : "Invalid voltage.");
  }
  const { records } = await loadBenchRecords();
  const analysis = analyzeBench(records);
  const c = analysis.connectors.find((x) => x.connector === q.connector)!;
  const scenario = findScenario(q.scenario);
  const realWorld =
    q.voltage > 0 && c.healthyMeanV !== null && c.healthyMeanMa !== null && q.voltage < c.healthyMeanV
      ? proportional({ loadOhm: c.loadOhm, healthyV: c.healthyMeanV, healthyMa: c.healthyMeanMa, degradedV: q.voltage }, scenario, q.voltage)
      : null;
  return json({
    input: { voltageV: q.voltage, scale: "experimental", connector: q.connector, scenario: scenario.id },
    estimate,
    model: { intercept: savedCalibration.intercept, slope: savedCalibration.slope, heldOutMae: savedCalibration.timeBlocked.mae },
    realWorld,
    note: "Degradation % is the bench's own index (a property of its voltage reference). The real-world values are a proportional (Method A) scaling, not charger telemetry.",
  });
});
