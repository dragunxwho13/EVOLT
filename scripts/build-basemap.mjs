#!/usr/bin/env node
/**
 * Builds public/basemap/south-asia.json — the offline background map EVOLT draws under its
 * station pins. No tile server or map API is used at runtime: this one static file is all.
 *
 * Source: Natural Earth 1:10m (public domain, https://www.naturalearthdata.com). Country
 * borders and land use Natural Earth's *India point-of-view* edition
 * (ne_10m_admin_0_countries_ind) so the map follows India's official boundaries.
 *
 * Steps (run once, outputs are committed):
 *   1. Download into ./basemap-src the GeoJSON files listed in SOURCES below from
 *      https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
 *   2. npx mapshaper@0.7.98 … (the exact commands are in MAPSHAPER below) → ./basemap-src/out
 *   3. node scripts/build-basemap.mjs ./basemap-src/out
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SOURCES = [
  "ne_10m_admin_0_countries_ind",
  "ne_10m_admin_1_states_provinces_lines",
  "ne_10m_roads",
  "ne_10m_populated_places_simple",
  "ne_10m_lakes",
  "ne_110m_land",
];

export const MAPSHAPER = `
B=66,4,99,38
mapshaper ne_10m_admin_0_countries_ind.geojson -clip bbox=$B -simplify 12% keep-shapes -o out/countries.json format=geojson precision=0.001
mapshaper ne_10m_admin_0_countries_ind.geojson -clip bbox=$B -simplify 12% keep-shapes -innerlines -o out/borders.json format=geojson precision=0.001
mapshaper ne_10m_admin_1_states_provinces_lines.geojson -filter "ADM0_A3=='IND'" -clip bbox=$B -simplify 15% -o out/states.json format=geojson precision=0.001
mapshaper ne_10m_roads.geojson -filter "continent=='Asia' && (type=='Major Highway' || type=='Secondary Highway' || (type=='Road' && scalerank<=6))" -clip bbox=$B -clip out/countries.json -simplify 25% -filter-fields type,scalerank -o out/roads.json format=geojson precision=0.001
mapshaper ne_10m_populated_places_simple.geojson -clip bbox=$B -filter-fields name,scalerank,pop_max,adm0_a3 -o out/places.json format=geojson precision=0.0001
mapshaper ne_10m_lakes.geojson -clip bbox=$B -simplify 15% keep-shapes -filter-fields name -o out/lakes.json format=geojson precision=0.001
mapshaper ne_110m_land.geojson -o out/world.json format=geojson precision=0.01
`;

const dir = process.argv[2] ?? "basemap-src/out";
/** Reads a mapshaper output as a list of features (it writes GeometryCollections for line-only layers). */
const read = (name) => {
  const json = JSON.parse(readFileSync(path.join(dir, `${name}.json`), "utf8"));
  const features = json.features ?? (json.geometries ?? []).map((geometry) => ({ properties: {}, geometry }));
  return { features };
};
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
/** Flattens [[lon, lat], …] to [lon, lat, lon, lat, …] — about half the size. */
const flat = (coords, d = 3) => coords.flatMap(([x, y]) => [round(x, d), round(y, d)]);

function rings(geometry, d) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.map((r) => flat(r, d));
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((p) => p.map((r) => flat(r, d)));
  return [];
}
function lines(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [flat(geometry.coordinates)];
  if (geometry.type === "MultiLineString") return geometry.coordinates.map((l) => flat(l));
  return [];
}

const countries = read("countries").features.map((f) => ({ a3: f.properties.ADM0_A3, rings: rings(f.geometry, 3) }));
const out = {
  attribution: "Made with Natural Earth (public domain). Borders: India point of view.",
  bbox: [66, 4, 99, 38],
  countries,
  borders: read("borders").features.flatMap((f) => lines(f.geometry)),
  states: read("states").features.flatMap((f) => lines(f.geometry)),
  roads: read("roads").features.flatMap((f) =>
    lines(f.geometry).map((c) => ({ major: f.properties.type === "Major Highway" ? 1 : 0, c })),
  ),
  lakes: read("lakes").features.flatMap((f) => rings(f.geometry, 3)),
  places: read("places")
    .features.map((f) => [f.properties.name, round(f.geometry.coordinates[0], 4), round(f.geometry.coordinates[1], 4), f.properties.scalerank])
    .sort((a, b) => a[3] - b[3]),
  world: read("world").features.flatMap((f) => rings(f.geometry, 2)),
};

mkdirSync("public/basemap", { recursive: true });
const file = "public/basemap/south-asia.json";
writeFileSync(file, JSON.stringify(out));
console.log(`Wrote ${file}: ${countries.length} countries, ${out.borders.length} borders, ${out.states.length} state lines, ${out.roads.length} roads, ${out.places.length} places.`);
