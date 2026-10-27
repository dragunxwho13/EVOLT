/**
 * Everything the Arduino-to-real-world scaling depends on, in one documented place.
 *
 * Three kinds of numbers live here and are never mixed:
 *  - BENCH_RUN: where the experimental-circuit log is and how its columns are defined.
 *  - SCENARIOS / ASSUMPTIONS: chosen operating points and modelling assumptions (editable).
 *  - REFERENCES: values published by an identified third party, with the page they came from.
 * Circuit values (each connector's load resistance and healthy reference voltage) are NOT
 * hard-coded: they are measured from the stored bench readings by src/features/bench/analysis.ts.
 */

export const SCALING_VERSION = "2026.10-2";

export const BENCH_RUN = {
  id: "bench-run-2",
  file: "database/data/arduino-bench-run-2.csv",
  rawFile: "database/data/raw/arduino-bench-run-2.xlsx",
  description:
    "Three connectors (C1–C3), each with its own fixed load, logged every 0.5 s from 1.2 s to 64.2 s. Each connector is swept repeatedly from near-healthy to an open circuit and back.",
  /**
   * The log's definition, per connector: degradation % = 100 × (1 − V ÷ V_ref), where V_ref is that
   * connector's healthy (0 %) level. V_ref is not hard-coded: it is measured from the readings.
   */
  degradationDefinition: "100 × (1 − V ÷ V_ref), V_ref = the connector's own healthy level",
  /** Arduino Uno: 10-bit ADC on a 5 V reference. */
  adcReferenceV: 5.0,
  adcBits: 10,
  /** Bands of the logged degradation index, used to describe the readings. */
  healthyBelowPct: 10,
  severeFromPct: 40,
  /** Degradation levels offered for the bench → charger scaling (the bench index, not charger wear). */
  scalingLevelsPct: [10, 25, 50, 75] as const,
  defaultScalingLevelPct: 50,
} as const;

export type ChargerKind = "AC" | "DC";

export interface Scenario {
  id: string;
  label: string;
  kind: ChargerKind;
  /** Voltage across one current path: phase-to-neutral for AC, pack voltage for DC (V). */
  pathVoltage: number;
  /** Current in each current-carrying conductor (A, RMS for AC). */
  current: number;
  /** Number of current paths delivering power (1 single-phase, 3 three-phase, 1 DC). */
  paths: number;
  /** Power contacts carrying the full current: L+N (2), L1–L3 (3, balanced neutral ≈ 0), DC+ and DC− (2). */
  currentContacts: number;
  /** Real/apparent power ratio; 1 for DC. Affects delivered power, not I²R contact heating. */
  powerFactor: number;
  /** Whether the stated current is within the connector ratings in REFERENCES. */
  ratingRefs: string[];
}

/**
 * Representative operating points (assumptions, not measurements). Voltages and currents are
 * common nominal values; all must sit inside the IEC 62196-1 ratings, which the tests check.
 */
export const SCENARIOS: Scenario[] = [
  { id: "ac-7", label: "AC 7.4 kW · single-phase 230 V, 32 A", kind: "AC", pathVoltage: 230, current: 32, paths: 1, currentContacts: 2, powerFactor: 0.99, ratingRefs: ["iec62196"] },
  { id: "ac-22", label: "AC 22 kW · three-phase 400 V, 32 A", kind: "AC", pathVoltage: 230, current: 32, paths: 3, currentContacts: 3, powerFactor: 0.99, ratingRefs: ["iec62196"] },
  { id: "dc-50", label: "DC 50 kW · 400 V, 125 A", kind: "DC", pathVoltage: 400, current: 125, paths: 1, currentContacts: 2, powerFactor: 1, ratingRefs: ["iec62196", "harting-ccs2", "mida-ccs2"] },
  { id: "dc-150", label: "DC 150 kW · 750 V, 200 A", kind: "DC", pathVoltage: 750, current: 200, paths: 1, currentContacts: 2, powerFactor: 1, ratingRefs: ["iec62196", "harting-ccs2", "mida-ccs2"] },
];

export const DEFAULT_SCENARIO = "dc-50";

export const ASSUMPTIONS = {
  /** Session length used to turn power into energy (h). */
  sessionHours: 1,
  /** Illustrative wear levels: multiples of the datasheet maximum for a new contact. Not measured. */
  wearMultiples: [1, 2, 5, 10, 20] as const,
  /** AC power factor when the scenario does not state one. */
  powerFactor: 0.99,
  /**
   * Thermal resistance of a contact to ambient (K/W). No calibrated value exists for this
   * hardware, so temperature rise is NOT estimated. Set it (e.g. from a thermocouple test) to
   * enable the estimate.
   */
  contactThermalResistanceKPerW: null as number | null,
} as const;

export interface Reference {
  id: string;
  title: string;
  publisher: string;
  url: string;
  accessed: string;
  /** Exact figures taken from the page. */
  figures: Record<string, string>;
}

export const REFERENCES: Record<string, Reference> = {
  iec62196: {
    id: "iec62196",
    title: "IEC 62196-1:2022 — Plugs, socket-outlets, vehicle connectors and vehicle inlets, Part 1 (abstract)",
    publisher: "DER-Lab standards summary",
    url: "https://standards.der-lab.net/standard/plugs-socket-outlets-vehicle-connectors-and-vehicle-inlets-conductive-charging-of-electric-vehicles-part-1-general-requirements/",
    accessed: "2026-10-26",
    figures: { acMaxV: "690 V AC", acMaxA: "250 A", dcMaxV: "1 500 V DC", dcMaxA: "800 A" },
  },
  "mida-ccs2": {
    id: "mida-ccs2",
    title: "MIDA CCS 2 charging cable / plug, DC 1000 V 250 A — product specification",
    publisher: "MIDA (manufacturer)",
    url: "https://www.midapower.com/mida-ccs-2-charging-cable-dc1000v-250a-200a-ccs2-plug-product/",
    accessed: "2026-10-26",
    figures: { contactResistance: "0.5 mΩ max", temperatureRise: "< 50 K (terminal)", matingCycles: "> 10 000", rating: "DC 1000 V, 250 A" },
  },
  "harting-ccs2": {
    id: "harting-ccs2",
    title: "HARTING charging cable CCS Type 2 — technical data",
    publisher: "HARTING (manufacturer)",
    url: "https://harting.com/sites/default/files/2021-07/Technical%20Data_Charging%20Cable%20CCS%20Type2_EN_0.pdf",
    accessed: "2026-10-26",
    figures: { rating: "60 A – 200 A, 1000 V DC (power contacts)", matingCycles: "> 10 000", shutdown: "90 °C" },
  },
  adac: {
    id: "adac",
    title: "ADAC tested five EVs for charging losses",
    publisher: "The Next Web (reporting ADAC tests), 19 Aug 2026",
    url: "https://thenextweb.com/news/adac-ev-home-charging-losses-wallbox-socket",
    accessed: "2026-10-26",
    figures: { wallbox11kW: "5.1 % – 7.0 %", socket2_3kW: "12.7 % – 24.2 %", dcFast: "5 % – 15 % (1–4 % warm battery)" },
  },
};

/** Numeric forms of the reference figures used in calculations (each traced to REFERENCES). */
export const REFERENCE_VALUES = {
  newContactResistanceMaxMohm: { value: 0.5, ref: "mida-ccs2" },
  terminalTemperatureRiseMaxK: { value: 50, ref: "mida-ccs2" },
  ratedMatingCycles: { value: 10_000, ref: "mida-ccs2" },
  acMaxVoltage: { value: 690, ref: "iec62196" },
  acMaxCurrent: { value: 250, ref: "iec62196" },
  dcMaxVoltage: { value: 1500, ref: "iec62196" },
  dcMaxCurrent: { value: 800, ref: "iec62196" },
  wallboxLossPct: { value: [5.1, 7.0] as [number, number], ref: "adac" },
  socketLossPct: { value: [12.7, 24.2] as [number, number], ref: "adac" },
  dcLossPct: { value: [5, 15] as [number, number], ref: "adac" },
} as const;
