"use client";

import { List, LocateFixed, Map as MapIcon, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONNECTOR_LABELS,
  CONNECTOR_TYPES,
  HEALTH_LABELS,
  HEALTH_STATUSES,
  OPERATIONAL_LABELS,
  OPERATIONAL_STATUSES,
  type OperationalStatus,
} from "@/config/domain";
import { StationMap } from "@/components/map/station-map";
import { Button, ErrorState, Field, inputClass } from "@/components/ui/primitives";
import { HealthBadge, SyntheticTag } from "@/components/ui/status";
import type { StationListItem, StationListResult } from "@/features/station-discovery/service";
import { cn } from "@/lib/utils/cn";
import { formatDistanceKm, formatNumber } from "@/lib/utils/format";

type GeoState = { status: "idle" } | { status: "locating" } | { status: "ok"; lat: number; lng: number } | { status: "error"; message: string };

const POWER_OPTIONS = [22, 50, 100, 150];

function stationMarkerStatus(station: StationListItem): OperationalStatus {
  if (station.availableCount > 0) return "available";
  if (station.chargers.length > 0 && station.chargers.every((c) => c.operationalStatus === "in_use")) return "in_use";
  if (station.chargers.length > 0 && station.chargers.every((c) => c.operationalStatus === "offline")) return "offline";
  return "unknown";
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function StationExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const debouncedQ = useDebounced(q, 300);
  const connector = params.get("connector") ?? "";
  const minPowerKw = params.get("minPowerKw") ?? "";
  const availability = params.get("availability") ?? "";
  const health = params.get("health") ?? "";

  const [geo, setGeo] = useState<GeoState>({ status: "idle" });
  const [response, setResponse] = useState<{ key: string; data: StationListResult | null; error: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const registerItem = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) itemRefs.current.set(id, el);
    else itemRefs.current.delete(id);
  }, []);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if ((params.get("q") ?? "") !== debouncedQ) setParam("q", debouncedQ.trim());
  }, [debouncedQ, params, setParam]);

  const apiQuery = useMemo(() => {
    const s = new URLSearchParams();
    if (debouncedQ.trim()) s.set("q", debouncedQ.trim());
    if (connector) s.set("connector", connector);
    if (minPowerKw) s.set("minPowerKw", minPowerKw);
    if (availability) s.set("availability", availability);
    if (health) s.set("health", health);
    if (geo.status === "ok") {
      s.set("lat", String(geo.lat));
      s.set("lng", String(geo.lng));
    }
    s.set("limit", "500");
    return s.toString();
  }, [debouncedQ, connector, minPowerKw, availability, health, geo]);

  const requestKey = `${apiQuery}#${reloadKey}`;
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/stations?${apiQuery}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Stations could not be loaded.");
        setResponse({ key: requestKey, data: body.data as StationListResult, error: null });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setResponse((prev) => ({ key: requestKey, data: prev?.data ?? null, error: (err as Error).message || "Stations could not be loaded." }));
      });
    return () => ctrl.abort();
  }, [apiQuery, requestKey]);
  // Keep showing the previous results while a new request is in flight.
  const loading = response?.key !== requestKey;
  const data = response?.data ?? null;
  const error = !loading ? response?.error ?? null : null;

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeo({ status: "error", message: "This browser does not support location." });
      return;
    }
    setGeo({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ status: "ok", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        setGeo({
          status: "error",
          message:
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied. Stations are listed by name instead."
              : "Your location could not be determined. Stations are listed by name instead.",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const select = (id: string, fromMap: boolean) => {
    setSelectedId(id);
    if (fromMap) {
      itemRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };

  const items = data?.items ?? [];
  const mapPoints = items
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      latitude: s.latitude!,
      longitude: s.longitude!,
      status: s.worstHealth,
      markerStatus: stationMarkerStatus(s),
      detail: `${s.chargerCount} charger${s.chargerCount === 1 ? "" : "s"}`,
      chargers: s.chargers.map((c) => ({
        id: c.id,
        code: c.code,
        connector: CONNECTOR_LABELS[c.connectorType],
        powerKw: c.ratedPowerKw,
        operational: OPERATIONAL_LABELS[c.operationalStatus],
        health: c.healthStatus,
        alerts: c.activeAlerts,
      })),
    }));
  const selected = items.find((s) => s.id === selectedId) ?? null;
  const hasFilters = Boolean(q || connector || minPowerKw || availability || health);

  return (
    <div>
      <div className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-3 sm:p-4 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <Field label="Search" htmlFor="station-q">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              id="station-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, code, city or operator"
              className={cn(inputClass, "pl-8")}
              autoComplete="off"
            />
          </div>
        </Field>
        <Field label="Connector" htmlFor="f-connector">
          <select id="f-connector" className={inputClass} value={connector} onChange={(e) => setParam("connector", e.target.value)}>
            <option value="">Any</option>
            {CONNECTOR_TYPES.map((c) => (
              <option key={c} value={c}>
                {CONNECTOR_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minimum power" htmlFor="f-power">
          <select id="f-power" className={inputClass} value={minPowerKw} onChange={(e) => setParam("minPowerKw", e.target.value)}>
            <option value="">Any</option>
            {POWER_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p} kW or more
              </option>
            ))}
          </select>
        </Field>
        <Field label="Availability" htmlFor="f-avail">
          <select id="f-avail" className={inputClass} value={availability} onChange={(e) => setParam("availability", e.target.value)}>
            <option value="">Any</option>
            {OPERATIONAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {OPERATIONAL_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Health" htmlFor="f-health">
          <select id="f-health" className={inputClass} value={health} onChange={(e) => setParam("health", e.target.value)}>
            <option value="">Any</option>
            {HEALTH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {HEALTH_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={locate} disabled={geo.status === "locating"}>
          <LocateFixed aria-hidden className="h-4 w-4" />
          {geo.status === "locating" ? "Locating…" : geo.status === "ok" ? "Update my location" : "Sort by distance from me"}
        </Button>
        {geo.status === "ok" && (
          <Button size="sm" variant="ghost" onClick={() => setGeo({ status: "idle" })}>
            <X aria-hidden className="h-4 w-4" />
            Stop using location
          </Button>
        )}
        {hasFilters && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ("");
              router.replace(pathname, { scroll: false });
            }}
          >
            Clear filters
          </Button>
        )}
        <p className="ml-auto text-sm text-muted" aria-live="polite">
          {loading ? "Loading stations…" : data ? `${data.total} station${data.total === 1 ? "" : "s"}` : ""}
          {data?.sortedByDistance && !loading ? ", nearest first (straight-line)" : ""}
        </p>
      </div>
      {geo.status === "error" && <p className="mb-3 text-sm text-watch">{geo.message}</p>}

      <div className="mb-3 inline-flex rounded-md border border-line-strong bg-surface p-0.5 lg:hidden" role="group" aria-label="View">
        {(["list", "map"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm", view === v ? "bg-ink text-surface" : "text-muted")}
          >
            {v === "list" ? <List aria-hidden className="h-4 w-4" /> : <MapIcon aria-hidden className="h-4 w-4" />}
            {v === "list" ? "List" : "Map"}
          </button>
        ))}
      </div>
      <p className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
        Map markers show station records from the connected registry. Availability is shown only when the source reports a recent status;
        connector health stays <span className="font-medium text-ink">insufficient data</span> until measured readings are imported.
      </p>

      {error ? (
        <ErrorState
          title="Stations could not be loaded"
          message={error}
          action={<Button onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className={cn(view === "map" && "hidden lg:block")}>
            <StationList
              items={items}
              loading={loading && !data}
              selectedId={selectedId}
              onSelect={(id) => select(id, false)}
              registerItem={registerItem}
              withoutCoordinates={data?.withoutCoordinates ?? 0}
            />
          </div>
          <div className={cn("lg:sticky lg:top-6 lg:self-start", view === "list" && "hidden lg:block")}>
            <div className="h-[60vh] min-h-80 rounded-lg border border-line bg-surface p-1.5 lg:h-[calc(100dvh-14rem)]">
              <StationMap
                className="h-full"
                points={mapPoints}
                selectedId={selectedId}
                onSelect={(id) => select(id, true)}
                origin={geo.status === "ok" ? { lat: geo.lat, lng: geo.lng } : null}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted" aria-label="Map legend">
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ok align-middle" />Healthy evidence</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-unknown align-middle" />Health not measured</span>
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-watch align-middle" />Needs review</span>
            </div>
            {selected && <StationPreview station={selected} onClose={() => setSelectedId(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}

function StationList({
  items,
  loading,
  selectedId,
  onSelect,
  registerItem,
  withoutCoordinates,
}: {
  items: StationListItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  registerItem: (id: string, el: HTMLLIElement | null) => void;
  withoutCoordinates: number;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong px-5 py-8 text-sm text-muted">
        <p className="font-medium text-ink">No stations match these filters</p>
        <p className="mt-1">Loosen a filter or clear the search to see more stations.</p>
      </div>
    );
  }
  return (
    <>
      {withoutCoordinates > 0 && (
        <p className="mb-2 text-sm text-muted">
          {withoutCoordinates} matching station{withoutCoordinates === 1 ? " has" : "s have"} no recorded coordinates; they appear
          in the list but not on the map.
        </p>
      )}
      <ul className="space-y-2 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto lg:pr-1">
        {items.map((s) => {
          const active = s.id === selectedId;
          return (
            <li
              key={s.id}
              ref={(el) => registerItem(s.id, el)}
            >
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-pressed={active}
                className={cn(
                  "w-full rounded-lg border bg-surface px-4 py-3 text-left transition-[border-color,box-shadow] duration-150",
                  active ? "border-ink shadow-lift" : "border-line hover:border-line-strong",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{s.name}</span>
                    <span className="block text-sm text-muted">
                      {[s.city, s.operator].filter(Boolean).join(", ") || "Location details not recorded"}
                    </span>
                  </span>
                  <HealthBadge status={s.worstHealth} short />
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span>
                    <span className="num text-ink">{s.availableCount}</span>/{s.chargerCount} available
                  </span>
                  <span>{s.connectorTypes.join(", ")}</span>
                  {s.maxPowerKw !== null && <span>up to {formatNumber(s.maxPowerKw, 0)} kW</span>}
                  {s.distanceKm !== null && <span className="text-ink">{formatDistanceKm(s.distanceKm)} straight-line</span>}
                  {s.latitude === null && <span className="text-watch">No coordinates</span>}
                  {s.isSynthetic && <SyntheticTag />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function StationPreview({ station, onClose }: { station: StationListItem; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{station.name}</p>
          <p className="num text-sm text-muted">{station.code}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close preview" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        {station.healthCounts.inspection_recommended} inspection recommended, {station.healthCounts.monitor} monitor,{" "}
        {station.healthCounts.normal} normal, {station.healthCounts.insufficient_data} with insufficient data.
      </p>
      <ul className="mt-3 divide-y divide-line rounded-md border border-line">
        {station.chargers.map((charger) => (
          <li key={charger.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="num block font-medium text-ink">{charger.code}</span>
              <span className="block truncate text-xs text-muted">
                {CONNECTOR_LABELS[charger.connectorType]}{charger.ratedPowerKw !== null ? ` · ${formatNumber(charger.ratedPowerKw, 0)} kW` : ""}
              </span>
            </span>
            <HealthBadge status={charger.healthStatus} short />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/stations/${station.id}`} className="text-sm font-medium text-signal underline-offset-4 hover:underline">
          View station and chargers
        </Link>
      </div>
    </div>
  );
}
