"use client";

import { LocateFixed } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CONNECTOR_LABELS, HEALTH_SHORT_LABELS, KNOWN_CONNECTOR_TYPES, type HealthStatus } from "@/config/domain";
import { StationMap } from "@/components/map/station-map";
import { Button, ErrorState, Field, inputClass } from "@/components/ui/primitives";
import { HealthBadge, OperationalBadge } from "@/components/ui/status";
import type { ExclusionReason } from "@/features/recommendations/engine";
import type { RecommendationResponse } from "@/features/recommendations/service";
import { ApiError, apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/utils/cn";
import { formatDistanceKm, formatNumber } from "@/lib/utils/format";

export interface ReferenceOption {
  id: string;
  code: string;
  stationName: string;
  healthStatus: HealthStatus;
}

const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  no_coordinates: "no coordinates",
  outside_radius: "outside the radius",
  offline: "offline",
  incompatible_connector: "incompatible connector",
  below_min_power: "below minimum power",
  inspection_recommended: "inspection recommended",
  reference_charger: "the reference charger itself",
  unknown_connector: "connector type not recorded",
};

export function RecommendationFinder({ references }: { references: ReferenceOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [fromCharger, setFromCharger] = useState(params.get("fromCharger") ?? "");
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(() => {
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    return params.get("lat") && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  });
  const [connector, setConnector] = useState(params.get("connector") ?? "");
  const [minPowerKw, setMinPowerKw] = useState(params.get("minPowerKw") ?? "");
  const [radiusKm, setRadiusKm] = useState(params.get("radiusKm") ?? "25");
  const [includeInspection, setIncludeInspection] = useState(params.get("includeInspection") === "true");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [response, setResponse] = useState<{ key: string; result: RecommendationResponse | null; error: string | null } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useMemo(() => {
    const s = new URLSearchParams();
    if (fromCharger) s.set("fromCharger", fromCharger);
    if (origin) {
      s.set("lat", origin.lat.toFixed(6));
      s.set("lng", origin.lng.toFixed(6));
    }
    if (connector) s.set("connector", connector);
    if (minPowerKw) s.set("minPowerKw", minPowerKw);
    s.set("radiusKm", radiusKm);
    if (includeInspection) s.set("includeInspection", "true");
    return s;
  }, [fromCharger, origin, connector, minPowerKw, radiusKm, includeInspection]);

  const ready = Boolean(fromCharger || origin);

  const queryKey = query.toString();
  useEffect(() => {
    if (!ready) return;
    router.replace(`${pathname}?${queryKey}`, { scroll: false });
    let cancelled = false;
    apiFetch<RecommendationResponse>(`/api/recommendations?${queryKey}`)
      .then((r) => {
        if (!cancelled) setResponse({ key: queryKey, result: r, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setResponse({ key: queryKey, result: null, error: e instanceof ApiError ? e.message : "Recommendations could not be loaded." });
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey, ready, pathname, router]);
  const loading = ready && response?.key !== queryKey;
  const result = ready ? (response?.result ?? null) : null;
  const error = ready && !loading ? (response?.error ?? null) : null;

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("This browser does not support location.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Choose a reference charger instead."
            : "Your location could not be determined. Choose a reference charger instead.",
        );
      },
      { timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const excludedSummary = result
    ? (Object.entries(result.excluded) as [ExclusionReason, number][]).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${EXCLUSION_LABEL[k]}`)
    : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <form className="h-fit space-y-4 rounded-lg border border-line bg-surface p-4 lg:sticky lg:top-6" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="space-y-3">
          <legend className="mb-1 font-semibold">Start from</legend>
          <Field label="Charger you want to avoid or replace" htmlFor="rec-ref">
            <select id="rec-ref" className={inputClass} value={fromCharger} onChange={(e) => setFromCharger(e.target.value)}>
              <option value="">None — use a location</option>
              {references.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {HEALTH_SHORT_LABELS[r.healthStatus]} · {r.stationName}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={locate} disabled={locating}>
              <LocateFixed aria-hidden className="h-4 w-4" />
              {locating ? "Locating…" : origin ? "Update my location" : "Use my location"}
            </Button>
            {origin && (
              <Button size="sm" variant="ghost" onClick={() => setOrigin(null)}>
                Clear location
              </Button>
            )}
          </div>
          {origin && <p className="num text-xs text-muted">Using {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}</p>}
          {geoError && <p className="text-sm text-watch">{geoError}</p>}
        </fieldset>

        <fieldset className="space-y-3 border-t border-line pt-4">
          <legend className="mb-1 font-semibold">Compatibility</legend>
          <Field label="Connector type" htmlFor="rec-connector">
            <select id="rec-connector" className={inputClass} value={connector} onChange={(e) => setConnector(e.target.value)}>
              <option value="">Not specified</option>
              {KNOWN_CONNECTOR_TYPES.map((c) => (
                <option key={c} value={c}>
                  {CONNECTOR_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3 border-t border-line pt-4">
          <legend className="mb-1 font-semibold">Limits</legend>
          <Field label="Minimum power" htmlFor="rec-power">
            <select id="rec-power" className={inputClass} value={minPowerKw} onChange={(e) => setMinPowerKw(e.target.value)}>
              <option value="">Any</option>
              {[22, 50, 100, 150].map((p) => (
                <option key={p} value={p}>
                  {p} kW+
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search radius" htmlFor="rec-radius">
            <select id="rec-radius" className={inputClass} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)}>
              {[5, 10, 25, 50, 100, 250].map((r) => (
                <option key={r} value={r}>
                  {r} km
                </option>
              ))}
            </select>
          </Field>
          <label className="col-span-2 flex items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="mt-1 accent-[var(--ink)]"
              checked={includeInspection}
              onChange={(e) => setIncludeInspection(e.target.checked)}
            />
            Include chargers flagged “Inspection recommended” (ranked last)
          </label>
        </fieldset>
      </form>

      <div className="min-w-0 space-y-4" aria-live="polite" aria-busy={loading}>
        {!ready ? (
          <div className="rounded-lg border border-dashed border-line-strong px-5 py-10 text-sm text-muted">
            <p className="font-medium text-ink">Choose a starting point</p>
            <p className="mt-1 max-w-prose">
              Pick the charger you want an alternative to, or use your location. EVOLT then ranks nearby compatible chargers by
              health evidence first, availability second and distance third.
            </p>
          </div>
        ) : error ? (
          <ErrorState title="No recommendations" message={error} />
        ) : loading && !result ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        ) : result ? (
          <>
            <div className="rounded-lg border border-line bg-surface p-4 text-sm">
              <p className="text-ink">
                From <strong className="font-medium">{result.origin.label}</strong>, within {radiusKm} km straight-line.{" "}
                {result.compatibility.source}
              </p>
              {result.reference && (
                <p className="mt-1 text-muted">
                  Reference charger {result.reference.chargerCode} is currently{" "}
                  <span className="text-ink">{HEALTH_SHORT_LABELS[result.reference.healthStatus as HealthStatus].toLowerCase()}</span>.
                </p>
              )}
              {excludedSummary.length > 0 && <p className="mt-1 text-muted">Excluded: {excludedSummary.join(", ")}.</p>}
              <details className="mt-2">
                <summary className="cursor-pointer text-signal hover:underline">How results are ranked</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                  {result.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </details>
            </div>

            {result.recommendations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line-strong px-5 py-8 text-sm">
                <p className="font-medium text-ink">No compatible alternative found</p>
                <p className="mt-1 text-muted">Widen the search radius, lower the minimum power, or remove the connector filter.</p>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <ol className={cn("space-y-3", loading && "opacity-60 transition-opacity")}>
                  {result.recommendations.map((r) => (
                    <li key={r.chargerId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.stationId)}
                        className={cn(
                          "w-full rounded-lg border bg-surface p-4 text-left transition-[border-color,box-shadow]",
                          selectedId === r.stationId ? "border-ink shadow-lift" : "border-line hover:border-line-strong",
                        )}
                      >
                        <span className="flex items-start gap-3">
                          <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-strong text-sm">{r.rank}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                <span className="block font-medium text-ink">{r.stationName}</span>
                                <span className="mt-0.5 block text-xs font-medium uppercase tracking-[0.08em] text-signal">
                                  {r.rank === 1 ? "Best available match" : r.rank <= 3 ? "Strong alternative" : "Lower-priority fallback"}
                                </span>
                              </span>
                              <HealthBadge status={r.healthStatus} short />
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                              <span className="num">{r.chargerCode}</span>
                              <span>{r.connectorType}</span>
                              {r.ratedPowerKw !== null && <span>{formatNumber(r.ratedPowerKw, 0)} kW</span>}
                              <span className="text-ink">{formatDistanceKm(r.distanceKm)}</span>
                              <OperationalBadge status={r.operationalStatus} />
                            </span>
                            <span className="mt-2 block text-sm text-muted">{r.reasons.join(" ")}</span>
                            {r.limitations.length > 0 && <span className="mt-1 block text-sm text-watch">{r.limitations.join(" ")}</span>}
                          </span>
                        </span>
                      </button>
                      <Link href={`/chargers/${r.chargerId}`} className="mt-1 ml-14 inline-block text-sm text-signal hover:underline">
                        View evidence for {r.chargerCode}
                      </Link>
                    </li>
                  ))}
                </ol>
                <div className="h-[420px] rounded-lg border border-line bg-surface p-1.5 xl:sticky xl:top-6">
                  <StationMap
                    className="h-full"
                    origin={result.origin}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    points={dedupeStations(result.recommendations)}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-faint">
              Recommendations are ranked from the available evidence and do not guarantee that any charger is safe, available or
              suitable. Price is not considered.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function dedupeStations(recs: RecommendationResponse["recommendations"]) {
  const seen = new Map<string, { id: string; name: string; latitude: number; longitude: number; status: HealthStatus; detail: string }>();
  for (const r of recs) {
    if (!seen.has(r.stationId)) {
      seen.set(r.stationId, {
        id: r.stationId,
        name: r.stationName,
        latitude: r.latitude!,
        longitude: r.longitude!,
        status: r.healthStatus,
        detail: `#${r.rank}, ${formatDistanceKm(r.distanceKm)}`,
      });
    }
  }
  return [...seen.values()];
}
