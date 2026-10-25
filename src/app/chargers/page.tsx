import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  CONNECTOR_LABELS,
  CONNECTOR_TYPES,
  HEALTH_LABELS,
  HEALTH_STATUSES,
  OPERATIONAL_LABELS,
  OPERATIONAL_STATUSES,
} from "@/config/domain";
import { FilterForm } from "@/components/ui/filter-form";
import { ButtonLink, EmptyState, ErrorState, PageHeader, Pagination, PanelSkeleton } from "@/components/ui/primitives";
import { HealthBadge, OperationalBadge, SyntheticTag } from "@/components/ui/status";
import { listChargers } from "@/features/connector-health/queries";
import { load } from "@/lib/http/load";
import { formatAge, formatNumber } from "@/lib/utils/format";
import { chargerQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Chargers" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function ChargersPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Chargers"
        description="Every registered charger with its operational status and evidence-based health category."
      />
      <Suspense fallback={<PanelSkeleton rows={10} />}>
        <ChargerTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ChargerTable({ searchParams }: { searchParams: SP }) {
  const raw = searchParamsToObject(await searchParams);
  await connection();
  const parsed = chargerQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return (
      <ErrorState
        title="Those filters are not valid"
        message="One or more filter values are not recognised. Reset the filters and choose again."
        action={<ButtonLink href="/chargers">Reset filters</ButtonLink>}
      />
    );
  }
  const q = parsed.data;
  const result = await load(() => listChargers(q));
  const now = new Date();

  const hrefFor = (page: number) => {
    const s = new URLSearchParams(raw);
    s.set("page", String(page));
    return `/chargers?${s}`;
  };

  return (
    <>
      <FilterForm
        action="/chargers"
        search={{ name: "q", label: "Search", value: q.q, placeholder: "Charger code, station or city" }}
        selects={[
          { name: "health", label: "Health", value: q.health, options: HEALTH_STATUSES.map((s) => ({ value: s, label: HEALTH_LABELS[s] })) },
          { name: "connector", label: "Connector", value: q.connector, options: CONNECTOR_TYPES.map((c) => ({ value: c, label: CONNECTOR_LABELS[c] })) },
          {
            name: "availability",
            label: "Availability",
            value: q.availability,
            options: OPERATIONAL_STATUSES.map((s) => ({ value: s, label: OPERATIONAL_LABELS[s] })),
          },
        ]}
      />
      {!result.ok ? (
        <ErrorState {...result.error} />
      ) : result.data.items.length === 0 ? (
        <EmptyState title={result.data.total === 0 && !q.q && !q.health && !q.connector && !q.availability ? "No chargers registered" : "No chargers match these filters"}>
          {result.data.total === 0 && !q.q ? (
            <>
              Import a registry file on the <Link href="/data" className="text-signal underline">Data import</Link> page, or clear
              the filters.
            </>
          ) : (
            "Try a broader search or clear the filters."
          )}
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Chargers</caption>
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Charger</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Station</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Connector</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Power</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Health</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Latest data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.data.items.map((c) => (
                  <tr key={c.id} className="hover:bg-sunken">
                    <td className="px-5 py-3">
                      <Link href={`/chargers/${c.id}`} className="num font-medium text-signal hover:underline">
                        {c.code}
                      </Link>
                      {c.isSynthetic && <span className="ml-2 align-middle"><SyntheticTag /></span>}
                    </td>
                    <td className="max-w-64 truncate px-3 py-3">
                      <Link href={`/stations/${c.stationId}`} className="hover:underline">
                        {c.stationName}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{c.connectorType}</td>
                    <td className="num px-3 py-3 text-right">{c.ratedPowerKw !== null ? `${formatNumber(c.ratedPowerKw, 1)} kW` : "—"}</td>
                    <td className="px-3 py-3"><OperationalBadge status={c.operationalStatus} /></td>
                    <td className="px-3 py-3"><HealthBadge status={c.healthStatus} short /></td>
                    <td className="px-5 py-3 text-muted">{formatAge(c.lastObservationAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-5 pb-4">
            <Pagination page={result.data.page} pageSize={result.data.pageSize} total={result.data.total} hrefFor={hrefFor} />
            {result.data.total <= result.data.pageSize && (
              <p className="pt-4 text-sm text-muted">{result.data.total} charger{result.data.total === 1 ? "" : "s"}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
