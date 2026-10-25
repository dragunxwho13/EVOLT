/** Public map configuration. Attribution is always rendered on the map. */
export const MAP_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Used only to frame an empty map; never presented as a station location. */
export const DEFAULT_MAP_CENTER: [number, number] = [20.5937, 78.9629];
export const DEFAULT_MAP_ZOOM = 4;
