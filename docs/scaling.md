# Arduino bench → real-world scaling

[← Back to README](../README.md)

EVOLT's **Arduino bench** page (`/company/bench`) shows what the team's small experimental
circuit measured on three connectors, how each quantity is scaled to a representative
charger, and how that compares with published charger figures. Every number on the page is
recalculated from the stored readings each time it loads.

Three kinds of numbers are kept apart everywhere (in code, in the database and on screen):

| Layer | What it is | Where it lives |
|---|---|---|
| **Experimental circuit** | Readings logged by the Arduino prototype, unchanged | `database/data/raw/degradation_data.xlsx` → `database/data/arduino-bench-readings.csv` → table `bench_readings` |
| **Real-world estimate** | Calculated from the prototype by the formulas below | Computed on request by `src/features/bench/scaling.ts`; never stored as if measured |
| **Commercial reference** | Figures published by a standard or manufacturer | `REFERENCES` in `src/config/scaling.ts`, each with its URL and access date |

> The bench readings are **not** measurements of a commercial charger, and the real-world
> estimates are **not** charger telemetry.

## 1. The experimental circuit

The log (95 time steps × 3 connectors, one reading every 0.5 s for 47.5 s) has, per connector,
voltage (V), current (mA) and a degradation % column. EVOLT measures the circuit from the
readings rather than assuming it:

| Quantity | Value | How it is obtained |
|---|---|---|
| Load resistance | 270 Ω | median V ÷ I over live readings (spread ≈ 4 Ω) |
| Healthy level | ≈ 4.21 V, 15.6 mA | mean of the readings logged at 0 % (14.0–16.5 s) |
| Worn level | 2.20 V | median of the readings logged at ≥ 30 % |
| Extra series resistance when worn | ≈ 239–251 Ω | R_L × (V_healthy ÷ V_worn − 1) |
| Degradation % | the log's definition | 100 × (1 − V ÷ 4.0 V), clipped at 0 (matches within 0.15 points) |

Each reading is classified as *no signal* (start of run), *dropout* (one sample at 10 s),
*healthy*, *transition*, *worn* (≥ 30 %), or *degradation not logged* (5 per connector,
30–32 s). Blanks stay blank; nothing is filled in.

**Three connectors, separately.** They are summarised one by one and never averaged. They
differ by 0.07 points of degradation on average; the one connector-specific difference is C2,
which reads about 93 mV (2.2 %) lower than C1 and C3 in the healthy window.

## 2. Parameter-specific scaling

A representative charger is described by its voltage across one current path, the current in
one conductor, the number of current paths and current-carrying contacts, and the power
factor (`SCENARIOS` in `src/config/scaling.ts`). Each quantity is scaled by the law that
governs it — never by one common multiplier:

| Quantity | Factor | Why |
|---|---|---|
| Voltage | k_V = V_path ÷ V_healthy | sets the operating voltage |
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

*What would the bench's worn state look like at charger size?* Keep the bench's resistance
ratio (extra ÷ load) and apply it to the real path:

```
R_load,real  = V_path ÷ I_rated
R_extra,real = R_load,real × (V_healthy ÷ V_bench − 1)      (≈ R_extra,bench × k_R)
I_worn       = I_rated × V_bench ÷ V_healthy                (the divider's current)
ΔV           = V_path × (1 − V_bench ÷ V_healthy)
Heat         = paths × I_worn² × R_extra,real
```

Ohm's law and I²R hold exactly after scaling (unit-tested), and the loss share equals the
bench's voltage share for DC. **Result:** the bench's worn state corresponds to about 108–111 V
lost and ≈ 1.8 kW of heat in one connector at 7.4 kW AC. That is a fault that would destroy a
contact, not gradual wear. The bench demonstrates the *direction* of the effect (more
resistance → lower voltage), not its *size*.

### Method B — contact physics

*What does real wear look like, and could the bench see it?* Start from the datasheet maximum
for a new CCS2 contact (0.5 mΩ), multiply by illustrative wear levels (1, 2, 5, 10, 20 ×), and use
the charger's controlled current:

```
ΔV per contact = I × R
Heat per contact = I² × R,   all contacts = n × I² × R
Share of delivered power = n × I² × R ÷ (paths × V_path × I × PF)
Bench-equivalent drop = V_healthy − V_healthy × R_L ÷ (R_L + R ÷ k_R)
Visible on the bench if that drop ≥ one ADC step (5 V ÷ 2¹⁰ = 4.88 mV)
```

**Result:** at 7.4 kW AC, real wear only reaches one ADC step at about 20 × the new-contact
maximum (10 mΩ); at 50 kW DC, at about 10 ×. Early, real-world wear is below what this circuit
can resolve.

## 3. Commercial references

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

## 4. Assumptions (all configurable in `src/config/scaling.ts`)

- Four representative operating points: AC 7.4 kW single-phase (230 V, 32 A); AC 22 kW
  three-phase (230 V per phase, 32 A); DC 50 kW (400 V, 125 A); DC 150 kW (750 V, 200 A). All
  are inside the IEC 62196-1 ratings (tested).
- AC power factor 0.99; balanced three-phase; session length 1 h for energy.
- Wear multiples are illustrative.
- The supply voltage of the bench was not logged; the healthy level stands in for it.
- Contact thermal resistance: **not set**, so temperature rise is not estimated.

## 5. Calibration still needed

1. Log the bench supply voltage, not only the load voltage.
2. Add an independent current sensor (today current = V ÷ 270 Ω).
3. Measure contact resistance directly with a four-wire (milliohm) method, while mating a real
   connector pair hundreds of times.
4. Fit a thermal resistance (K/W) with a thermocouple on each contact, then set
   `contactThermalResistanceKPerW`.
5. Give C1–C3 different, known resistances and step them gradually, to record a wear curve.

## 6. Reproduce

```bash
npm run db:seed:bench          # store the bench log (also run by the launcher)
npm run model:degradation      # rebuild models/degradation-report.json
npm run test:unit              # includes the scaling, physics and reproducibility tests
```
