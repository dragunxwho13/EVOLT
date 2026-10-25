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
        description="Find stations by name, connector, power, availability or connector health. Distances are straight-line, never driving distance."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <StationExplorer />
      </Suspense>
    </>
  );
}
