# API reference

[← Back to README](../README.md)

Every response uses the same envelope:

- success: `{ "data": … }`;
- failure: `{ "error": { "code", "message", "details"? } }`, with the matching HTTP status (400,
  401, 404, 409, 413, 503).

Query strings are validated strictly: unknown parameters return 400.

**Writes** (marked ✎ below) pass through the same check, which works like this:

1. Requests from another website are refused.
2. In `token` mode, the request must also carry `Authorization: Bearer <EVOLT_ADMIN_TOKEN>` or the
   session cookie set from Settings.

## Driver

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/recommendations` | Ranked chargers with explanations, exclusions, hard constraints and preferences |
| GET | `/api/bookings/availability` | Free slots on one charger for one day, busy periods and their gaps, and the next queue start |
| POST | `/api/bookings` | Book a slot (`start` given) or join the queue (no `start`); returns the booking code once |
| POST | `/api/bookings/fleet` | Plan several vehicles across a station's chargers; `preview: false` books the plan |
| POST | `/api/bookings/lookup` · `/api/bookings/cancel` | View or cancel by booking code (sent in the body, never the URL) |

Booking writes need no admin token, even in token mode: drivers have no accounts. They accept
same-site requests only and are fully validated. Details and request bodies → [booking.md](booking.md#api).

Parameters:

- an origin: either `lat` + `lng`, or `fromCharger=<uuid>`;
- optional `connector`, `minPowerKw`, `radiusKm` (default 25), `availableOnly`,
  `includeInspection` and `limit`.

```bash
curl "http://127.0.0.1:3000/api/recommendations?lat=13.0827&lng=80.2707&connector=CCS2&availableOnly=true"
```

## Company

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/insights` | Action items with evidence, rule, priority and workflow status |
| PUT ✎ | `/api/insights/review` | `{ "key", "status": "reviewed" \| "resolved" \| "dismissed" \| "open", "note"? }` |
| GET | `/api/company/performance` | Fleet, station, area, charging-type and daily figures; `?chargingMode=` `?area=` filters; `?format=csv` downloads station rows |
| GET | `/api/stations` · `/api/stations/{id}` | Stations (search, filters, distance sort) |
| GET | `/api/chargers` · `/api/chargers/{id}` · `/api/chargers/{id}/observations` | Chargers and their readings |
| GET · PATCH ✎ | `/api/alerts` · `/api/alerts/{id}` | Connector-health alerts; status changes with an optional note |
| GET | `/api/analytics/overview` · `/quality` · `/evaluation` | Fleet overview, data-quality figures, detector benchmark |
| POST ✎ | `/api/analytics/recompute` | Re-run the health analysis |
| GET · POST ✎ | `/api/chargers/{id}/maintenance` | Recorded work on a charger; POST `{ "performedAt", "action": "cleaned" \| "contacts_replaced" \| "connector_replaced" \| "adjusted" \| "other", "note"? }` then re-runs its analysis |
| PUT ✎ | `/api/chargers/{id}/service-limit` | `{ "contactResistanceLimitMohm": number \| null }` — the forecast target (null = default) |
| GET | `/api/bench` | Arduino bench: raw readings, per-connector analysis, insight cards, and the scaling table for `?scenario=ac-7\|ac-22\|dc-50\|dc-150` and `?connector=C1\|C2\|C3` |
| GET | `/api/bench/estimate?voltage=&connector=&scenario=` | Saved bench calibration: bench volts → bench degradation %, plus the Method A real-world equivalent. Voltages above 5 V are refused (not bench readings) |
| GET | `/api/maintenance` | Every recorded job with its verified outcome, and held rates by kind of work |

## Data and models

| Method | Endpoint | Purpose |
|---|---|---|
| POST ✎ | `/api/datasets/preview` | Validate a CSV/JSON upload without writing (multipart: `file`, `kind`, `mapping`, `timezone`, `defaultProvenance`) |
| POST ✎ | `/api/datasets` | Import in one transaction, re-analyse and retrain |
| GET ✎ | `/api/datasets` | Import history |
| DELETE ✎ | `/api/datasets/synthetic` | Remove the demo stations (imported data is untouched) |
| GET | `/api/models` | Latest cross-validated report per label |
| POST ✎ | `/api/models/train` | Retrain on stored sessions |
| POST | `/api/models/predict` | `{ "target", "values": { feature: number } }` → prediction, rule, accuracy, warnings |

```bash
curl -X POST http://127.0.0.1:3000/api/models/predict \
  -H "content-type: application/json" \
  -d '{"target":"reduced_power_loss_category","values":{"power_loss":3.0}}'
# → { "data": { "predicted": "Medium", "accuracy": 0.917, "explanation": "power_loss = 3 is between 1.88 and 3.67 …", … } }
```

## Platform

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Database status, edit mode, whether writes are enabled, analysis version |
| GET · POST | `/api/session` | Token-mode unlock status / unlock |
| POST ✎ · GET ✎ | `/api/sensor-readings` | Optional bench-sensor readings (never change health status) |
