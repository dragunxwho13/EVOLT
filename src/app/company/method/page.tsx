import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ANALYSIS_PARAMS, ANALYSIS_VERSION } from "@/config/analysis";
import { METRICS, METRIC_KEYS, PROVENANCES, PROVENANCE_DESCRIPTIONS } from "@/config/domain";
import { RecomputeButton } from "@/components/analytics/recompute-button";
import { ErrorState, Notice, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { runEvaluation, SCENARIOS, type DetectorResult, type ScenarioKind } from "@/features/anomaly-detection/evaluation";
import { getDataQualityReport } from "@/lib/analytics/overview";
import { load } from "@/lib/http/load";
import { formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Analysis method" };

const P = ANALYSIS_PARAMS;

const STEPS: { title: string; body: string }[] = [
  {
    title: "Validate",
    body: `Readings that are missing, non-numeric, outside each metric's plausible range, timestamped more than ${P.futureToleranceMinutes} minutes in the future, or duplicated are excluded and reported. Nothing is replaced with zero.`,
  },
  {
    title: "Establish a baseline",
    body: `Each charger is compared with its own history: the median of its earliest ${P.minBaselinePoints}–${P.maxBaselinePoints} readings, with spread measured by the median absolute deviation. At least ${P.minBaselinePoints + P.minRecentPoints} valid readings are required; otherwise the metric is "Insufficient data".`,
  },
  {
    title: "Look for persistence, not spikes",
    body: `A reading deviates when it is more than ${P.deviationZ} robust spreads and at least ${formatPercent(P.minRelativeDeviation)} above the baseline median. An alert needs ${P.persistenceMinCount} of the last ${P.persistenceWindow} readings to deviate; a single spike is noted but not alerted. If more than ${formatPercent(P.maxBaselineExceedFraction)} of the baseline readings already cross the threshold, the baseline is too variable and no deviation alert is raised. Sustained deviations of ${formatPercent(P.severeRelativeDeviation)} or more recommend inspection.`,
  },
  {
    title: "Check direction and magnitude of change",
    body: `Over the last ${P.trendWindow} readings, the Theil–Sen median slope must be upward in at least ${formatPercent(P.trendConsistency)} of reading pairs and add up to at least ${formatPercent(P.trendMinRelativeChange)} of the baseline (and ${P.trendMinScaleMultiple} spreads). A rise of ${formatPercent(P.trendSevereRelativeChange)} with a deviating latest reading recommends inspection.`,
  },
  {
    title: "Count recurring faults",
    body: `Connector-related faults in the ${P.faultWindowDays} days ending at the latest report: ${P.faultMonitorTotal} or more (and 1.5× the historical rate) means Monitor; ${P.faultInspectTotal} or more means Inspection recommended.`,
  },
  {
    title: "Combine and qualify",
    body: `The charger takes its most serious primary-metric result; two independent metrics at Monitor escalate to Inspection recommended. Temperature rise and voltage fluctuation are supporting evidence only and never set status. When the newest reading is older than ${P.staleAfterDays} days, the result is labelled historical: it describes the data at that time, not the connector today.`,
  },
];

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        title="Analysis method"
        description="The connector-health analysis is deterministic and rule-based: the same data always gives the same result, and every rule and threshold is listed here."
        actions={<RecomputeButton />}
      />
      <Panel title="How a charger is assessed" description={`Analysis version ${ANALYSIS_VERSION}`}>
        <ol className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-strong text-sm text-muted">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-ink">{s.title}</p>
                <p className="mt-0.5 text-sm text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 border-t border-line pt-4 text-sm text-muted">
          What this cannot do: EVOLT does not measure connectors itself and cannot see physical wear. A flagged pattern means the
          available measurements changed relative to this charger&apos;s own history — a reason to look, not proof of degradation.
        </p>
      </Panel>

      <EvaluationSection />

      <h2 className="mt-9 mb-3 text-lg font-semibold tracking-[-0.01em]">Data coverage and quality</h2>
      <Suspense fallback={<PanelSkeleton rows={6} />}>
        <QualitySection />
      </Suspense>
    </>
  );
}

function rate(n: number, d: number) {
  return d ? `${n}/${d} (${formatPercent(n / d)})` : "—";
}

function EvaluationSection() {
  const report = runEvaluation();
  const detectors: [string, DetectorResult][] = [
    ["Single-reading threshold", report.singlePoint],
    ["EVOLT trend-aware rules", report.trendAware],
  ];
  return (
    <section className="mt-9" aria-labelledby="eval-heading">
      <h2 id="eval-heading" className="mb-1 text-lg font-semibold tracking-[-0.01em]">
        Trend-aware rules versus a simple threshold
      </h2>
      <p className="mb-3 max-w-3xl text-sm text-muted">
        Both detectors are run reading-by-reading over {report.seedsPerScenario} generated series per scenario (
        {report.seriesLength} weekly readings each). The simple method flags any single reading above the same deviation
        threshold. Results are computed live from the code.
      </p>
      <Notice tone="warn">
        Development benchmark only. The trend parameters were tuned on different generated series (seeds 1–40) and are evaluated
        here on held-out seeds from {report.seedOffset + 1}. These figures describe behaviour on idealised scenarios; they are not
        an estimate of real-world accuracy.
      </Notice>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Detector comparison on generated scenarios</caption>
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Scenario</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Truth</th>
              {detectors.map(([name]) => (
                <th key={name} scope="col" className="px-3 py-2.5 font-medium">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(Object.keys(SCENARIOS) as ScenarioKind[]).map((k) => (
              <tr key={k}>
                <th scope="row" className="px-5 py-3 text-left font-normal">
                  <span className="block text-ink">{SCENARIOS[k].label}</span>
                  <span className="block text-xs text-muted">{SCENARIOS[k].description}</span>
                </th>
                <td className="px-3 py-3 text-muted">{SCENARIOS[k].degrading ? "Degrading" : "Not degrading"}</td>
                {detectors.map(([name, r]) => {
                  const s = r.perScenario[k];
                  return (
                    <td key={name} className="num px-3 py-3">
                      {SCENARIOS[k].degrading ? (
                        <>
                          {rate(s.flagged, s.series)} flagged
                          <span className="block text-xs text-muted">
                            median delay {s.medianDelay === null ? "—" : `${formatNumber(s.medianDelay, 1)} readings`}
                          </span>
                        </>
                      ) : (
                        <span className={s.flagged > 0 ? "text-inspect" : undefined}>{rate(s.flagged, s.series)} false alarms</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-line-strong">
            <tr>
              <th scope="row" className="px-5 py-3 text-left font-medium">
                Overall
              </th>
              <td />
              {detectors.map(([name, r]) => (
                <td key={name} className="num px-3 py-3">
                  detected {rate(r.detected, r.degradingSeries)}
                  <span className="block text-xs text-muted">
                    series with a false alarm {rate(r.falseAlarmSeries, r.degradingSeries + r.nonDegradingSeries)}
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-muted">
        Reading the table: requiring persistence suppresses alerts on isolated spikes, at the cost of reacting a little later to
        abrupt step changes. Neither method is told about measurement-method changes, seasonal effects or sensor faults, all of
        which occur in real data.
      </p>
    </section>
  );
}

async function QualitySection() {
  await connection();
  const result = await load(getDataQualityReport);
  if (!result.ok) return <ErrorState {...result.error} />;
  const q = result.data;
  const totalObs = PROVENANCES.reduce((s, p) => s + q.provenance[p], 0);
  const flagEntries = Object.entries(q.flagCounts);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Panel title="Metric coverage" flush>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Metric</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Chargers</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Readings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {METRIC_KEYS.map((k) => (
              <tr key={k}>
                <td className="px-5 py-2.5">
                  {METRICS[k].label} <span className="text-faint">({METRICS[k].unit})</span>
                </td>
                <td className="num px-3 py-2.5 text-right">{q.coverage[k].chargers}</td>
                <td className="num px-5 py-2.5 text-right">{q.coverage[k].observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="space-y-5">
        <Panel title="Where the readings come from">
          {totalObs === 0 ? (
            <p className="text-sm text-muted">No observations stored yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {PROVENANCES.map((p) => (
                <li key={p} className="flex items-baseline justify-between gap-3">
                  <span>
                    <span className="text-ink capitalize">{p === "simulated" ? "Generated" : p}</span>
                    <span className="block text-xs text-muted">{PROVENANCE_DESCRIPTIONS[p]}</span>
                  </span>
                  <span className="num">{q.provenance[p]}</span>
                </li>
              ))}
            </ul>
          )}
          {q.provenance.simulated > 0 && (
            <p className="mt-3 text-sm text-watch">
              {formatPercent(q.provenance.simulated / Math.max(totalObs, 1))} of stored readings are demo or sample data, not field measurements.
            </p>
          )}
        </Panel>
        <Panel title="Data-quality flags">
          {flagEntries.length === 0 ? (
            <p className="text-sm text-muted">No quality issues were flagged in the latest analysis of {q.evaluatedChargers} chargers.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {flagEntries.map(([code, v]) => (
                <li key={code} className="flex justify-between gap-3">
                  <span className="text-ink">{FLAG_LABELS[code] ?? code}</span>
                  <span className="text-muted">
                    <span className="num">{v!.chargers}</span> charger{v!.chargers === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

const FLAG_LABELS: Record<string, string> = {
  implausible_value: "Implausible values excluded",
  non_finite_value: "Missing or non-numeric values excluded",
  future_timestamp: "Future timestamps excluded",
  duplicate_timestamp: "Duplicate timestamps ignored",
  stale: "Latest data is stale",
  insufficient_history: "Too little history for a baseline",
  irregular_sampling: "Irregular sampling",
};
