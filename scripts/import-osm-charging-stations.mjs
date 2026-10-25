#!/usr/bin/env node
/**
 * Imports real charging-station registry data from OpenStreetMap through Overpass.
 *
 * OSM is a station registry, not a live telemetry source. This importer only writes
 * station identity, coordinates, connector tags, operator, and nameplate power when
 * the source provides them. Availability and health remain unknown unless OSM explicitly
 * reports a compatible status; no electrical readings or health observations are created.
 *
 * Usage:
 *   DATABASE_URL=... npm run db:import:osm -- --bbox 12.85,80.05,13.15,80.35
 *   EVOLT_OSM_BBOX=12.85,80.05,13.15,80.35 npm run db:import:osm
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const DEFAULT_BBOX = "12.85,80.05,13.15,80.35";
const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const CONNECTORS = [
  ["ccs2", "CCS2"],
  ["ccs1", "CCS1"],
  ["ccs", "CCS2"],
  ["chademo", "CHAdeMO"],
  ["type2", "Type2"],
  ["type2_combo", "CCS2"],
  ["type2_cable", "Type2"],
  ["type1", "CCS1"],
  ["gbt", "GBT"],
  ["gb/t", "GBT"],
  ["nacs", "NACS"],
  ["tesla_supercharger", "NACS"],
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseBbox(value) {
  const parts = String(value ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("Bbox must be south,west,north,east, for example 12.85,80.05,13.15,80.35.");
  }
  const [south, west, north, east] = parts;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) {
    throw new Error("Bbox coordinates are invalid; expected south < north and west < east.");
  }
  return `${south},${west},${north},${east}`;
}

function clean(value, max = 240) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function number(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function slug(value, fallback) {
  return (clean(value, 80) ?? fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || fallback;
}

function coordinates(element) {
  if (element.lat !== undefined && element.lon !== undefined) return { lat: element.lat, lon: element.lon };
  if (element.center?.lat !== undefined && element.center?.lon !== undefined) return { lat: element.center.lat, lon: element.center.lon };
  return null;
}

function connectorEntries(tags) {
  const entries = [];
  for (const [key, connector] of CONNECTORS) {
    const matchingKeys = [
      `socket:${key}`,
      `socket:${key}:count`,
      `socket:${key}:output`,
      `socket:${key}:cable`,
      `socket:${key}:cable:output`,
      `socket:${key}_combo`,
      `socket:${key}_combo:output`,
      `charging_station:${key}`,
      `charging_station:${key}:count`,
    ];
    const sourceKey = matchingKeys.find((candidate) => tags[candidate] !== undefined);
    if (!sourceKey) continue;
    const count = Math.max(1, Math.min(50, Math.trunc(number(tags[sourceKey]) ?? 1)));
    for (let index = 1; index <= count; index += 1) entries.push({ connector, index });
  }
  return entries;
}

function operationalStatus(tags) {
  const value = String(tags.status ?? tags["operational:status"] ?? "").toLowerCase();
  if (/^(available|operational|open|yes)$/.test(value)) return "available";
  if (/^(closed|offline|broken|out_of_service|out of service|no)$/.test(value)) return "offline";
  return "unknown";
}

function powerKw(tags) {
  const value = number(tags.capacity ?? tags["capacity:kw"] ?? tags.power ?? tags["charging_station:output"]);
  if (value === null || value <= 0 || value > 1500) return null;
  return value;
}

function stationRows(elements) {
  const rows = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const coords = coordinates(element);
    if (!coords || tags.amenity !== "charging_station") continue;
    const connectors = connectorEntries(tags);
    if (connectors.length === 0) continue;
    const kind = element.type === "node" ? "node" : "area";
    const stationCode = `osm-${kind}-${element.id}`;
    const stationName = clean(tags.name ?? tags.operator ?? tags.network, `OSM charging station ${element.id}`);
    const address = clean([tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "));
    const city = clean(tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:municipality"]);
    const region = clean(tags["addr:state"] ?? tags["addr:district"] ?? tags["addr:province"]);
    const country = clean(tags["addr:country"] ?? tags["addr:country_code"]);
    const operator = clean(tags.operator ?? tags.network);
    rows.push({
      station: {
        code: stationCode,
        name: stationName,
        address,
        city,
        region,
        country,
        latitude: coords.lat,
        longitude: coords.lon,
        operator,
      },
      chargers: connectors.map(({ connector, index }) => ({
        code: `${stationCode}-${slug(connector, "connector")}-${index}`,
        connector,
        ratedPowerKw: powerKw(tags),
        status: operationalStatus(tags),
      })),
    });
  }
  return rows;
}

async function fetchOverpass(query) {
  let lastError;
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
          headers: { accept: "application/json", "user-agent": "EVOLT OpenStreetMap importer/1.0" },
          signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return await response.json();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error(`All Overpass endpoints failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const bbox = parseBbox(argument("--bbox") ?? process.env.EVOLT_OSM_BBOX ?? DEFAULT_BBOX);
const dryRun = process.argv.includes("--dry-run");
const query = `[out:json][timeout:90];nwr[amenity=charging_station](${bbox});out center tags;`;
console.log(`Loading OpenStreetMap charging stations for bbox ${bbox}...`);
const payload = await fetchOverpass(query);
const rows = stationRows(Array.isArray(payload.elements) ? payload.elements : []);
const chargers = rows.flatMap((row) => row.chargers);
if (rows.length === 0) throw new Error("No OSM charging stations with connector tags were found in this area.");
console.log(`Found ${rows.length} stations and ${chargers.length} connector records with source metadata.`);
if (dryRun) process.exit(0);

const client = new Client({ connectionString: url });
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
        "OpenStreetMap via Overpass",
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
        [row.station.code, charger.code, charger.connector, charger.ratedPowerKw, charger.status],
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

console.log(`Imported ${rows.length} real OSM stations and ${chargers.length} chargers.`);
console.log("Availability is only populated when OSM supplies a status; health and telemetry remain unavailable without measurements.");
