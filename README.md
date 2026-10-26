<div align="center">

<img src="docs/images/logo.svg" alt="EVOLT logo" width="72" height="72" />

# EVOLT

**EV charging intelligence — with the evidence shown.**

Drivers find a charger they can rely on. Charging companies see which chargers need attention
first, and why.

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-4169E1?logo=postgresql&logoColor=white)
[![CI](https://github.com/dragunxwho13/EVOLT/actions/workflows/ci.yml/badge.svg)](https://github.com/dragunxwho13/EVOLT/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-190%20passing-2ea44f)
[![Live demo](https://img.shields.io/badge/live%20demo-evolt--ev.vercel.app-000000?logo=vercel&logoColor=white)](https://evolt-ev.vercel.app)
![External APIs](https://img.shields.io/badge/external%20APIs-none-6e7781)

**[▶ Open the live demo](https://evolt-ev.vercel.app)**

[Live demo](#-live-demo) · [Quick start](#-quick-start) · [For judges](#-a-2-minute-tour-for-judges) · [Features](#-what-it-does) · [How it works](#-how-it-works) · [Documentation](#-documentation)

<img src="docs/images/entry.png" alt="EVOLT entry page with a choice between the driver and company experiences" width="900" />

</div>

---

## 🔍 The problem

Public EV chargers are often out of service or underperforming, and drivers usually find out only on arrival. Operators
collect plenty of data but still struggle to decide **which** charger to fix first, and to justify
that decision.

## 💡 The solution

EVOLT turns charging data into two focused experiences built on one database:

| 🚗 **Driver** | 🏢 **Charging company** |
|---|---|
| Find compatible chargers nearby, ranked so the ones with healthy evidence come first, and see them on a map with the **best match starred** | See prioritised **action items**, each with its evidence, the rule that fired, why it matters and the next step |
| Compare up to four chargers side by side; click any map pin to see the chargers at that spot | A **fleet map** coloured by connector health; track station performance and export the station table |
| | A **service forecast**: when each connector will reach its contact-resistance limit, with a range, from temperature-corrected readings |
| | **Repair checks**: after recorded work, whether readings returned to normal and whether the fix held |
| Read a plain-English reason for every recommendation | Record decisions (reviewed / resolved / dismissed); they are stored in the database |

> **Every number is computed from stored records.** Nothing is hard-coded or shown as live
> telemetry, and an anomaly is always a reason to investigate, never proof of a fault.

<table>
<tr>
<td width="50%"><img src="docs/images/driver-finder.png" alt="Driver finder with ranked, explained results" /></td>
<td width="50%"><img src="docs/images/company-overview.png" alt="Company overview leading with prioritised action items" /></td>
</tr>
<tr>
<td align="center"><sub><b>Driver</b> — ranked chargers, each with its reason</sub></td>
<td align="center"><sub><b>Company</b> — what needs attention first</sub></td>
</tr>
</table>

---

## 🌐 Live demo

**https://evolt-ev.vercel.app** — no install, no sign-up.

| | |
|---|---|
| **Hosting** | Vercel (functions in Singapore, `sin1`) + Neon PostgreSQL (Singapore) |
| **Data loaded** | 13 labelled demo stations (29 chargers, 1,958 readings), the 1,000-session dataset with its trained models, and all 285 Arduino bench readings |
| **Browsing** | Every page and every read-only API is open to anyone |
| **Editing** | Token mode: recording maintenance, setting service limits, importing data and updating action items need the admin token. Unlock it on **Company → Settings**; ask the project owner for the token |
| **Health check** | [`/api/health`](https://evolt-ev.vercel.app/api/health) → `{"status":"ok","database":"ok",…}` |

Each deploy runs the migrations and loads the data before building
([`scripts/vercel-build.mjs`](scripts/vercel-build.mjs)). Every step is idempotent, so
redeploying never duplicates records. How to set up your own → [docs/deployment.md](docs/deployment.md).

---

## 🚀 Quick start

**Requirement:** [Node.js 20.9+](https://nodejs.org) (LTS). Nothing else — no PostgreSQL install,
no API keys.

| Windows | macOS / Linux |
|---|---|
| Double-click **`run-evolt.bat`** | `./run-evolt.sh` |

The browser opens at **http://127.0.0.1:3000**. Pick **I'm a driver** or **I work for a charging
company**; each view links to the other.

<details>
<summary><b>What happens on first run?</b></summary>

<br/>

1. Installs dependencies (internet needed once, a few minutes).
2. Creates `.env.local` and starts a private PostgreSQL 17 instance in `.evolt/` (no installation).
3. Applies the database migrations.
4. Loads 13 labelled **demo** stations.
5. Stores the Arduino bench log unchanged, then imports the supplied session dataset through the normal import pipeline and trains the models.
6. Builds and starts the app.

Later starts take seconds and keep your data. Launcher options: `--rebuild`, `--no-seed`,
`--no-dataset`, `--no-open`, `--port 3001`.

</details>

<details>
<summary><b>Manual setup with your own PostgreSQL</b></summary>

<br/>

```bash
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local — then set DATABASE_URL
npm run db:migrate
npm run db:seed                 # optional: demo stations
npm run db:seed:dataset         # the supplied session dataset + model training
npm run build && npm start      # or: npm run dev
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `EVOLT_EDIT_MODE` | `open` for local and demo use; `token` for any public deployment |
| `EVOLT_ADMIN_TOKEN` | Required in token mode (16+ characters) |

Deployment to Vercel and a managed PostgreSQL database → [docs/deployment.md](docs/deployment.md).

</details>

---

## 🎯 A 2-minute tour for judges

Works on the [live demo](https://evolt-ev.vercel.app) or a local copy.

| # | Go to | What to notice |
|---|---|---|
| 1 | **I'm a driver** → *start from a city* → **Chennai** | The map stars the best match; click any pin to see that station's chargers. Each result card gives a reason built only from facts in the record |
| 2 | Set **Your connector**, tick **Compare** on two results | Hard filters apply instantly; the side-by-side table highlights only objective bests |
| 3 | **Company workspace** → **Overview** → **Fleet map** | Opens with *Needs attention first*; the map shows where, coloured by health |
| 4 | **Action items** → open any item | Evidence, triggering rule, why it matters, next step; mark it reviewed and it persists |
| 5 | **Performance** | Station table with uncertainty intervals and CSV export; the takeaways say when a difference is just noise |
| 6 | **Learned model** → type `4.2` → **Classify** | A live prediction from the stored model, with its rule and tested accuracy |
| 7 | **Service forecast** → open **DEMO-13-C2** | Likely service date with its range and the limit line; readings restated at 20 °C. **DEMO-13-C3** rose only because it was measured hot, and is not flagged |
| 8 | **Repair checks** | One cleaning held, one relapsed after about a month; record new work on a charger page and set your own service limit |
| 9 | **Arduino bench** | C1, C2 and C3 side by side; pick a charger to see each quantity scaled (Arduino reading → method → estimate → published reference); type `2.2` in the calibration |

---

## ✨ What it does

<details>
<summary><b>🚗 Driver experience</b> — find, compare, decide</summary>

<br/>

- **Location, three ways:** browser location (with permission), a city in the data, or typed
  coordinates. A denied permission or invalid input gets a clear message, never a guessed location.
- **Hard requirements vs preferences:**
  - *Must meet:* within radius, not offline, your connector, minimum power, optionally
    *available only*.
  - *Ranked by:* health evidence → availability → distance → power.
- **Honest wording:**
  - *Availability unknown* is never shown as available.
  - Status times are shown when they were recorded.
  - Distances are straight-line.
- **Map:** your location and search radius. The best match is starred, other matches are numbered by rank, and non-matching stations are faint. Click a pin to see a popup of every charger at that station, or click empty map to search from that point. Each result card has *Show on map*.
- **Compare** up to four chargers, and open a **station page** with chargers, a mini map of nearby stations, a coordinate copy
  button and its session history. No turn-by-turn directions are claimed.
- **Empty results** offer *search a larger radius* or *remove optional filters*, and say what was
  excluded and why.

<img src="docs/images/driver-compare.png" alt="Side-by-side charger comparison" width="800" />

</details>

<details>
<summary><b>🏢 Company workspace</b> — act on evidence</summary>

<br/>

| Page | Answers |
|---|---|
| **Overview** | What needs attention first · where it is (map) · fleet connector health · session KPIs with definitions · trends with computed takeaways |
| **Fleet map** | Every located station coloured by its most concerning charger, with health filters, a needs-attention list, and popups showing chargers, alerts and open items |
| **Action items** | What is happening · why it matters · what to do next · which rule fired · priority · confidence |
| **Performance** | How each station performed, with intervals; filter, sort, export CSV |
| **Service forecast** | Which connector reaches its service limit next, the likely date and an 80% range; no date unless the rise is statistically clear |
| **Repair checks** | Each recorded job checked against later readings (held, relapsed, partly improved, no effect) and the held rate per kind of work |
| **Chargers / Health alerts** | Per-charger evidence charts; acknowledge, resolve or dismiss alerts |
| **Learned model** | What the model can and cannot predict, plus a live classifier and the degradation study |
| **Arduino bench** | The three bench connectors side by side, the parameter-by-parameter scaling table, heat and loss-share charts, real-wear physics, and the bench calibration |
| **Data import** | Drag-and-drop CSV/JSON with auto-detection, column mapping, validation and data-quality findings |

**Priority** follows explicit rules:

- **High:** a connector-health analysis recommends inspection.
- **Medium:** a statistically clear station-level excess, or significant data inconsistencies.
- **Low:** data gaps, or a pattern that is no longer detected.

*“Marked resolved” records a decision; it never claims a charger was repaired.*

<img src="docs/images/company-action-item.png" alt="An action item expanded to show evidence, rule and workflow" width="800" />

<img src="docs/images/company-performance.png" alt="Station performance with intervals and a sortable table" width="800" />

</details>

<details>
<summary><b>🔌 Arduino bench → real charger</b> — what the prototype measures, and what it means at charger scale</summary>

<br/>

Our small experimental circuit logs three connectors (C1–C3). EVOLT stores those readings
unchanged, measures the circuit from them (270 Ω load, 4.21 V healthy, 2.20 V worn) and scales
each quantity by its own law — voltage × k_V, current × k_I, resistance × k_V/k_I, power × k_V·k_I;
ratios unchanged; temperature only with a calibrated thermal resistance.

| Finding | Evidence |
|---|---|
| The worn bench state is a **fault** at charger scale | ≈ 110 V lost and ≈ 1.8 kW of heat in one connector at 7.4 kW AC (Method A) |
| Real wear is **below the bench's resolution** | a new CCS2 contact is ≤ 0.5 mΩ (datasheet); at 7.4 kW AC wear becomes visible on the 4.88 mV ADC step only at ≈ 10 mΩ (Method B) |
| The three connectors behave almost alike | 0.07-point average gap; only C2 reads 2.2 % lower when healthy |
| Degradation in the supplied training file is a **formula** | = clip(100 × loss ÷ consumed); no degradation predictor is deployed from it |

Every value is tagged **Experimental circuit**, **Real-world estimate** or **Commercial reference**
(IEC 62196-1, MIDA and HARTING datasheets, ADAC tests). Details → [docs/scaling.md](docs/scaling.md)
and [docs/machine-learning.md](docs/machine-learning.md#connector-degradation-what-can-and-cannot-be-predicted).

</details>

<details>
<summary><b>🔧 Connector wear: temperature, forecasts and repair checks</b> — what other platforms leave out</summary>

<br/>

Charging-management platforms typically alert when a threshold is crossed. EVOLT follows the
connector's contact resistance over time and answers three further questions:

| Question | How |
|---|---|
| **Is this rise real, or just a hot day?** | Readings that record the contact temperature are restated at 20 °C (copper, 0.393 %/°C). Correction is all-or-nothing per metric, so it never creates jumps. |
| **When will it need service?** | Theil–Sen rate since the last recorded maintenance, with Sen's 80 % interval → likely date and range to the operator's limit (default: baseline + 50 %). No date unless the rise is statistically clear. |
| **Did the repair work, and did it last?** | Readings after each recorded job are compared with the connector's own normal range → *held*, *relapsed*, *partly improved* or *no measurable effect*, plus a held rate per kind of work. |

Details and every threshold → [docs/analytics.md](docs/analytics.md#temperature-correction).

</details>

<details>
<summary><b>📊 What the dataset really shows</b> — findings, not decoration</summary>

<br/>

The supplied file holds **1,000 sessions** from **19 stations** (1–11 Jan 2024). EVOLT reports
what it supports, and also what it does not:

| Finding | What EVOLT does |
|---|---|
| Every station appears as urban, suburban **and** rural | No station can be located; these stations are listed separately for drivers |
| No availability, downtime or outcome fields | Utilisation, downtime and failure rate are **not shown**, and the app says why |
| 35 sessions lose more power than they consume | Raised as data-quality action items |
| 30 % of sessions deliver more energy than the battery holds | Medium-priority item: check the units with the data provider |
| “Fast” and other charging types deliver the same power | Low-priority item: the labels look wrong |
| Station loss rates range from 16 % to 35 % | None is outside chance once 19 comparisons are accounted for, and the app says so |

All figures were checked independently with pandas → [docs/analytics.md](docs/analytics.md).

</details>

<details>
<summary><b>🧠 Machine learning</b> — tested on unseen data, honest verdicts</summary>

<br/>

Stratified 5-fold cross-validation. Each label is tested against a guessing baseline, an
explainable threshold model and logistic regression. A label counts as predictable only if a
model clearly beats guessing.

| Question | Result | Guessing | Verdict |
|---|---|---|---|
| Power-loss category | **91.7 %** | 37.4 % | ✅ Predictable — rule: ≤ 1.88 kW Low · ≤ 3.67 kW Medium · else High |
| …without the power-loss reading | 37.0 % | 37.4 % | ❌ Loss must be measured |
| Voltage-stability category | 41.5 % | 40.4 % | ❌ Unrelated to every column — no prediction offered |

The 91.7 % recovers the dataset's labelling rule: it is useful for consistent categorisation, not
for forecasting. Predictions are served from the stored, evaluated model, and inputs outside the
training range are flagged. Details → [docs/machine-learning.md](docs/machine-learning.md).

<img src="docs/images/model.png" alt="Learned model page with accuracy, confusion matrix and learned rule" width="800" />

</details>

---

## ⚙️ How it works

```mermaid
flowchart LR
    A[CSV / JSON] --> B[Validate & import]
    B --> C[(PostgreSQL)]
    C --> D[Connector-health analysis]
    C --> E[Model training]
    C --> F[Action-item rules]
    C --> G[Driver ranking]
    D & E & F --> H[🏢 Company workspace]
    G --> I[🚗 Driver experience]
```

**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL + Drizzle · Zod ·
Recharts · Vitest · Playwright.

**Maps without a map provider:** EVOLT draws its own map (Web Mercator, SVG) over a 268 KB
background file bundled with the app, built from public-domain Natural Earth data with India's
official boundaries. There are no tiles, API keys or network calls, and distances use the
Haversine formula on stored coordinates.

<details>
<summary><b>Project structure</b></summary>

<br/>

```text
src/app/            Entry page · /driver · /company · /api route handlers
src/features/       recommendations · insights · sessions · anomaly-detection ·
                    connector-health · learning · data-ingestion · bench  (pure, tested logic)
src/config/         analysis thresholds · scaling assumptions and references
src/components/     UI: driver, insights, charts, primitives
database/           SQL migrations · demo seed · dataset and bench loaders · data/ (raw files)
models/             saved model reports (session classifiers, degradation study + calibration)
scripts/            One-click launcher · offline model training
tests/              unit · integration · e2e
docs/               Detailed documentation (below)
```

Full breakdown and design decisions → [docs/architecture.md](docs/architecture.md).

</details>

<details>
<summary><b>Quality and testing</b> — 190 automated tests</summary>

<br/>

| Suite | Count | Covers |
|---|---|---|
| Unit | 138 | Metrics against pandas/SciPy, map projection and scale, every action-item rule, ranking, training, import, security, temperature correction, forecasts, repair outcomes, bench parsing, scaling laws, contact physics, degradation study and calibration, model reproducibility |
| Integration | 24 | Real API handlers + PostgreSQL: imports, reviews, CSV export, predictions, access control, service limits, maintenance and repair verification, raw bench storage and the bench APIs |
| End-to-end | 28 | Both user journeys in Chromium (desktop + mobile), maps and popups, forecasts and repair checks, the Arduino bench page and estimator, regressions, wording checks |

```bash
npm run lint && npm run typecheck && npm run test:unit
```

Last full run: 26 Oct 2026 — lint, type check and production build clean; 138 + 24 + 28 passed.

**Checked on the live demo (26 Oct 2026):** the health endpoint, all 13 pages, and the
recommendation, station, action-item, maintenance and bench-estimate APIs return real data;
no runtime errors in the Vercel logs.
**Not yet checked on the live demo:** saving changes with the admin token from a browser, and
browser geolocation on a phone. Both are covered by the local integration and end-to-end tests.

What was and was not verified → [docs/testing.md](docs/testing.md) ·
[docs/VERIFICATION.md](docs/VERIFICATION.md).

</details>

---

## ⚖️ Scope and limitations

- **Unverified data.** The supplied dataset's origin is unverified and it is internally
  inconsistent, so its findings describe the file, not a real network.
- **Demo stations.** They are labelled *Demo* everywhere and are not real sites. One click removes them.
- **No live data.** There is no live availability, price or opening hours, so none is shown.
- **Mapped stations.** Only stations with recorded coordinates appear on maps; the 19 dataset stations have none and are listed separately.
- **No user accounts.** The driver/company switch is a view choice, not a sign-in. Changes
  are protected by a single admin token (token mode), which the live demo uses.
- **Not a safety certification.** Health categories summarise recorded evidence.

---

## 📚 Documentation

| Guide | Contents |
|---|---|
| [Architecture](docs/architecture.md) | System design, data flow, repository layout, security model |
| [Data & analytics](docs/analytics.md) | Dataset findings, metric definitions, action-item rules, ranking logic |
| [Machine learning](docs/machine-learning.md) | Pipeline, evaluation protocol, results and how to read them |
| [API reference](docs/api.md) | Every endpoint, with examples |
| [Data dictionary](docs/data-dictionary.md) | Import formats, fields, units, database tables |
| [Testing](docs/testing.md) | Test suites, last verified run, what is not verified |
| [Deployment](docs/deployment.md) | Vercel + Neon PostgreSQL, automatic migrations and data loading, the live setup |
| [Hardware bench](docs/hardware.md) | Optional Arduino low-voltage demo |
| [Bench scaling](docs/scaling.md) | Arduino → real-world scaling formulas, assumptions, references and calibration needs |
| [Change report](docs/CHANGE_REPORT.md) | Bugs fixed, features changed, verification |
| [Verification report](docs/VERIFICATION.md) | What was tested for the bench, scaling and model work, and what was not |

<div align="center">
<sub>Research prototype · No licence declared yet — all rights reserved by the author · See <a href="CONTRIBUTING.md">CONTRIBUTING.md</a></sub>
</div>
