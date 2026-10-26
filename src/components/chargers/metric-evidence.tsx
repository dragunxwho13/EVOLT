import { ANALYSIS_PARAMS } from "@/config/analysis";
import { ALERT_RULE_LABELS, METRICS } from "@/config/domain";
import { MetricTrace } from "@/components/charts/metric-trace";
import { HealthBadge } from "@/components/ui/status";
import { cn } from "@/lib/utils/cn";
import { deviationThreshold } from "@/features/anomaly-detection/assess-metric";
import type { MetricAssessment, ServiceForecast } from "@/types/analysis";
import { formatDate, formatMetricValue, formatNumber, formatPercent } from "@/lib/utils/format";
import type { ReactNode } from "react";

export function MetricEvidence({
  assessment,
  series,
  markers = [],
  limitControl,
}: {
  assessment: MetricAssessment;
  series: { t: number; value: number }[];
  markers?: { t: number; label: string }[];
  /** Optional editor for the service limit (contact resistance only). */
  limitControl?: ReactNode;
}) {
  const forecast = assessment.forecast ?? null;
  const tc = assessment.temperatureCorrection ?? null;
  const def = METRICS[assessment.metric];
  const b = assessment.baseline;
  const threshold = b ? deviationThreshold(b.median, b.scale, def.minScale, ANALYSIS_PARAMS) : null;
  const canChart = assessment.metric === "fault_count" ? series.length >= ANALYSIS_PARAMS.minBaselinePoints : b !== null;
  const window = assessment.findings[0] ? { start: assessment.findings[0].windowStart, end: assessment.findings[0].windowEnd } : null;
  // Plain-language reading of what the analysis concluded (never a fresh judgement of its own).
  const interpretation =
    assessment.findings.length > 0
      ? `The analysis found ${assessment.findings.length === 1 ? "one pattern" : `${assessment.findings.length} patterns`} in this metric — see below for the evidence and what to check.`
      : assessment.status === "insufficient_data" || !b
        ? "There are too few valid readings to judge this metric yet."
        : assessment.latest && threshold !== null && assessment.latest.value > threshold
          ? assessment.notes.find((n) => /baseline/i.test(n)) ??
            "The latest reading is above the deviation threshold, but not in enough recent readings to count as persistent."
          : `Readings stay within this charger's own normal range: no persistent deviation, sustained rise or fault pattern was found.`;

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
              limit={forecast ? forecast.limit : null}
              markers={markers}
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
          {tc && (
            <p className={cn("rounded border px-2 py-1 text-xs", tc.applied ? "border-signal/40 text-signal" : "border-line text-muted")}>
              {tc.applied
                ? `Temperature-corrected to ${tc.referenceC} °C (readings taken at ${formatNumber(tc.minTempC ?? 0, 0)}–${formatNumber(tc.maxTempC ?? 0, 0)} °C). Values shown are corrected.`
                : tc.withTemperature > 0
                  ? `Not temperature-corrected: only ${tc.withTemperature} of ${tc.readings} readings record a temperature.`
                  : "Not temperature-corrected: no contact temperature recorded."}
            </p>
          )}
          {forecast && <ForecastBlock forecast={forecast} metric={assessment.metric} limitControl={limitControl} />}
          <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">What this means</p>
            <p className="mt-1 text-sm leading-6 text-ink">{interpretation}</p>
          </div>
          {assessment.findings.length > 0 && (
            <ul className="space-y-2">
              {assessment.findings.map((f) => (
                <li
                  key={f.rule}
                  className={cn(
                    "rounded-md border bg-sunken px-3 py-2",
                    f.severity === "inspection_recommended" ? "border-inspect/40" : "border-watch/40",
                  )}
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

function ForecastBlock({ forecast: f, metric, limitControl }: { forecast: ServiceForecast; metric: MetricAssessment["metric"]; limitControl?: ReactNode }) {
  const tone =
    f.status === "already_above" ? "border-inspect/50" : f.status === "projected" && !f.beyondHorizon ? "border-watch/50" : "border-line";
  const headline =
    f.status === "already_above"
      ? "Already at or above the service limit"
      : f.status === "projected"
        ? f.beyondHorizon
          ? "Service limit more than a year away"
          : f.expectedDate
            ? `Service limit likely around ${formatDate(f.expectedDate)}`
            : `Service limit not before ${formatDate(f.earliestDate)}`
        : f.status === "not_rising"
          ? "No clear rise — no service date forecast"
          : "Not enough readings to forecast";
  return (
    <section aria-label="Service-limit forecast" className={cn("rounded-md border bg-surface px-3 py-2.5", tone)} data-testid={`forecast-${metric}`}>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">Service forecast</p>
      <p className="mt-1 font-semibold text-ink">{headline}</p>
      {f.status === "projected" && !f.beyondHorizon && (
        <p className="num mt-0.5 text-sm text-muted">
          {formatPercent(f.confidence)} range: {formatDate(f.earliestDate)} – {f.latestDate ? formatDate(f.latestDate) : "later than a year"}
        </p>
      )}
      <p className="mt-1 text-sm leading-6 text-muted">{f.explanation}</p>
      <p className="mt-1 text-xs text-faint">
        Limit {formatMetricValue(metric, f.limit)} ({f.limitSource === "operator" ? "set by the operator" : "default: baseline + 50%"}). A forecast extends the
        recent rate; maintenance, load or weather can change it.
      </p>
      {limitControl && <div className="mt-2 border-t border-line pt-2">{limitControl}</div>}
    </section>
  );
}
