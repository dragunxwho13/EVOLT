import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { HealthBadge } from "@/components/ui/status";
import { listStations } from "@/features/station-discovery/service";
import { load } from "@/lib/http/load";

export const metadata: Metadata = { title: "Find a charge" };

export default function DriversPage() {
  return (
    <>
      <PageHeader
        title="Find a charge with confidence"
        description="See real station locations and connector options. Choose alternatives using only evidence the connected sources actually provide."
        actions={<ButtonLink href="/stations" variant="primary">Explore stations</ButtonLink>}
      />
      <DriverContent />
    </>
  );
}

async function DriverContent() {
  await connection();
  const result = await load(() => listStations({ limit: 6, offset: 0 }));
  if (!result.ok) return <EmptyState title="Stations are temporarily unavailable">Try the station map again in a moment.</EmptyState>;

  const stations = result.data.items;
  if (stations.length === 0) {
    return (
      <EmptyState title="No public stations are connected yet">
        EVOLT will show verified imported station data here once a network feed is connected. Development and test records stay out of the driver experience.
        <span className="mt-2 block"><ButtonLink href="/stations">Open station map</ButtonLink></span>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
      <Panel title="Nearby choices" description="Imported station records, ordered for quick comparison." flush>
        <ul className="divide-y divide-line">
          {stations.map((station) => (
            <li key={station.id}>
              <Link href={`/stations/${station.id}`} className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-sunken sm:px-5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{station.name}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {station.availableCount}/{station.chargerCount} available · {station.maxPowerKw ?? "Power unknown"}{station.maxPowerKw ? " kW max" : ""}
                  </span>
                </span>
                <HealthBadge status={station.worstHealth} short />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Choose the next step" description="Start with the task you need right now.">
        <div className="grid gap-3">
          <ButtonLink href="/recommendations" variant="primary">Find the best alternative</ButtonLink>
          <ButtonLink href="/stations">Browse the full station map</ButtonLink>
        </div>
        <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-muted">
          EVOLT ranks health evidence before small distance differences. It does not guarantee safety, availability, price, or driving time.
        </p>
      </Panel>
    </div>
  );
}
