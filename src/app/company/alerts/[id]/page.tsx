import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { ALERT_RULE_LABELS, METRICS } from "@/config/domain";
import { AlertActions } from "@/components/alerts/alert-actions";
import { EvidenceSummary } from "@/components/alerts/evidence-summary";
import { MetricTrace } from "@/components/charts/metric-trace";
import { ErrorState, KeyValues, Notice, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { AlertStatusTag, HealthBadge, DemoTag } from "@/components/ui/status";
import { deviationThreshold } from "@/features/anomaly-detection/assess-metric";
import { getAlertDetail, listObservations } from "@/features/connector-health/queries";
import { load } from "@/lib/http/load";
import { formatDateTime, shortId } from "@/lib/utils/format";
import { uuidSchema } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Alert" };

export default function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PanelSkeleton rows={8} />}>
      <AlertContent params={params} />
    </Suspense>
  );
}

async function AlertContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  if (!uuidSchema.safeParse(id).success) notFound();
  const result = await load(async () => {
    const detail = await getAlertDetail(id);
    const obs = await listObservations(detail.charger.id, 1000);
    return { ...detail, series: obs.filter((o) => o.metric === detail.alert.metric).reverse() };
  });
  if (!result.ok) {
    if (result.notFound) notFound();
    return <ErrorState {...result.error} />;
  }
  const { alert, charger, station, events, series } = result.data;
  const def = METRICS[alert.metric];
  const ev = alert.evidence;
  const baseline = ev.kind === "fault_recurrence" ? null : ev.baseline;
  const threshold = baseline ? deviationThreshold(baseline.median, baseline.scale, def.minScale, ANALYSIS_PARAMS) : null;

  return (
    <>
      <PageHeader
        meta={
          <>
            <Link href="/company/alerts" className="hover:text-ink">
              Alerts
            </Link>
            <span aria-hidden>/</span>
            <span className="num">{shortId(alert.id)}</span>
            {charger.isSynthetic && <DemoTag />}
          </>
        }
        title={`${ALERT_RULE_LABELS[alert.rule]} in ${def.label.toLowerCase()}`}
        description={
          <>
            Charger{" "}
            <Link href={`/company/chargers/${charger.id}`} className="num text-signal hover:underline">
              {charger.code}
            </Link>{" "}
            at{" "}
            <Link href={`/company/stations/${station.id}`} className="text-signal hover:underline">
              {station.name}
            </Link>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <HealthBadge status={alert.severity} />
            <AlertStatusTag status={alert.status} />
          </div>
        }
      />
      {!alert.conditionActive && (alert.status === "open" || alert.status === "acknowledged") && (
        <div className="mb-5">
          <Notice>
            The most recent analysis no longer finds this condition. The alert stays open until someone reviews and resolves it.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="What was detected">
            <p className="text-ink">{alert.explanation}</p>
            <div className="mt-4">
              {series.length >= 3 ? (
                <MetricTrace
                  label={def.label}
                  unit={def.unit}
                  points={series.map((o) => ({ t: o.observedAt.getTime(), value: o.value }))}
                  baseline={baseline ? { median: baseline.median, from: baseline.from, to: baseline.to } : null}
                  threshold={threshold}
                  highlightWindow={{ start: alert.windowStart.toISOString(), end: alert.windowEnd.toISOString() }}
                  height={240}
                />
              ) : (
                <p className="text-sm text-muted">The underlying observations are no longer available to chart.</p>
              )}
            </div>
          </Panel>
          <Panel title="Triggering evidence and thresholds">
            <EvidenceSummary evidence={ev} />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Status">
            <AlertActions alertId={alert.id} status={alert.status} />
          </Panel>
          <Panel title="Interpretation">
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-ink">Confidence</p>
                <p className="text-muted">{alert.confidenceNote}</p>
              </div>
              <div>
                <p className="font-medium text-ink">Suggested action</p>
                <p className="text-muted">{alert.suggestedAction}</p>
              </div>
            </div>
          </Panel>
          <Panel title="Record">
            <KeyValues
              items={[
                ["Alert ID", <span key="i" className="num text-xs">{alert.id}</span>],
                ["Window", `${formatDateTime(alert.windowStart)} – ${formatDateTime(alert.windowEnd)}`],
                ["First detected", formatDateTime(alert.firstDetectedAt)],
                ["Last evaluated", formatDateTime(alert.lastEvaluatedAt)],
                ["New-evidence count", String(alert.occurrences)],
                ["Analysis version", alert.analysisVersion],
              ]}
            />
          </Panel>
          <Panel title="History" flush>
            <ol className="divide-y divide-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-2.5">
                  <p className="text-ink">
                    {e.fromStatus ? `${e.fromStatus} → ${e.toStatus}` : `Created as ${e.toStatus}`}
                  </p>
                  {e.note && <p className="text-muted">{e.note}</p>}
                  <p className="text-xs text-faint">{formatDateTime(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
