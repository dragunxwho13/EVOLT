import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ALERT_RULE_LABELS, METRICS } from "@/config/domain";
import { HealthDistribution } from "@/components/dashboard/health-distribution";
import { OverviewMap } from "@/components/dashboard/overview-map";
import { ButtonLink, EmptyState, ErrorState, Notice, PageHeader, Panel, PanelSkeleton, Skeleton } from "@/components/ui/primitives";
import { AlertStatusTag, HealthBadge, HealthGlyph } from "@/components/ui/status";
import { latestReports, sessionStats } from "@/features/learning/service";
import { getOverview } from "@/lib/analytics/overview";
import { load } from "@/lib/http/load";
import { formatAge, formatDate, formatDateTime, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Connector health overview"
        description="Where the evidence says connectors need attention, and how current that evidence is."
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="rounded-lg border border-line bg-surface p-5">
        <Skeleton className="mb-4 h-3 w-full" />
        <div className="grid grid-cols-4 gap-6">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <PanelSkeleton className="lg:col-span-2" rows={6} />
        <PanelSkeleton className="lg:col-span-3" rows={6} />
      </div>
    </div>
  );
}

async function DashboardContent() {
  await connection();
  const now = new Date();
  const result = await load(async () => ({ o: await getOverview(now), stats: await sessionStats(), reports: await latestReports() }));
  if (!result.ok) {
    return <ErrorState {...result.error} action={<ButtonLink href="/settings">Check configuration</ButtonLink>} />;
  }
  const { o, stats, reports } = result.data;

  if (o.chargers.total === 0) {
    return (
      <EmptyState
        title="No chargers yet"
        action={
          <ButtonLink href="/data" variant="primary">
            Import a registry file
          </ButtonLink>
        }
      >
        Import a station and charger registry, then health observations, to see connector health here. For a demonstration,
        run <code className="num">npm run db:seed</code> to load clearly labelled synthetic data.
      </EmptyState>
    );
  }

  const activeAlertTotal = o.activeAlerts.inspection_recommended + o.activeAlerts.monitor;
  return (
    <div className="grid grid-cols-1 gap-5">
      {o.chargers.synthetic > 0 && (
        <Notice tone="warn">
          {o.chargers.synthetic === o.chargers.total ? "All" : `${o.chargers.synthetic} of ${o.chargers.total}`} chargers on this
          page are <strong>synthetic demonstration records</strong> with simulated observations. Their locations do not
          correspond to real charging stations.
        </Notice>
      )}

      <section aria-labelledby="fleet-heading" className="rounded-lg border border-line bg-surface px-4 py-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="fleet-heading" className="text-[0.95rem] font-semibold">
            {o.chargers.total} chargers across {o.stations.total} stations
          </h2>
          <p className="text-sm text-muted">
            {activeAlertTotal > 0 ? (
              <Link href="/alerts" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                {activeAlertTotal} unresolved alert{activeAlertTotal === 1 ? "" : "s"}
              </Link>
            ) : (
              "No unresolved alerts"
            )}
            {activeAlertTotal > 0 && ` (${o.activeAlerts.inspection_recommended} inspection, ${o.activeAlerts.monitor} monitor)`}
          </p>
        </div>
        <HealthDistribution counts={o.healthDistribution} total={o.chargers.total} />
        <dl className="mt-5 grid gap-x-8 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Newest observation</dt>
            <dd className="text-ink">
              {o.freshness.latestObservationAt ? (
                <>
                  {formatAge(o.freshness.latestObservationAt, now)}
                  <span className="text-faint"> · {formatDateTime(o.freshness.latestObservationAt)}</span>
                </>
              ) : (
                "None recorded"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Observations in last 30 days</dt>
            <dd className="num text-ink">{o.freshness.observationsLast30Days}</dd>
          </div>
          <div>
            <dt className="text-muted">Chargers with only old or no data</dt>
            <dd className="text-ink">
              <span className="num">{o.freshness.chargersStaleOrEmpty}</span>
              <span className="text-faint"> (nothing in {o.freshness.staleAfterDays} days — assessed as historical)</span>
            </dd>
          </div>
        </dl>
      </section>

      {stats.sessions > 0 && (
        <section aria-labelledby="dataset-heading" className="rounded-lg border border-line bg-surface px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="dataset-heading" className="text-[0.95rem] font-semibold">
                Imported session data and learned model
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {stats.sessions.toLocaleString("en-GB")} charging sessions across {stats.chargers} chargers
                {stats.first && stats.last ? `, ${formatDate(stats.first)} – ${formatDate(stats.last)}` : ""}.
              </p>
            </div>
            <ButtonLink href="/model" size="sm">
              See model results
            </ButtonLink>
          </div>
          {reports.length > 0 && (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {reports
                .sort((a, b) => Number(b.learnable) - Number(a.learnable))
                .map((r) => {
                  const e = r.evaluations.find((x) => x.model === r.best)!;
                  return (
                    <li key={r.target} className="rounded-md bg-sunken px-3.5 py-2.5">
                      <p className="text-sm text-muted">{r.targetLabel}</p>
                      <p className="mt-0.5 text-ink">
                        {r.learnable ? (
                          <>
                            <span className="num text-lg font-medium text-ok">{formatPercent(e.accuracy, 1)}</span> correct on unseen sessions
                            <span className="text-faint"> (baseline {formatPercent(r.baselineAccuracy, 1)})</span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">Not predictable</span>
                            <span className="text-faint"> — no better than the {formatPercent(r.baselineAccuracy, 1)} baseline</span>
                          </>
                        )}
                      </p>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Panel
          className="lg:col-span-2"
          title="Needs attention"
          description="Chargers whose evidence suggests monitoring or inspection."
          flush
        >
          {o.attention.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No charger is currently flagged by the analysis.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.attention.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/chargers/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-sunken sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="num block text-sm font-medium text-ink">{c.code}</span>
                      <span className="block truncate text-sm text-muted">{c.stationName}</span>
                    </span>
                    <HealthBadge status={c.healthStatus} short />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="lg:col-span-3"
          title="Stations"
          description={
            o.stations.withoutCoordinates > 0
              ? `${o.stations.withoutCoordinates} station(s) have no recorded coordinates and are not shown on the map.`
              : "Pins show each station's most concerning charger."
          }
          actions={
            <ButtonLink href="/stations" size="sm">
              Open map
            </ButtonLink>
          }
          flush bodyClassName="p-2"
        >
          {o.mapPoints.length ? (
            <OverviewMap points={o.mapPoints} />
          ) : (
            <p className="px-3 py-6 text-sm text-muted">No station has valid coordinates.</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Recent alert activity" flush actions={<ButtonLink href="/alerts" size="sm">All alerts</ButtonLink>}>
          {o.recentAlerts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">The analysis has not raised any alerts.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.recentAlerts.map(({ alert, chargerCode, stationName }) => (
                <li key={alert.id}>
                  <Link href={`/alerts/${alert.id}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-sunken sm:px-5">
                    <HealthGlyph
                      status={alert.severity}
                      className={alert.severity === "inspection_recommended" ? "mt-1 text-inspect" : "mt-1 text-watch"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">
                        {ALERT_RULE_LABELS[alert.rule]} · {METRICS[alert.metric].label.toLowerCase()}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        <span className="num">{chargerCode}</span> at {stationName}
                      </span>
                    </span>
                    <AlertStatusTag status={alert.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most recently observed" description="Chargers ordered by their newest health observation." flush>
          {o.recentlyUpdated.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">No observations have been recorded.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.recentlyUpdated.map((c) => (
                <li key={c.id}>
                  <Link href={`/chargers/${c.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="num block text-sm font-medium text-ink">{c.code}</span>
                      <span className="block truncate text-sm text-muted">{c.stationName}</span>
                    </span>
                    <span className="text-right text-sm text-muted">{formatAge(c.lastObservationAt, now)}</span>
                    <HealthBadge status={c.healthStatus} short />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
