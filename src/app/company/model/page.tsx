import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DistributionChart } from "@/components/model/distribution-chart";
import { ClassifyForm } from "@/components/model/classify-form";
import { DegradationStudy } from "@/components/model/degradation-study";
import { RetrainButton } from "@/components/model/retrain-button";
import { ButtonLink, EmptyState, ErrorState, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { humanize } from "@/features/learning/train";
import { latestReports, sessionStats } from "@/features/learning/service";
import type { ModelEvaluation, TargetReport } from "@/features/learning/types";
import { load } from "@/lib/http/load";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Learned model" };

export default function ModelPage() {
  return (
    <>
      <PageHeader
        title="Learned model"
        description="Classifiers trained on the labelled sessions you imported, and tested only on sessions they never saw. A label is called predictable only when a model clearly beats guessing."
        actions={<RetrainButton />}
      />
      <Suspense fallback={<PanelSkeleton rows={10} />}>
        <ModelContent />
      </Suspense>
      <DegradationStudy />
    </>
  );
}

const pct = (v: number) => formatPercent(v, 1);

async function ModelContent() {
  await connection();
  const result = await load(async () => ({ stats: await sessionStats(), reports: await latestReports() }));
  if (!result.ok) return <ErrorState {...result.error} />;
  const { stats, reports } = result.data;

  if (!reports.length) {
    return (
      <EmptyState
        title={stats.sessions ? "No labelled sessions to learn from" : "No session data yet"}
        action={
          <ButtonLink href="/company/data" variant="primary">
            Import a session dataset
          </ButtonLink>
        }
      >
        Import a charging-session file that includes a category column (for example the bundled{" "}
        <code className="num">ev-charging-grid-sessions.csv</code>). EVOLT then trains a classifier for each label and reports how well it
        does on unseen sessions.
      </EmptyState>
    );
  }

  // Learnable labels first; each follow-up test directly after the label it belongs to.
  const base = (r: TargetReport) => r.variantOf ?? r.target;
  const rank = (t: string) => (reports.find((r) => r.target === t)?.learnable ? 0 : 1);
  const sorted = [...reports].sort(
    (a, b) => rank(base(a)) - rank(base(b)) || base(a).localeCompare(base(b)) || Number(Boolean(a.variantOf)) - Number(Boolean(b.variantOf)),
  );
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Training data">
        {(
          [
            ["Sessions stored", stats.sessions.toLocaleString("en-GB")],
            ["With labels", stats.labelled.toLocaleString("en-GB")],
            ["Chargers", String(stats.chargers)],
            ["Time span", stats.first && stats.last ? `${formatDate(stats.first)} – ${formatDate(stats.last)}` : "—"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-sm text-muted">{k}</p>
            <p className="num mt-0.5 text-lg text-ink">{v}</p>
          </div>
        ))}
      </section>

      {sorted.map((r) => (
        <TargetSection key={r.target} report={r} orderHint={r.variantOf ? reports.find((p) => p.target === r.variantOf)?.thresholdModel?.order : undefined} />
      ))}

      <Panel title="How these numbers were produced">
        <ul className="grid gap-x-8 gap-y-2 text-sm text-muted md:grid-cols-2">
          <li>
            Each label is tested with {sorted[0]!.folds}-fold stratified cross-validation (fixed seed {sorted[0]!.seed}): the model is trained
            on four fifths of the sessions and scored on the fifth it never saw, five times over.
          </li>
          <li>Everything the model learns — which measurement to use, the cut points, the weights — is chosen inside each training fold only.</li>
          <li>
            The baseline always predicts the most common class. A label counts as predictable only if the best model beats it by at least 5
            points and by more than two fold-standard-deviations.
          </li>
          <li>
            Results describe this dataset only. It contains records that cannot all be correct (for example sessions that lose more power than
            they consume — see Action items), so treat these accuracies as a description of the file, not as evidence about real chargers.
          </li>
          <li>
            The trained model is stored with each run and reloaded for every prediction, so predictions always use exactly the evaluated model.
            The same training can be reproduced offline with <code className="num">npm run model:train</code>.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

/** Ordinal display order (Low → Medium → High) when the label is ordered, else alphabetical. */
function displayOrder(r: TargetReport, hint?: string[]): string[] {
  const o = hint ?? (r.learnable && r.thresholdModel ? r.thresholdModel.order : null);
  return o && o.length === r.classes.length ? o : r.classes;
}

function reorder(e: ModelEvaluation, from: string[], to: string[]): ModelEvaluation {
  const idx = to.map((c) => from.indexOf(c));
  return {
    ...e,
    confusion: idx.map((i) => idx.map((j) => e.confusion[i]![j]!)),
    perClass: idx.map((i) => e.perClass[i]!),
  };
}

function TargetSection({ report: r, orderHint }: { report: TargetReport; orderHint?: string[] }) {
  const order = displayOrder(r, orderHint);
  const chosen = r.evaluations.find((e) => e.model === r.best)!;
  const bestAttempt = [...r.evaluations.slice(1)].sort((a, b) => b.accuracy - a.accuracy)[0]!;
  const shown = reorder(r.learnable ? chosen : bestAttempt, r.classes, order);
  const t = r.thresholdModel;
  return (
    <section
      aria-labelledby={`t-${r.target}`}
      className={cn("rounded-lg border bg-surface", r.learnable ? "border-ok/50" : "border-line")}
    >
      <header className="border-b border-line px-4 py-4 sm:px-5">
        <p className="text-sm text-muted">
          {r.variantOf ? "Follow-up test" : "Label"}: <code className="num text-ink">{r.variantOf ?? r.target}</code> · {order.join(", ")} ·{" "}
          {r.rows.toLocaleString("en-GB")} sessions
          {r.excludedFeatures?.length ? ` · without ${r.excludedFeatures.join(", ")}` : ""}
        </p>
        {r.question && <p className="mt-1 text-sm font-medium text-ink">{r.question}</p>}
        <h2 id={`t-${r.target}`} className="mt-1 text-xl font-semibold tracking-[-0.01em]">
          {r.learnable ? (
            <>
              {r.question ? "Yes" : "Predictable"} — <span className="num">{pct(chosen.accuracy)}</span> correct on unseen sessions
            </>
          ) : (
            <>{r.question ? "No — " : ""}Not predictable from this data</>
          )}
        </h2>
        <p className="mt-1.5 max-w-3xl text-sm text-muted">{r.verdict}</p>
      </header>

      <div className="grid gap-6 px-4 py-5 sm:px-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Accuracy on unseen sessions</h3>
          <ModelBars evaluations={r.evaluations} baseline={r.baselineAccuracy} chosen={r.learnable ? r.best : null} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">
            Confusion matrix — {r.learnable ? shown.name.toLowerCase() : `best attempt (${shown.name.toLowerCase()})`}
          </h3>
          <Confusion classes={order} evaluation={shown} />
        </div>
      </div>

      {r.learnable && t && (
        <div className="border-t border-line px-4 py-5 sm:px-5">
          <h3 className="text-sm font-semibold text-ink">What the model learned</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            {t.order
              .map((label, i) => {
                const lo = i === 0 ? null : t.cuts[i - 1]!;
                const hi = i === t.order.length - 1 ? null : t.cuts[i]!;
                const f = humanize(t.feature).toLowerCase();
                const range = lo === null ? `${f} ≤ ${formatNumber(hi!)}` : hi === null ? `${f} > ${formatNumber(lo)}` : `${formatNumber(lo)} < ${f} ≤ ${formatNumber(hi)}`;
                return `${range} → ${label}`;
              })
              .join(";  ")}
            . Each dot below is one session; the dashed lines are the learned cut points.
          </p>
          <div className="mt-3">
            <DistributionChart feature={humanize(t.feature)} unit={t.feature === "power_loss" ? "kW" : ""} groups={r.distribution} cuts={t.cuts} />
          </div>
          {r.best === "threshold" && (
            <p className="mt-3 max-w-3xl text-sm text-muted">
              <span className="font-medium text-ink">What this is useful for: </span>
              categorising new sessions consistently from their measured {humanize(t.feature).toLowerCase()}. In this dataset the label is
              almost a fixed function of that one measurement, so the high accuracy means the labelling rule was recovered — not that EVOLT
              can forecast it. The follow-up test below checks whether it can be anticipated without the measurement.
            </p>
          )}
        </div>
      )}

      {r.learnable && r.finalModel && !r.variantOf && (
        <div id="classify" className="scroll-mt-24 border-t border-line px-4 py-5 sm:px-5">
          <h3 className="text-sm font-semibold text-ink">Categorise a session</h3>
          <p className="mt-1 mb-3 text-sm text-muted">Enter the measured values; the stored model classifies it and shows the rule it applied.</p>
          <ClassifyForm
            target={r.target}
            features={(r.finalModel.kind === "threshold" ? [r.finalModel.feature] : r.finalModel.features.filter((f) => !f.includes("="))).map((f) => ({
              key: f,
              label: humanize(f),
              min: r.featureRanges?.[f]?.min ?? null,
              max: r.featureRanges?.[f]?.max ?? null,
            }))}
          />
        </div>
      )}

      <div className="border-t border-line px-4 py-4 sm:px-5">
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-ink">Per-class precision and recall, and inputs</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Class</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Sessions</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Precision</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Recall</th>
                  <th scope="col" className="py-2 text-right font-medium">F1</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.perClass.map((c) => (
                  <tr key={c.label}>
                    <td className="py-2 pr-3">{c.label}</td>
                    <td className="num py-2 pr-3 text-right">{c.support}</td>
                    <td className="num py-2 pr-3 text-right">{pct(c.precision)}</td>
                    <td className="num py-2 pr-3 text-right">{pct(c.recall)}</td>
                    <td className="num py-2 text-right">{c.f1.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-muted">
            Inputs ({r.features.length}): {r.features.map(humanize).join(", ")}. Identifier columns are excluded. Trained{" "}
            {formatDateTime(r.trainedAt)}.
          </p>
        </details>
      </div>
    </section>
  );
}

function ModelBars({ evaluations, baseline, chosen }: { evaluations: ModelEvaluation[]; baseline: number; chosen: string | null }) {
  return (
    <ul className="space-y-3">
      {evaluations.map((e) => (
        <li key={e.model}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className={cn("text-ink", chosen === e.model && "font-semibold")}>
              {e.name}
              {chosen === e.model && <span className="ml-2 rounded bg-ok-soft px-1.5 py-px text-xs font-medium text-ok">used</span>}
            </span>
            <span className="num shrink-0 text-ink">
              {pct(e.accuracy)} <span className="text-faint">± {formatNumber(e.accuracyStd * 100, 1)}</span>
            </span>
          </div>
          <div className="relative mt-1 h-2.5 rounded-full bg-sunken" aria-hidden>
            <div
              className={cn("h-full rounded-full", e.model === "majority" ? "bg-unknown" : chosen === e.model ? "bg-ok" : "bg-signal")}
              style={{ width: `${Math.max(0, Math.min(1, e.accuracy)) * 100}%` }}
            />
            <div className="absolute top-[-3px] h-4 w-px bg-ink" style={{ left: `${baseline * 100}%` }} title="Baseline" />
          </div>
          <p className="mt-0.5 text-xs text-faint">{e.description}</p>
        </li>
      ))}
      <li className="text-xs text-muted">The thin vertical mark is the baseline ({pct(baseline)}).</li>
    </ul>
  );
}

function Confusion({ classes, evaluation }: { classes: string[]; evaluation: ModelEvaluation }) {
  const max = Math.max(1, ...evaluation.confusion.flat());
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <caption className="sr-only">Rows are the true class, columns the predicted class</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left text-xs font-normal text-muted">
              true ↓ / predicted →
            </th>
            {classes.map((c) => (
              <th key={c} scope="col" className="px-2 py-1 text-center text-xs font-medium text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evaluation.confusion.map((row, i) => (
            <tr key={classes[i]}>
              <th scope="row" className="px-2 py-1 text-left text-xs font-medium text-muted">
                {classes[i]}
              </th>
              {row.map((n, j) => {
                const strength = n / max;
                return (
                  <td key={j} className="p-0.5">
                    <div
                      className={cn("num grid h-12 w-16 place-items-center rounded text-sm", i === j ? "text-ink" : "text-ink")}
                      style={{
                        background:
                          i === j
                            ? `color-mix(in srgb, var(--ok) ${Math.round(12 + strength * 55)}%, transparent)`
                            : `color-mix(in srgb, var(--inspect) ${Math.round(strength * 55)}%, transparent)`,
                      }}
                      title={`${n} sessions labelled ${classes[i]} were predicted ${classes[j]}`}
                    >
                      {n}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Green diagonal = correct. Summed over all five held-out folds.</p>
    </div>
  );
}
