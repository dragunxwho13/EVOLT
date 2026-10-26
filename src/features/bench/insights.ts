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
  out.push({
    key: "connectors-alike",
    tone: "info",
    title: "The three connectors behave almost identically",
    observed: `At the same instants, C1, C2 and C3 differ by ${f(c.meanDegradationGap, 2)} percentage points of degradation and ${f(c.meanVoltageGap * 1000, 1)} mV on average.`,
    evidence: "Mean over time steps of (largest − smallest) reading across the three connectors, live steps only.",
    why: "With no contrast between connectors, the run cannot show that EVOLT tells a worn connector from a healthy one.",
    next: "Give C1, C2 and C3 different, known series resistances (for example none, medium, high) and repeat the run.",
  });
  if (c.healthyOutlier && c.healthyOutlier.gapPct > 0.01) {
    const o = c.healthyOutlier;
    out.push({
      key: "healthy-outlier",
      tone: "attention",
      title: `${o.connector} reads lower than the others in the healthy window`,
      observed: `${o.connector} averages ${f(o.gapV * 1000, 0)} mV (${f(o.gapPct * 100, 1)} %) below the other two connectors while all three log 0 % degradation.`,
      evidence: "Mean voltage of the rows logged at 0 % degradation, per connector.",
      why: "It is the only connector-specific difference in the run — possibly extra contact resistance, possibly a wiring or ADC-channel offset. One run cannot tell which.",
      next: `Swap ${o.connector} onto another ADC channel and repeat: if the offset follows the connector, inspect its contact; if it stays with the channel, calibrate the channel.`,
    });
  }
  const p = s.proportional;
  out.push({
    key: "fault-scale",
    tone: "attention",
    title: "At charger scale, the bench's worn state is a fault, not wear",
    observed: `Scaled to ${s.scenario.label}, the worn state would lose ${f(p.realVoltageLostV, 0)} V and turn ${f(p.realHeatW / 1000, 2)} kW into heat in the connector.`,
    evidence: `Method A: same resistance ratio as the bench (extra ${f(p.benchExtraOhm, 0)} Ω on a ${f(a.circuit.loadOhm, 0)} Ω load), × k_R ${s.factors.kR.toExponential(2)}; heat = I² × R per path.`,
    why: "A real contact that wasted this much would melt; the bench proves the direction of the effect (more resistance → lower voltage), not its size.",
    next: "Present the bench as a stress test of the detection idea. Use stepped, small resistances to model gradual wear.",
  });
  const first = s.physics.find((r) => r.detectableOnBench);
  out.push({
    key: "resolution",
    tone: "info",
    title: "Realistic wear is below the bench's resolution",
    observed: first
      ? `A real contact only becomes visible on the bench's ${f(s.physics[0]!.adcStepMv, 1)} mV ADC step at about ${first.wearMultiple} × the new-contact maximum (${f(first.resistanceMohm, 1)} mΩ) in this scenario.`
      : `No wear level up to ${s.physics[s.physics.length - 1]!.wearMultiple} × the new-contact maximum would move the bench reading by one ADC step (${f(s.physics[0]!.adcStepMv, 1)} mV).`,
    evidence: `Method B: R = ${s.physics[0]!.resistanceMohm} mΩ (datasheet maximum) × wear multiple, mapped back with ÷ k_R and the bench's voltage divider.`,
    why: "Gradual, real-world wear changes resistance by milliohms; a 10-bit ADC on this circuit cannot see the early stage of it.",
    next: "Measure contact resistance directly with a four-wire (milliohm) method, or amplify the voltage across the connector before the ADC.",
  });
  const unreported = a.connectors.reduce((n, x) => n + x.counts.unreported, 0);
  out.push({
    key: "formula",
    tone: "info",
    title: "Degradation is calculated from voltage, not measured separately",
    observed: `Logged degradation matches 100 × (1 − V ÷ ${BENCH_RUN.degradationReferenceV} V) within ${f(Math.max(...a.connectors.map((x) => x.formulaMaxDeviation ?? 0)), 2)} points; current equals V ÷ ${f(a.circuit.loadOhm, 0)} Ω.`,
    evidence: "Largest |logged − formula| over readings at or below 4.0 V; median V ÷ I over live readings.",
    why: "The bench has one independent signal — voltage. A model trained on its degradation column can only rediscover the formula.",
    next: "Add an independent current sensor and a temperature sensor on each connector.",
  });
  if (unreported > 0) {
    out.push({
      key: "unreported",
      tone: "attention",
      title: "The deepest voltage sag has no degradation logged",
      observed: `${unreported} readings (${unreported / 3} per connector) have a voltage but a blank degradation value — the lowest voltages of the run.`,
      evidence: "Rows with V > 0 and an empty degradation cell. They are kept blank; nothing is filled in.",
      why: "The most important region of the run is the least documented.",
      next: "Log degradation wherever voltage is logged, including above 50 %.",
    });
  }
  return out;
}
