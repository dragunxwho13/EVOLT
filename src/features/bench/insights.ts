/**
 * Insight cards for the experimental circuit. Each states what was observed, the evidence and
 * calculation, why it matters and what to do next. None asserts a fault from a reading alone.
 */
import { BENCH_RUN } from "@/config/scaling";
import type { BenchAnalysis } from "./analysis";
import type { ScalingReport } from "./scaling";

export interface BenchInsight {
  key: string;
  tone: "info" | "attention";
  title: string;
  observed: string;
  evidence: string;
  why: string;
  next: string;
}

const f = (v: number, d = 2) => Number(v.toFixed(d)).toLocaleString("en-GB");

export function benchInsights(a: BenchAnalysis, s: ScalingReport): BenchInsight[] {
  const out: BenchInsight[] = [];
  const c = a.comparison;
  const list = (pick: (x: BenchAnalysis["connectors"][number]) => string) => a.connectors.map((x) => `${x.connector} ${pick(x)}`).join(", ");

  out.push({
    key: "connectors-differ",
    tone: "attention",
    title: "Each connector needs its own calibration",
    observed: `The connectors have different loads (${list((x) => `${f(x.loadOhm, 0)} Ω`)}) and different healthy levels (${list((x) => `${f(x.referenceV, 3)} V`)}): a ${f(c.referenceSpreadPct * 100, 1)} % spread.`,
    evidence: `Load = median V ÷ I; healthy level V_ref = median V ÷ (1 − degradation/100) — the log's own definition, ${BENCH_RUN.degradationDefinition}.`,
    why: `Reading all three against one shared healthy level would misstate degradation by about ${f(c.pooledReferenceError, 1)} points (median). A voltage only means something relative to that connector's own healthy level.`,
    next: "Record each connector's healthy voltage when it is installed (a commissioning sweep) and judge later readings against it. EVOLT's model does exactly this.",
  });

  out.push({
    key: "sweeps",
    tone: "info",
    title: "The run sweeps every connector through its full range, repeatedly",
    observed: `Each connector goes from near-healthy to an open circuit and back: ${list((x) => (x.sweepPeriodS ? `every ${f(x.sweepPeriodS, 1)} s` : "once"))}. Open circuit (0 V) takes up ${list((x) => `${f(x.openShare * 100, 0)} %`)} of the readings.`,
    evidence: `${a.timeSteps} time steps every ${f(a.stepS, 1)} s from ${f(a.startS, 1)} s to ${f(a.endS, 1)} s; a sweep is counted from one open-circuit episode to the next.`,
    why: "Repeated full-range sweeps are good calibration data: the whole voltage–degradation curve is seen several times on every connector, so the model can be tested on sweeps it never saw. They are a controlled stress pattern, not natural wear, so they give no wear rate.",
    next: "Add a slow, one-way wear test (many mating cycles, readings over hours or days) to measure how fast degradation actually builds up.",
  });

  const p = s.proportional;
  out.push({
    key: "fault-scale",
    tone: "attention",
    title: `At charger scale, a ${s.levelPct} % bench state is a serious fault`,
    observed: `On ${s.connector}, scaled to ${s.scenario.label}, the ${s.levelPct} % state would lose ${f(p.realVoltageLostV, 0)} V and turn ${f(p.realHeatW / 1000, 2)} kW into heat in the connector.`,
    evidence: `Method A: same resistance ratio as the bench (extra ${f(p.benchExtraOhm, 0)} Ω on a ${f(s.rows.find((r) => r.key === "load")?.bench ?? 0, 0)} Ω load), × k_R ${s.factors.kR.toExponential(2)}; heat = I² × R per path.`,
    why: "A real contact wasting this much would overheat long before it reached this state. The bench shows the direction and shape of the effect (more resistance → lower voltage), not the size of real wear.",
    next: "Treat the bench as a test of the detection idea. Model gradual wear with small, stepped resistances.",
  });

  const first = s.physics.find((r) => r.detectableOnBench);
  out.push({
    key: "resolution",
    tone: "info",
    title: "Early real-world wear is below the bench's resolution",
    observed: first
      ? `A real contact only moves ${s.connector}'s reading by one ${f(s.physics[0]!.adcStepMv, 1)} mV ADC step at about ${first.wearMultiple} × the new-contact maximum (${f(first.resistanceMohm, 1)} mΩ) in this scenario.`
      : `No wear level up to ${s.physics[s.physics.length - 1]!.wearMultiple} × the new-contact maximum would move the bench reading by one ADC step (${f(s.physics[0]!.adcStepMv, 1)} mV).`,
    evidence: `Method B: R = ${s.physics[0]!.resistanceMohm} mΩ (datasheet maximum) × wear multiple, mapped back with ÷ k_R and the bench's voltage divider.`,
    why: "Gradual, real-world wear changes resistance by milliohms; a 10-bit ADC on this circuit cannot see the early stage of it.",
    next: "Measure contact resistance directly with a four-wire (milliohm) method, or amplify the voltage across the connector before the ADC.",
  });

  out.push({
    key: "formula",
    tone: "info",
    title: "Degradation is calculated from voltage, not measured separately",
    observed: `Logged degradation matches ${BENCH_RUN.degradationDefinition} within ${f(Math.max(...a.connectors.map((x) => x.formulaMaxDeviation ?? 0)), 2)} points on every connector, and current follows V ÷ R_load.`,
    evidence: "Largest |logged − formula| over conducting readings, using each connector's measured V_ref; median V ÷ I per connector.",
    why: "The bench has one independent signal — voltage. Any model trained on its degradation column rediscovers this definition; what the data does show is that the reference must be per connector.",
    next: "Add an independent current sensor and a temperature sensor on each connector.",
  });
  return out;
}
