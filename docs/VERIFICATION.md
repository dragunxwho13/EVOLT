# Verification report — Arduino bench (run 2), scaling and degradation model

[← Back to README](../README.md)

Run on 27 Oct 2026, Linux sandbox, PostgreSQL 16, Node 22, Chromium (Playwright).

## Checks that actually ran

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test:unit` | **165 / 165 passed** |
| `npm run test:integration` (real PostgreSQL) | **37 / 37 passed** |
| `npm run build` (production) | succeeded |
| `npm run test:e2e` (desktop + mobile Chromium) | **34 / 34 passed** |
| Fresh database: migrate → `database/seed/dataset.ts` | 381 bench readings stored (run `bench-run-2` only), then 1,000 sessions, 57 chargers analysed, 3 model reports |
| `npm run model:degradation` twice | identical `models/degradation-report.json` (also enforced by a unit test) |
| Independent check with pandas | per-connector load, healthy level V_ref, open-circuit counts, sweep periods, the shared-reference error (1.66 points median) and every model's held-out error match the app's figures |

## The pipeline, step by step

| Step | How it was verified |
|---|---|
| Arduino data unchanged | the raw workbook is byte-identical to the file supplied; its CSV conversion and the workbook both match `database/data/SHA256SUMS`; spot values (C1 at 1.2 s = 0 V, 0 mA, 100 %; C2 at 1.2 s = 0.81 V, 2.3 mA, 73.5 %; C3 at 1.2 s = 3.06 V, 8 mA, 4 %; C1 at 64.2 s = 0.64 V, 1.3 mA, 81.4 %) in unit tests; every one of the 381 database rows compared with the file in an integration test |
| Earlier log removed | its files and checksums deleted; the parser refuses its column names; migration `0007` deletes readings of any other run (integration test inserts one and checks it is removed while run 2 stays) |
| → database | idempotent loader; a second load is a no-op; changed file refused |
| → preprocessing | per connector: 127 readings, 8 / 9 / 11 near healthy, 32 / 31 / 30 moderate, 59 / 63 / 71 severe, 28 / 24 / 15 open circuit |
| → connector analysis | loads 493 / 350 / 388 Ω; healthy levels 3.455 / 3.067 / 3.193 V; sweeps every 15 / 20 / 22.5 s; the log's formula reproduced within 0.49 points |
| → scaling | k_R = k_V ÷ k_I and k_P = k_V × k_I for every scenario; Ohm's law and I²R hold after scaling; loss share equals the chosen level for DC; at 50 % the extra resistance equals the load (115 V lost at 230 V); every level × connector × scenario builds a complete table; scenarios inside IEC 62196-1 ratings |
| → degradation model | relative-voltage model: held-out sweeps 0.09 points MAE vs 2.28 for one shared voltage line; held-out connectors 0.09–0.12 vs 1.05–4.52; commissioning references within 3 mV of the full run; real-charger voltages and invalid references refused. Unified-dataset audit unchanged: identities hold on all 1,000 rows; no station in two folds |
| → backend | `/api/bench` (scenario, connector, level) and `/api/bench/estimate` (connector or `referenceV`), including 400s for bad scenario, connector, level, voltage and reference |
| → frontend | bench page: three connector columns with healthy levels, relative-voltage chart, scaling table, scenario / connector / level change through the URL, estimates per connector and for a new connector, refusal; model page comparison table; no page shows "synthetic" or "simulated" |

## Live deployment

Not yet redeployed with run 2 at the time of writing. On the next deploy, `npm run vercel-build`
applies migration `0007` (removing the earlier readings from the hosted database) and loads run 2.
The checks to repeat afterwards: `/api/bench` returns `run.id = "bench-run-2"` and
`calibrationConsistent: true`; `/api/bench/estimate?voltage=1.7&connector=C1` returns about 50.8 %.

## Not verified

- **Real-world accuracy of any estimate.** The scaled values follow from documented formulas;
  no commercial charger was measured to check them.
- **Wear rate.** The run sweeps each connector in a controlled pattern; it does not show how fast
  real wear builds up.
- **Temperature.** Not estimated: no calibrated thermal resistance exists for this hardware.
- **The bench supply voltage.** Not logged; each connector's healthy level stands in for it.
- **Reference figures** are as published on the cited pages on 26 Oct 2026; the full IEC
  standard text was not consulted.
- Windows hardware, physical-device geolocation, token mode in a browser, and manual
  screen-reader or dark-mode review (unchanged from earlier reports).
