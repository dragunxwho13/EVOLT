# Testing and verification

[← Back to README](../README.md)

```bash
npm run lint && npm run typecheck
npm run test:unit                    # 92 tests · no database
npm run test:integration             # 22 tests · TEST_DATABASE_URL (wiped on every run)
npm run build && npm run test:e2e    # 20 tests · E2E_DATABASE_URL (wiped and re-seeded)
```

Put `TEST_DATABASE_URL` and `E2E_DATABASE_URL` in `.env.test.local`. Both must point at
disposable databases that are different from `DATABASE_URL`.

## What each suite covers

| Suite | Scope |
|---|---|
| **Unit** (Vitest) | Session metrics against figures computed independently with pandas: derived energy 43,065.9 kWh, 256/1000 high-loss sessions, 35 + 302 inconsistent records, tariff 0.1477. Wilson intervals and normal quantiles against SciPy. Every action-item rule, including the multiple-comparison guard. Computed takeaways. Driver explanations and hard constraints. Training, cross-validation and the follow-up model test. Import parsing, detection and timezones. Edit-mode and same-origin security. Baselines, trends, alert de-duplication. |
| **Integration** (Vitest + PostgreSQL) | Real route handlers against a real database: imports and duplicate blocking; action items and review persistence, including refusing unauthorised and cross-site writes; performance figures and the CSV export; predictions, including refusals; the availability filter; referential and coordinate constraints |
| **End-to-end** (Playwright) | Role switching and old-URL redirects. Driver flow: city start, granted and denied geolocation, coordinate validation, filters, compare, station page, empty state. Company flow: action items, acknowledgement persistence, charger evidence. Import → performance → review → model classification. A check that no page shows “synthetic” or “simulated”. Demo removal. Mobile layout, plus a regression check that moving between pages never crashes. |

## Last verified run

25 Oct 2026, on Linux.

- Lint and typecheck: clean.
- Tests: 92/92 unit, 22/22 integration and 20/20 end-to-end (run twice in a row).
- A clean first run of the one-click launcher succeeded.
- The full change and verification report is in [CHANGE_REPORT.md](CHANGE_REPORT.md).

Not verified:

- on Windows hardware;
- physical-device geolocation (only Playwright's simulated permission was tested);
- token mode in a browser (only unit and integration tests cover it);
- manual screen-reader and dark-mode review.

These tests show that the code does what it states. They do **not** show how accurate the
analysis is on real chargers.
