import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DriverFinder } from "@/components/driver/driver-finder";
import { ErrorState, PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import { cityStartingPoints, stationsWithoutLocation } from "@/features/driver/service";
import { load } from "@/lib/http/load";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Find a charger" };

export default function DriverHome() {
  return (
    <>
      <PageHeader
        title="Find a charger"
        description="Share where you are and what you need. EVOLT lists compatible chargers nearby, puts the ones with healthy evidence first, and tells you why."
      />
      <Suspense fallback={<PanelSkeleton rows={6} />}>
        <DriverContent />
      </Suspense>
    </>
  );
}

async function DriverContent() {
  await connection();
  const result = await load(async () => ({ points: await cityStartingPoints(), unlocated: await stationsWithoutLocation() }));
  if (!result.ok) return <ErrorState {...result.error} />;
  const { points, unlocated } = result.data;
  return (
    <>
      <DriverFinder startingPoints={points} />
      {unlocated.length > 0 && (
        <details className="mt-8 rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium">
            {unlocated.length} station{unlocated.length === 1 ? "" : "s"} without a recorded location
          </summary>
          <p className="mt-2 text-sm text-muted">
            These stations cannot be ranked by distance because no coordinates are recorded for them. Most come from the
            historical session dataset, which identifies stations only by number and records an area type (urban, suburban,
            rural) per session rather than a place. You can still open them to see their chargers and session history.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unlocated.map((s) => (
              <li key={s.id}>
                <Link href={`/driver/stations/${s.id}`} className="block rounded-md border border-line px-3 py-2 text-sm transition-colors hover:bg-sunken">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {s.name} {s.isDemo && <DemoTag />}
                  </span>
                  <span className="text-xs text-muted">
                    {s.chargers} charger{s.chargers === 1 ? "" : "s"}
                    {s.sessions > 0 ? ` · ${s.sessions} historical sessions, last ${formatDate(s.lastSessionAt)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
