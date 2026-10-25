import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ALERT_RULE_LABELS, CONNECTOR_LABELS, HEALTH_LABELS, METRICS, METRIC_KEYS, type MetricKey } from "@/config/domain";
import { MetricEvidence } from "@/components/chargers/metric-evidence";
import { ButtonLink, ErrorState, KeyValues, Notice, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { AlertStatusTag, HealthBadge, HealthGlyph, OperationalBadge, ProvenanceTag, SyntheticTag } from "@/components/ui/status";
import { getChargerDetail } from "@/features/connector-health/queries";
import { chargerModelViews } from "@/features/learning/service";
import { NEXT_ACTIONS } from "@/features/connector-health/assess-charger";
import { load } from "@/lib/http/load";
import { cn } from "@/lib/utils/cn";
import { formatAge, formatDate, formatDateTime, formatMetricValue, formatNumber, formatPercent } from "@/lib/utils/format";
import { uuidSchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Charger" };

export default function ChargerPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PanelSkeleton rows={10} />}>
      <ChargerContent params={params} />
    </Suspense>
  );
}

async function ChargerContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  if (!uuidSchema.safeParse(id).success) notFound();
  const result = await load(async () => ({ ...(await getChargerDetail(id)), models: await chargerModelViews(id) }));
  if (!result.ok) {
    if (result.notFound) notFound();
    return <ErrorState {...result.error} />;
  }
  const { charger, station, observations, observationTotal, alerts, sensorReadings, models } = result.data;
  const now = new Date();
  const summary = charger.healthSummary;

  const seriesByMetric = new Map<MetricKey, { t: number; value: number }[]>();
  for (const o of observations) {
    const list = seriesByMetric.get(o.metric) ?? [];
    list.push({ t: o.observedAt.getTime(), value: o.value });
    seriesByMetric.set(o.metric, list);
  }
  const activeAlerts = alerts.filter((a) => a.status === "open" || a.status === "acknowledged");
  const assessedMetrics = summary?.metrics ?? [];
  const missingMetrics = METRIC_KEYS.filter((k) => !assessedMetrics.some((m) => m.metric === k));
  const recent = [...observations].reverse().slice(0, 40);

  return (
    <>
      <PageHeader
        meta={
          <>
            <Link href="/chargers" className="hover:text-ink">
              Chargers
            </Link>
            <span aria-hidden>/</span>
            <Link href={`/stations/${station.id}`} className="hover:text-ink">
              {station.name}
            </Link>
            {charger.isSynthetic && <SyntheticTag />}
          </>
        }
        title={<span className="num tracking-normal">{charger.code}</span>}
        description={[
          charger.connectorType === "Unknown" ? "Connector type not recorded" : CONNECTOR_LABELS[charger.connectorType],
          charger.chargingMode ? `${charger.chargingMode} charging` : null,
          charger.ratedPowerKw !== null ? `rated ${formatNumber(charger.ratedPowerKw, 1)} kW` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <ButtonLink href={`/recommendations?fromCharger=${charger.id}`} variant={charger.healthStatus === "inspection_recommended" || charger.healthStatus === "monitor" ? "primary" : "secondary"}>
            Find alternatives to this charger
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section
          aria-labelledby="assessment-heading"
          className={cn(
            "rounded-lg border bg-surface lg:col-span-2",
            charger.healthStatus === "inspection_recommended" ? "border-inspect/50" : charger.healthStatus === "monitor" ? "border-watch/50" : "border-line",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h2 id="assessment-heading" className="font-semibold">
              Health assessment
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {summary?.historical && (
                <span className="rounded border border-dashed border-line-strong px-1.5 py-px text-xs text-muted" title="Based on old data">
                  Historical · data to {formatDate(summary.latestObservationAt)}
                </span>
              )}
              <HealthBadge status={charger.healthStatus} className="text-sm" />
            </div>
          </div>
          <div className="space-y-4 px-4 py-4 sm:px-5">
            {!summary ? (
              <p className="text-sm text-muted">This charger has not been analysed yet. Re-run the analysis from the Analysis page.</p>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-ink">Why “{HEALTH_LABELS[summary.status]}”</p>
                  <ul className="mt-1.5 space-y-1.5 text-sm text-muted">
                    {summary.reasons.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-faint" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md bg-sunken px-3.5 py-3 text-sm">
                  <p className="font-medium text-ink">Recommended next step</p>
                  <p className="mt-0.5 text-muted">{summary.nextAction ?? NEXT_ACTIONS[summary.status]}</p>
                </div>
                <p className="text-sm text-muted">{summary.coverageNote}</p>
                {summary.stale && !summary.historical && (
                  <Notice tone="warn">
                    The newest observation is older than the freshness limit, so this assessment may not reflect the connector today.
                  </Notice>
                )}
                <p className="text-xs text-faint">
                  Evaluated {formatDateTime(summary.evaluatedAt)} with analysis version {summary.analysisVersion}. This is an
                  evidence summary, not a safety certification.
                </p>
              </>
            )}
          </div>
        </section>

        <Panel title="Charger record">
          <KeyValues
            items={[
              ["Station", <Link key="s" href={`/stations/${station.id}`} className="text-signal hover:underline">{station.name}</Link>],
              ["Location", [station.city, station.region].filter(Boolean).join(", ") || "Not recorded"],
              ["Connector", CONNECTOR_LABELS[charger.connectorType]],
              ["Charging type", charger.chargingMode ?? "Not recorded"],
              ["Rated power", charger.ratedPowerKw !== null ? `${formatNumber(charger.ratedPowerKw, 1)} kW` : "Not recorded"],
              [
                "Operational",
                <span key="o" className="flex flex-col">
                  <OperationalBadge status={charger.operationalStatus} />
                  {charger.operationalStatusAt && <span className="text-xs text-faint">reported {formatAge(charger.operationalStatusAt, now)}</span>}
                </span>,
              ],
              ["Latest observation", charger.lastObservationAt ? `${formatAge(charger.lastObservationAt, now)}` : "None"],
              ["Observations", <span key="n" className="num">{observationTotal}</span>],
              ["Unresolved alerts", <span key="a" className="num">{activeAlerts.length}</span>],
            ]}
          />
        </Panel>
      </div>

      {models.map((m) => (
        <Panel
          key={m.target}
          className="mt-5"
          title={`Learned ${m.targetLabel.toLowerCase()}`}
          description={`${m.modelName}, ${formatPercent(m.accuracy, 1)} accurate on unseen sessions. A classification of this charger's sessions, separate from its health status.`}
          actions={
            <Link href="/model" className="text-sm text-signal hover:underline">
              How it was trained
            </Link>
          }
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <dl className="space-y-2 text-sm">
                {Object.entries(m.predicted)
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, n]) => (
                    <div key={label}>
                      <div className="flex justify-between">
                        <dt className="text-ink">{label}</dt>
                        <dd className="num text-muted">
                          {n} of {m.sessions}
                        </dd>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-sunken" aria-hidden>
                        <div className="h-full rounded-full bg-signal" style={{ width: `${(n / m.sessions) * 100}%` }} />
                      </div>
                    </div>
                  ))}
              </dl>
              {m.agreement && (
                <p className="mt-3 text-sm text-muted">
                  Matches the dataset&apos;s own label in{" "}
                  <span className="num text-ink">
                    {m.agreement.matched}/{m.agreement.labelled}
                  </span>{" "}
                  sessions ({formatPercent(m.agreement.matched / m.agreement.labelled)}). The model was trained on all sessions, so this
                  in-sample figure is higher than the tested accuracy.
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Latest sessions</th>
                    {m.recent.some((r) => r.feature !== null) && <th scope="col" className="py-1.5 pr-3 text-right font-medium">Power loss</th>}
                    <th scope="col" className="py-1.5 pr-3 font-medium">Predicted</th>
                    <th scope="col" className="py-1.5 font-medium">Dataset label</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {m.recent.map((r) => (
                    <tr key={r.at}>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{formatDateTime(r.at)}</td>
                      {r.feature !== null && <td className="num py-1.5 pr-3 text-right">{formatNumber(r.feature)} kW</td>}
                      <td className="py-1.5 pr-3 text-ink">{r.predicted}</td>
                      <td className={r.actual && r.actual !== r.predicted ? "py-1.5 text-watch" : "py-1.5 text-muted"}>{r.actual ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      ))}

      <h2 className="mt-9 mb-3 text-lg font-semibold tracking-[-0.01em]">Evidence by metric</h2>
      {assessedMetrics.length === 0 ? (
        <Notice>No health observations are recorded for this charger. Import observations to assess it.</Notice>
      ) : (
        <div className="space-y-4">
          {assessedMetrics.map((m) => (
            <MetricEvidence key={m.metric} assessment={m} series={seriesByMetric.get(m.metric) ?? []} />
          ))}
        </div>
      )}
      {missingMetrics.length > 0 && assessedMetrics.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          No data recorded for: {missingMetrics.map((k) => METRICS[k].label.toLowerCase()).join(", ")}.
        </p>
      )}

      <div className="mt-9 grid gap-5 lg:grid-cols-2">
        <Panel title="Alerts for this charger" flush>
          {alerts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No alerts have been raised for this charger.</p>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link href={`/alerts/${a.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-sunken sm:px-5">
                    <HealthGlyph status={a.severity} className={cn("mt-1", a.severity === "inspection_recommended" ? "text-inspect" : "text-watch")} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block text-ink">{ALERT_RULE_LABELS[a.rule]}</span>
                      <span className="block text-muted">
                        {METRICS[a.metric].label}, last evidence {formatAge(a.windowEnd, now)}
                        {!a.conditionActive && " — no longer detected"}
                      </span>
                    </span>
                    <AlertStatusTag status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Supporting bench-sensor readings"
          description="Optional readings from a demonstration rig. They are context only and never change health status."
          flush
        >
          {sensorReadings.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No sensor readings are linked to this charger.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {sensorReadings.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-3 px-5 py-2.5">
                  <span className="text-muted">
                    {r.deviceId} / {r.sensor}
                  </span>
                  <span className="num">
                    {formatNumber(r.value)} {r.unit}
                  </span>
                  <span className="text-faint">{formatAge(r.recordedAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Observation history"
        description={`Most recent ${recent.length} of ${observationTotal} stored observations. Values are shown in canonical units.`}
        className="mt-5"
        flush
      >
        {recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No observations recorded.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 border-b border-line bg-surface text-left text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Observed</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Metric</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Value</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Provenance</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td className="px-5 py-2 whitespace-nowrap text-muted">{formatDateTime(o.observedAt)}</td>
                    <td className="px-3 py-2">{METRICS[o.metric].label}</td>
                    <td className="num px-3 py-2 text-right">{formatMetricValue(o.metric, o.value)}</td>
                    <td className="px-3 py-2"><ProvenanceTag provenance={o.provenance} /></td>
                    <td className="max-w-56 truncate px-5 py-2 text-muted">{o.source ?? "—"}</td>
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
