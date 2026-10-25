"use client";

import { Check, LocateFixed, Map as MapIcon, MapPinned, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CONNECTOR_LABELS, KNOWN_CONNECTOR_TYPES } from "@/config/domain";
import { Button, ButtonLink, ErrorState, Field, inputClass } from "@/components/ui/primitives";
import { DemoTag, HealthBadge, OperationalBadge } from "@/components/ui/status";
import type { ExclusionReason, Recommendation } from "@/features/recommendations/engine";
import type { RecommendationResponse } from "@/features/recommendations/service";
import type { StationListResult } from "@/features/station-discovery/service";
import { DriverMap } from "./driver-map";
import { ApiError, apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/utils/cn";
import { formatDistanceKm, formatNumber } from "@/lib/utils/format";

export interface StartingPointOption {
  city: string;
  lat: number;
  lng: number;
  stations: number;
}

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];
const POWER_OPTIONS = [7, 22, 50, 100, 150];
export const MAX_COMPARE = 4;

const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  no_coordinates: "with no recorded location",
  outside_radius: "outside your radius",
  offline: "reported offline",
  incompatible_connector: "with a different connector",
  below_min_power: "below your minimum power",
  inspection_recommended: "with an inspection advised",
  reference_charger: "you started from",
  unknown_connector: "with no recorded connector type",
  not_available: "not reported available",
};

type SortKey = "recommended" | "distance" | "power";

function parseOrigin(params: URLSearchParams): { lat: number; lng: number } | null {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!params.get("lat") || !params.get("lng") || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function DriverFinder({ startingPoints }: { startingPoints: StartingPointOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [origin, setOrigin] = useState(() => parseOrigin(params));
  const [originLabel, setOriginLabel] = useState(() => params.get("from") ?? (parseOrigin(params) ? "Chosen location" : ""));
  const [fromCharger] = useState(params.get("fromCharger") ?? "");
  const [radiusKm, setRadiusKm] = useState(params.get("radiusKm") ?? "25");
  const [connector, setConnector] = useState(params.get("connector") ?? "");
  const [minPowerKw, setMinPowerKw] = useState(params.get("minPowerKw") ?? "");
  const [availableOnly, setAvailableOnly] = useState(params.get("availableOnly") === "true");
  const [includeInspection, setIncludeInspection] = useState(params.get("includeInspection") === "true");
  const [sort, setSort] = useState<SortKey>((params.get("sort") as SortKey) || "recommended");
  const [selected, setSelected] = useState<string[]>([]);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [response, setResponse] = useState<{ key: string; result: RecommendationResponse | null; error: string | null } | null>(null);
  const [stationsResp, setStationsResp] = useState<{ key: string; data: StationListResult } | null>(null);
  const [mapStation, setMapStation] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const query = useMemo(() => {
    const s = new URLSearchParams();
    if (fromCharger) s.set("fromCharger", fromCharger);
    if (origin) {
      s.set("lat", origin.lat.toFixed(5));
      s.set("lng", origin.lng.toFixed(5));
    }
    if (connector) s.set("connector", connector);
    if (minPowerKw) s.set("minPowerKw", minPowerKw);
    s.set("radiusKm", radiusKm);
    if (availableOnly) s.set("availableOnly", "true");
    if (includeInspection) s.set("includeInspection", "true");
    s.set("limit", "20");
    return s.toString();
  }, [fromCharger, origin, connector, minPowerKw, radiusKm, availableOnly, includeInspection]);

  const ready = Boolean(origin || fromCharger);

  useEffect(() => {
    // Keep the URL shareable; the API call uses the same parameters.
    const url = new URLSearchParams(query);
    url.delete("limit");
    if (url.get("radiusKm") === "25") url.delete("radiusKm"); // default
    if (originLabel && origin) url.set("from", originLabel);
    if (sort !== "recommended") url.set("sort", sort);
    const next = url.toString();
    if (next === window.location.search.replace(/^\?/, "")) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [query, originLabel, origin, sort, pathname, router]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    apiFetch<RecommendationResponse>(`/api/recommendations?${query}`)
      .then((r) => !cancelled && setResponse({ key: query, result: r, error: null }))
      .catch((e: unknown) => {
        if (cancelled) return;
        setResponse({ key: query, result: null, error: e instanceof ApiError ? e.message : "The search could not be completed." });
      });
    return () => {
      cancelled = true;
    };
  }, [query, ready]);

  // Every station with a location, for the map (with distances once a location is known).
  const stationsKey = origin ? `lat=${origin.lat.toFixed(5)}&lng=${origin.lng.toFixed(5)}` : "";
  useEffect(() => {
    let cancelled = false;
    apiFetch<StationListResult>(`/api/stations?limit=500${stationsKey ? `&${stationsKey}` : ""}`)
      .then((d) => !cancelled && setStationsResp({ key: stationsKey, data: d }))
      .catch(() => !cancelled && setStationsResp({ key: stationsKey, data: { items: [], total: 0, limit: 500, offset: 0, withoutCoordinates: 0, sortedByDistance: false } }));
    return () => {
      cancelled = true;
    };
  }, [stationsKey]);

  const loading = ready && response?.key !== query;
  const result = response?.key === query ? response.result : null;
  const error = response?.key === query ? response.error : null;

  const sorted = useMemo(() => {
    const list = [...(result?.recommendations ?? [])];
    if (sort === "distance") list.sort((a, b) => a.distanceKm - b.distanceKm);
    if (sort === "power") list.sort((a, b) => (b.ratedPowerKw ?? -1) - (a.ratedPowerKw ?? -1) || a.distanceKm - b.distanceKm);
    return list;
  }, [result, sort]);

  function useMyLocation() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("This browser cannot share a location. Choose a starting point or enter coordinates.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setOriginLabel("Your location");
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Choose a starting point or enter coordinates instead."
            : "Your location could not be determined. Choose a starting point or enter coordinates instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  function applyManual(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (!manualLat.trim() || !manualLng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setManualError("Enter both latitude and longitude as decimal numbers, for example 13.0827 and 80.2707.");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setManualError("Latitude must be between −90 and 90 and longitude between −180 and 180.");
      return;
    }
    setManualError(null);
    setOrigin({ lat, lng });
    setOriginLabel("Entered coordinates");
    setManualOpen(false);
  }

  function toggleCompare(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id]));
  }

  const nextRadius = RADIUS_OPTIONS.find((r) => r > Number(radiusKm));
  const hasOptionalFilters = Boolean(connector || minPowerKw || availableOnly);
  const compareHref = `/driver/compare?ids=${selected.join(",")}${origin ? `&lat=${origin.lat.toFixed(5)}&lng=${origin.lng.toFixed(5)}` : ""}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ── Search controls ── */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start" aria-label="Search">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-1 font-semibold">1. Where are you?</h2>
          <p className="mb-3 text-sm text-muted">
            {origin ? (
              <>
                Searching from <span className="font-medium text-ink">{originLabel || "chosen location"}</span>{" "}
                <span className="num text-xs">({origin.lat.toFixed(4)}, {origin.lng.toFixed(4)})</span>
              </>
            ) : fromCharger && result?.reference ? (
              <>Searching around {result.reference.stationName}.</>
            ) : (
              "Share your location, or choose a starting point."
            )}
          </p>
          <div className="grid gap-2">
            <Button variant="primary" onClick={useMyLocation} disabled={locating} aria-describedby={geoError ? "geo-error" : undefined}>
              <LocateFixed className="h-4 w-4" aria-hidden />
              {locating ? "Finding your location…" : "Use my location"}
            </Button>
            {geoError && (
              <p id="geo-error" role="alert" className="text-sm text-inspect">
                {geoError}
              </p>
            )}
            {startingPoints.length > 0 && (
              <Field label="Or start from a city in the data" htmlFor="drv-start">
                <select
                  id="drv-start"
                  className={inputClass}
                  value=""
                  onChange={(e) => {
                    const p = startingPoints.find((s) => s.city === e.target.value);
                    if (!p) return;
                    setOrigin({ lat: p.lat, lng: p.lng });
                    setOriginLabel(`${p.city} (centre of ${p.stations} recorded station${p.stations === 1 ? "" : "s"})`);
                  }}
                >
                  <option value="">Choose a city…</option>
                  {startingPoints.map((p) => (
                    <option key={p.city} value={p.city}>
                      {p.city} — {p.stations} station{p.stations === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <button
              type="button"
              className="w-fit text-sm font-medium text-signal underline-offset-4 hover:underline"
              aria-expanded={manualOpen}
              aria-controls="manual-location"
              onClick={() => setManualOpen((o) => !o)}
            >
              <MapPinned className="mr-1 inline h-4 w-4 align-[-3px]" aria-hidden />
              Enter coordinates
            </button>
            {manualOpen && (
              <form id="manual-location" onSubmit={applyManual} className="grid grid-cols-2 gap-2" noValidate>
                <Field label="Latitude" htmlFor="drv-lat">
                  <input id="drv-lat" inputMode="decimal" className={inputClass} value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="13.0827" />
                </Field>
                <Field label="Longitude" htmlFor="drv-lng">
                  <input id="drv-lng" inputMode="decimal" className={inputClass} value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="80.2707" />
                </Field>
                {manualError && (
                  <p role="alert" className="col-span-2 text-sm text-inspect">
                    {manualError}
                  </p>
                )}
                <Button type="submit" className="col-span-2">
                  Use these coordinates
                </Button>
              </form>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <SlidersHorizontal className="h-4 w-4 text-faint" aria-hidden />
            2. What do you need?
          </h2>
          <div className="grid gap-3">
            <Field label="Search radius" htmlFor="drv-radius" hint="Straight-line distance, not driving distance.">
              <select id="drv-radius" className={inputClass} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)}>
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} km
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Your connector" htmlFor="drv-connector" hint={connector ? undefined : "Not set: compatibility is not checked."}>
              <select id="drv-connector" className={inputClass} value={connector} onChange={(e) => setConnector(e.target.value)}>
                <option value="">Any (not checked)</option>
                {KNOWN_CONNECTOR_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {CONNECTOR_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Minimum charger power" htmlFor="drv-power">
              <select id="drv-power" className={inputClass} value={minPowerKw} onChange={(e) => setMinPowerKw(e.target.value)}>
                <option value="">Any</option>
                {POWER_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p} kW or more
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />
              <span>Only chargers reported available</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={includeInspection} onChange={(e) => setIncludeInspection(e.target.checked)} />
              <span>Include chargers with an inspection advised</span>
            </label>
          </div>
        </section>
      </aside>

      {/* ── Results ── */}
      <section aria-labelledby="results-heading" aria-busy={loading}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="results-heading" className="text-lg font-semibold">
              {!ready ? "Chargers near you" : loading ? "Searching…" : `${sorted.length} charger${sorted.length === 1 ? "" : "s"} found`}
            </h2>
            {result?.reference && (
              <p className="text-sm text-muted">
                Alternatives to <span className="num">{result.reference.chargerCode}</span> at {result.reference.stationName}.
              </p>
            )}
          </div>
          {sorted.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">Sort by</span>
              <select className={cn(inputClass, "h-8 w-auto py-0")} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="recommended">Recommended</option>
                <option value="distance">Distance</option>
                <option value="power">Charging power</option>
              </select>
            </label>
          )}
        </div>

        <div ref={mapRef} className="mb-4 scroll-mt-24">
          <DriverMap
            stations={stationsResp?.data.items ?? []}
            results={result?.recommendations ?? []}
            origin={
              origin
                ? { ...origin, label: originLabel || "Your search point" }
                : result
                  ? { lat: result.origin.lat, lng: result.origin.lng, label: result.origin.label }
                  : null
            }
            radiusKm={Number(radiusKm)}
            selectedStationId={mapStation}
            onSelectStation={setMapStation}
            onPickLocation={(lat, lng) => {
              setOrigin({ lat, lng });
              setOriginLabel("Point chosen on the map");
              setMapStation(null);
            }}
            compareIds={selected}
            compareFull={selected.length >= MAX_COMPARE}
            onToggleCompare={toggleCompare}
            fitKey={`${origin ? `${origin.lat},${origin.lng}` : result ? `${result.origin.lat},${result.origin.lng}` : "none"}|${radiusKm}`}
          />
          {stationsResp && stationsResp.data.withoutCoordinates > 0 && (
            <p className="mt-1.5 text-xs text-muted">
              {stationsResp.data.withoutCoordinates} station{stationsResp.data.withoutCoordinates === 1 ? " has" : "s have"} no recorded location and
              cannot be placed on the map (listed below the results).
            </p>
          )}
        </div>

        {!ready ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
            <p className="font-medium text-ink">Start by sharing a location — or click a point on the map.</p>
            <p className="mt-1">
              EVOLT ranks chargers with a recorded location by distance from you. Your location is used only in your browser
              session to calculate distances; it is not stored.
            </p>
          </div>
        ) : error ? (
          <ErrorState title="Search failed" message={error} />
        ) : loading ? (
          <div className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-36" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <NoResults
            result={result}
            radiusKm={Number(radiusKm)}
            onExpand={nextRadius ? () => setRadiusKm(String(nextRadius)) : undefined}
            nextRadius={nextRadius}
            onClear={
              hasOptionalFilters
                ? () => {
                    setConnector("");
                    setMinPowerKw("");
                    setAvailableOnly(false);
                  }
                : undefined
            }
          />
        ) : (
          <>
            {sort !== "recommended" && (
              <p className="mb-3 text-sm text-muted">Sorted by {sort === "distance" ? "distance" : "charging power"}. Rank numbers show the recommended order.</p>
            )}
            {!connector && (
              <p className="mb-3 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
                No connector selected, so compatibility with your vehicle is not checked. Choose your connector to hide chargers you cannot use.
              </p>
            )}
            <ol className="space-y-3">
              {sorted.map((r) => (
                <ResultCard
                  key={r.chargerId}
                  r={r}
                  checked={selected.includes(r.chargerId)}
                  compareFull={selected.length >= MAX_COMPARE}
                  onToggle={() => toggleCompare(r.chargerId)}
                  onShowOnMap={() => {
                    setMapStation(r.stationId);
                    mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
              ))}
            </ol>
            {result && <Exclusions result={result} />}
          </>
        )}

        {result && (
          <details className="mt-5 rounded-lg border border-line bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-medium">How chargers are chosen and ordered</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 font-medium">Must meet (hard requirements)</p>
                <ul className="list-disc space-y-1 pl-5 text-muted">
                  {result.hardConstraints.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium">Then ordered by (preferences)</p>
                <ol className="list-decimal space-y-1 pl-5 text-muted">
                  {result.preferences.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </div>
            </div>
            <p className="mt-3 text-muted">{result.compatibility.source}</p>
          </details>
        )}
      </section>

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur" role="region" aria-label="Compare chargers">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm">
              <span className="font-medium">{selected.length}</span> of {MAX_COMPARE} selected for comparison
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
              <ButtonLink href={compareHref} variant="primary" aria-disabled={selected.length < 2} className={selected.length < 2 ? "pointer-events-none opacity-50" : undefined}>
                Compare {selected.length >= 2 ? selected.length : ""} chargers
              </ButtonLink>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  r,
  checked,
  compareFull,
  onToggle,
  onShowOnMap,
}: {
  r: Recommendation;
  checked: boolean;
  compareFull: boolean;
  onToggle: () => void;
  onShowOnMap: () => void;
}) {
  return (
    <li className={cn("rounded-lg border bg-surface", r.rank === 1 ? "border-ink/40 shadow-lift" : "border-line")}>
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong text-sm" aria-label={`Rank ${r.rank}`}>
          {r.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/driver/stations/${r.stationId}`} className="font-semibold text-ink underline-offset-4 hover:underline">
              {r.stationName}
            </Link>
            {r.isDemo && <DemoTag />}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            <span className="num">{r.chargerCode}</span>
            {r.city ? ` · ${r.city}` : ""}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Distance</dt>
              <dd className="num font-medium">{formatDistanceKm(r.distanceKm)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Charging power</dt>
              <dd className="num font-medium">{r.ratedPowerKw !== null ? `${formatNumber(r.ratedPowerKw, 1)} kW` : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Connector</dt>
              <dd className="font-medium">{CONNECTOR_LABELS[r.connectorType]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Availability</dt>
              <dd>
                <OperationalBadge status={r.operationalStatus} driver />
                {r.statusAt && r.operationalStatus !== "unknown" && (
                  <span className="block text-xs text-faint">recorded {new Date(r.statusAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <HealthBadge status={r.healthStatus} driver />
            {r.activeAlerts > 0 && <span className="text-xs text-watch">{r.activeAlerts} open issue{r.activeAlerts === 1 ? "" : "s"} under review</span>}
          </div>
          <p className="mt-3 text-sm leading-relaxed">{r.summary}</p>
          {r.limitations.filter((l) => !l.startsWith("Compatibility not checked")).length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              {r.limitations.filter((l) => !l.startsWith("Compatibility not checked")).map((l) => (
                <li key={l}>· {l}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <label className={cn("flex items-center gap-2 text-sm", !checked && compareFull && "opacity-50")}>
          <input type="checkbox" checked={checked} disabled={!checked && compareFull} onChange={onToggle} aria-label={`Compare ${r.stationName} ${r.chargerCode}`} />
          {checked ? (
            <span className="inline-flex items-center gap-1 font-medium">
              <Check className="h-3.5 w-3.5" aria-hidden /> Selected to compare
            </span>
          ) : (
            "Compare"
          )}
        </label>
        <span className="flex items-center gap-4">
          <button type="button" onClick={onShowOnMap} className="inline-flex items-center gap-1 text-sm font-medium text-signal underline-offset-4 hover:underline">
            <MapIcon className="h-3.5 w-3.5" aria-hidden />
            Show on map
          </button>
          <Link href={`/driver/stations/${r.stationId}`} className="text-sm font-medium text-signal underline-offset-4 hover:underline">
            Station details
          </Link>
        </span>
      </div>
    </li>
  );
}

function Exclusions({ result }: { result: RecommendationResponse }) {
  const entries = (Object.entries(result.excluded) as [ExclusionReason, number][]).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <p className="mt-4 text-sm text-muted">
      Not shown: {entries.map(([k, n]) => `${n} ${n === 1 ? "charger" : "chargers"} ${EXCLUSION_LABEL[k]}`).join("; ")}.
    </p>
  );
}

function NoResults({
  result,
  radiusKm,
  nextRadius,
  onExpand,
  onClear,
}: {
  result: RecommendationResponse | null;
  radiusKm: number;
  nextRadius?: number;
  onExpand?: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      <p className="font-semibold">No charger matches within {radiusKm} km.</p>
      {result && <Exclusions result={result} />}
      <div className="mt-4 flex flex-wrap gap-2">
        {onExpand && nextRadius && (
          <Button variant="primary" onClick={onExpand}>
            Search within {nextRadius} km
          </Button>
        )}
        {onClear && <Button onClick={onClear}>Remove optional filters</Button>}
      </div>
    </div>
  );
}
