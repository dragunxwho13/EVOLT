import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { HealthDistribution } from "@/components/dashboard/health-distribution";
import { RateIntervals } from "@/components/charts/rate-intervals";
import { TrendChart } from "@/components/charts/trend-chart";
import { InsightCard } from "@/components/insights/insight-card";
import { ButtonLink, EmptyState, ErrorState, Notice, PageHeader, Panel, PanelSkeleton, Skeleton } from "@/components/ui/primitives";
import { getPerformance } from "@/features/insights/performance-service";
import { listInsights } from "@/features/insights/service";
import { latestReports } from "@/features/learning/service";
import { getOverview } from "@/lib/analytics/overview";
import { load } from "@/lib/http/load";
import { formatAge, formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Company overview" };

export default function CompanyOverviewPage() {
  return (
    <>
      <PageHeader
        title="Company overview"
        description="What needs attention first, the evidence behind it, and how the network has performed in the recorded data."
      />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewContent />
      </Suspense>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
      <PanelSkeleton rows={4} />
    </div>
  );
}

function Kpi({ label, value, definition }: { label: string; value: ReactNode; definition: string }) {
  return (
    <div className="rounded-md bg-sunken px-3.5 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-1 text-xl font-medium text-ink">{value}</dd>
      <p className="mt-1 text-xs leading-snug text-faint">{definition}</p>
    </div>
  );
}

async function OverviewContent() {
  await connection();
  const now = new Date();
  const result = await load(async () => {
    const [o, insights, perf, reports] = await Promise.all([getOverview(now), listInsights(now), getPerformance(), latestReports()]);
    return { o, insights, perf, reports };
  });
  if (!result.ok) {
    return <ErrorState {...result.error} action={<ButtonLink href="/company/settings">Check configuration</ButtonLink>} />;
  }
  const { o, insights, perf, reports } = result.data;

  if (o.chargers.total === 0) {
    return (
      <EmptyState
        title="No chargers yet"
        action={
          <ButtonLink href="/company/data" variant="primary">
            Import data
          </ButtonLink>
        }
      >
        Import the charging-session dataset or a station registry to see the network here.
      </EmptyState>
    );
  }

  const open = insights.items.filter((i) => i.workflow.status !== "resolved" && i.workflow.status !== "dismissed");
  const top = open.slice(0, 3);
  const f = perf.fleet;
  const hasSessions = f.sessions > 0;
  const learnable = reports.filter((r) => r.learnable);

  return (
    <div className="grid gap-6">
      <Notice>
        Data in this workspace: <strong>{o.stations.total - o.stations.synthetic}</strong> stations from imported data
        {hasSessions && (
          <>
            {" "}
            (historical sessions {formatDate(f.firstAt)} – {formatDate(f.lastAt)})
          </>
        )}
        {o.stations.synthetic > 0 && (
          <>
            {" "}
            and <strong>{o.stations.synthetic}</strong> demo stations, labelled “Demo”, that show the connector-health workflow
          </>
        )}
        . Nothing here is a live feed.
      </Notice>

      {/* 1 ── What needs attention first */}
      <section aria-labelledby="attention-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="attention-heading" className="text-lg font-semibold">
              Needs attention first
            </h2>
            <p className="text-sm text-muted">
              {open.length === 0
                ? "No open action items."
                : `${insights.counts.high} high, ${insights.counts.medium} medium and ${insights.counts.low} low priority open items, each traceable to a rule and its records.`}
            </p>
          </div>
          <ButtonLink href="/company/actions" variant="primary">
            All action items ({open.length})
          </ButtonLink>
        </div>
        {top.length === 0 ? (
          <EmptyState title="Nothing to act on">The current data does not trigger any rule.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {top.map((i) => (
              <InsightCard key={i.key} insight={i} />
            ))}
          </div>
        )}
      </section>

      {/* 2 ── Connector health across the fleet */}
      <Panel
        title={`Connector health · ${o.chargers.total} chargers at ${o.stations.total} stations`}
        description="Each charger's category from its own measurement history. Click a category to list those chargers."
      >
        <HealthDistribution counts={o.healthDistribution} total={o.chargers.total} />
        <dl className="mt-5 grid gap-x-8 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Newest health reading</dt>
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
            <dt className="text-muted">Readings in the last 30 days</dt>
            <dd className="num text-ink">{o.freshness.observationsLast30Days}</dd>
          </div>
          <div>
            <dt className="text-muted">Chargers with only old or no readings</dt>
            <dd className="text-ink">
              <span className="num">{o.freshness.chargersStaleOrEmpty}</span>
              <span className="text-faint"> (none in {o.freshness.staleAfterDays} days — assessed as historical)</span>
            </dd>
          </div>
        </dl>
      </Panel>

      {/* 3 ── Session performance */}
      {hasSessions ? (
        <section aria-labelledby="perf-heading" className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="perf-heading" className="text-lg font-semibold">
                Charging sessions
              </h2>
              <p className="text-sm text-muted">
                Historical data · {formatDate(f.firstAt)} – {formatDate(f.lastAt)} · {f.sessions.toLocaleString("en-GB")} sessions at {perf.stations.length} stations.
              </p>
            </div>
            <ButtonLink href="/company/performance">Station performance</ButtonLink>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Energy delivered (derived)"
              value={f.energyKwh === null ? "Not in data" : `${formatNumber(f.energyKwh, 0)} kWh`}
              definition="Σ charging power × charging time. Derived, not metered."
            />
            <Kpi
              label="Average session"
              value={f.avgDurationMin === null ? "Not in data" : `${formatNumber(f.avgDurationMin, 0)} min`}
              definition={`Mean charging time; average charging power ${f.avgChargingPowerKw === null ? "not in data" : `${formatNumber(f.avgChargingPowerKw, 1)} kW`}.`}
            />
            <Kpi
              label="High-loss sessions"
              value={f.highLoss.rate === null ? "Not labelled" : formatPercent(f.highLoss.rate, 1)}
              definition={`${f.highLoss.count} of ${f.highLoss.of} sessions labelled “High” loss in the dataset. Median loss ${f.medianLossShare === null ? "—" : formatPercent(f.medianLossShare, 0)} of power consumed.`}
            />
            <Kpi
              label="Records that cannot all be right"
              value={`${f.lossExceedsConsumed.count + f.energyExceedsBattery.count}`}
              definition={`${f.lossExceedsConsumed.count} lose more power than consumed; ${f.energyExceedsBattery.count} exceed battery capacity.`}
            />
          </dl>
          <p className="text-xs text-muted">
            Not shown: utilisation, downtime and failed-session rate. The data has no per-charger availability, no downtime and no
            session outcome, and its charger counts per station are inconsistent.
          </p>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Sessions per day">
              <TrendChart label="Sessions per day" kind="count" points={perf.daily.map((d) => ({ x: d.day, y: d.sessions }))} />
              <p className="mt-3 text-sm text-muted">{perf.takeaways.dailySessions}</p>
            </Panel>
            <Panel title="Share of high-loss sessions per day">
              <TrendChart
                label="Daily share of high-loss sessions"
                kind="percent"
                points={perf.daily.map((d) => ({ x: d.day, y: d.highLossRate }))}
                reference={f.highLoss.rate !== null ? { value: f.highLoss.rate, label: `period ${formatPercent(f.highLoss.rate)}` } : undefined}
              />
              <p className="mt-3 text-sm text-muted">{perf.takeaways.dailyLoss}</p>
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="High-loss share by area type" description="Area type is recorded per session.">
              <RateIntervals
                caption="High-loss share by area type with 95% intervals"
                fleet={f.highLoss.rate}
                rows={perf.byArea.map((r) => ({ label: r.label, ...r.summary.highLoss }))}
              />
              <p className="mt-3 text-sm">{perf.takeaways.area}</p>
            </Panel>
            <Panel title="High-loss share by charging type">
              <RateIntervals
                caption="High-loss share by charging type with 95% intervals"
                fleet={f.highLoss.rate}
                rows={perf.byMode.map((r) => ({ label: r.label, ...r.summary.highLoss }))}
              />
              <p className="mt-3 text-sm">{perf.takeaways.mode}</p>
            </Panel>
          </div>
        </section>
      ) : (
        <EmptyState title="No session data yet" action={<ButtonLink href="/company/data">Import sessions</ButtonLink>}>
          Import a charging-session file to see energy, loss and data-quality figures here.
        </EmptyState>
      )}

      {reports.length > 0 && (
        <Panel
          title="Learned model"
          actions={
            <ButtonLink href="/company/model" size="sm">
              Model details
            </ButtonLink>
          }
        >
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reports.map((r) => {
              const e = r.evaluations.find((x) => x.model === r.best)!;
              return (
                <li key={r.target} className="rounded-md bg-sunken px-3.5 py-2.5 text-sm">
                  <p className="text-muted">{r.targetLabel}</p>
                  {r.learnable ? (
                    <p className="mt-0.5">
                      <span className="num text-lg font-medium text-ink">{formatPercent(e.accuracy, 1)}</span> correct on unseen sessions
                      <span className="text-faint"> (guessing: {formatPercent(r.baselineAccuracy, 1)})</span>
                    </p>
                  ) : (
                    <p className="mt-0.5">
                      <span className="font-medium">Not predictable</span>
                      <span className="text-faint"> — no better than guessing ({formatPercent(r.baselineAccuracy, 1)})</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {learnable.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              Use it on the <Link href="/company/model#classify" className="text-signal hover:underline">model page</Link> to categorise a new session from its measured values.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
