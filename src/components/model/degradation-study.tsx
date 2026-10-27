import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import report from "../../../models/degradation-report.json";
import { formatNumber } from "@/lib/utils/format";

const SPLIT_LABELS = { station_grouped_cv: "Held-out stations (5-fold, grouped)", time_holdout: "Latest 20 % in time" } as const;

/** The leakage-aware degradation study from models/degradation-report.json (npm run model:degradation). */
export function DegradationStudy() {
  const { study, calibration, sources } = report;
  const lso = calibration.evaluation.leaveOneSweepOut;
  const loco = calibration.evaluation.leaveOneConnectorOut;
  const range = (v: number[]) => `${formatNumber(Math.min(...v), 2)}–${formatNumber(Math.max(...v), 2)} pts`;
  return (
    <Panel
      className="mt-6"
      title="Can connector degradation be predicted?"
      description={`From the unified training dataset (${sources.unified.rows} rows) and the Arduino bench log (run 2). Regression metrics on data the model never saw. Reproduce with npm run model:degradation.`}
    >
      <div className="space-y-5 text-sm">
        <div>
          <h3 className="font-semibold text-ink">1. What the dataset&apos;s degradation columns are</h3>
          <ul className="mt-2 space-y-1">
            {study.audit.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span className={c.holds ? "text-inspect" : "text-ok"} aria-hidden>{c.holds ? "=" : "≠"}</span>
                <span className="text-muted">
                  {c.finding} <span className="num text-faint">(largest difference {c.maxAbsDifference.toExponential(1)})</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted">
            All {study.audit.rows} rows are derived from the charging sessions; {study.audit.lossExceedsConsumption} lose more power than they consume (degradation clipped at
            100 %). There is no independently measured degradation label.
          </p>
        </div>

        <div>
          <h3 className="font-semibold text-ink">2. Baseline versus ridge regression, target {study.target}</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Features</th>
                  <th scope="col" className="px-3 py-2 font-medium">Test split</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Baseline MAE</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Ridge MAE</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Ridge RMSE</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">Ridge R²</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {study.featureSets.flatMap((fs) =>
                  fs.results.map((r, i) => (
                    <tr key={`${fs.featureSet.id}-${r.split}`}>
                      {i === 0 && (
                        <th scope="row" rowSpan={fs.results.length} className="py-2 pr-3 text-left align-top font-normal">
                          <span className="block text-ink">{fs.featureSet.label}</span>
                          <span className="block text-xs text-faint">{fs.featureSet.question}</span>
                        </th>
                      )}
                      <td className="px-3 py-2 text-muted">{SPLIT_LABELS[r.split as keyof typeof SPLIT_LABELS]}</td>
                      <td className="num px-3 py-2 text-right">{formatNumber(r.baseline.mae, 2)} pts</td>
                      <td className="num px-3 py-2 text-right">{formatNumber(r.ridge.mae, 2)} pts</td>
                      <td className="num px-3 py-2 text-right">{formatNumber(r.ridge.rmse, 2)} pts</td>
                      <td className="num py-2 pl-3 text-right">{formatNumber(r.ridge.r2, 3)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-faint">Baseline = median of the training rows. Stations are never split between training and test.</p>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-muted">
            {study.verdict.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-ink">3. What is deployed: the bench model (relative voltage)</h3>
          <p className="mt-1 text-muted">{calibration.verdict}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px]" aria-label="Bench model comparison">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Model</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Held-out sweeps (MAE)</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Unseen connector (MAE)</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-line">
                <tr>
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">One voltage line for all connectors</th>
                  <td className="px-3 py-1.5 text-right">{formatNumber(lso.pooledVoltage.mae, 2)} pts</td>
                  <td className="px-3 py-1.5 text-right">{range(loco.map((l) => l.pooledVoltage.mae))}</td>
                </tr>
                <tr>
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">A separate voltage line per connector</th>
                  <td className="px-3 py-1.5 text-right">{formatNumber(lso.perConnectorVoltage.mae, 2)} pts</td>
                  <td className="px-3 py-1.5 text-right text-faint">needs that connector&apos;s full history</td>
                </tr>
                <tr className="font-medium text-ink">
                  <th scope="row" className="py-1.5 pr-3 text-left">Relative voltage V ÷ V_ref (deployed)</th>
                  <td className="px-3 py-1.5 text-right">{formatNumber(lso.relativeVoltage.mae, 2)} pts</td>
                  <td className="px-3 py-1.5 text-right">{range(loco.map((l) => l.relativeVoltage.mae))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-faint">
            Held-out sweeps: every sweep of every connector left out in turn. Unseen connector: trained on the other two; the relative model gets only the unseen
            connector&apos;s first sweep (commissioning) to set its V_ref and is tested on the rest. Open-circuit readings (0 V = 100 % by definition) are excluded.
          </p>
          <p className="mt-2 text-muted">
            It accepts bench voltages only (≤ 5 V); real-charger voltages are refused.{" "}
            <Link href="/company/bench" className="text-signal hover:underline">Try it on the Arduino bench page</Link>.
          </p>
        </div>
      </div>
    </Panel>
  );
}
