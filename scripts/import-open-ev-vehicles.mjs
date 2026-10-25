#!/usr/bin/env node
/**
 * Imports vehicle compatibility profiles from the OpenEV Data release.
 *
 * This source contains vehicle specifications, not charging-station locations
 * or charger telemetry. It is therefore used only to improve compatibility
 * filtering and never creates stations, readings, alerts, or health scores.
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const connectorMap = {
  ccs1: "CCS1",
  ccs2: "CCS2",
  chademo: "CHAdeMO",
  type1: "CCS1",
  type2: "Type2",
  gbt: "GBT",
  nacs: "NACS",
};

const releaseResponse = await fetch("https://api.github.com/repos/open-ev-data/open-ev-data-dataset/releases/latest", {
  headers: { accept: "application/vnd.github+json", "user-agent": "EVOLT vehicle profile importer" },
});
if (!releaseResponse.ok) throw new Error(`OpenEV release lookup failed: ${releaseResponse.status} ${releaseResponse.statusText}`);
const release = await releaseResponse.json();
const asset = release.assets?.find((candidate) => candidate.name.endsWith(".json"));
if (!asset?.browser_download_url) throw new Error("OpenEV latest release does not include a JSON asset.");
const sourceUrl = asset.browser_download_url;
const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`OpenEV download failed: ${response.status} ${response.statusText}`);
const dataset = await response.json();
const vehicles = Array.isArray(dataset.vehicles) ? dataset.vehicles : [];
if (vehicles.length === 0) throw new Error("OpenEV release did not contain any vehicles.");

const profiles = new Map();
for (const vehicle of vehicles) {
  const make = vehicle.make?.name;
  const model = vehicle.model?.name;
  const year = vehicle.year;
  if (!make || !model || !year) continue;
  const connectors = [...new Set(
    (Array.isArray(vehicle.charge_ports) ? vehicle.charge_ports : [])
      .map((port) => connectorMap[String(port.connector ?? "").toLowerCase()])
      .filter(Boolean),
  )];
  if (connectors.length === 0) continue;

  const code = `openev-${vehicle.unique_code ?? `${make}-${model}-${year}`}`.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
  const name = `${make} ${model} (${year}${vehicle.trim?.name ? ` · ${vehicle.trim.name}` : ""})`;
  const maxDcPowerKw = Number.isFinite(vehicle.charging?.dc?.max_power_kw) ? vehicle.charging.dc.max_power_kw : null;
  profiles.set(code, { code, name, connectors, maxDcPowerKw });
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  for (const profile of profiles.values()) {
    await client.query(
      `INSERT INTO vehicle_profiles (code, name, connector_types, max_dc_power_kw, is_synthetic)
       VALUES ($1, $2, $3::connector_type[], $4, false)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         connector_types = EXCLUDED.connector_types,
         max_dc_power_kw = EXCLUDED.max_dc_power_kw,
         is_synthetic = false`,
      [profile.code, profile.name, profile.connectors, profile.maxDcPowerKw],
    );
  }
  await client.query("COMMIT");
  console.log(`Imported ${profiles.size} OpenEV vehicle profiles from ${sourceUrl}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
