# EVOLT data dictionary

Everything EVOLT stores, what each field means, and the formats it accepts on import.
Example files live in [`public/samples/`](../public/samples) and are downloadable from the
Data import page.

## Import formats

Files may be **CSV** (comma-separated, header row, UTF-8) or **JSON** (an array of objects, or
`{"records": [...]}`). Values are read as text and validated server-side; nothing in a file is
ever executed. The default upload limit is 2 MiB (`EVOLT_MAX_UPLOAD_BYTES`, hard ceiling 4 MiB)
and 20,000 rows. Column names are matched case-insensitively and common aliases are mapped
automatically; anything else can be mapped by hand in the preview step.

The importer detects which of the three formats a file is from its columns; you can override
it. Timestamps without a timezone (e.g. `2024-01-01 00:15:00`) are read in the timezone chosen
on the import screen (UTC by default).

### Session files (one row per charging session)

Creates stations, chargers and readings in one step, and keeps every numeric column of each
session for model training.

| Column | Required | Aliases | Rules |
|---|---|---|---|
| `station_code` | yes | station_id, site_id, station | Numeric ids become `ST-07` etc. Stations have no coordinates unless a registry adds them. |
| `observed_at` | yes | timestamp, time, start_time, date | Session time. |
| `charging_mode` | no | charging_type, charger_type, mode | Each station + charging type becomes a charger (`ST-07-FAST`). |
| `charger_code` | no | charger_id, evse_id | Used instead of station + type when present. |
| `connector_type` | no | connector, plug_type | Missing → “Not recorded”; such chargers are never offered as compatible alternatives. |
| `area` | no | location, zone | Kept per session (it may vary for one station). |
| `power_loss` | no | power_loss_kw, loss_kw | kW (assumed). Stored as the `power_loss` health metric and analysed. |
| `voltage_fluctuation` | no | voltage_variation | % (assumed). Supporting metric only. |
| `power_loss_label` | no | reduced_power_loss_category, loss_category | Training label. |
| `voltage_stability_label` | no | voltage_stability_category | Training label. |

All other numeric columns (voltage, current, cost…) are stored with the session and used as
model inputs; identifier-like columns (`*_id`, `*_code`) are excluded from models.

### Registry files (stations and chargers)

One row per charger. Station attributes repeat on each row for that station.

| Column | Required | Aliases | Rules |
|---|---|---|---|
| `station_code` | yes | station_id, site_id, site_code, location_id | Letters, digits and `. _ : - /`, max 64 chars. Stable key. |
| `station_name` | yes | site_name, name, station | Must be identical on every row of a station. |
| `address` | no | street, street_address | |
| `city` | no | town | |
| `region` | no | state, province, district | |
| `country` | no | country_code | |
| `latitude` | no | lat | WGS84 decimal degrees, −90…90. |
| `longitude` | no | lon, lng, long | WGS84 decimal degrees, −180…180. Give both coordinates or neither; `0,0` is rejected as a placeholder. |
| `operator` | no | cpo, network, owner | |
| `charger_code` | yes | charger_id, evse_id, connector_id, charger | Stable key. A charger cannot move to another station. |
| `connector_type` | yes | connector, plug_type, plug, standard | `CCS2`, `CCS1`, `CHAdeMO`, `Type2`, `GBT`, `NACS` (variants like `Type 2`, `GB/T`, `J3400` accepted). |
| `rated_power_kw` | no | power_kw, max_power_kw, rated_power, power | > 0 and ≤ 1500. |
| `operational_status` | no | status, availability | `available`, `in_use`, `offline`, `unknown` (also `occupied`, `out of service`, …). Empty means `unknown`. |

Re-importing a registry updates connector type, power and status of existing chargers
(matched by `charger_code`) and the descriptive fields of existing stations.

### Observation files (health measurements)

One row per measurement.

| Column | Required | Aliases | Rules |
|---|---|---|---|
| `charger_code` | yes | charger_id, evse_id, connector_id | Must already exist (import the registry first). |
| `observed_at` | yes | timestamp, time, datetime, measured_at, date, recorded_at | ISO 8601 **with timezone** (`2026-05-01T10:00:00Z`, `…+05:30`). A bare date means 00:00 UTC. Up to 10 minutes in the future is tolerated for clock skew. |
| `metric` | yes | measurement, parameter, quantity | One of the metrics below (unit-suffixed names such as `contact_resistance_mohm` accepted). |
| `value` | yes | reading, measurement_value, val | A number. Empty values are **rejected** — never treated as zero. |
| `unit` | yes | units, uom | Converted to the metric's canonical unit; unknown units are rejected. |
| `provenance` | no | data_type, origin, data_origin | `observed`, `derived`, `estimated`, `simulated`. If missing, the value chosen in the import form is used. |
| `source` | no | source_name, instrument, device | Free text, max 120 chars. |

Row outcomes reported in the preview and summary:

- **accepted** — valid and new;
- **rejected** — invalid (with the field and reason);
- **duplicate** — same charger + metric + timestamp as an earlier row in the file or an existing record;
- **skipped** — blank row.

An identical file (same SHA-256) can only be imported successfully once.

### Metrics

| Key | Canonical unit | Accepted units | Plausible range | Role |
|---|---|---|---|---|
| `contact_resistance` | mΩ | mohm, mΩ, milliohm, ohm, Ω, uohm, µΩ | 0–100 | Primary |
| `voltage_drop` | mV | mV, V | 0–10000 | Primary |
| `power_loss` | kW | kW, W | 0–500 | Primary (from session files) |
| `voltage_fluctuation` | % | %, pct, percent | 0–100 | **Supporting only** |
| `fault_count` | count | count, faults, n | 0–10000 (whole numbers) | Primary — faults in the reporting period ending at the timestamp |
| `temperature_rise` | °C | C, °C, degC, K | −20–150 | **Supporting only** — never sets health status |

### Provenance

| Value | Meaning |
|---|---|
| `observed` | Directly measured or logged by equipment |
| `derived` | Calculated from other observed values |
| `estimated` | Approximated or inferred, not measured |
| `simulated` | Generated synthetically for demonstration or testing |

All seeded demonstration data and the example files use `simulated`.

## Database tables

| Table | Purpose | Key constraints |
|---|---|---|
| `stations` | Charging sites | unique `code`; both coordinates or neither, within valid ranges |
| `chargers` | Chargers/connectors, with the latest health status and full assessment (`health_summary` JSON) | unique `code`; FK → stations (cascade); power > 0 |
| `health_observations` | Measurements in canonical units, with source unit, provenance and import | unique (`charger_id`, `metric`, `observed_at`); FK → chargers, dataset_imports |
| `alerts` | Explainable alerts with evidence JSON, thresholds, confidence note, suggested action | at most one open/acknowledged alert per (`charger_id`, `metric`, `rule`) |
| `alert_events` | Status history of each alert (with optional note) | FK → alerts |
| `dataset_imports` | Every import attempt, its counts and row issues | unique `file_hash` among completed imports |
| `vehicle_profiles` | Connector compatibility and DC power limit for recommendations | unique `code` |
| `sensor_readings` | Optional bench-sensor readings (supporting context only) | unique (`device_id`, `sensor`, `recorded_at`) |
| `charging_sessions` | Imported sessions with all numeric values and labels | unique (`charger_id`, `started_at`) |
| `model_runs` | Cross-validated training reports per label | — |

Enumerations: `connector_type`, `operational_status`, `health_status`
(`normal`, `monitor`, `inspection_recommended`, `insufficient_data`), `provenance`,
`alert_status` (`open`, `acknowledged`, `resolved`, `dismissed`), `alert_severity`,
`alert_rule` (`persistent_deviation`, `sustained_trend`, `fault_recurrence`),
`health_metric`, `dataset_kind`, `import_status`.

## Sensor ingestion API

`POST /api/sensor-readings` (admin token required)

```json
{
  "deviceId": "bench-uno-1",
  "chargerCode": "SYN-01-C1",
  "readings": [{ "sensor": "temp_c", "value": 27.4, "unit": "°C", "recordedAt": "2026-10-24T09:00:00Z" }]
}
```

Up to 500 readings per request; duplicates (same device, sensor, time) are ignored and counted.
