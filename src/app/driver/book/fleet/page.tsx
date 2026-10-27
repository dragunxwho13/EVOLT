import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FleetPlanner } from "@/components/booking/fleet-planner";
import { EmptyState, ErrorState, Notice, PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import { BOOKING } from "@/config/booking";
import { getStation } from "@/features/station-discovery/service";
import { load } from "@/lib/http/load";
import { uuidSchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Book several vehicles" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function FleetBookingPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<PanelSkeleton rows={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Search }) {
  const raw = (await searchParams).station;
  const stationId = Array.isArray(raw) ? raw[0] : raw;
  await connection();
  if (!stationId || !uuidSchema.safeParse(stationId).success) {
    return (
      <>
        <PageHeader title="Book several vehicles" />
        <EmptyState title="Choose a station first">
          Open a station from <Link className="text-signal underline-offset-4 hover:underline" href="/driver">Find a charger</Link>, then choose “Book several vehicles”.
        </EmptyState>
      </>
    );
  }
  const result = await load(() => getStation(stationId));
  if (!result.ok) {
    if (result.notFound) notFound();
    return <ErrorState {...result.error} />;
  }
  const { station, chargers } = result.data;
  const connectorTypes = [...new Set(chargers.map((c) => c.connectorType))].filter((c) => c !== "Unknown");
  return (
    <>
      <PageHeader
        meta={
          <>
            <Link href="/driver" className="hover:text-ink">
              Find a charger
            </Link>
            <span aria-hidden>/</span>
            <Link href={`/driver/stations/${station.id}`} className="hover:text-ink">
              {station.name}
            </Link>
            {station.isSynthetic && <DemoTag />}
          </>
        }
        title="Book several vehicles"
        description={`EVOLT spreads your vehicles across the ${chargers.length} charger${chargers.length === 1 ? "" : "s"} here so they finish as early as possible, with a ${BOOKING.bufferMinutes}-minute gap after every session. Review the plan, then book it under one code.`}
      />
      {station.isSynthetic && (
        <div className="mb-5">
          <Notice tone="warn">This is a demo station, not a real site. Bookings here show how the feature works.</Notice>
        </div>
      )}
      {chargers.length === 0 ? (
        <EmptyState title="No chargers at this station">There is nothing to book here.</EmptyState>
      ) : (
        <FleetPlanner station={{ id: station.id, name: station.name }} connectorTypes={connectorTypes} />
      )}
    </>
  );
}
