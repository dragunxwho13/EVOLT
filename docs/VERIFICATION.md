# Verification report — Arduino bench, scaling and degradation model

[← Back to README](../README.md)

Run on 26 Oct 2026, Linux sandbox, PostgreSQL 16.15, Node 22.23, Chromium (Playwright).

## Checks that actually ran

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test:unit` | **138 / 138 passed** |
| `npm run test:integration` (real PostgreSQL) | **24 / 24 passed** |
| `npm run build` (production) | succeeded |
| `npm run test:e2e` (desktop + mobile Chromium) | **28 / 28 passed** |
| Fresh database: migrate → `database/seed/dataset.ts` | 285 bench readings stored, then 1,000 sessions, 57 chargers analysed, 3 model reports |
| `npm run model:degradation` twice | identical `models/degradation-report.json` (also enforced by a unit test) |
| Unified training file on **Data import** (preview) | before fix: 0 / 1,000 accepted; after: all rows valid (1,000 accepted on an empty database; reported as 1,000 duplicates when the same sessions are already stored) |

## The requested pipeline, step by step

| Step | How it was verified |
|---|---|
| Arduino data unchanged | CSV checksum matches `database/data/SHA256SUMS`; spot values (C1 at 14 s = 4.21 V, 15.6 mA, 0 %; blanks stay null) in unit tests; every one of the 285 database rows compared with the file in an integration test |
| → database | idempotent loader; a second load is a no-op; changed file refused |
| → preprocessing | reading states counted per connector (10 no-signal, 1 dropout, 6 healthy, 2 transition, 71 worn, 5 unlogged) |
| → scaling | k_R = k_V ÷ k_I and k_P = k_V × k_I for every scenario; Ohm's law and I²R hold after scaling; loss share invariant for DC; the report's 113 V example reproduced; scenarios inside IEC 62196-1 ratings |
| → degradation model | audit identities hold on all 1,000 rows; no station in two folds; definition R² > 0.999, no-loss-no-current R² < 0.05; calibration slope ≈ −25, held-out MAE < 0.2 points; 230 V refused |
| → connector analysis | three connectors summarised separately; C2's 93 mV healthy-window offset found |
| → backend | `/api/bench` and `/api/bench/estimate`, including 400s for bad scenario, connector and voltage |
| → frontend | bench page: three connector columns, scaling table, scenario change through the URL, estimator result and refusal; model page study; no page shows "synthetic" or "simulated" |

## Live deployment (https://evolt-ev.vercel.app, 26 Oct 2026)

| Check | Result |
|---|---|
| Build log | migrations applied; demo 13 stations / 29 chargers / 1,958 observations; 285 bench readings; dataset loaded; compiled |
| `/api/health` | `status: ok`, `database: ok`, `writesEnabled: true`, `editMode: token` |
| Pages | `/`, `/driver` and all 12 company pages returned 200 with data, no error screens |
| APIs | overview, stations, recommendations, insights, maintenance, bench estimate (2.2 V → 45.0 %) returned correct data |
| Vercel runtime errors | none since the final deploy |
| Fixed during this check | unknown query parameters (e.g. share tokens) caused 400s on GET endpoints; `pg` SSL-mode warning |
| Not checked live | saving with the admin token from a browser; phone geolocation |

## Not verified

- **Real-world accuracy of any estimate.** The scaled values follow from documented formulas;
  no commercial charger was measured to check them.
- **Temperature.** Not estimated: no calibrated thermal resistance exists for this hardware.
- **The bench supply voltage.** Not logged; the healthy level stands in for it.
- **Reference figures** are as published on the cited pages on 26 Oct 2026; the full IEC
  standard text was not consulted.
- **Hardware re-run.** No new bench run was made; the analysis uses the one supplied log.
- Windows hardware, physical-device geolocation, token mode in a browser, and manual
  screen-reader or dark-mode review (unchanged from earlier reports).
