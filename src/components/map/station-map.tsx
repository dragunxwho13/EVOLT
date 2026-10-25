"use client";

import dynamic from "next/dynamic";
import type { StationMapProps } from "./station-map-inner";

/** Leaflet needs `window`, so the map is loaded only in the browser. */
export const StationMap = dynamic<StationMapProps>(() => import("./station-map-inner"), {
  ssr: false,
  loading: () => (
    <div className="skeleton grid h-full min-h-60 w-full place-items-center rounded-lg" aria-busy="true">
      <span className="text-sm text-muted">Loading map…</span>
    </div>
  ),
});

export type { MapPointInput } from "./station-map-inner";
