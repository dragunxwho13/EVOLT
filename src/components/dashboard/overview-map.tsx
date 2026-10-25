"use client";

import { useRouter } from "next/navigation";
import type { HealthStatus } from "@/config/domain";
import { StationMap } from "@/components/map/station-map";

export interface OverviewMapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  worstHealth: HealthStatus;
  chargerCount: number;
}

export function OverviewMap({ points }: { points: OverviewMapPoint[] }) {
  const router = useRouter();
  return (
    <StationMap
      className="h-72 sm:h-80"
      ariaLabel="Stations coloured by their most concerning charger"
      points={points.map((p) => ({
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        status: p.worstHealth,
        detail: `${p.chargerCount} charger${p.chargerCount === 1 ? "" : "s"}`,
      }))}
      onSelect={(id) => router.push(`/stations/${id}`)}
    />
  );
}
