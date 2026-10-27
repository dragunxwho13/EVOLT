/**
 * From the Arduino bench to a representative charger — parameter by parameter.
 *
 * The bench is a resistive voltage divider: supply → connector (extra series resistance when
 * worn) → fixed load. Each connector has its own load and its own healthy reference voltage
 * V_ref (both measured from the log). Each quantity is scaled by the relationship that governs
 * it, never by one common multiplier:
 *
 *   k_V = V_path / V_ref                voltage across one current path
 *   k_I = I_rated / I_healthy           current in one conductor
 *   k_R = k_V / k_I                     resistance (Ohm's law: R = V / I)
 *   k_P = k_V × k_I                     power per path (P = V × I)
 *   energy = power × time               time is a chosen session length, not scaled
 *   ratios (degradation %, loss share)  dimensionless → unchanged by scaling
 *
 * Two methods answer different questions:
 *  A. Proportional (similarity): keep the bench's resistance RATIO at a chosen level of the
 *     degradation index and enlarge it. Answers "what would that bench state look like at
 *     charger size?"
 *  B. Contact physics: start from a published new-contact resistance and wear multiples, use
 *     the charger's controlled current (P = I²R, ΔV = I·R), and map back to what the bench
 *     would read. Answers "what does real wear look like, and could the bench see it?"
 *
 * AC: RMS current; I²R heating does not depend on power factor; delivered power does
 * (P = V × I × PF per phase). Balanced three-phase: three line contacts carry full current and
 * the neutral ≈ 0. DC: two power contacts (DC+ and DC−). Temperature rise is only estimated
 * when a calibrated thermal resistance is configured.
 */
import { ASSUMPTIONS, BENCH_RUN, REFERENCE_VALUES, REFERENCES, SCENARIOS, type Scenario } from "@/config/scaling";
import { voltageAtLevel, type BenchAnalysis, type ConnectorSummary } from "./analysis";
import type { BenchConnector } from "./parse";

export interface CircuitBaseline {
  loadOhm: number;
  healthyV: number;
  healthyMa: number;
  degradedV: number;
}

export interface Factors {
  kV: number;
  kI: number;
  kR: number;
  kP: number;
}

export function scaleFactors(base: CircuitBaseline, s: Scenario): Factors {
  const kV = s.pathVoltage / base.healthyV;
  const kI = s.current / (base.healthyMa / 1000);
  return { kV, kI, kR: kV / kI, kP: kV * kI };
}

export function findScenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scenario "${id}".`);
  return s;
}

/** Real power delivered with a healthy path (W). */
export function deliveredPowerW(s: Scenario): number {
  return s.paths * s.pathVoltage * s.current * s.powerFactor;
}

export interface ProportionalResult {
  benchV: number;
  /** Share of the path voltage lost in the connector (dimensionless, = bench share). */
  voltageShareLost: number;
  benchExtraOhm: number;
  realExtraOhm: number;
  realLoadOhm: number;
  /** Current with the divider's added resistance: I_rated × V / V_healthy. */
  realCurrentA: number;
  realVoltageLostV: number;
  /** I²R heat in the added resistance, summed over the scenario's current paths (W). */
  realHeatW: number;
  realDeliveredW: number;
  benchHeatMw: number;
}

/** Method A for a single bench voltage (e.g. the voltage at a chosen degradation level). */
export function proportional(base: CircuitBaseline, s: Scenario, benchV: number): ProportionalResult {
  const ratio = benchV / base.healthyV;
  const benchExtraOhm = base.loadOhm * (base.healthyV / benchV - 1);
  const realLoadOhm = s.pathVoltage / s.current;
  // Similarity keeps the resistance RATIO (extra ÷ load), applied to the real path's load so that
  // Ohm's law holds exactly at charger scale (≈ benchExtraOhm × k_R; they differ only by how
  // closely the measured load matches V_healthy ÷ I_healthy).
  const realExtraOhm = realLoadOhm * (base.healthyV / benchV - 1);
  const realCurrentA = s.current * ratio;
  const benchCurrentA = (base.healthyMa / 1000) * ratio;
  return {
    benchV,
    voltageShareLost: 1 - ratio,
    benchExtraOhm,
    realExtraOhm,
    realLoadOhm,
    realCurrentA,
    realVoltageLostV: s.pathVoltage * (1 - ratio),
    realHeatW: s.paths * realCurrentA ** 2 * realExtraOhm,
    realDeliveredW: s.paths * realCurrentA * s.pathVoltage * ratio * s.powerFactor,
    benchHeatMw: benchCurrentA ** 2 * benchExtraOhm * 1000,
  };
}

export interface ContactPhysicsRow {
  wearMultiple: number;
  resistanceMohm: number;
  voltageDropMv: number;
  heatPerContactW: number;
  heatTotalW: number;
  shareOfDelivered: number;
  energyPerSessionWh: number;
  /** What the bench would read for the same resistance ratio: drop below the healthy level (mV). */
  benchEquivalentDropMv: number;
  /** One step of the bench ADC (mV). */
  adcStepMv: number;
  detectableOnBench: boolean;
  /** Only when a calibrated thermal resistance is configured. */
  temperatureRiseK: number | null;
}

/** Method B: published new-contact resistance × wear multiples, at the scenario's current. */
export function contactPhysics(
  base: CircuitBaseline,
  s: Scenario,
  multiples: readonly number[] = ASSUMPTIONS.wearMultiples,
  thermalKPerW: number | null = ASSUMPTIONS.contactThermalResistanceKPerW,
): ContactPhysicsRow[] {
  const f = scaleFactors(base, s);
  const newMohm = REFERENCE_VALUES.newContactResistanceMaxMohm.value;
  const adcStepMv = (BENCH_RUN.adcReferenceV / 2 ** BENCH_RUN.adcBits) * 1000;
  const delivered = deliveredPowerW(s);
  return multiples.map((m) => {
    const R = (newMohm * m) / 1000;
    const perContact = s.current ** 2 * R;
    const total = perContact * s.currentContacts;
    const benchR = R / f.kR;
    const benchV = (base.healthyV * base.loadOhm) / (base.loadOhm + benchR);
    const dropMv = (base.healthyV - benchV) * 1000;
    return {
      wearMultiple: m,
      resistanceMohm: newMohm * m,
      voltageDropMv: s.current * R * 1000,
      heatPerContactW: perContact,
      heatTotalW: total,
      shareOfDelivered: total / delivered,
      energyPerSessionWh: total * ASSUMPTIONS.sessionHours,
      benchEquivalentDropMv: dropMv,
      adcStepMv,
      detectableOnBench: dropMv >= adcStepMv,
      temperatureRiseK: thermalKPerW === null ? null : perContact * thermalKPerW,
    };
  });
}

export type Layer = "experimental" | "estimate" | "reference";

export interface ScalingRow {
  key: string;
  parameter: string;
  unit: { bench: string; real: string };
  bench: number | null;
  benchNote?: string;
  method: string;
  scaled: number | null;
  scaledNote?: string;
  reference: string | null;
  referenceIds: string[];
  difference: string | null;
}

const fmt = (v: number, d = 2) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-GB") : Number(v.toFixed(d)).toString());

function lossRange(s: Scenario): { range: [number, number]; label: string } {
  return s.kind === "DC"
    ? { range: REFERENCE_VALUES.dcLossPct.value, label: "DC fast charging, whole chain" }
    : { range: REFERENCE_VALUES.wallboxLossPct.value, label: "11 kW AC wallbox, whole chain" };
}

/**
 * The comparison table for one connector in one scenario. Bench values are that connector's
 * own measurements; references are only the published figures in REFERENCES.
 */
export function baselineAt(summary: ConnectorSummary, levelPct: number): CircuitBaseline {
  return { loadOhm: summary.loadOhm, healthyV: summary.referenceV, healthyMa: summary.healthyMa, degradedV: voltageAtLevel(summary, levelPct) };
}

export function scalingTable(summary: ConnectorSummary, s: Scenario, levelPct: number): ScalingRow[] {
  if (!Number.isFinite(summary.referenceV) || !Number.isFinite(summary.loadOhm) || levelPct <= 0 || levelPct >= 100) return [];
  const base = baselineAt(summary, levelPct);
  const f = scaleFactors(base, s);
  const p = proportional(base, s, base.degradedV);
  const newMohm = REFERENCE_VALUES.newContactResistanceMaxMohm.value;
  const newHeatW = s.current ** 2 * (newMohm / 1000);
  const maxV = s.kind === "AC" ? REFERENCE_VALUES.acMaxVoltage.value : REFERENCE_VALUES.dcMaxVoltage.value;
  const maxA = s.kind === "AC" ? REFERENCE_VALUES.acMaxCurrent.value : REFERENCE_VALUES.dcMaxCurrent.value;
  const loss = lossRange(s);
  const deliveredKwh = (deliveredPowerW(s) * ASSUMPTIONS.sessionHours) / 1000;
  const benchCurrentDeg = (base.healthyMa / 1000) * (base.degradedV / base.healthyV);
  const benchHeatMw = p.benchHeatMw;
  const thermal = ASSUMPTIONS.contactThermalResistanceKPerW;

  return [
    {
      key: "voltage",
      parameter: "Voltage across one current path (healthy, 0 %)",
      unit: { bench: "V", real: "V" },
      bench: base.healthyV,
      benchNote: "The connector's own reference V_ref, from the log's definition",
      method: `× k_V = ${fmt(f.kV, 1)} (${s.pathVoltage} V ÷ ${fmt(base.healthyV, 3)} V)`,
      scaled: s.pathVoltage,
      reference: `IEC 62196-1 maximum ${s.kind}: ${fmt(maxV)} V`,
      referenceIds: ["iec62196"],
      difference: `${fmt((s.pathVoltage / maxV) * 100, 0)} % of the ${s.kind} maximum`,
    },
    {
      key: "current",
      parameter: "Current in one conductor (healthy, 0 %)",
      unit: { bench: "mA", real: "A" },
      bench: base.healthyMa,
      benchNote: "V_ref ÷ R_load",
      method: `× k_I = ${fmt(f.kI, 0)} (${s.current} A ÷ ${fmt(base.healthyMa, 2)} mA)`,
      scaled: s.current,
      reference:
        s.kind === "DC"
          ? `IEC 62196-1 max ${maxA} A DC; HARTING CCS2 cable 60–200 A; MIDA CCS2 plug 250 A`
          : `IEC 62196-1 max ${maxA} A AC`,
      referenceIds: s.kind === "DC" ? ["iec62196", "harting-ccs2", "mida-ccs2"] : ["iec62196"],
      difference: `${fmt((s.current / maxA) * 100, 0)} % of the IEC maximum`,
    },
    {
      key: "load",
      parameter: "Load resistance (healthy path)",
      unit: { bench: "Ω", real: "Ω" },
      bench: base.loadOhm,
      benchNote: `Median V ÷ I of readings ≥ 1 mA (middle 50 %: ${fmt(summary.loadIqrOhm[0], 0)}–${fmt(summary.loadIqrOhm[1], 0)} Ω)`,
      method: `× k_R = ${f.kR.toExponential(2)} (k_V ÷ k_I)`,
      scaled: base.loadOhm * f.kR,
      reference: null,
      referenceIds: [],
      difference: null,
    },
    {
      key: "extra_resistance",
      parameter: `Extra series resistance at ${levelPct} % degradation`,
      unit: { bench: "Ω", real: "Ω" },
      bench: p.benchExtraOhm,
      benchNote: `R_L × (V_ref ÷ V − 1), V = ${fmt(base.degradedV, 3)} V at ${levelPct} %`,
      method: "Method A: same resistance ratio as the bench (extra ÷ load), ≈ × k_R",
      scaled: p.realExtraOhm,
      reference: `New CCS2 contact: ≤ ${newMohm} mΩ (MIDA datasheet)`,
      referenceIds: ["mida-ccs2"],
      difference: `${fmt(p.realExtraOhm / (newMohm / 1000), 0)} × the new-contact maximum`,
    },
    {
      key: "voltage_lost",
      parameter: `Voltage lost in the connector at ${levelPct} %`,
      unit: { bench: "V", real: "V" },
      bench: base.healthyV - base.degradedV,
      method: "Method A: × k_V",
      scaled: p.realVoltageLostV,
      reference: `At ≤ ${newMohm} mΩ and ${s.current} A: ≤ ${fmt(s.current * newMohm, 1)} mV per contact (I × R)`,
      referenceIds: ["mida-ccs2"],
      difference: `${fmt(p.realVoltageLostV / ((s.current * newMohm) / 1000), 0)} × the new-contact drop`,
    },
    {
      key: "heat",
      parameter: `Heat generated in the connector at ${levelPct} %`,
      unit: { bench: "mW", real: "W" },
      bench: benchHeatMw,
      benchNote: `I² × R_extra with I = ${fmt(benchCurrentDeg * 1000, 2)} mA`,
      method: `Method A: I² × R per path, ${s.paths} path${s.paths > 1 ? "s" : ""} (k_P = ${fmt(f.kP, 0)})`,
      scaled: p.realHeatW,
      reference: `New contact at ${s.current} A: ≤ ${fmt(newHeatW, 2)} W per contact (I² × ${newMohm} mΩ)`,
      referenceIds: ["mida-ccs2"],
      difference: `${fmt(p.realHeatW / (newHeatW * s.paths), 0)} × a new contact`,
    },
    {
      key: "loss_share",
      parameter: "Share of power lost in the connector",
      unit: { bench: "%", real: "%" },
      bench: p.voltageShareLost * 100,
      method: "Dimensionless — unchanged by scaling",
      scaled: (p.realHeatW / (p.realHeatW + p.realDeliveredW)) * 100,
      scaledNote: s.powerFactor < 1 ? `includes PF ${s.powerFactor} on delivered power` : undefined,
      reference: `ADAC: ${loss.range[0]}–${loss.range[1]} % (${loss.label})`,
      referenceIds: ["adac"],
      difference: `${fmt(((p.realHeatW / (p.realHeatW + p.realDeliveredW)) * 100) / loss.range[1], 1)} × the top of the whole-chain range`,
    },
    {
      key: "energy",
      parameter: `Energy lost in the connector per ${ASSUMPTIONS.sessionHours} h session`,
      unit: { bench: "mWh", real: "kWh" },
      bench: benchHeatMw * ASSUMPTIONS.sessionHours,
      benchNote: `bench heat held for ${ASSUMPTIONS.sessionHours} h`,
      method: `Method A heat × ${ASSUMPTIONS.sessionHours} h (time is chosen, not scaled)`,
      scaled: (p.realHeatW * ASSUMPTIONS.sessionHours) / 1000,
      reference: `ADAC whole-chain loss on ${fmt(deliveredKwh, 1)} kWh: ${fmt((deliveredKwh * loss.range[0]) / 100, 2)}–${fmt((deliveredKwh * loss.range[1]) / 100, 2)} kWh`,
      referenceIds: ["adac"],
      difference: null,
    },
    {
      key: "temperature",
      parameter: "Contact temperature rise",
      unit: { bench: "K", real: "K" },
      bench: null,
      benchNote: "Not measured on the bench",
      method: thermal === null ? "Needs a calibrated thermal resistance (K/W); not estimated" : `heat per contact × ${thermal} K/W (configured)`,
      scaled: thermal === null ? null : (p.realHeatW / s.paths) * thermal,
      scaledNote: thermal === null ? "No estimate without thermal calibration" : undefined,
      reference: `Terminal temperature rise < ${REFERENCE_VALUES.terminalTemperatureRiseMaxK.value} K (MIDA datasheet)`,
      referenceIds: ["mida-ccs2"],
      difference: null,
    },
    {
      key: "degradation",
      parameter: "Degradation index (bench definition)",
      unit: { bench: "%", real: "%" },
      bench: levelPct,
      benchNote: `Chosen level; defined as ${BENCH_RUN.degradationDefinition} (V_ref ${fmt(summary.referenceV, 3)} V)`,
      method: "Not scaled: it is a property of the bench's voltage reference, not of charger wear",
      scaled: null,
      scaledNote: "No real-world equivalent",
      reference: "No verified field degradation rate was found",
      referenceIds: [],
      difference: null,
    },
  ];
}

export function referenceList(ids: readonly string[]) {
  return ids.map((id) => REFERENCES[id]).filter((r): r is NonNullable<typeof r> => Boolean(r));
}

export interface ScalingReport {
  scenario: Scenario;
  connector: BenchConnector;
  levelPct: number;
  factors: Factors;
  rows: ScalingRow[];
  physics: ContactPhysicsRow[];
  proportional: ProportionalResult;
}

export function scalingReport(
  analysis: BenchAnalysis,
  scenarioId: string,
  connector: BenchConnector,
  levelPct: number = BENCH_RUN.defaultScalingLevelPct,
): ScalingReport {
  const s = findScenario(scenarioId);
  const summary = analysis.connectors.find((c) => c.connector === connector)!;
  const base = baselineAt(summary, levelPct);
  return {
    scenario: s,
    connector,
    levelPct,
    factors: scaleFactors(base, s),
    rows: scalingTable(summary, s, levelPct),
    physics: contactPhysics(base, s),
    proportional: proportional(base, s, base.degradedV),
  };
}
