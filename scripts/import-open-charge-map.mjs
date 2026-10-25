#!/usr/bin/env node
/**
 * Imports real EV charging-station registry data from Open Charge Map.
 *
 * OCM provides station locations, connector metadata, nameplate power and a
 * provider status. It does not guarantee live connector telemetry, so this
 * importer creates no health observations or alerts. The API key is read only
 * from OCM_API_KEY and is never written to the repository or database.
 *
 * Usage:
 *   OCM_API_KEY=... DATABASE_URL=... npm run db:import:ocm
 *   npm run db:import:ocm -- --latitude 13.05 --longitude 80.22 --distance 50
 */
import { Client } from "pg";

const keyIndex = process.argv.indexOf("--key");
const apiKey = process.env.OCM_API_KEY ?? (keyIndex >= 0 ? process.argv[keyIndex + 1] : undefined);
const databaseUrl = process.env.DATABASE_URL;
if (!apiKey) throw new Error("OCM_API_KEY is not set. Pass the key through the environment; never commit it.");
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function number(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function clean(value, max = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function connector(title) {
  const value = String(title ?? "").toLowerCase();
  if (value.includes("ccs") && value.includes("type 1")) return "CCS1";
  if (value.includes("ccs") || value.includes("combo")) return "CCS2";
  if (value.includes("chademo")) return "CHAdeMO";
  if (value.includes("type 2") || value.includes("iec 62196-2")) return "Type2";
  if (value.includes("type 1") || value.includes("j1772")) return "CCS1";
  if (value.includes("gb/t") || value.includes("gbt")) return "GBT";
  if (value.includes("nacs") || value.includes("tesla")) return "NACS";
  return null;
}

function status(item) {
  const verifiedAt = item?.DateLastVerified ? Date.parse(item.DateLastVerified) : NaN;
  const fresh = Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= 7 * 24 * 60 * 60 * 1000;
  if (!fresh) return "unknown";
  if (item?.StatusType?.IsOperational === true) return "available";
  if (item?.StatusType?.IsOperational === false) return "offline";
  return "unknown";
}

const latitude = number(argument("--latitude", process.env.OCM_LATITUDE ?? "13.05"), "latitude");
const longitude = number(argument("--longitude", process.env.OCM_LONGITUDE ?? "80.22"), "longitude");
const distance = number(argument("--distance", process.env.OCM_DISTANCE_KM ?? "50"), "distance");
const maxresults = Math.min(10000, Math.max(1, Math.trunc(number(argument("--maxresults", process.env.OCM_MAX_RESULTS ?? "1000"), "maxresults"))));
const dryRun = process.argv.includes("--dry-run");

const url = new URL("https://api.openchargemap.io/v3/poi/");
url.search = new URLSearchParams({
  output: "json",
  latitude: String(latitude),
  longitude: String(longitude),
  distance: String(distance),
  distanceunit: "KM",
  maxresults: String(maxresults),
  compact: "false",
  verbose: "false",
  key: apiKey,
}).toString();

console.log(`Loading Open Charge Map records near ${latitude},${longitude} within ${distance} km...`);
const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "EVOLT Open Charge Map importer/1.0" } });
if (!response.ok) throw new Error(`Open Charge Map request failed: ${response.status} ${response.statusText}`);
const payload = await response.json();
if (!Array.isArray(payload)) throw new Error("Open Charge Map returned an unexpected response.");

const rows = [];
for (const poi of payload) {
  const address = poi.AddressInfo;
  if (!address?.Latitude || !address?.Longitude || !poi.ID) continue;
  const connections = Array.isArray(poi.Connections) ? poi.Connections : [];
  const mapped = connections.flatMap((connection) => {
    const type = connector(connection.ConnectionType?.Title ?? connection.ConnectionType?.FormalName);
    if (!type) return [];
    const quantity = Math.max(1, Math.min(50, Math.trunc(Number(connection.Quantity) || 1)));
    return Array.from({ length: quantity }, (_, index) => ({
      code: `ocm-${poi.ID}-${connection.ID ?? type}-${index + 1}`,
      connector: type,
      powerKw:
        Number.isFinite(Number(connection.PowerKW)) && Number(connection.PowerKW) > 0 && Number(connection.PowerKW) <= 1500
          ? Number(connection.PowerKW)
          : null,
      status: status(poi),
    }));
  });
  if (mapped.length === 0) continue;
  const stationCode = `ocm-${poi.ID}`;
  rows.push({
    station: {
      code: stationCode,
      name: clean(address.Title, 200) ?? `Open Charge Map station ${poi.ID}`,
      address: clean([address.AddressLine1, address.AddressLine2, address.Postcode].filter(Boolean).join(", ")),
      city: clean(address.Town),
      region: clean(address.StateOrProvince),
      country: clean(address.Country?.Title ?? address.Country?.ISOCode),
      latitude: Number(address.Latitude),
      longitude: Number(address.Longitude),
      operator: clean(poi.OperatorInfo?.Title),
    },
    chargers: mapped,
  });
}

const chargerCount = rows.reduce((total, row) => total + row.chargers.length, 0);
if (rows.length === 0) throw new Error("Open Charge Map returned no stations with supported connector metadata.");
console.log(`Found ${rows.length} stations and ${chargerCount} connector records.`);
if (dryRun) process.exit(0);

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  for (const row of rows) {
    await client.query(
      `INSERT INTO stations (code, name, address, city, region, country, latitude, longitude, operator, is_synthetic, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city,
         region = EXCLUDED.region, country = EXCLUDED.country, latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude, operator = EXCLUDED.operator, is_synthetic = false,
         source = EXCLUDED.source, updated_at = now()`,
      [
        row.station.code,
        row.station.name,
        row.station.address,
        row.station.city,
        row.station.region,
        row.station.country,
        row.station.latitude,
        row.station.longitude,
        row.station.operator,
        "Open Charge Map",
      ],
    );
    for (const charger of row.chargers) {
      await client.query(
        `INSERT INTO chargers (station_id, code, connector_type, rated_power_kw, operational_status, operational_status_at, is_synthetic)
         SELECT id, $2, $3::connector_type, $4, $5::operational_status,
           CASE WHEN $5 = 'unknown' THEN NULL ELSE now() END, false
         FROM stations WHERE code = $1
         ON CONFLICT (code) DO UPDATE SET
           connector_type = EXCLUDED.connector_type, rated_power_kw = EXCLUDED.rated_power_kw,
           operational_status = EXCLUDED.operational_status, operational_status_at = EXCLUDED.operational_status_at,
           is_synthetic = false, updated_at = now()`,
        [row.station.code, charger.code, charger.connector, charger.powerKw, charger.status],
      );
    }
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

console.log(`Imported ${rows.length} real Open Charge Map stations and ${chargerCount} chargers.`);
console.log("OCM status is provider-reported; health telemetry and alerts remain unavailable without measurements.");
