# EVOLT — change and verification report (October 2026)

Base: `EVOLT-main.zip` (the previous project ZIP). It was audited, its baseline test results
recorded, and then it was improved in place. The architecture is unchanged: Next.js 16 App
Router, PostgreSQL with Drizzle, Zod, and the existing analysis, ingestion and learning modules.

## 1. Baseline before changes (measured)

| Check | Result |
|---|---|
| Typecheck, lint, unit tests (78), production build | Passed |
| Integration tests | **17 / 19** (import-history auth; open edit mode) |
| Browser tests | **3 / 17** |
| Fresh one-click install | Imports and edits **disabled** (`writesEnabled: false`) |

## 2. Bugs found and fixed

| # | Bug (reproduced) | Fix |
|---|---|---|
| 1 | Editing lock returned. Open mode required both `EVOLT_EDIT_MODE=open` and `EVOLT_LOCAL_DB=true`, but the launcher wrote only the second, so every import failed | Explicit mode always wins; unset means open for the launcher's local DB, token otherwise. Regression test added |
| 2 | Demo stations, chargers and alerts were hidden by `isSynthetic` filters while the overview still listed them, so its links led to “Nothing here” | Filters removed; demo records are shown with a **Demo** tag |
| 3 | Migration `0003` was missing from `_journal.json`, so it never ran | Replaced by a registered `0003` (demo renaming + `insight_reviews` table) |
| 4 | OSM importer: `capacity` (vehicle count) read as kW; `socket:type2_combo` recorded as AC Type 2; `:output` value used as charger count | Importer removed with all OpenStreetMap code |
| 5 | Type 1 mapped to CCS1 in both importers | Both importers removed |
| 6 | Data attribution stripped (“Imported station registry”, rename migration) | Removed with the importers |
| 7 | Map legend (health colours) did not match markers (availability colours) | Map removed |
| 8 | “What this means” called any value above the median “above usual” and ignored the analysis result | The text now reflects the analysis outcome, including the unstable-baseline note |
| 9 | “Best available match” label shown even for chargers with an inspection advised | Replaced by an evidence-only explanation sentence |
| 10 | Station listing grouped chargers in O(stations × chargers) | Uses the existing map lookup |
| 11 | README errors: wrong default mode, non-existent POST route, curl example with wrong parameters (400), missing migration | README rewritten and checked against the code |
| 12 | The old false-positive alert (ST-09-FAST) stayed open with “high” priority after the analysis stopped finding it | Alerts whose pattern is no longer detected become **low** priority “confirm and close” items |
| 13 | Testing 19 stations at 95 % would flag about one by chance (Station 5, 25/64 poor-stability sessions) | Bonferroni-adjusted Wilson intervals; the rule text says so |
| 14 | Driver page rewrote the URL with default values on load (test race) | Defaults omitted; replace only when changed |
| 15 | Alert note fields had duplicate HTML ids when several alerts were shown on one page | Unique per alert |
| 16 | Re-import preview showed 0 stations / empty labels (earlier version) | Kept fixed; regression test retained |

## 3. Removed and why

- **OpenStreetMap, Leaflet, map components and styles**, the `NEXT_PUBLIC_MAP_*` variables, the
  tile-provider setting, the OSM station importer and the OSM docs: removed as required. Distance
  discovery now uses Haversine distance on coordinates in the database.
- **OpenEV vehicle importer**: an external API whose output was not used anywhere in the UI.
- **`PRODUCT.md`**: it stated that public views must hide demo data (the cause of bug 2), and its
  dark-palette claim did not match the app.
- **Map-centric station explorer and the old recommendation finder**: replaced by the driver
  finder.
- **“Synthetic” / “Simulated” wording in the UI**: demo records are “Demo”, and provenance shows
  as “Demo / sample data”. Records stay flagged in the database and are never shown as live.

## 4. Added or improved

- **Entry page with role choice**; separate **driver** (top bar) and **company** (sidebar)
  layouts with switch links; old URLs redirect.
- **Driver**:
  - location from the browser (with permission), a city in the data, or typed coordinates;
  - radius, connector, power and availability as hard filters;
  - explained ranking that separates requirements from preferences;
  - sorting, compare up to 4 chargers, a driver station page, honest empty states;
  - stations without a location listed separately.
- **Company**:
  - an overview built around action items;
  - the **Action items** page (evidence, rule, why, next step, priority, confidence) with a
    persisted review workflow and a flag when evidence changes after review;
  - the **Performance** page with filters, sorting, intervals and CSV export;
  - computed chart takeaways, KPI definitions, and stated reasons for metrics that are not shown.
- **Data and model**:
  - session metrics checked against pandas;
  - data-quality rules (loss > consumed, energy > battery, indistinct charging types);
  - follow-up model test (loss category without power loss is **not** predictable);
  - prediction endpoint with validation and out-of-range warnings, and a *Categorise a session*
    form;
  - offline `npm run model:train` writing `models/session-models.json`;
  - the dataset is loaded automatically on first start, through the normal import pipeline.

## 4b. Maps (added 26 Oct 2026)

- **Own map component** (`src/components/map`):
  - Web Mercator, SVG;
  - drag, scroll and pinch zoom, plus keyboard pan and zoom;
  - nearby pins grouped into numbered circles, and city labels that never overlap;
  - a scale bar and a Natural Earth credit.
- **Background map:** a 268 KB static file built from public-domain Natural Earth data (India point of view: coastline, borders, states, highways, cities). There is no map provider or API, and the file is rebuilt with `scripts/build-basemap.mjs`.
- **Driver:**
  - shows your location and the search radius;
  - stars the best match (it is never grouped with other pins) and numbers the other results by rank;
  - popups list every charger at the station;
  - clicking empty map offers to search from that point;
  - each result card has *Show on map*.
- **Company:** the Fleet map page, coloured by worst charger health, with filters, a needs-attention list and popups linking to chargers. The overview has a compact version.
- **Station pages:** mini maps showing the station and its nearest neighbours.
- **Tests added:** 7 unit (projection, scale, fitting, grouping) and 4 browser (map flows).

## 4c. Temperature correction, service forecast and repair checks (added 26 Oct 2026)

- **Temperature correction.** New optional `temperature_c` on observations (import column,
  database column with a range check). Contact resistance and voltage drop are restated at 20 °C
  when every reading has a temperature; otherwise used as measured, with the reason shown.
- **Service forecast.** Theil–Sen rate with Sen's 80 % interval over the readings since the latest
  maintenance; likely date and range to the operator's limit (new
  `chargers.contact_resistance_limit_mohm`, editable on the charger page) or baseline + 50 %.
  Stored in each metric's assessment; new **Service forecast** page; forecasts within 30 days
  become action items. Analysis version → `2026.10-3`.
- **Repair checks.** New `maintenance_events` table, API and *Record work* form. Each job is
  verified against later readings (held, relapsed, partly improved, no measurable effect, still
  confirming, awaiting a reading); new **Repair checks** page with held rates per kind of work.
  Charts mark maintenance and the service limit.
- **Demo data.** Demo readings now carry a contact temperature (Chennai-like season). A 13th demo
  station adds three stories: a cleaning that held, a cleaning that relapsed, and a heat-only rise
  that temperature correction correctly leaves unflagged. Earlier demo values are unchanged.
- **Ordering.** Within a priority and category, confirmed health alerts are listed before forecasts.
- Migration `0004_temperature_forecast_maintenance.sql` (forward-only).
- Verified 26 Oct 2026: lint, typecheck and build clean; 122/122 unit, 23/23 integration,
  26/26 end-to-end.

## 4d. Arduino bench, real-world scaling and degradation model (added 26 Oct 2026)

**Audit findings (before coding)**

- The Arduino bench log is the only measured data. Its current follows V ÷ R_load and its
  degradation is calculated from voltage: one independent signal. (The log analysed then was
  replaced by run 2; see 4e.)
- The new unified training dataset (1,000 rows) is entirely derived from the charging sessions:
  `C1_V` = `voltage_level`, `C1_mA` = 340 × current, `C1_Deg_pct` = clip(100 × loss ÷ consumed),
  C2/C3 = C1 × fixed factors, `connector_type` = "Simulation". It has no independent
  degradation label.
- Bug: importing that file on **Data import** rejected all 1,000 rows because the optional
  `connector_type` held a non-standard value.

**Bugs fixed**

| # | Bug | Fix |
|---|---|---|
| 1 | An unrecognised value in a session file's optional connector column rejected the whole session (the unified file: 0 of 1,000 accepted) | Sessions are kept with connector "Not recorded" and the import shows a warning naming the value; tested |
| 2 | Log-scale bar charts on the new page cut off the smallest bar | Explicit decade bounds on the axis |

**Features added**

- `bench_readings` table (migration `0005`), `npm run db:seed:bench` (also run by the launcher
  and the end-to-end setup). Values stored exactly as logged, with source row, file and
  SHA-256; a changed file is refused rather than merged.
- `src/config/scaling.ts`: scenarios, assumptions and sourced references (IEC 62196-1, MIDA and
  HARTING datasheets, ADAC tests).
- `src/features/bench/`: parsing, reading classification, per-connector summaries,
  parameter-specific scaling (Method A proportional, Method B contact physics), insight cards.
- **Arduino bench** page: three connectors side by side, the requested comparison table
  (Arduino reading · method/factor · scaled estimate · commercial reference · difference),
  heat and loss-share charts, the Method B table with bench visibility, the calibration
  estimator, assumptions and references.
- `src/features/learning/degradation.ts` + `npm run model:degradation`: dataset audit,
  station-grouped and time-ordered regression study (baseline vs ridge, MAE/RMSE/R²), bench
  calibration saved to `models/degradation-report.json`, re-fitted from the database on every
  page load, served by `/api/bench/estimate` (bench volts only). Shown on **Learned model**.
- Docs: `docs/scaling.md`, a degradation section in `docs/machine-learning.md`.

**Files modified:** `src/lib/db/schema.ts`, `src/features/data-ingestion/plan.ts`,
`src/components/layout/nav.tsx`, `src/app/company/model/page.tsx`, `database/seed/dataset.ts`,
`database/migrations/meta/_journal.json`, `package.json`, `tests/e2e/app.spec.ts`,
`tests/e2e/global-setup.ts`, `tests/integration/api.test.ts`, `tests/integration/setup.ts`,
`tests/unit/sessions-import.test.ts`, `README.md`, `docs/*.md`.
**Files added:** `database/data/**`, `database/migrations/0005_bench_readings.sql`,
`database/seed/bench.ts`, `src/config/scaling.ts`, `src/features/bench/*`,
`src/features/learning/degradation.ts`, `src/app/company/bench/page.tsx`,
`src/app/api/bench/**`, `src/components/bench/*`, `src/components/model/degradation-study.tsx`,
`scripts/train-degradation.ts`, `models/degradation-report.json`, `tests/unit/bench.test.ts`,
`docs/scaling.md`.

**Not done, deliberately:** no degradation predictor from the unified dataset (its target is a
formula of its inputs); no temperature estimate (no calibrated thermal resistance); no field
wear rate (none verified).

## 4e. Arduino bench run 2 replaces the earlier log (added 27 Oct 2026)

**What changed in the data.** The team's improved bench log (127 time steps × 3 connectors,
0.5 s step, 1.2–64.2 s, no blank cells) replaces the earlier log everywhere. Each connector now
has its own load (493 / 350 / 388 Ω) and healthy level (3.455 / 3.067 / 3.193 V), and is swept
repeatedly between near-healthy and open circuit (every 15 / 20 / 22.5 s).

**Removed:** the earlier raw workbook and CSV, their checksums, and every figure derived from them
in code, tests, the saved model and the docs. Migration `0007_replace_bench_run.sql` deletes any
readings of other runs from `bench_readings`, so deployed databases drop them on the next deploy.

**Changed**

- Parser reads the log's own column names (`Connector1_V`, `Connector1_mA`, `Connector1_Deg_%`, …).
- Analysis measures each connector's V_ref from the log's definition, counts sweeps and their
  period, and classifies readings as near healthy / moderate / severe / open circuit.
- Scaling works from each connector's own load and V_ref at a chosen level of the index
  (10 / 25 / 50 / 75 %, `level` on `/api/bench`).
- **Model improved:** a relative-voltage model, degradation = 100.11 − 100.23 × (V ÷ V_ref),
  replaces a single voltage line. Held-out sweeps: 0.09 points MAE against 2.28 for one shared
  line; held-out connectors with one commissioning sweep: 0.09–0.12 against 1.05–4.52. The
  estimator accepts a connector or a new connector's healthy level (`referenceV`).
- Bench page: new findings, the per-connector table, a level selector, and a chart showing the
  readings against raw and relative voltage. Learned-model page: the model comparison table.

**Not done, deliberately:** no wear rate (the sweeps are a controlled pattern, not wear over
time); the unified training dataset and its study are unchanged (its Arduino-style columns are
derived from the sessions, not bench readings).

## 5. Verification (tests actually run on 25 Oct 2026, Linux sandbox)

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | Passed |
| Unit tests | **99 / 99** |
| Integration tests (real PostgreSQL) | **22 / 22** |
| Production build | Passed |
| Browser tests (Playwright, desktop + mobile) | **24 / 24** |
| Clean first run of the launcher (no `.env.local`, no database, no build) | Passed: demo stations and dataset loaded, 3 model reports, editing open, a same-site write accepted |
| Every page loaded in a browser with the console watched | 11 routes, no errors |
| No “synthetic” / “simulated” text on any main page | Passed (automated) |
| Analytics against independent calculation | Energy, durations, power, loss share, label counts, inconsistent records, tariff: match pandas. Wilson interval and normal quantiles: match SciPy |
| Model results against scikit-learn | 91.7 % / 37.0 % / 41.5 % consistent with scikit-learn (91.2–91.9 %, 31–36 %, 40–41 %) |

### Not verified or partially verified

- **Windows**: not run on Windows. The launcher logic is shared with the tested Linux path, but
  the `.bat` file and the Windows PostgreSQL binaries were not executed here.
- **Real browser geolocation on a phone**: tested with Playwright's simulated permission (granted
  and denied), not on a physical device.
- **Token mode in the browser**: covered by unit and integration tests, not by a browser test.
- **Dark mode and screen readers**: colour tokens exist for dark mode and the pages use semantic
  markup, but neither was reviewed manually.

### Blocked by the data, not by code

- Real station locations for the dataset, live availability, price, opening hours, downtime,
  utilisation and session outcomes are not in the supplied data, so they are not shown.
- Multi-company authorisation is not implemented; the role switch is demo mode only.
