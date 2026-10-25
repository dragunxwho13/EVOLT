"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { HEALTH_SHORT_LABELS, HEALTH_STATUSES, type HealthStatus } from "@/config/domain";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_ATTRIBUTION, MAP_TILE_URL } from "@/config/map";
import { HEALTH_HEX_VAR } from "@/components/ui/status";

export interface MapPointInput {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: HealthStatus;
  detail?: string;
}

export interface StationMapProps {
  points: MapPointInput[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  origin?: { lat: number; lng: number } | null;
  className?: string;
  ariaLabel?: string;
}

const GLYPH: Record<HealthStatus, string> = {
  normal: "✓",
  monitor: "◐",
  inspection_recommended: "!",
  insufficient_data: "–",
};

function pinIcon(status: HealthStatus, selected: boolean) {
  return L.divIcon({
    className: "evolt-pin",
    html: `<span data-selected="${selected}" style="background:${HEALTH_HEX_VAR[status]}"><i>${GLYPH[status]}</i></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    tooltipAnchor: [0, -24],
  });
}

// This module only ever loads in the browser (see station-map.tsx), so icons can be built once.
const ICONS = Object.fromEntries(
  HEALTH_STATUSES.flatMap((s) => [
    [`${s}:0`, pinIcon(s, false)],
    [`${s}:1`, pinIcon(s, true)],
  ]),
) as Record<string, L.DivIcon>;

/** Tooltip content built from text nodes, so imported station names can never inject HTML. */
function tooltipNode(p: MapPointInput): HTMLElement {
  const el = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = p.name;
  el.append(strong, document.createElement("br"), `${HEALTH_SHORT_LABELS[p.status]}${p.detail ? ` · ${p.detail}` : ""}`);
  return el;
}

/**
 * Imperative Leaflet map.
 *
 * Next.js (Cache Components) keeps visited pages alive in a hidden <Activity> and
 * re-runs their effects when they are shown again. Leaflet cannot re-initialise a
 * container it already owns, which crashed the page on back-navigation. Here every
 * mount creates a fresh child <div> and every cleanup fully removes the map, so the
 * component survives any number of hide/show cycles.
 */
export default function StationMapInner({ points, selectedId, onSelect, origin, className, ariaLabel }: StationMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedKeyRef = useRef<string>("");
  const propsRef = useRef({ points, selectedId, onSelect, origin });

  // Keep the latest props available to Leaflet event handlers.
  useEffect(() => {
    propsRef.current = { points, selectedId, onSelect, origin };
  });

  // Create / destroy the map.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.minHeight = "240px";
    container.style.borderRadius = "0.5rem";
    host.appendChild(container);
    const map = L.map(container, { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, scrollWheelZoom: true });
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    fittedKeyRef.current = "";
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(host);
    return () => {
      resize.disconnect();
      map.remove();
      container.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Draw markers whenever the data or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (origin) {
      L.circleMarker([origin.lat, origin.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#2457c5", fillOpacity: 1 })
        .bindTooltip("Reference point")
        .addTo(layer);
    }
    for (const p of points) {
      const selected = p.id === selectedId;
      const marker = L.marker([p.latitude, p.longitude], {
        icon: ICONS[`${p.status}:${selected ? 1 : 0}`],
        zIndexOffset: selected ? 1000 : 0,
        keyboard: true,
        title: `${p.name} — ${HEALTH_SHORT_LABELS[p.status]}`,
        alt: `${p.name} — ${HEALTH_SHORT_LABELS[p.status]}`,
      });
      marker.bindTooltip(tooltipNode(p), { direction: "top" });
      marker.on("click", () => propsRef.current.onSelect?.(p.id));
      marker.on("keypress", (e: L.LeafletKeyboardEvent) => {
        if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") propsRef.current.onSelect?.(p.id);
      });
      marker.addTo(layer);
    }

    // Frame the points once per distinct set (not on every selection change).
    const key = points.map((p) => p.id).join(",") + (origin ? `@${origin.lat},${origin.lng}` : "");
    if (fittedKeyRef.current !== key) {
      fittedKeyRef.current = key;
      const coords: [number, number][] = points.map((p) => [p.latitude, p.longitude]);
      if (origin) coords.push([origin.lat, origin.lng]);
      if (coords.length === 1) map.setView(coords[0]!, 13);
      else if (coords.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [36, 36], maxZoom: 14 });
    }
  }, [points, origin, selectedId]);

  // Fly to the selected station.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const p = points.find((x) => x.id === selectedId);
    if (!p) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.flyTo([p.latitude, p.longitude], Math.max(map.getZoom(), 12), { duration: reduce ? 0 : 0.6 });
  }, [selectedId, points]);

  return <div ref={hostRef} className={className} role="region" aria-label={ariaLabel ?? "Map of stations"} />;
}
