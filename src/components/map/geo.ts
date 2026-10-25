/**
 * Web Mercator maths for EVOLT's self-contained map. Pure and dependency-free.
 * "World pixels" are measured at zoom 0, where the whole world is TILE × TILE pixels.
 */
export const TILE = 256;
const MAX_LAT = 85.05112878;

export interface View {
  /** Map centre. */
  lng: number;
  lat: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export function project(lng: number, lat: number): [number, number] {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * TILE;
  const y = (0.5 - Math.log((1 + Math.sin(phi)) / (1 - Math.sin(phi))) / (4 * Math.PI)) * TILE;
  return [x, y];
}

export function unproject(x: number, y: number): [number, number] {
  const lng = (x / TILE) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / TILE;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
}

/** Screen position (CSS pixels inside the map box) of a coordinate. */
export function toScreen(view: View, size: Size, lng: number, lat: number): [number, number] {
  const s = 2 ** view.zoom;
  const [cx, cy] = project(view.lng, view.lat);
  const [x, y] = project(lng, lat);
  return [(x - cx) * s + size.width / 2, (y - cy) * s + size.height / 2];
}

export function fromScreen(view: View, size: Size, sx: number, sy: number): [number, number] {
  const s = 2 ** view.zoom;
  const [cx, cy] = project(view.lng, view.lat);
  return unproject(cx + (sx - size.width / 2) / s, cy + (sy - size.height / 2) / s);
}

/** Metres represented by one screen pixel at a latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** zoom);
}

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 15;

export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** The view that fits all points with padding; a single point gets a city-level zoom. */
export function fitView(points: { lng: number; lat: number }[], size: Size, padding = 48, maxZoom = 12): View {
  if (points.length === 0) return { lng: 80.5, lat: 21, zoom: 4.2 };
  const xs = points.map((p) => project(p.lng, p.lat));
  const minX = Math.min(...xs.map((p) => p[0]));
  const maxX = Math.max(...xs.map((p) => p[0]));
  const minY = Math.min(...xs.map((p) => p[1]));
  const maxY = Math.max(...xs.map((p) => p[1]));
  const [lng, lat] = unproject((minX + maxX) / 2, (minY + maxY) / 2);
  const w = Math.max(1e-9, maxX - minX);
  const h = Math.max(1e-9, maxY - minY);
  const zx = Math.log2(Math.max(1, size.width - 2 * padding) / w);
  const zy = Math.log2(Math.max(1, size.height - 2 * padding) / h);
  return { lng, lat, zoom: clampZoom(Math.min(zx, zy, maxZoom)) };
}

/** A "nice" scale-bar length (1, 2 or 5 × 10ⁿ metres) that fits in `maxPx`. */
export function scaleBar(lat: number, zoom: number, maxPx = 110): { metres: number; px: number; label: string } {
  const mpp = metresPerPixel(lat, zoom);
  const raw = mpp * maxPx;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const nice = [5, 2, 1].map((m) => m * pow).find((m) => m <= raw) ?? pow;
  return { metres: nice, px: nice / mpp, label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
}

/** Converts flat [lng, lat, lng, lat, …] arrays into one SVG path in world pixels (zoom 0). */
export function pathFromFlat(parts: number[][], closed: boolean): string {
  let d = "";
  for (const flat of parts) {
    for (let i = 0; i < flat.length; i += 2) {
      const [x, y] = project(flat[i]!, flat[i + 1]!);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(4)} ${y.toFixed(4)}`;
    }
    if (closed) d += "Z";
  }
  return d;
}

export interface Cluster<T> {
  key: string;
  x: number;
  y: number;
  items: T[];
}

/** Greedy screen-space clustering: items closer than `radius` pixels share one marker. */
export function clusterPoints<T extends { id: string }>(items: { item: T; x: number; y: number }[], radius: number): Cluster<T>[] {
  const clusters: { x: number; y: number; items: { item: T; x: number; y: number }[] }[] = [];
  for (const p of items) {
    const c = clusters.find((k) => Math.hypot(k.x - p.x, k.y - p.y) < radius);
    if (c) {
      c.items.push(p);
      c.x = c.items.reduce((a, q) => a + q.x, 0) / c.items.length;
      c.y = c.items.reduce((a, q) => a + q.y, 0) / c.items.length;
    } else {
      clusters.push({ x: p.x, y: p.y, items: [p] });
    }
  }
  return clusters.map((c) => ({ key: c.items.map((i) => i.item.id).sort().join("|"), x: c.x, y: c.y, items: c.items.map((i) => i.item) }));
}
