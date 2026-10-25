import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CONNECTOR_LABELS } from "@/config/domain";
import { StationMap } from "@/components/map/station-map";
import { ButtonLink, ErrorState, KeyValues, Notice, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { HealthBadge, OperationalBadge, SyntheticTag } from "@/components/ui/status";
import { worstStatus } from "@/features/anomaly-detection/assess-metric";
import { getStation } from "@/features/station-discovery/service";
import { isValidLatLng } from "@/features/station-discovery/geo";
import { load } from "@/lib/http/load";
import { uuidSchema } from "@/lib/validation/schemas";
import { formatAge, formatNumber } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Station" };

export default function StationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PanelSkeleton rows={8} />}>
      <StationContent params={params} />
    </Suspense>
  );
}

async function StationContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  if (!uuidSchema.safeParse(id).success) notFound();
  const result = await load(() => getStation(id));
  if (!result.ok) {
    if (result.notFound) notFound();
    return <ErrorState {...result.error} />;
  }
  const { station, chargers } = result.data;
  const now = new Date();
  const hasCoords = isValidLatLng(station.latitude, station.longitude);
  const worst = worstStatus(chargers.map((c) => c.healthStatus));

  return (
    <>
      <PageHeader
        meta={
          <>
            <Link href="/stations" className="hover:text-ink">
              Station map
            </Link>
            <span aria-hidden>/</span>
            <span className="num">{station.code}</span>
            {station.isSynthetic && <SyntheticTag />}
          </>
        }
        title={station.name}
        description={[station.address, station.city, station.region, station.country].filter(Boolean).join(", ") || undefined}
        actions={
          hasCoords ? (
            <ButtonLink href={`/recommendations?lat=${station.latitude}&lng=${station.longitude}`} variant="secondary">
              Find alternatives near here
            </ButtonLink>
          ) : null
        }
      />
      {station.isSynthetic && (
        <div className="mb-5">
          <Notice tone="warn">This is a synthetic demonstration station. It does not represent a real site.</Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Station details" className="lg:col-span-1">
          <KeyValues
            items={[
              ["Overall", <HealthBadge key="h" status={worst} />],
              ["Operator", station.operator ?? "Not recorded"],
              [
                "Coordinates",
                hasCoords ? (
                  <span className="num" key="c">
                    {station.latitude!.toFixed(5)}, {station.longitude!.toFixed(5)}
                  </span>
                ) : (
                  <span key="c" className="text-watch">
                    Not recorded — not shown on maps
                  </span>
                ),
              ],
              ["Chargers", String(chargers.length)],
              ["Source", station.source ?? "Not recorded"],
            ]}
          />
        </Panel>
        <Panel title="Location" className="lg:col-span-2" flush bodyClassName="p-1.5">
          {hasCoords ? (
            <StationMap
              className="h-64"
              points={[{ id: station.id, name: station.name, latitude: station.latitude!, longitude: station.longitude!, status: worst }]}
              selectedId={station.id}
            />
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted">
              No coordinates are recorded for this station, so it cannot be mapped or used for distance-based search.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Chargers" className="mt-5" flush>
        {chargers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No chargers are registered at this station.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Charger</th>
                  <th className="px-3 py-2.5 font-medium">Connector</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rated power</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Health</th>
                  <th className="px-3 py-2.5 font-medium">Alerts</th>
                  <th className="px-5 py-2.5 font-medium">Last observation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {chargers.map((c) => (
                  <tr key={c.id} className="hover:bg-sunken">
                    <td className="px-5 py-3">
                      <Link href={`/chargers/${c.id}`} className="num font-medium text-signal hover:underline">
                        {c.code}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{CONNECTOR_LABELS[c.connectorType]}</td>
                    <td className="num px-3 py-3 text-right">{c.ratedPowerKw !== null ? `${formatNumber(c.ratedPowerKw, 1)} kW` : "—"}</td>
                    <td className="px-3 py-3">
                      <OperationalBadge status={c.operationalStatus} />
                    </td>
                    <td className="px-3 py-3">
                      <HealthBadge status={c.healthStatus} short />
                    </td>
                    <td className="num px-3 py-3">{c.activeAlerts || "—"}</td>
                    <td className="px-5 py-3 text-muted">{formatAge(c.lastObservationAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
