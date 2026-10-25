import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CONNECTOR_LABELS } from "@/config/domain";
import { CopyCoordinates } from "@/components/driver/copy-coordinates";
import { StationHistoryPanel } from "@/components/sessions/station-history";
import { ButtonLink, ErrorState, Notice, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag, HealthBadge, OperationalBadge } from "@/components/ui/status";
import { nearbyStations, stationHistory } from "@/features/driver/service";
import { worstStatus as worstOf } from "@/features/anomaly-detection/assess-metric";
import { StationMiniMap } from "@/components/map/station-mini-map";
import { isValidLatLng } from "@/features/station-discovery/geo";
import { getStation } from "@/features/station-discovery/service";
import { load } from "@/lib/http/load";
import { formatDate, formatNumber } from "@/lib/utils/format";
import { uuidSchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Station" };

export default function DriverStationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PanelSkeleton rows={8} />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  if (!uuidSchema.safeParse(id).success) notFound();
  const result = await load(async () => {
    const detail = await getStation(id);
    const located = isValidLatLng(detail.station.latitude, detail.station.longitude);
    const [history, nearby] = await Promise.all([
      stationHistory(id),
      located ? nearbyStations({ lat: detail.station.latitude!, lng: detail.station.longitude! }, id) : Promise.resolve([]),
    ]);
    return { ...detail, history, nearby };
  });
  if (!result.ok) {
    if (result.notFound) notFound();
    return <ErrorState {...result.error} />;
  }
  const { station, chargers, history, nearby } = result.data;
  const hasCoords = isValidLatLng(station.latitude, station.longitude);
  const place = [station.address, station.city, station.region].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        meta={
          <>
            <Link href="/driver" className="hover:text-ink">
              Find a charger
            </Link>
            <span aria-hidden>/</span>
            <span>{station.name}</span>
            {station.isSynthetic && <DemoTag />}
          </>
        }
        title={station.name}
        description={place || undefined}
        actions={
          hasCoords ? (
            <ButtonLink href={`/driver?lat=${station.latitude}&lng=${station.longitude}&from=${encodeURIComponent(`Near ${station.name}`)}`} variant="primary">
              Find chargers near here
            </ButtonLink>
          ) : null
        }
      />
      {station.isSynthetic && (
        <div className="mb-5">
          <Notice tone="warn">This is a demo station included to show how EVOLT works. It is not a real charging site.</Notice>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={`Chargers here (${chargers.length})`} flush>
          {chargers.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No chargers are registered at this station.</p>
          ) : (
            <ul className="divide-y divide-line">
              {chargers.map((c) => (
                <li key={c.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div>
                    <p className="font-medium">
                      {CONNECTOR_LABELS[c.connectorType]}
                      <span className="num ml-2 text-sm font-normal text-muted">{c.code}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {c.ratedPowerKw !== null ? `${formatNumber(c.ratedPowerKw, 1)} kW rated` : "Rated power not recorded"}
                      {c.chargingMode ? ` · ${c.chargingMode} charging` : ""}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <OperationalBadge status={c.operationalStatus} driver />
                      {c.operationalStatusAt && c.operationalStatus !== "unknown" && (
                        <span className="text-xs text-faint">status recorded {formatDate(c.operationalStatusAt)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <HealthBadge status={c.healthStatus} driver />
                    <span className="text-xs text-faint">
                      {c.lastObservationAt ? `health data to ${formatDate(c.lastObservationAt)}` : "no health readings"}
                    </span>
                    {c.activeAlerts > 0 && <span className="text-xs text-watch">{c.activeAlerts} open issue(s) under review</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Location">
            {hasCoords ? (
              <div className="space-y-3 text-sm">
                <StationMiniMap
                  hrefBase="/driver/stations"
                  station={{
                    id: station.id,
                    name: station.name,
                    lat: station.latitude!,
                    lng: station.longitude!,
                    health: worstOf(chargers.map((c) => c.healthStatus)),
                    chargers: chargers.length,
                    distanceKm: null,
                  }}
                  nearby={nearby}
                />
                <p className="num">
                  {station.latitude!.toFixed(5)}, {station.longitude!.toFixed(5)}
                </p>
                <CopyCoordinates lat={station.latitude!} lng={station.longitude!} />
                <p className="text-muted">EVOLT does not provide turn-by-turn directions. Paste the coordinates into your own navigation app.</p>
              </div>
            ) : (
              <p className="text-sm text-muted">No location is recorded for this station, so EVOLT cannot measure how far away it is.</p>
            )}
          </Panel>
          {chargers.length >= 2 && (
            <Panel title="Compare">
              <ButtonLink href={`/driver/compare?ids=${chargers.slice(0, 4).map((c) => c.id).join(",")}`}>
                Compare chargers at this station
              </ButtonLink>
            </Panel>
          )}
        </div>
      </div>

      <div className="mt-5">
        <StationHistoryPanel history={history} audience="driver" />
      </div>
      <p className="mt-4 text-xs text-muted">
        Price, opening hours and access restrictions are not shown because the data does not contain them. Health labels describe
        recorded evidence only; they are not a safety guarantee.
      </p>
    </>
  );
}
