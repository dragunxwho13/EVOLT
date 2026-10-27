# Arduino bench → real-world scaling

[← Back to README](../README.md)

EVOLT's **Arduino bench** page (`/company/bench`) shows what the team's small experimental circuit
measured on three connectors, how each quantity is scaled to a representative charger, and how
that compares with published charger figures. Every number on the page is recalculated from the
stored readings each time it loads.

Three kinds of numbers are kept apart everywhere (in code, in the database and on screen):

| Layer | What it is | Where it lives |
|---|---|---|
| **Experimental circuit** | Readings logged by the Arduino prototype, unchanged | `database/data/raw/arduino-bench-run-2.xlsx` → `database/data/arduino-bench-run-2.csv` → table `bench_readings` (run `bench-run-2`) |
| **Real-world estimate** | Calculated from the prototype by the formulas below | Computed on request by `src/features/bench/scaling.ts`; never stored as if measured |
| **Commercial reference** | Figures published by a standard or manufacturer | `REFERENCES` in `src/config/scaling.ts`, each with its URL and access date |

> The bench readings are **not** measurements of a commercial charger, and the real-world
> estimates are **not** charger telemetry.

## 1. The experimental circuit (run 2)

The log has 127 time steps × 3 connectors (381 readings), one every 0.5 s from 1.2 s to 64.2 s.
Each connector has its own voltage (V), current (mA) and degradation % column; there are no blank
cells. EVOLT measures each connector's circuit from its own readings rather than assuming it:

| Quantity | C1 | C2 | C3 | How it is obtained |
|---|---|---|---|---|
| Load resistance | 493 Ω | 350 Ω | 388 Ω | median V ÷ I over readings ≥ 1 mA (middle 50 % within ± 4 Ω) |
| Healthy level V_ref (0 %) | 3.455 V | 3.067 V | 3.193 V | median V ÷ (1 − degradation/100): the log's own definition |
| Healthy current | 7.01 mA | 8.76 mA | 8.23 mA | V_ref ÷ load |
| Sweeps to open circuit | 5, every 15 s | 3, every 20 s | 3, every 22.5 s | episodes at 0 V, and the median time between them |
| Degradation % | | | | the log's definition, 100 × (1 − V ÷ V_ref), matched within 0.34 / 0.35 / 0.49 points |

**What the run is.** Each connector is swept repeatedly from near-healthy (1–2 %) down to an open
circuit (0 V, logged as 100 %) and back. That covers the whole voltage–degradation curve several
times on every connector, which is good calibration data. It is a controlled stress pattern, not
natural wear, so it gives **no rate of wear over time**.

Each reading is classified as *near healthy* (< 10 %), *moderate* (10–40 %), *severe* (≥ 40 %,
still conducting) or *open circuit* (0 V). The bands use the logged index only.

**Three connectors, separately.** They are summarised one by one and never averaged. Unlike a run in
which the connectors are alike, here they differ: loads by 143 Ω and healthy levels by 388 mV
(12 %). Reading all three against one shared healthy level would misstate degradation by about
1.7 points (median), so each connector is judged against its own V_ref.

## 2. Parameter-specific scaling

A representative charger is described by its voltage across one current path, the current in
one conductor, the number of current paths and current-carrying contacts, and the power
factor (`SCENARIOS` in `src/config/scaling.ts`). The bench side is one connector's measured load
and healthy level. Each quantity is scaled by the law that governs it — never by one common
multiplier:

| Quantity | Factor | Why |
|---|---|---|
| Voltage | k_V = V_path ÷ V_ref | sets the operating voltage |
| Current | k_I = I_rated ÷ I_healthy | sets the operating current |
| Resistance | k_R = k_V ÷ k_I | Ohm's law, R = V ÷ I |
| Power | k_P = k_V × k_I (per path) | P = V × I |
| Energy | power × chosen session time | time is an assumption, not scaled |
| Degradation %, loss share | unchanged | dimensionless |
| Temperature | not scaled | needs a calibrated thermal resistance (K/W) |

**AC vs DC.** AC values are RMS. I²R heating in a contact does not depend on power factor;
delivered power does (P = V × I × PF per phase). Single-phase: two contacts (L, N) carry the
current. Balanced three-phase: three line contacts carry it and the neutral ≈ 0 A. DC: two
power contacts (DC+, DC−).

### Method A — proportional (similarity)

*What would a given bench state look like at charger size?* The page lets you choose a level of the
bench's degradation index (10, 25, 50 or 75 %). That level fixes the bench voltage
V = V_ref × (1 − level/100), and the bench's resistance ratio is kept at charger size:

```
R_load,real  = V_path ÷ I_rated
R_extra,real = R_load,real × (V_ref ÷ V − 1)                (≈ R_extra,bench × k_R)
I            = I_rated × V ÷ V_ref                          (the divider's current)
ΔV           = V_path × (1 − V ÷ V_ref)
Heat         = paths × I² × R_extra,real
```

At 50 % the extra resistance equals the load. Ohm's law and I²R hold exactly after scaling
(unit-tested), and the loss share equals the chosen level for DC. **Result:** a 50 % bench state
corresponds to 115 V lost and ≈ 1.8 kW of heat in one connector at 7.4 kW AC, and 200 V and
12.5 kW at 50 kW DC. Because the ratio is what is scaled, these figures are the same for all three
connectors. They are faults that would destroy a contact, not gradual wear: the bench demonstrates
the *direction* of the effect (more resistance → lower voltage), not its *size*.

### Method B — contact physics

*What does real wear look like, and could the bench see it?* Start from the datasheet maximum
for a new CCS2 contact (0.5 mΩ), multiply by illustrative wear levels (1, 2, 5, 10, 20 ×), and use
the charger's controlled current:

```
ΔV per contact = I × R
Heat per contact = I² × R,   all contacts = n × I² × R
Share of delivered power = n × I² × R ÷ (paths × V_path × I × PF)
Bench-equivalent drop = V_ref − V_ref × R_L ÷ (R_L + R ÷ k_R)
Visible on the bench if that drop ≥ one ADC step (5 V ÷ 2¹⁰ = 4.88 mV)
```

**Result:** at 7.4 kW AC, no wear level up to 20 × the new-contact maximum moves any connector's
reading by one ADC step. At 50 kW DC it becomes visible at 10 × (5 mΩ) on C1 and C3, and at
20 × (10 mΩ) on C2. Early, real-world wear is below what this circuit can resolve.

## 3. The model: relative voltage

The deployed bench model converts a bench voltage into the bench's degradation index using the
voltage **relative to that connector's healthy level**:

```
degradation % = 100.11 − 100.23 × (V ÷ V_ref)       clipped to 0–100
```

The coefficients rediscover the log's definition (100 − 100 × V ÷ V_ref); what the data adds is
that V_ref must be per connector. Evaluated on data it never saw (open-circuit readings, which are
100 % by definition, left out):

| Model | Held-out sweeps (MAE) | Unseen connector (MAE) |
|---|---|---|
| One voltage line for all connectors | 2.28 points | 1.05–4.52 points |
| A separate voltage line per connector | 0.09 points | needs that connector's full history |
| **Relative voltage (deployed)** | **0.09 points** | **0.09–0.12 points** |

"Unseen connector": trained on the other two; the relative model gets only the unseen connector's
first sweep (a commissioning sweep) to set its V_ref, and is tested on its remaining sweeps. A new
connector's healthy level can be entered in the estimator on the bench page. Voltages above 5 V are
refused: they are not bench readings. Details → [machine-learning.md](machine-learning.md#what-is-deployed-the-bench-model).

## 4. Commercial references

Only figures that appear on these pages are used:

| Reference | Figures used |
|---|---|
| [IEC 62196-1:2022 abstract (DER-Lab)](https://standards.der-lab.net/standard/plugs-socket-outlets-vehicle-connectors-and-vehicle-inlets-conductive-charging-of-electric-vehicles-part-1-general-requirements/) | AC ≤ 690 V, ≤ 250 A; DC ≤ 1 500 V, ≤ 800 A |
| [MIDA CCS2 plug specification](https://www.midapower.com/mida-ccs-2-charging-cable-dc1000v-250a-200a-ccs2-plug-product/) | contact resistance ≤ 0.5 mΩ; terminal temperature rise < 50 K; > 10 000 mating cycles; DC 1000 V, 250 A |
| [HARTING CCS Type 2 cable technical data](https://harting.com/sites/default/files/2021-07/Technical%20Data_Charging%20Cable%20CCS%20Type2_EN_0.pdf) | 60–200 A, 1000 V DC; > 10 000 mating cycles; shutdown 90 °C |
| [ADAC charging-loss tests (The Next Web, 19 Aug 2026)](https://thenextweb.com/news/adac-ev-home-charging-losses-wallbox-socket) | 11 kW wallbox 5.1–7.0 %; 2.3 kW socket 12.7–24.2 %; DC 5–15 % |

ADAC measures the **whole charging chain**; the bench measures only a connector, so that
comparison is labelled as not like-for-like. No verified rate of connector degradation per
month or per mating cycle was found, so none is used.

## 5. Assumptions (all configurable in `src/config/scaling.ts`)

- Four representative operating points: AC 7.4 kW single-phase (230 V, 32 A); AC 22 kW
  three-phase (230 V per phase, 32 A); DC 50 kW (400 V, 125 A); DC 150 kW (750 V, 200 A). All
  are inside the IEC 62196-1 ratings (tested).
- AC power factor 0.99; balanced three-phase; session length 1 h for energy.
- Degradation levels for scaling (10, 25, 50, 75 %) and wear multiples are illustrative choices.
- The supply voltage of the bench was not logged; each connector's V_ref stands in for it.
- Contact thermal resistance: **not set**, so temperature rise is not estimated.

## 6. Calibration still needed

1. A slow, one-way wear test (many mating cycles over hours or days) to measure how fast degradation
   builds up; the sweeps cannot show that.
2. Log the bench supply voltage, not only the load voltage.
3. Add an independent current sensor (today current follows V ÷ R_load).
4. Measure contact resistance directly with a four-wire (milliohm) method.
5. Fit a thermal resistance (K/W) with a thermocouple on each contact, then set
   `contactThermalResistanceKPerW`.

## 7. Reproduce

```bash
npm run db:migrate             # also removes readings of any earlier bench run
npm run db:seed:bench          # store run 2 (also run by the launcher and on Vercel)
npm run model:degradation      # rebuild models/degradation-report.json
npm run test:unit              # includes the scaling, physics, model and reproducibility tests
```
