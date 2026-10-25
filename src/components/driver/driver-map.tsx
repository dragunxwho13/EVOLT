"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CONNECTOR_LABELS } from "@/config/domain";
import { EvoltMap, type MapPoint } from "@/components/map/evolt-map";
import { DemoTag, HealthBadge, OperationalBadge } from "@/components/ui/status";
import type { Recommendation } from "@/features/recommendations/engine";
import type { StationListItem } from "@/features/station-discovery/service";
import { formatDistanceKm, formatNumber } from "@/lib/utils/format";

export interface DriverMapProps {
  stations: StationListItem[];
  /** Ranked results for the current search (empty before a search). */
  results: Recommendation[];
  origin: { lat: number; lng: number; label: string } | null;
  radiusKm: number | null;
  selectedStationId: string | null;
  onSelectStation: (id: string | null) => void;
  onPickLocation: (lat: number, lng: number) => void;
  compareIds: string[];
  compareFull: boolean;
  onToggleCompare: (chargerId: string) => void;
  /** Changes when a new search should re-frame the map. */
  fitKey: string;
}

/**
 * The driver's map: every station with a recorded location, the best match starred, other
 * matches numbered by rank, and non-matching stations as faint dots. Popups list the chargers
 * at that location with the same facts as the result cards.
 */
export function DriverMap(props: DriverMapProps) {
  const { stations, results, origin, radiusKm, selectedStationId, onSelectStation, onPickLocation, fitKey } = props;

  const bestRankByStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) m.set(r.stationId, Math.min(m.get(r.stationId) ?? Infinity, r.rank));
    return m;
  }, [results]);

  const points: MapPoint[] = useMemo(
    () =>
      stations
        .filter((s) => s.latitude !== null && s.longitude !== null)
        .map((s) => {
          const rank = bestRankByStation.get(s.id);
          const distance = s.distanceKm !== null ? `, ${formatDistanceKm(s.distanceKm)}` : "";
          if (rank === 1) return { id: s.id, name: s.name, lat: s.latitude!, lng: s.longitude!, variant: "best" as const, title: `${s.name} — best match${distance}` };
          if (rank !== undefined)
            return { id: s.id, name: s.name, lat: s.latitude!, lng: s.longitude!, variant: "result" as const, label: String(rank), title: `${s.name} — result ${rank}${distance}` };
          return {
            id: s.id,
            name: s.name,
            lat: s.latitude!,
            lng: s.longitude!,
            variant: "context" as const,
            title: `${s.name} — ${results.length ? "does not match your search" : "station"}${distance}`,
          };
        }),
    [stations, bestRankByStation, results.length],
  );

  return (
    <EvoltMap
      ariaLabel="Map of charging stations"
      className="h-[340px] sm:h-[420px]"
      points={points}
      origin={origin}
      radiusKm={origin ? radiusKm : null}
      selectedId={selectedStationId}
      onSelect={onSelectStation}
      onPickLocation={onPickLocation}
      fitKey={`${fitKey}|${[...bestRankByStation.keys()].sort().join(",")}`}
      focusIds={results.length ? [...bestRankByStation.keys()] : undefined}
      legend={[
        ...(origin ? [{ variant: "origin" as const, label: origin.label }] : []),
        ...(results.length ? [{ variant: "best" as const, label: "Best match" }, { variant: "result" as const, label: "Other matches (rank)" }] : []),
        { variant: "context" as const, label: results.length ? "Doesn't match your search" : "Charging station" },
      ]}
      footnote={
        !origin && points.length > 0 ? (
          <span className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-surface shadow-lift">Click anywhere on the map to search from that point</span>
        ) : undefined
      }
      renderPopup={(p) => <StationPopup station={stations.find((s) => s.id === p.id)!} {...props} />}
    />
  );
}

function StationPopup({ station, results, compareIds, compareFull, onToggleCompare }: { station: StationListItem } & DriverMapProps) {
  const ranked = new Map(results.filter((r) => r.stationId === station.id).map((r) => [r.chargerId, r]));
  const best = [...ranked.values()].sort((a, b) => a.rank - b.rank)[0];
  return (
    <div>
      <p className="pr-8 font-semibold leading-snug">{station.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        {station.city && <span>{station.city}</span>}
        {station.distanceKm !== null && <span className="num">{formatDistanceKm(station.distanceKm)} straight-line</span>}
        {station.isSynthetic && <DemoTag />}
      </p>
      <p className="mt-2 text-sm">
        {best ? (
          best.rank === 1 ? (
            <span className="font-medium text-signal">★ Best match for your search</span>
          ) : (
            <span className="font-medium">Result {best.rank} for your search</span>
          )
        ) : results.length ? (
          <span className="text-muted">No charger here matches your current search (filters, radius or availability).</span>
        ) : (
          <span className="text-muted">
            {station.chargerCount} charger{station.chargerCount === 1 ? "" : "s"} · {station.availableCount} reported available
          </span>
        )}
      </p>
      {best && <p className="mt-1 text-xs leading-relaxed text-muted">{best.summary}</p>}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {station.chargers.map((c) => {
          const r = ranked.get(c.id);
          const inCompare = compareIds.includes(c.id);
          return (
            <li key={c.id} className="py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {CONNECTOR_LABELS[c.connectorType]}
                    {r && <span className="num ml-2 rounded bg-sunken px-1.5 text-xs">#{r.rank}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {c.ratedPowerKw !== null ? `${formatNumber(c.ratedPowerKw, 0)} kW` : "Power not recorded"} · <span className="num">{c.code}</span>
                  </p>
                </div>
                <OperationalBadge status={c.operationalStatus} driver />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <HealthBadge status={c.healthStatus} driver />
                {r && (
                  <label className={`flex items-center gap-1.5 text-xs ${!inCompare && compareFull ? "opacity-50" : ""}`}>
                    <input type="checkbox" checked={inCompare} disabled={!inCompare && compareFull} onChange={() => onToggleCompare(c.id)} />
                    Compare
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Link href={`/driver/stations/${station.id}`} className="mt-3 inline-block text-sm font-medium text-signal underline-offset-4 hover:underline">
        Station details →
      </Link>
    </div>
  );
}
