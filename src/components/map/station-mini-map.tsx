"use client";

import Link from "next/link";
import type { HealthStatus } from "@/config/domain";
import { HEALTH_LABELS } from "@/config/domain";
import { EvoltMap } from "@/components/map/evolt-map";
import { formatDistanceKm } from "@/lib/utils/format";

export interface MiniMapStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  health: HealthStatus;
  chargers: number;
  distanceKm: number | null;
}

/** A station and its nearest neighbours; neighbours link to their own pages. */
export function StationMiniMap({ station, nearby, hrefBase }: { station: MiniMapStation; nearby: MiniMapStation[]; hrefBase: "/driver/stations" | "/company/stations" }) {
  const all = [station, ...nearby];
  return (
    <EvoltMap
      ariaLabel={`Map of ${station.name} and nearby stations`}
      className="h-[280px]"
      fitKey={station.id}
      points={all.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        variant: s.id === station.id ? s.health : "context",
        title: s.id === station.id ? `${s.name} (this station) — ${HEALTH_LABELS[s.health]}` : `${s.name}${s.distanceKm !== null ? `, ${formatDistanceKm(s.distanceKm)} away` : ""}`,
      }))}
      legend={[
        { variant: station.health, label: "This station" },
        { variant: "context", label: "Nearby stations" },
      ]}
      renderPopup={(p) => {
        const s = all.find((x) => x.id === p.id)!;
        return (
          <div>
            <p className="pr-8 font-semibold">{s.name}</p>
            <p className="mt-0.5 text-xs text-muted">
              {s.chargers} charger{s.chargers === 1 ? "" : "s"} · {HEALTH_LABELS[s.health]}
              {s.id !== station.id && s.distanceKm !== null ? ` · ${formatDistanceKm(s.distanceKm)} from this station` : ""}
            </p>
            {s.id !== station.id && (
              <Link href={`${hrefBase}/${s.id}`} className="mt-2 inline-block text-sm font-medium text-signal hover:underline">
                Open station →
              </Link>
            )}
          </div>
        );
      }}
    />
  );
}
