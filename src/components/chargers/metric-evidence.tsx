import { ANALYSIS_PARAMS } from "@/config/analysis";
import { ALERT_RULE_LABELS, METRICS } from "@/config/domain";
import { MetricTrace } from "@/components/charts/metric-trace";
import { HealthBadge } from "@/components/ui/status";
import { cn } from "@/lib/utils/cn";
import { deviationThreshold } from "@/features/anomaly-detection/assess-metric";
import type { MetricAssessment } from "@/types/analysis";
import { formatDate, formatMetricValue, formatNumber } from "@/lib/utils/format";

export function MetricEvidence({ assessment, series }: { assessment: MetricAssessment; series: { t: number; value: number }[] }) {
  const def = METRICS[assessment.metric];
  const b = assessment.baseline;
  const threshold = b ? deviationThreshold(b.median, b.scale, def.minScale, ANALYSIS_PARAMS) : null;
  const canChart = assessment.metric === "fault_count" ? series.length >= ANALYSIS_PARAMS.minBaselinePoints : b !== null;
  const window = assessment.findings[0] ? { start: assessment.findings[0].windowStart, end: assessment.findings[0].windowEnd } : null;

  return (
    <article className="rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-semibold">{def.label}</h3>
          <p className="mt-0.5 max-w-prose text-sm text-muted">{def.description}</p>
        </div>
        {def.supporting ? (
          <span className="rounded border border-line px-2 py-0.5 text-xs text-muted">Supporting only — never sets status</span>
        ) : (
          <HealthBadge status={assessment.status} />
        )}
      </header>
      <div className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {canChart ? (
            <MetricTrace
              label={def.label}
              unit={def.unit}
              points={series}
              baseline={b ? { median: b.median, from: b.from, to: b.to } : null}
              threshold={threshold}
              highlightWindow={window}
            />
          ) : (
            <div className="grid h-[180px] place-items-center rounded-md border border-dashed border-line-strong px-6 text-center text-sm text-muted">
              Not enough history to draw a meaningful trend ({assessment.validPoints} valid reading
              {assessment.validPoints === 1 ? "" : "s"}).
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt className="text-muted">Latest</dt>
              <dd className="num text-base text-ink">{assessment.latest ? formatMetricValue(assessment.metric, assessment.latest.value) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Baseline median</dt>
              <dd className="num text-base text-ink">{b ? formatMetricValue(assessment.metric, b.median) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Valid readings</dt>
              <dd className="num text-ink">
                {assessment.validPoints}
                {assessment.excludedPoints > 0 && <span className="text-watch"> (+{assessment.excludedPoints} excluded)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Typical interval</dt>
              <dd className="num text-ink">{assessment.medianIntervalDays !== null ? `${formatNumber(assessment.medianIntervalDays, 1)} days` : "—"}</dd>
            </div>
          </dl>
          {b && (
            <p className="text-muted">
              Baseline from the first {b.n} readings ({formatDate(b.from)} to {formatDate(b.to)}).
            </p>
          )}
          {assessment.findings.length > 0 && (
            <ul className="space-y-2">
              {assessment.findings.map((f) => (
                <li
                  key={f.rule}
                  className={cn("rounded-md border-l-2 bg-sunken px-3 py-2", f.severity === "inspection_recommended" ? "border-inspect" : "border-watch")}
                >
                  <p className="font-medium text-ink">{ALERT_RULE_LABELS[f.rule]}</p>
                  <p className="mt-0.5 text-muted">{f.explanation}</p>
                </li>
              ))}
            </ul>
          )}
          {assessment.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-muted">
              {assessment.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {assessment.qualityFlags.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-ink">Data quality</p>
              <ul className="space-y-1 text-watch">
                {assessment.qualityFlags.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
