import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { CONNECTOR_LABELS } from "@/config/domain";
import { ButtonLink, EmptyState, ErrorState, PageHeader, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag, HealthBadge, OperationalBadge } from "@/components/ui/status";
import { compareChargers, MAX_COMPARE, type ComparedCharger } from "@/features/driver/service";
import { load } from "@/lib/http/load";
import { formatDate, formatDistanceKm, formatNumber } from "@/lib/utils/format";
import { uuidSchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Compare chargers" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function ComparePage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <PageHeader title="Compare chargers" description="Side-by-side facts from the recorded data. Highlights mark the best value in a row only where 'best' is objective." />
      <Suspense fallback={<PanelSkeleton rows={6} />}>
        <CompareContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function CompareContent({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await connection();
  const ids = (one(sp.ids) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => uuidSchema.safeParse(s).success);
  const lat = Number(one(sp.lat));
  const lng = Number(one(sp.lng));
  const origin = one(sp.lat) && one(sp.lng) && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  if (ids.length < 2) {
    return (
      <EmptyState
        title="Choose at least two chargers"
        action={
          <ButtonLink href="/driver" variant="primary">
            Find chargers to compare
          </ButtonLink>
        }
      >
        Tick “Compare” on up to {MAX_COMPARE} search results, then open the comparison.
      </EmptyState>
    );
  }
  const result = await load(() => compareChargers(ids, origin));
  if (!result.ok) return <ErrorState {...result.error} />;
  const rows = result.data;
  if (rows.length < 2) {
    return (
      <EmptyState title="Those chargers were not found" action={<ButtonLink href="/driver">Back to search</ButtonLink>}>
        Some of the selected chargers no longer exist.
      </EmptyState>
    );
  }

  const bestDistance = Math.min(...rows.map((r) => r.distanceKm ?? Infinity));
  const bestPower = Math.max(...rows.map((r) => r.ratedPowerKw ?? -Infinity));
  const best = (on: boolean) => (on ? "bg-ok-soft font-semibold" : "");

  const line = (label: string, cell: (r: ComparedCharger) => ReactNode, highlight?: (r: ComparedCharger) => boolean) => (
    <tr>
      <th scope="row" className="sticky left-0 bg-surface px-4 py-3 text-left text-sm font-medium text-muted">
        {label}
      </th>
      {rows.map((r) => (
        <td key={r.id} className={`px-4 py-3 text-sm ${highlight ? best(highlight(r)) : ""}`}>
          {cell(r)}
        </td>
      ))}
    </tr>
  );

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[640px]">
          <caption className="sr-only">Charger comparison</caption>
          <thead className="border-b border-line">
            <tr>
              <th className="sticky left-0 bg-surface px-4 py-3 text-left text-sm font-medium text-muted">Charger</th>
              {rows.map((r) => (
                <th key={r.id} scope="col" className="px-4 py-3 text-left align-top">
                  <Link href={`/driver/stations/${r.stationId}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                    {r.stationName}
                  </Link>
                  <span className="num block text-xs font-normal text-muted">{r.code}</span>
                  {r.isDemo && <DemoTag />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {line("Distance", (r) => (r.distanceKm === null ? (origin ? "No location recorded" : "Share a location to see") : formatDistanceKm(r.distanceKm)), (r) => origin !== null && r.distanceKm === bestDistance)}
            {line("Charging power", (r) => (r.ratedPowerKw === null ? "Not recorded" : `${formatNumber(r.ratedPowerKw, 1)} kW`), (r) => r.ratedPowerKw !== null && r.ratedPowerKw === bestPower)}
            {line("Connector", (r) => CONNECTOR_LABELS[r.connectorType])}
            {line("Availability", (r) => (
              <>
                <OperationalBadge status={r.operationalStatus} driver />
                {r.statusAt && r.operationalStatus !== "unknown" && <span className="block text-xs text-faint">recorded {formatDate(r.statusAt)}</span>}
              </>
            ))}
            {line("Health evidence", (r) => (
              <>
                <HealthBadge status={r.healthStatus} driver />
                <span className="block text-xs text-faint">{r.lastObservationAt ? `data to ${formatDate(r.lastObservationAt)}` : "no health readings"}</span>
              </>
            ))}
            {line("Open issues", (r) => (r.activeAlerts ? `${r.activeAlerts} under review` : "None"))}
            {line("Charging type", (r) => r.chargingMode ?? "Not recorded")}
            {line("City", (r) => r.city ?? "Not recorded")}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Distances are straight-line. Price and opening hours are not compared because the data does not contain them.
      </p>
      <div className="mt-4">
        <ButtonLink href={origin ? `/driver?lat=${origin.lat}&lng=${origin.lng}` : "/driver"}>Back to results</ButtonLink>
      </div>
    </>
  );
}
