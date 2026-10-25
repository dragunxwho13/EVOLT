import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { FleetMap } from "@/components/company/fleet-map";
import { ErrorState, PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { listInsights } from "@/features/insights/service";
import { actionCountsByStation } from "@/features/insights/station-actions";
import { listStations } from "@/features/station-discovery/service";
import { load } from "@/lib/http/load";

export const metadata: Metadata = { title: "Fleet map" };

export default function FleetMapPage() {
  return (
    <>
      <PageHeader
        title="Fleet map"
        description="Every station with recorded coordinates, coloured by its most concerning charger. Select a station to see its chargers, alerts and open action items."
      />
      <Suspense fallback={<PanelSkeleton rows={10} />}>
        <FleetMapContent />
      </Suspense>
    </>
  );
}

async function FleetMapContent() {
  await connection();
  const result = await load(async () => {
    const [stations, insights] = await Promise.all([listStations({ limit: 500, offset: 0 }), listInsights()]);
    const chargerStation = new Map(stations.items.flatMap((s) => s.chargers.map((c) => [c.id, s.id] as const)));
    return { stations: stations.items, actionCounts: actionCountsByStation(insights.items, chargerStation) };
  });
  if (!result.ok) return <ErrorState {...result.error} />;
  return <FleetMap stations={result.data.stations} actionCounts={result.data.actionCounts} />;
}
