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
    /** A new connector's healthy (0 %) voltage, from its commissioning sweep. Overrides `connector`'s reference. */
    referenceV: z.coerce.number().optional(),
    scenario: z.enum(SCENARIOS.map((s) => s.id) as [string, ...string[]]).default(DEFAULT_SCENARIO),
  })
  .strip();

/**
 * Inference with the saved bench model: a bench (experimental-scale) voltage → the bench's
 * degradation index, using the connector's own healthy reference (or one supplied for a new
 * connector), plus what that state would mean at charger scale (Method A).
 */
export const GET = dynamicGet(async (request: Request) => {
  const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  let estimate;
  try {
    estimate = estimateFromBenchVoltage(savedCalibration, q.voltage, q.referenceV !== undefined ? { referenceV: q.referenceV } : { connector: q.connector });
  } catch (err) {
    throw validationError(err instanceof Error ? err.message : "Invalid voltage.");
  }
  const { records } = await loadBenchRecords();
  const c = analyzeBench(records).connectors.find((x) => x.connector === q.connector)!;
  const scenario = findScenario(q.scenario);
  // Method A needs a load as well as a reference; it uses the chosen bench connector's load.
  const realWorld =
    q.voltage > 0 && !estimate.aboveReference
      ? proportional({ loadOhm: c.loadOhm, healthyV: estimate.referenceV, healthyMa: (estimate.referenceV / c.loadOhm) * 1000, degradedV: q.voltage }, scenario, q.voltage)
      : null;
  return json({
    input: { voltageV: q.voltage, scale: "experimental", connector: q.connector, referenceV: estimate.referenceV, customReference: q.referenceV !== undefined, scenario: scenario.id },
    estimate,
    model: {
      intercept: savedCalibration.intercept,
      slope: savedCalibration.slope,
      heldOutMae: savedCalibration.evaluation.leaveOneSweepOut.relativeVoltage.mae,
    },
    realWorld,
    note: "Degradation % is the bench's own index, relative to the connector's healthy level. The real-world values are a proportional (Method A) scaling, not charger telemetry.",
  });
});
