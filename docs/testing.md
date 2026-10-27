# Testing and verification

[← Back to README](../README.md)

```bash
npm run lint && npm run typecheck
npm run test:unit                    # 165 tests · no database
npm run test:integration             # 37 tests · TEST_DATABASE_URL (wiped on every run)
npm run build && npm run test:e2e    # 34 tests · E2E_DATABASE_URL (wiped and re-seeded)
```

Put `TEST_DATABASE_URL` and `E2E_DATABASE_URL` in `.env.test.local`. Both must point at
disposable databases that are different from `DATABASE_URL`.

## What each suite covers

| Suite | Scope |
|---|---|
| **Unit** (Vitest) | Driver booking: IST day boundaries, the buffer in both directions, day slots, the queue start and sessions ahead, charge-time estimates (DC taper, AC and vehicle caps, limits), and fleet plans (spreading, earliest deadline first, earliest-finish charger, connector compatibility). Session metrics against figures computed independently with pandas: derived energy 43,065.9 kWh, 256/1000 high-loss sessions, 35 + 302 inconsistent records, tariff 0.1477. Wilson intervals and normal quantiles against SciPy. Map projection round-trips, on-screen distances matching Haversine distances, view fitting and pin grouping. Every action-item rule, including the multiple-comparison guard. Computed takeaways. Driver explanations and hard constraints. Training, cross-validation and the follow-up model test. Import parsing, detection and timezones. Edit-mode and same-origin security. Baselines, trends, alert de-duplication. Temperature correction (including refusing to mix corrected and raw readings), the Sen slope interval, every forecast status, every repair-verification outcome and the held-rate summary, forecast action items, temperature import. Bench log run 2: checksums of the raw workbook and CSV, parsing (the earlier column names refused), per-connector load, healthy level, sweeps and open-circuit counts against pandas, the shared-reference error, every scaling law (k_R = k_V/k_I, Ohm's law and I²R after scaling, invariant shares), operating points inside IEC ratings, contact physics and ADC mapping, references resolvable, no invented temperature, insight cards, the dataset audit, grouped and time-ordered evaluation without leakage, the relative-voltage model beating one shared voltage line on held-out sweeps and held-out connectors, per-connector and new-connector estimates, refusal of real-charger voltages and invalid references, and that the committed model file equals a fresh training run. Import of the unified training file. |
| **Integration** (Vitest + PostgreSQL) | Real route handlers against a real database: bookings made without an admin token in token mode, only a hash of the code stored, overlap and buffer refusals with the next free start, three simultaneous requests for one slot (exactly one succeeds), queue order, no driver details in availability, offline and inspection chargers refused, validation and cross-site refusal, look-up in any code format, cancellation freeing the slot, fleet preview vs booking, per-vehicle cancellation, per-charger estimates; imports and duplicate blocking; action items and review persistence, including refusing unauthorised and cross-site writes; performance figures and the CSV export; predictions, including refusals; the availability filter; referential and coordinate constraints; operator service limit → forecast, recording maintenance (and refusing bad or future entries), forecast restart after work, and a repair verified as held from later imported readings; the bench log (run 2) stored value-for-value, idempotent loading, migration 0007 removing readings of any other run, bench API per connector and level, estimates per connector and for a new connector, and refusals |
| **End-to-end** (Playwright) | Driver booking: estimate, pick a slot, booked and gap times no longer offered, My bookings and cancel; joining the queue behind another driver; finding a booking by code in another browser; planning and booking three vehicles; chargers not taking bookings; booking on a phone without horizontal scrolling. Role switching and old-URL redirects. Driver flow: city start, granted and denied geolocation, coordinate validation, filters, compare, station page, empty state. Company flow: action items, acknowledgement persistence, charger evidence. Import → performance → review → model classification. A check that no page shows “synthetic” or “simulated”. Maps: best-match pin and popup, *Show on map*, picking a point on the map, fleet-map filters and popups. Service forecast page → corrected charger evidence; a heat-only rise not flagged; repair checks (held and relapsed), setting a limit and recording work in the browser. Arduino bench page: three connector columns with their healthy levels, the relative-voltage chart, scaling table, scenario, connector and level change, per-connector and new-connector estimates and refusal; model page study and model comparison. Demo removal. Mobile layout, plus a regression check that moving between pages never crashes. |

## Last verified run

27 Oct 2026, on Linux.

- Lint, typecheck and production build: clean.
- Tests: 165/165 unit, 37/37 integration and 34/34 end-to-end (236 total).
- A clean first run of the one-click launcher succeeded.
- The full change and verification report is in [CHANGE_REPORT.md](CHANGE_REPORT.md).

Not verified:

- on Windows hardware;
- physical-device geolocation (only Playwright's simulated permission was tested);
- token mode in a browser (only unit and integration tests cover it);
- manual screen-reader and dark-mode review.

These tests show that the code does what it states. They do **not** show how accurate the
analysis is on real chargers.
