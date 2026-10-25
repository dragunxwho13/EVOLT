"use client";

import { Crosshair, Maximize2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HealthStatus } from "@/config/domain";
import { HealthGlyph } from "@/components/ui/status";
import { cn } from "@/lib/utils/cn";
import {
  MAX_ZOOM,
  clampZoom,
  clusterPoints,
  fitView,
  fromScreen,
  metresPerPixel,
  pathFromFlat,
  project,
  scaleBar,
  toScreen,
  unproject,
  type Size,
  type View,
} from "./geo";

/** How a station pin looks. Health variants carry a glyph so meaning never depends on colour. */
export type MarkerVariant = "best" | "result" | "context" | HealthStatus;

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  variant: MarkerVariant;
  /** Short text inside the pin (e.g. a rank). */
  label?: string;
  /** Accessible name, e.g. "Demo Site A — best match, 3.9 km". */
  title: string;
}

export interface LegendItem {
  variant: MarkerVariant | "origin";
  label: string;
}

export interface EvoltMapProps {
  points: MapPoint[];
  origin?: { lat: number; lng: number; label: string } | null;
  radiusKm?: number | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Content of the popup for one station. */
  renderPopup: (point: MapPoint) => ReactNode;
  /** When set, clicking empty map offers "search from here". */
  onPickLocation?: (lat: number, lng: number) => void;
  legend?: LegendItem[];
  ariaLabel: string;
  className?: string;
  /** Changing this value re-fits the view to the points (e.g. after a new search). */
  fitKey?: string;
  /** Station ids to frame (with the origin); defaults to every point plus the radius. */
  focusIds?: string[];
  footnote?: ReactNode;
}

/* ───────── base map (one static file, loaded once) ───────── */

interface BaseMapData {
  attribution: string;
  countries: { a3: string; rings: number[][] }[];
  borders: number[][];
  states: number[][];
  roads: { major: number; c: number[] }[];
  lakes: number[][];
  places: [string, number, number, number][];
  world: number[][];
}

interface BaseMapPaths {
  world: string;
  india: string;
  neighbours: string;
  lakes: string;
  borders: string;
  states: string;
  majorRoads: string;
  roads: string;
  places: BaseMapData["places"];
  attribution: string;
}

let baseMapPromise: Promise<BaseMapPaths> | null = null;
function loadBaseMap(): Promise<BaseMapPaths> {
  baseMapPromise ??= fetch("/basemap/south-asia.json")
    .then((r) => {
      if (!r.ok) throw new Error(`Base map ${r.status}`);
      return r.json() as Promise<BaseMapData>;
    })
    .then((d) => ({
      world: pathFromFlat(d.world, true),
      india: pathFromFlat(d.countries.filter((c) => c.a3 === "IND").flatMap((c) => c.rings), true),
      neighbours: pathFromFlat(d.countries.filter((c) => c.a3 !== "IND").flatMap((c) => c.rings), true),
      lakes: pathFromFlat(d.lakes, true),
      borders: pathFromFlat(d.borders, false),
      states: pathFromFlat(d.states, false),
      majorRoads: pathFromFlat(d.roads.filter((r) => r.major).map((r) => r.c), false),
      roads: pathFromFlat(d.roads.filter((r) => !r.major).map((r) => r.c), false),
      places: d.places,
      attribution: d.attribution,
    }))
    .catch((e) => {
      baseMapPromise = null;
      throw e;
    });
  return baseMapPromise;
}

/* ───────── marker styling ───────── */

const MARKER: Record<MarkerVariant, { size: number; className: string; glyph?: string }> = {
  best: { size: 38, className: "bg-signal text-signal-ink ring-4 ring-signal/25", glyph: "★" },
  result: { size: 28, className: "bg-ink text-surface", glyph: undefined },
  context: { size: 16, className: "border-2 border-faint bg-surface text-transparent" },
  normal: { size: 26, className: "bg-surface text-ok ring-2 ring-ok" },
  monitor: { size: 26, className: "bg-surface text-watch ring-2 ring-watch" },
  inspection_recommended: { size: 28, className: "bg-surface text-inspect ring-2 ring-inspect" },
  insufficient_data: { size: 24, className: "bg-surface text-unknown ring-2 ring-unknown/60" },
};
const SEVERITY: MarkerVariant[] = ["best", "inspection_recommended", "monitor", "result", "insufficient_data", "normal", "context"];

function Pin({ variant, label, small = false }: { variant: MarkerVariant | "origin"; label?: string; small?: boolean }) {
  if (variant === "origin") {
    return <span className="block h-3.5 w-3.5 rounded-full border-2 border-surface bg-signal shadow-[0_0_0_4px_color-mix(in_srgb,var(--signal)_25%,transparent)]" />;
  }
  const m = MARKER[variant];
  const size = small ? Math.min(m.size, 18) : m.size;
  if (variant === "normal" || variant === "monitor" || variant === "inspection_recommended" || variant === "insufficient_data") {
    // Health pins reuse the app's status glyphs (shape + colour), never colour alone.
    return (
      <span className={cn("grid place-items-center rounded-full shadow-lift", m.className)} style={{ width: size, height: size }}>
        <HealthGlyph status={variant} className={small ? "scale-90" : "scale-125"} />
      </span>
    );
  }
  return (
    <span
      className={cn("grid place-items-center rounded-full text-[0.7rem] leading-none font-semibold shadow-lift", m.className)}
      style={{ width: size, height: size, fontSize: small ? 10 : undefined }}
    >
      {small ? (m.glyph ?? "") : (label ?? m.glyph ?? "")}
    </span>
  );
}

/* ───────── component ───────── */

type Popup = { kind: "station"; id: string } | { kind: "group"; ids: string[]; lng: number; lat: number } | { kind: "pick"; lng: number; lat: number };

export function EvoltMap({
  points,
  origin,
  radiusKm,
  selectedId,
  onSelect,
  renderPopup,
  onPickLocation,
  legend,
  ariaLabel,
  className,
  fitKey,
  focusIds,
  footnote,
}: EvoltMapProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [base, setBase] = useState<BaseMapPaths | null>(null);
  const [baseError, setBaseError] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch?: { dist: number; zoom: number } } | null>(null);

  useEffect(() => {
    let alive = true;
    loadBaseMap()
      .then((b) => alive && setBase(b))
      .catch(() => alive && setBaseError(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize((s) => (s && Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Points the initial view must show: stations, the origin and the radius circle. */
  const fitTargets = useMemo(() => {
    const focus = focusIds?.length ? points.filter((p) => focusIds.includes(p.id)) : null;
    const pts = (focus?.length ? focus : points).map((p) => ({ lng: p.lng, lat: p.lat }));
    if (origin) {
      pts.push({ lng: origin.lng, lat: origin.lat });
      if (radiusKm && !focus?.length) {
        const dLat = radiusKm / 111.32;
        const dLng = radiusKm / (111.32 * Math.cos((origin.lat * Math.PI) / 180));
        pts.push({ lng: origin.lng, lat: origin.lat + dLat }, { lng: origin.lng, lat: origin.lat - dLat }, { lng: origin.lng + dLng, lat: origin.lat }, { lng: origin.lng - dLng, lat: origin.lat });
      }
    }
    return pts;
  }, [points, origin, radiusKm, focusIds]);

  const fit = useCallback(() => {
    if (size) setView(fitView(fitTargets, size, 56, 12.5));
  }, [fitTargets, size]);

  // Fit when the map first gets a size, and whenever the caller signals a new result set
  // (state adjusted during render — React's pattern for reacting to a changed input).
  // Points that arrive after the first paint (async data) also trigger a fit.
  const fitToken = size ? `${fitKey ?? "initial"}|${points.length > 0 ? "points" : "empty"}` : null;
  const [fittedFor, setFittedFor] = useState<string | null>(null);
  if (size && fitToken !== fittedFor) {
    setFittedFor(fitToken);
    setView(fitView(fitTargets, size, 56, 12.5));
    setPopup(null);
  }

  // A selection made outside the map (e.g. a result card) opens its popup and brings it into view.
  const [shownSelection, setShownSelection] = useState<string | null>(null);
  if (view && size && (selectedId ?? null) !== shownSelection) {
    setShownSelection(selectedId ?? null);
    const p = selectedId ? points.find((x) => x.id === selectedId) : null;
    if (p) {
      setPopup({ kind: "station", id: p.id });
      const [sx, sy] = toScreen(view, size, p.lng, p.lat);
      const inside = sx > 40 && sx < size.width - 40 && sy > 60 && sy < size.height - 40;
      if (!inside) setView({ ...view, lng: p.lng, lat: p.lat });
    }
  }

  /** Zooms keeping the point under (sx, sy) fixed; `next` maps the current zoom to the new one. */
  const zoomAt = useCallback(
    (next: (zoom: number) => number, sx?: number, sy?: number) => {
      setView((v) => {
        if (!v || !size) return v;
        const z = clampZoom(next(v.zoom));
        const px = sx ?? size.width / 2;
        const py = sy ?? size.height / 2;
        const [lng, lat] = fromScreen(v, size, px, py);
        const [wx, wy] = project(lng, lat);
        const s = 2 ** z;
        const [clng, clat] = unproject(wx - (px - size.width / 2) / s, wy - (py - size.height / 2) / s);
        return { lng: clng, lat: clat, zoom: z };
      });
    },
    [size],
  );

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Let popups and the legend scroll normally; only the map surface zooms.
      if (e.target instanceof Element && e.target.closest("[data-map-ui]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const delta = Math.max(-1, Math.min(1, -e.deltaY / 240));
      zoomAt((z) => z + delta, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const isMapSurface = (target: EventTarget | null) => !(target instanceof Element) || !target.closest("[data-map-ui]");

  const onPointerDown = (e: React.PointerEvent) => {
    if (!view || !isMapSurface(e.target)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pointers = drag.current?.pointers ?? new Map();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      drag.current = { x: e.clientX, y: e.clientY, view, moved: true, pointers, pinch: { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: view.zoom } };
    } else {
      drag.current = { x: e.clientX, y: e.clientY, view, moved: false, pointers };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !size || !d.pointers.has(e.pointerId)) return;
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pinch && d.pointers.size === 2) {
      const [a, b] = [...d.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const r = boxRef.current!.getBoundingClientRect();
      const target = d.pinch.zoom + Math.log2(dist / d.pinch.dist);
      zoomAt(() => target, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top);
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const s = 2 ** d.view.zoom;
    const [cx, cy] = project(d.view.lng, d.view.lat);
    const [lng, lat] = unproject(cx - dx / s, cy - dy / s);
    setView({ ...d.view, lng, lat });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.pointers.delete(e.pointerId);
    if (d.pointers.size > 0) return;
    drag.current = null;
    if (d.moved || !view || !size || !isMapSurface(e.target)) return;
    // A click on empty map: offer to search from here, or just close the popup.
    const r = boxRef.current!.getBoundingClientRect();
    const [lng, lat] = fromScreen(view, size, e.clientX - r.left, e.clientY - r.top);
    if (onPickLocation) setPopup({ kind: "pick", lng, lat });
    else {
      setPopup(null);
      onSelect?.(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!view || !size || !isMapSurface(e.target)) {
      if (e.key === "Escape") setPopup(null);
      return;
    }
    const step = 80 / 2 ** view.zoom;
    const [cx, cy] = project(view.lng, view.lat);
    const pan = (dx: number, dy: number) => {
      const [lng, lat] = unproject(cx + dx * step, cy + dy * step);
      setView({ ...view, lng, lat });
    };
    if (e.key === "ArrowLeft") pan(-1, 0);
    else if (e.key === "ArrowRight") pan(1, 0);
    else if (e.key === "ArrowUp") pan(0, -1);
    else if (e.key === "ArrowDown") pan(0, 1);
    else if (e.key === "+" || e.key === "=") zoomAt((z) => z + 0.75);
    else if (e.key === "-") zoomAt((z) => z - 0.75);
    else if (e.key === "Escape") setPopup(null);
    else return;
    e.preventDefault();
  };

  /* ───── derived screen geometry ───── */

  const screen = useMemo(() => {
    if (!view || !size) return null;
    const placed = points.map((p) => {
      const [x, y] = toScreen(view, size, p.lng, p.lat);
      return { item: p, x, y };
    });
    const visible = placed.filter((p) => p.x > -40 && p.x < size.width + 40 && p.y > -40 && p.y < size.height + 40);
    // The best match is never folded into a group: it must always be visible on its own.
    const best = visible.filter((p) => p.item.variant === "best");
    const clusters = [
      ...clusterPoints(
        visible.filter((p) => p.item.variant !== "best"),
        30,
      ),
      ...best.map((p) => ({ key: p.item.id, x: p.x, y: p.y, items: [p.item] })),
    ].map((c) => ({
      ...c,
      variant: SEVERITY.find((v) => c.items.some((i) => i.variant === v)) ?? "context",
    }));

    // Place labels: bigger cities first, no overlaps, more appear as you zoom in.
    const labels: { name: string; x: number; y: number; major: boolean }[] = [];
    if (base) {
      const maxRank = Math.floor(view.zoom - 1.2);
      const boxes: [number, number, number, number][] = clusters.map((c) => [c.x - 16, c.y - 16, c.x + 16, c.y + 16]);
      for (const [name, lng, lat, rank] of base.places) {
        if (rank > maxRank) continue;
        const [x, y] = toScreen(view, size, lng, lat);
        if (x < 0 || y < 0 || x > size.width || y > size.height) continue;
        const w = name.length * 6.6 + 10;
        const box: [number, number, number, number] = [x - w / 2, y - 18, x + w / 2, y + 4];
        if (boxes.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
        boxes.push(box);
        labels.push({ name, x, y, major: rank <= 3 });
        if (labels.length > 40) break;
      }
    }

    const [ox, oy] = origin ? toScreen(view, size, origin.lng, origin.lat) : [0, 0];
    const radiusPx = origin && radiusKm ? (radiusKm * 1000) / metresPerPixel(origin.lat, view.zoom) : 0;
    const [cx, cy] = project(view.lng, view.lat);
    const s = 2 ** view.zoom;
    return {
      clusters,
      labels,
      origin: origin ? { x: ox, y: oy, r: radiusPx } : null,
      transform: `translate(${size.width / 2 - cx * s} ${size.height / 2 - cy * s}) scale(${s})`,
      scale: scaleBar(view.lat, view.zoom),
    };
  }, [view, size, points, base, origin, radiusKm]);

  const popupPoint = popup?.kind === "station" ? points.find((p) => p.id === popup.id) : null;
  const popupAnchor = (() => {
    if (!popup || !view || !size) return null;
    const ll = popup.kind === "station" ? popupPoint : popup;
    if (!ll) return null;
    const [x, y] = toScreen(view, size, ll.lng, ll.lat);
    const width = Math.min(310, size.width - 16);
    const left = Math.max(8, Math.min(size.width - width - 8, x - width / 2));
    // Open on the side with more room, and scroll inside if the content is taller still.
    const spaceAbove = y - 30;
    const spaceBelow = size.height - y - 30;
    const below = spaceBelow > spaceAbove;
    return { left, width, x, y, below, maxHeight: Math.max(140, below ? spaceBelow : spaceAbove) };
  })();

  const openCluster = (c: { items: MapPoint[]; x: number; y: number }) => {
    if (!view || !size) return;
    if (c.items.length === 1) {
      setPopup({ kind: "station", id: c.items[0]!.id });
      onSelect?.(c.items[0]!.id);
      return;
    }
    const target = fitView(c.items, size, 80, MAX_ZOOM);
    if (target.zoom - view.zoom > 0.5) {
      setView(target);
      setPopup(null);
    } else {
      const [lng, lat] = fromScreen(view, size, c.x, c.y);
      setPopup({ kind: "group", ids: c.items.map((i) => i.id), lng, lat });
    }
  };

  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-line bg-[var(--map-water)]", className)}>
      <div
        ref={boxRef}
        role="region"
        aria-label={`${ariaLabel}. Use arrow keys to pan and plus or minus to zoom.`}
        tabIndex={0}
        className="absolute inset-0 cursor-grab touch-none select-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-inset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {size && screen && (
          <svg width={size.width} height={size.height} className="absolute inset-0" aria-hidden>
            {base && (
              <g transform={screen.transform}>
                <path d={base.world} fill="var(--map-land)" />
                <path d={base.neighbours} fill="var(--map-land)" stroke="none" />
                <path d={base.india} fill="var(--map-land-focus)" stroke="none" />
                <path d={base.lakes} fill="var(--map-water)" />
                {view!.zoom >= 6.2 && <path d={base.roads} fill="none" stroke="var(--map-road)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
                {view!.zoom >= 5 && <path d={base.majorRoads} fill="none" stroke="var(--map-road)" strokeWidth={view!.zoom >= 8 ? 2.2 : 1.4} vectorEffect="non-scaling-stroke" />}
                <path d={base.states} fill="none" stroke="var(--map-state)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                <path d={base.borders} fill="none" stroke="var(--map-border)" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />
                <path d={base.india} fill="none" stroke="var(--map-border)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
              </g>
            )}
            {screen.origin && screen.origin.r > 0 && (
              <circle cx={screen.origin.x} cy={screen.origin.y} r={screen.origin.r} fill="color-mix(in srgb, var(--signal) 7%, transparent)" stroke="var(--signal)" strokeWidth={1.5} strokeDasharray="6 5" />
            )}
          </svg>
        )}

        {screen?.labels.map((l) => (
          <span
            key={`${l.name}-${l.x.toFixed(0)}`}
            className={cn("pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-[0.7rem] text-[var(--map-label)] [text-shadow:0_0_3px_var(--map-land-focus),0_0_3px_var(--map-land-focus)]", l.major && "font-semibold text-[0.78rem]")}
            style={{ left: l.x, top: l.y }}
          >
            {l.name}
          </span>
        ))}

        {screen?.origin && (
          <span data-map-ui className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: screen.origin.x, top: screen.origin.y }} title={origin!.label}>
            <Pin variant="origin" />
            <span className="sr-only">{origin!.label}</span>
          </span>
        )}

        {screen?.clusters.map((c) => {
          const single = c.items.length === 1 ? c.items[0]! : null;
          const selected = single ? single.id === selectedId || (popup?.kind === "station" && popup.id === single.id) : false;
          return (
            <button
              key={c.key}
              type="button"
              data-map-ui
              onClick={() => openCluster(c)}
              aria-label={single ? single.title : `${c.items.length} stations here: ${c.items.map((i) => i.name).join(", ")}. Select to zoom in.`}
              aria-pressed={single ? selected : undefined}
              className={cn(
                "absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-transform duration-150 hover:scale-110 focus-visible:scale-110",
                selected && "z-10 scale-110 outline outline-2 outline-offset-2 outline-ink",
                c.items.some((i) => i.variant === "best") && "z-20",
              )}
              style={{ left: c.x, top: c.y }}
            >
              {single ? (
                <>
                  <Pin variant={single.variant} label={single.label} />
                  {single.variant === "best" && (
                    <span className="absolute top-full mt-1 rounded bg-signal px-1.5 py-px text-[0.68rem] font-semibold whitespace-nowrap text-signal-ink shadow-lift">Best match</span>
                  )}
                </>
              ) : (
                <span className="relative grid h-10 w-10 place-items-center rounded-full border-2 border-dashed border-ink bg-surface text-[0.7rem] leading-none font-semibold text-ink shadow-lift">
                  <span>
                    {c.items.length}
                    <span className="block text-[0.55rem] font-medium text-muted">sites</span>
                  </span>
                  <span className="absolute -top-1.5 -right-1.5">
                    <Pin variant={c.variant} small />
                  </span>
                </span>
              )}
            </button>
          );
        })}

        {popup && popupAnchor && (
          <div
            data-map-ui
            role="dialog"
            aria-label={popup.kind === "station" && popupPoint ? popupPoint.name : popup.kind === "group" ? "Stations at this spot" : "Search here"}
            className="absolute z-30 overflow-auto overscroll-contain rounded-lg border border-line bg-surface p-3.5 text-sm shadow-lift"
            style={{
              left: popupAnchor.left,
              width: popupAnchor.width,
              maxHeight: popupAnchor.maxHeight,
              ...(popupAnchor.below ? { top: popupAnchor.y + 24 } : { bottom: (size?.height ?? 0) - popupAnchor.y + 24 }),
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setPopup(null);
                onSelect?.(null);
              }}
              aria-label="Close"
              className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            {popup.kind === "station" && popupPoint && renderPopup(popupPoint)}
            {popup.kind === "group" && (
              <>
                <p className="mb-2 pr-8 font-semibold">{popup.ids.length} stations at this spot</p>
                <ul className="space-y-1">
                  {popup.ids.map((id) => {
                    const p = points.find((x) => x.id === id)!;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sunken"
                          onClick={() => {
                            setPopup({ kind: "station", id });
                            onSelect?.(id);
                          }}
                        >
                          <Pin variant={p.variant} label={p.label} small />
                          {p.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {popup.kind === "pick" && onPickLocation && (
              <>
                <p className="pr-8 font-semibold">Search from this point?</p>
                <p className="num mt-0.5 text-xs text-muted">
                  {popup.lat.toFixed(4)}, {popup.lng.toFixed(4)}
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-surface hover:bg-ink/85"
                  onClick={() => {
                    onPickLocation(popup.lat, popup.lng);
                    setPopup(null);
                  }}
                >
                  <Crosshair className="h-4 w-4" aria-hidden />
                  Find chargers near here
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div data-map-ui className="absolute top-3 right-3 z-20 flex flex-col overflow-hidden rounded-md border border-line bg-surface shadow-lift">
        <button type="button" aria-label="Zoom in" className="grid h-8 w-8 place-items-center hover:bg-sunken" onClick={() => zoomAt((z) => z + 1)}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label="Zoom out" className="grid h-8 w-8 place-items-center border-t border-line hover:bg-sunken" onClick={() => zoomAt((z) => z - 1)}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label="Fit all stations" title="Fit all stations" className="grid h-8 w-8 place-items-center border-t border-line hover:bg-sunken" onClick={fit}>
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {legend && legend.length > 0 && (
        <button
          type="button"
          data-map-ui
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          className="absolute top-3 left-3 z-20 rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium shadow-lift sm:hidden"
        >
          {legendOpen ? "Hide key" : "Key"}
        </button>
      )}
      {legend && legend.length > 0 && (
        <ul
          data-map-ui
          className={cn(
            "absolute left-3 z-20 max-w-[60%] space-y-1 rounded-md border border-line bg-surface/95 px-2.5 py-2 text-xs shadow-lift sm:top-3 sm:block",
            legendOpen ? "top-11 block" : "hidden",
          )}
          aria-label="Map legend"
        >
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-2">
              <span className="grid w-5 place-items-center">
                <Pin variant={l.variant} small />
              </span>
              {l.label}
            </li>
          ))}
        </ul>
      )}

      {screen && (
        <div className="pointer-events-none absolute bottom-2 left-3 z-20 flex items-end gap-3 text-[0.68rem] text-muted">
          <span>
            <span className="block h-1.5 border-x border-b border-ink/60" style={{ width: screen.scale.px }} />
            {screen.scale.label}
          </span>
        </div>
      )}
      <p className="pointer-events-none absolute right-2 bottom-1.5 z-20 rounded bg-surface/80 px-1.5 text-[0.65rem] text-muted">
        {baseError ? "Base map unavailable — stations shown on a blank background" : "Base map: Natural Earth (public domain) · India boundaries"}
      </p>
      {footnote && <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center px-3">{footnote}</div>}
    </div>
  );
}
