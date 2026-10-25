# Data, analytics and action items

[← Back to README](../README.md)

## The supplied dataset

`public/samples/ev-charging-grid-sessions.csv`:

- 1,000 sessions and 20 columns, with no missing values and no duplicate rows;
- one session every 15 minutes, 1–11 January 2024;
- 19 numeric station IDs.

It is imported on first start through the normal import pipeline.

| Column(s) | How EVOLT uses it |
|---|---|
| `station_id`, `charging_type` | Station (`Station 7`) and charger (`ST-07-FAST`) → 19 stations, 57 chargers |
| `timestamp` | Session time (no timezone in the file; read as UTC by default, selectable on import) |
| `power_loss` | Analysed connector-health metric (kW, unit assumed) and model input |
| `voltage_fluctuation` | Supporting metric (%), never sets health on its own |
| `charging_power × charging_time ÷ 60` | Derived energy, kWh (time assumed to be minutes — *derived, not metered*) |
| `charging_cost` | Cost per derived kWh: 0.1477 in every row (a flat tariff; currency not stated) |
| `battery_capacity`, `power_consumed` | Consistency checks |
| `reduced_power_loss_category`, `voltage_stability_category` | Training labels |
| `location` | Area type per session (Urban / Suburban / Rural) — not a place |
| Other numeric columns | Stored and used as model inputs; `*_id` columns excluded |

### What the data supports — and what it does not

These findings were checked independently with pandas and are reproduced by the unit tests.

| Finding | Consequence in the app |
|---|---|
| Every station appears in all three area types | No station can be located; drivers see them in a separate “without a recorded location” list |
| No availability, downtime or session-outcome field; `num_chargers` changes between rows of the same station | Utilisation, downtime and failure rate are **not shown**, and the UI says why |
| 35 sessions lose more power than they consume | Data-quality action items |
| 302 sessions (30 %) deliver more energy than the battery holds | Medium-priority data-quality item |
| Fast, Conventional and V2G average 26.0–26.9 kW | Low-priority item: charging-type labels look wrong |
| Station high-loss shares range from 16 % to 35 % | None is outside chance once sample size and the number of stations are considered; the app says so |

The dataset is stored with provenance “Demo / sample data” because its origin is unverified.

### Demo stations

Twelve labelled demo stations (`DEMO-01` … `DEMO-12`) add coordinates and
contact-resistance / voltage-drop / fault histories. With them, the distance search and the
connector-health alert workflow can be demonstrated. They are not real sites, and **Remove demo
data** on the Data import page deletes them without touching imported data.

## Company metrics (definitions)

| Metric | Definition |
|---|---|
| Energy delivered | Σ charging power × charging time ÷ 60 (kWh, derived) |
| Average session | Mean charging time (minutes, assumed) |
| Median loss share | Median of power loss ÷ power consumed over sessions with consumed > 0 |
| High-loss share | Sessions labelled “High” ÷ labelled sessions, with a 95 % Wilson interval |
| Poor-stability share | Sessions labelled “Poor” ÷ labelled sessions, with a 95 % Wilson interval |
| Inconsistent records | Sessions with loss > consumed, plus sessions with energy > battery capacity |

## Action-item rules

Every action item carries:

- the subject;
- the evidence (counts, period, comparison);
- the rule that fired;
- why it matters;
- the next step;
- a priority;
- a confidence note where relevant.

No rule asserts a root cause.

| Rule | Trigger | Priority |
|---|---|---|
| Connector-health alert | Persistent deviation, sustained trend or recurring faults (see the Analysis method page) | High (inspection) · Medium (monitor) · Low (pattern no longer detected) |
| Elevated high-loss share | Station share ≥ fleet + 10 points **and** Bonferroni-adjusted 95 % Wilson lower bound above the fleet share; ≥ 20 labelled sessions | Medium |
| Elevated poor-stability share | Same test on the stability label | Medium |
| Loss exceeds consumption | ≥ 5 % of a station's sessions (smaller counts are grouped into one fleet item) | Medium · Low |
| Energy exceeds battery | ≥ 10 % of sessions | Medium · Low |
| Indistinct charging types | Largest gap between types' average power < 10 % | Low |
| Low demand | Station session count z ≤ −2.33 against the station average (≥ 5 stations) | Low |
| Evidence coverage | Chargers with insufficient data; chargers assessed only on data older than 45 days | Low |

**Workflow.** Employees can mark items *reviewed*, *resolved* or *dismissed*, with a note. Each
decision is stored in `insight_reviews` together with a fingerprint of the evidence, so the item
is flagged when its evidence changes after review. “Marked resolved” records a decision; it does
not claim the charger was repaired.

## Connector-health analysis (summary)

Each primary metric (contact resistance, voltage drop, fault count, power loss) is assessed
against the charger's **own** baseline:

1. Rejects invalid readings.
2. Takes the median and robust scale of the earliest valid readings as the baseline.
3. Requires a deviation to persist (3 of the last 5 readings).
4. Detects a sustained rise with a Theil–Sen slope and a consistency check.
5. Counts recurring faults over 30 days.
6. Raises no alert when the baseline itself is too variable.
7. Labels the assessment historical when the newest reading is older than 45 days.

Temperature rise and voltage fluctuation are supporting evidence only. All thresholds are on
the in-app **Analysis method** page and in `src/config/analysis.ts` (version `2026.10-2`).

## Driver ranking

| Hard requirements (must meet) | Preferences (ordering) |
|---|---|
| Recorded location within the radius (straight-line) | 1. Health evidence (no issues → not assessed → under observation → inspection advised) |
| Not reported offline | 2. Latest reported status (available → in use → unknown) |
| Selected connector (unknown connector types are excluded when one is chosen) | 3. Distance in 5 km bands |
| Minimum power, if set | 4. Rated power, then exact distance |
| No inspection advised (unless included) | Price and opening hours are not used — the data does not contain them |
| Reported available, if requested | |

Each result's explanation sentence is assembled only from facts in the record and the
driver's own inputs.
