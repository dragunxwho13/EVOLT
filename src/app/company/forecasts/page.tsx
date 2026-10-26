import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { METRICS } from "@/config/domain";
import { EmptyState, ErrorState, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import { fleetForecasts, type FleetForecastRow } from "@/features/connector-health/fleet-forecasts";
import { load } from "@/lib/http/load";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatMetricValue, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Service forecast" };

export default function ForecastsPage() {
  return (
    <>
      <PageHeader
        title="Service forecast"
        description="Which connectors will reach their service limit next, and when. Each date extends the connector's recent rate of change; the range is the uncertainty in that rate."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <ForecastList />
      </Suspense>
    </>
  );
}

function when(f: FleetForecastRow["forecast"]): string {
  if (f.status === "already_above") return "Now — already above";
  if (f.status !== "projected") return "—";
  if (f.beyondHorizon) return "More than a year";
  return f.expectedDate ? formatDate(f.expectedDate) : `After ${formatDate(f.earliestDate)}`;
}

async function ForecastList() {
  await connection();
  const result = await load(() => fleetForecasts());
  if (!result.ok) return <ErrorState {...result.error} />;
  const { rows, dueSoon } = result.data;
  const dated = rows.filter((r) => r.forecast.status === "projected" || r.forecast.status === "already_above");
  const other = rows.filter((r) => !dated.includes(r));
  const counts = {
    above: rows.filter((r) => r.forecast.status === "already_above").length,
    soon: dueSoon,
    flat: rows.filter((r) => r.forecast.status === "not_rising").length,
  };

  if (rows.length === 0) {
    return (
      <EmptyState title="No forecasts yet">
        Forecasts need at least {ANALYSIS_PARAMS.forecastMinPoints} contact-resistance, voltage-drop or power-loss readings per connector.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          ["Already above limit", counts.above, "text-inspect"],
          [`Earliest date within ${ANALYSIS_PARAMS.forecastActionDays} days`, counts.soon, "text-watch"],
          ["No clear rise", counts.flat, "text-ok"],
        ].map(([label, n, tone]) => (
          <div key={label as string} className="rounded-lg border border-line bg-surface px-4 py-3">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className={cn("num text-2xl font-semibold", tone as string)}>{n}</dd>
          </div>
        ))}
      </dl>

      <Panel title="Dated forecasts" description="Soonest first. Open a charger to see the readings, the limit line and the full explanation." flush>
        {dated.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No connector shows a statistically clear rise towards its limit.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Charger</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Metric</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Likely date</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Range</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Now / limit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dated.map((r) => (
                  <tr key={`${r.chargerId}-${r.metric}`}>
                    <td className="px-5 py-2.5">
                      <Link href={`/company/chargers/${r.chargerId}`} className="num font-medium text-signal hover:underline">
                        {r.chargerCode}
                      </Link>
                      <span className="block text-xs text-muted">
                        {r.stationName} {r.isDemo && <DemoTag />} {r.historical && "· historical data"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{METRICS[r.metric].label}</td>
                    <td className={cn("px-3 py-2.5 font-medium", r.forecast.status === "already_above" ? "text-inspect" : "text-ink")}>{when(r.forecast)}</td>
                    <td className="num px-3 py-2.5 text-muted">
                      {r.forecast.status === "projected" && !r.forecast.beyondHorizon
                        ? `${formatDate(r.forecast.earliestDate)} – ${r.forecast.latestDate ? formatDate(r.forecast.latestDate) : "later"} (${formatPercent(r.forecast.confidence)})`
                        : "—"}
                    </td>
                    <td className="num px-3 py-2.5 text-right">
                      {r.forecast.currentLevel !== null ? formatMetricValue(r.metric, r.forecast.currentLevel) : "—"} /{" "}
                      {formatMetricValue(r.metric, r.forecast.limit)}
                      <span className="block text-xs text-faint">{r.forecast.limitSource === "operator" ? "operator limit" : "default limit"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <details className="rounded-lg border border-line bg-surface px-5 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">
          {other.length} connector metric{other.length === 1 ? "" : "s"} without a date
        </summary>
        <ul className="mt-3 space-y-2 text-muted">
          {other.map((r) => (
            <li key={`${r.chargerId}-${r.metric}`}>
              <Link href={`/company/chargers/${r.chargerId}`} className="num text-signal hover:underline">
                {r.chargerCode}
              </Link>{" "}
              · {METRICS[r.metric].label}: {r.forecast.explanation}
            </li>
          ))}
        </ul>
      </details>

      <p className="text-xs text-faint">
        Method: Theil–Sen rate over the latest {ANALYSIS_PARAMS.forecastWindow} readings since the most recent recorded maintenance; Sen&apos;s{" "}
        {formatPercent(ANALYSIS_PARAMS.forecastConfidence)} interval sets the range; no date unless the whole interval is above zero. Default limit = baseline
        median + {formatPercent(ANALYSIS_PARAMS.forecastLimitRelative)}, replaceable per charger.
      </p>
    </div>
  );
}
