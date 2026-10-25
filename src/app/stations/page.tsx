import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { StationExplorer } from "@/components/stations/station-explorer";

export const metadata: Metadata = { title: "Station map" };

export default function StationsPage() {
  return (
    <>
      <PageHeader
        title="Station map"
        description="Find real registry stations by name, connector and nameplate power. Live availability and connector health appear only when the source provides recent evidence."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <StationExplorer />
      </Suspense>
    </>
  );
}
