import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SlotBooker } from "@/components/booking/slot-booker";
import { ErrorState, Notice, PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import { BOOKING } from "@/config/booking";
import { getBookableCharger } from "@/features/booking/service";
import { listVehicleProfiles } from "@/features/recommendations/service";
import { load } from "@/lib/http/load";
import { uuidSchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Book a charging slot" };

export default function BookChargerPage({ params }: { params: Promise<{ chargerId: string }> }) {
  return (
    <Suspense fallback={<PanelSkeleton rows={8} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ chargerId: string }> }) {
  const { chargerId } = await params;
  await connection();
  if (!uuidSchema.safeParse(chargerId).success) notFound();
  const result = await load(async () => {
    const [charger, vehicles] = await Promise.all([getBookableCharger(chargerId), listVehicleProfiles()]);
    return { charger, vehicles: vehicles.map((v) => ({ code: v.code, name: v.name, maxDcPowerKw: v.maxDcPowerKw })) };
  });
  if (!result.ok) {
    if (result.notFound) notFound();
    return <ErrorState {...result.error} />;
  }
  const { charger, vehicles } = result.data;
  return (
    <>
      <PageHeader
        meta={
          <>
            <Link href="/driver" className="hover:text-ink">
              Find a charger
            </Link>
            <span aria-hidden>/</span>
            <Link href={`/driver/stations/${charger.stationId}`} className="hover:text-ink">
              {charger.stationName}
            </Link>
            {charger.isDemo && <DemoTag />}
          </>
        }
        title={`Book ${charger.code}`}
        description={`Reserve a time so the charger is free when you arrive, or join the queue for the next opening. A ${BOOKING.bufferMinutes}-minute gap is kept between drivers.`}
      />
      {charger.isDemo && (
        <div className="mb-5">
          <Notice tone="warn">This is a demo charger, not a real site. Bookings here show how the feature works.</Notice>
        </div>
      )}
      <SlotBooker charger={charger} vehicles={vehicles} />
    </>
  );
}
