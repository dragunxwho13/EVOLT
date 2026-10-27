import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ASSUMPTIONS, BENCH_RUN, DEFAULT_SCENARIO, SCENARIOS, SCALING_VERSION } from "@/config/scaling";
import { BenchEstimator } from "@/components/bench/bench-estimator";
import { ConnectorTraces, LayerBars, RelativeVoltageScatter, type BarDatum, type CalibrationPoint, type TracePoint } from "@/components/bench/bench-charts";
import { LAYER_HINTS, LayerTag, type Layer } from "@/components/bench/layer-tag";
import { EmptyState, ErrorState, PageHeader, Panel, PanelSkeleton, buttonClass, inputClass } from "@/components/ui/primitives";
import { READING_STATE_LABELS, extraResistanceAtLevel, voltageAtLevel, type ConnectorSummary } from "@/features/bench/analysis";
import { BENCH_CONNECTORS, type BenchConnector } from "@/features/bench/parse";
import { benchOverview } from "@/features/bench/service";
import { load } from "@/lib/http/load";
import { cn } from "@/lib/utils/cn";
import { formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Arduino bench" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function BenchPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Arduino bench & real-world scaling"
        description="What our small experimental circuit measured on three connectors (run 2), how each quantity is scaled to a representative charger, and how that compares with published charger figures."
      />
      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
        {(["experimental", "estimate", "reference"] as Layer[]).map((l) => (
          <span key={l} className="inline-flex items-center gap-2">
            <LayerTag layer={l} /> {LAYER_HINTS[l]}
          </span>
        ))}
      </div>
      <Suspense fallback={<PanelSkeleton rows={10} />}>
        <BenchContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function n(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 1e6)) return v.toExponential(2);
  return formatNumber(v, a >= 1000 ? 0 : digits);
}

function unitValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "Ω" && Math.abs(v) < 1) return `${n(v * 1000, 2)} mΩ`;
  return `${n(v, 3)} ${unit}`;
}

async function BenchContent({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const scenarioId = SCENARIOS.some((s) => s.id === one(sp.scenario)) ? one(sp.scenario)! : DEFAULT_SCENARIO;
  const connector = (BENCH_CONNECTORS as readonly string[]).includes(one(sp.connector) ?? "") ? (one(sp.connector) as BenchConnector) : "C1";
  const levelRaw = Number(one(sp.level));
  const level = (BENCH_RUN.scalingLevelsPct as readonly number[]).includes(levelRaw) ? levelRaw : BENCH_RUN.defaultScalingLevelPct;
  const result = await load(() => benchOverview(scenarioId, connector, level));
  if (!result.ok) {
    if (result.notFound) {
      return (
        <EmptyState title="No bench readings stored">
          Load the Arduino log with <code className="num">npm run db:seed:bench</code> (the one-click launcher does this automatically).
        </EmptyState>
      );
    }
    return <ErrorState {...result.error} />;
  }
  const { analysis, scaling, insights, run, calibration, calibrationConsistent, references } = result.data;
  const s = scaling.scenario;

  const times = [...new Set(analysis.readings.map((r) => r.timeS))].sort((a, b) => a - b);
  const trace: TracePoint[] = times.map((t) => {
    const at = (c: BenchConnector) => analysis.readings.find((r) => r.timeS === t && r.connector === c)?.voltageV ?? null;
    return { t, C1: at("C1"), C2: at("C2"), C3: at("C3") };
  });
  const vrefs = calibration.references;
  const calPoints: CalibrationPoint[] = analysis.readings
    .filter((r) => r.voltageV > 0 && r.degradationPct !== null && r.degradationPct < 100)
    .map((r) => ({ connector: r.connector, voltageV: r.voltageV, ratio: r.voltageV / vrefs[r.connector], degradationPct: r.degradationPct! }));
  const lso = calibration.evaluation.leaveOneSweepOut;
  const loco = calibration.evaluation.leaveOneConnectorOut;

  const physics = scaling.physics;
  const heatBars: BarDatum[] = [
    { label: `Bench at ${level} % at ${s.kind} scale`, value: scaling.proportional.realHeatW, layer: "estimate" },
    ...physics.filter((p) => [1, 5, 20].includes(p.wearMultiple)).map((p) => ({
      label: p.wearMultiple === 1 ? `New contact (${p.resistanceMohm} mΩ, datasheet max)` : `Worn contact × ${p.wearMultiple} (${p.resistanceMohm} mΩ)`,
      value: p.heatTotalW,
      layer: (p.wearMultiple === 1 ? "reference" : "estimate") as Layer,
    })),
  ];
  const lossRef = s.kind === "DC" ? { lo: 5, hi: 15, label: "ADAC: DC fast charging (whole chain)" } : { lo: 5.1, hi: 7.0, label: "ADAC: 11 kW wallbox (whole chain)" };
  const shareRow = scaling.rows.find((r) => r.key === "loss_share");
  const lossBars: BarDatum[] = [
    { label: `Bench at ${level} % (share kept)`, value: shareRow?.scaled ?? 0, layer: "estimate" },
    { label: `${lossRef.label}, upper`, value: lossRef.hi, layer: "reference" },
    { label: `${lossRef.label}, lower`, value: lossRef.lo, layer: "reference" },
    ...physics.filter((p) => [5, 20].includes(p.wearMultiple)).map((p) => ({ label: `Contacts worn × ${p.wearMultiple}`, value: p.shareOfDelivered * 100, layer: "estimate" as Layer })),
  ];

  const connectorRows: { label: string; get: (c: ConnectorSummary) => string }[] = [
    { label: "Readings (conducting)", get: (c) => `${c.readings} (${c.live})` },
    { label: "Load resistance (median V ÷ I)", get: (c) => `${n(c.loadOhm, 0)} Ω` },
    { label: "Healthy level V_ref (0 %)", get: (c) => `${n(c.referenceV, 3)} V` },
    { label: "Healthy current (V_ref ÷ load)", get: (c) => `${n(c.healthyMa, 2)} mA` },
    { label: "Highest reading", get: (c) => `${n(c.maxLiveV, 2)} V (${n(c.minDegradationPct, 1)} %)` },
    { label: `Voltage at ${level} %`, get: (c) => `${n(voltageAtLevel(c, level), 3)} V` },
    { label: `Extra resistance at ${level} %`, get: (c) => `${n(extraResistanceAtLevel(c, level), 0)} Ω` },
    { label: "Sweeps to open circuit (period)", get: (c) => `${c.sweeps}${c.sweepPeriodS ? ` (every ${n(c.sweepPeriodS, 1)} s)` : ""}` },
    { label: "Degradation logged: mean / median", get: (c) => `${n(c.degradationMean, 1)} % / ${n(c.degradationMedian, 1)} %` },
    { label: "Largest gap to the log's formula", get: (c) => `${n(c.formulaMaxDeviation, 2)} pts` },
    ...(["healthy", "moderate", "severe", "open_circuit"] as const).map((st) => ({ label: READING_STATE_LABELS[st], get: (c: ConnectorSummary) => String(c.counts[st]) })),
  ];

  return (
    <div className="space-y-6">
      <section aria-labelledby="insights-heading">
        <h2 id="insights-heading" className="mb-3 text-lg font-semibold">
          What the bench shows
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {insights.map((i) => (
            <li key={i.key} className={cn("rounded-lg border bg-surface px-4 py-3 text-sm", i.tone === "attention" ? "border-watch/50" : "border-line")}>
              <p className="font-semibold text-ink">{i.title}</p>
              <dl className="mt-2 space-y-1.5">
                <div><dt className="inline font-medium text-ink">Observed: </dt><dd className="inline text-muted">{i.observed}</dd></div>
                <div><dt className="inline font-medium text-ink">Evidence: </dt><dd className="inline text-muted">{i.evidence}</dd></div>
                <div><dt className="inline font-medium text-ink">Why it matters: </dt><dd className="inline text-muted">{i.why}</dd></div>
                <div><dt className="inline font-medium text-ink">Next step: </dt><dd className="inline text-muted">{i.next}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <Panel
        title="Three connectors, side by side"
        description={`${run.description} Each connector is summarised from its own readings; nothing is averaged across connectors.`}
        actions={<LayerTag layer="experimental" />}
      >
        <ConnectorTraces points={trace} references={vrefs} />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm" aria-label="Per-connector comparison">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Parameter</th>
                {analysis.connectors.map((c) => (
                  <th key={c.connector} scope="col" className="num px-3 py-2 text-right font-medium">{c.connector}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {connectorRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-muted">{row.label}</th>
                  {analysis.connectors.map((c) => (
                    <td key={c.connector} className="num px-3 py-2 text-right">{row.get(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted">
          The connectors&apos; healthy levels differ by {n(analysis.comparison.referenceSpreadV * 1000, 0)} mV ({formatPercent(analysis.comparison.referenceSpreadPct, 1)}) and
          their loads by {n(analysis.comparison.loadSpreadOhm, 0)} Ω. Reading them against one shared healthy level would misstate degradation by about{" "}
          {n(analysis.comparison.pooledReferenceError, 1)} points (median), so each is judged against its own.
        </p>
      </Panel>

      <Panel
        title="Why the model uses relative voltage"
        description="The same readings twice. Against raw voltage the three connectors form three different lines; against voltage relative to each connector's healthy level they fall on one."
        actions={<LayerTag layer="experimental" />}
      >
        <RelativeVoltageScatter points={calPoints} model={{ intercept: calibration.intercept, slope: calibration.slope }} />
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          {[
            ["One voltage line for all", lso.pooledVoltage.mae, `${n(Math.min(...loco.map((l) => l.pooledVoltage.mae)), 2)}–${n(Math.max(...loco.map((l) => l.pooledVoltage.mae)), 2)}`],
            ["A line per connector", lso.perConnectorVoltage.mae, "needs full history"],
            ["Relative voltage (deployed)", lso.relativeVoltage.mae, `${n(Math.min(...loco.map((l) => l.relativeVoltage.mae)), 2)}–${n(Math.max(...loco.map((l) => l.relativeVoltage.mae)), 2)}`],
          ].map(([k, v, u], i) => (
            <div key={String(k)} className={cn("rounded-md border px-3 py-2", i === 2 ? "border-signal/50 bg-signal-soft/40" : "border-line")}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="num text-base font-semibold text-ink">{n(Number(v), 2)} pts</dd>
              <dd className="text-xs text-faint">error on held-out sweeps · unseen connector: {u}{typeof u === "string" && u.includes("–") ? " pts" : ""}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-faint">
          Mean absolute error in points of the bench&apos;s degradation index, on data the model never saw. &quot;Unseen connector&quot;: trained on the other two; the relative model gets
          only that connector&apos;s first sweep to set its healthy level. Open-circuit readings (0 V = 100 % by definition) are left out.
        </p>
      </Panel>

      <Panel
        title="From the bench to a real charger"
        description="Pick a representative charger, a bench connector and a level of the bench's degradation index. Every number below is recalculated from the stored readings."
      >
        <form method="get" action="/company/bench" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex min-w-64 flex-col gap-1">
            <label htmlFor="scenario" className="text-[0.8125rem] font-medium text-muted">Representative charger (assumption)</label>
            <select id="scenario" name="scenario" defaultValue={s.id} className={inputClass}>
              {SCENARIOS.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </select>
          </div>
          <div className="flex min-w-32 flex-col gap-1">
            <label htmlFor="connector" className="text-[0.8125rem] font-medium text-muted">Bench connector</label>
            <select id="connector" name="connector" defaultValue={connector} className={inputClass}>
              {BENCH_CONNECTORS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex min-w-32 flex-col gap-1">
            <label htmlFor="level" className="text-[0.8125rem] font-medium text-muted">Bench degradation level</label>
            <select id="level" name="level" defaultValue={level} className={inputClass}>
              {BENCH_RUN.scalingLevelsPct.map((l) => (
                <option key={l} value={l}>{l} %</option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass("primary")}>Recalculate</button>
        </form>

        <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-4">
          {[
            ["k_V voltage", n(scaling.factors.kV, 1), `${s.pathVoltage} V ÷ ${connector} healthy V_ref`],
            ["k_I current", n(scaling.factors.kI, 0), `${s.current} A ÷ ${connector} healthy mA`],
            ["k_R resistance", scaling.factors.kR.toExponential(2), "k_V ÷ k_I (Ohm's law)"],
            ["k_P power", n(scaling.factors.kP, 0), "k_V × k_I per path"],
          ].map(([k, v, h]) => (
            <div key={k} className="rounded-md border border-line px-3 py-2">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="num text-base font-semibold text-ink">× {v}</dd>
              <dd className="text-xs text-faint">{h}</dd>
            </div>
          ))}
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm" aria-label="Scaling comparison">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Parameter</th>
                <th scope="col" className="px-3 py-2 font-medium"><LayerTag layer="experimental" /><span className="sr-only"> Arduino reading</span></th>
                <th scope="col" className="px-3 py-2 font-medium">Scaling method / factor</th>
                <th scope="col" className="px-3 py-2 font-medium"><LayerTag layer="estimate" /><span className="sr-only"> Scaled estimate</span></th>
                <th scope="col" className="px-3 py-2 font-medium"><LayerTag layer="reference" /><span className="sr-only"> Commercial reference</span></th>
                <th scope="col" className="py-2 pl-3 font-medium">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {scaling.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">{r.parameter}</th>
                  <td className="px-3 py-2.5">
                    <span className="num">{unitValue(r.bench, r.unit.bench)}</span>
                    {r.benchNote && <span className="block text-xs text-faint">{r.benchNote}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.method}</td>
                  <td className="px-3 py-2.5">
                    <span className="num">{unitValue(r.scaled, r.unit.real)}</span>
                    {r.scaledNote && <span className="block text-xs text-faint">{r.scaledNote}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.reference ?? "—"}</td>
                  <td className="py-2.5 pl-3 text-muted">{r.difference ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-faint">
          Method A keeps the bench&apos;s resistance ratio at the chosen level ({level} %: extra resistance = load × {n(1 / (1 - level / 100) - 1, 2)}). Heat uses I² × R, which does not depend on power factor; delivered AC power uses PF {s.powerFactor}. Comparisons with
          ADAC are not like-for-like: ADAC measures the whole charging chain, the bench only the connector.
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Heat in the connector" description={`${s.label}. Log scale: the bench at ${level} % against real contacts at the same current.`}>
          <LayerBars data={heatBars} unit="W" label="Heat generated in the connector" />
        </Panel>
        <Panel title="Share of power lost" description="Percent of delivered power. The bench share is dimensionless and carries over unchanged.">
          <LayerBars data={lossBars} unit="%" label="Share of power lost" />
        </Panel>
      </div>

      <Panel
        title="What real wear looks like (Method B)"
        description={`Start from the datasheet maximum for a new contact (${physics[0]?.resistanceMohm} mΩ), multiply by illustrative wear levels, and apply ${s.label}. Then map back: would the bench see it?`}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">Contact resistance</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Drop per contact</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Heat per contact</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">All {s.currentContacts} contacts</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Share of delivered</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Bench-equivalent drop</th>
                <th scope="col" className="px-5 py-2 font-medium">Visible on bench?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {physics.map((p) => (
                <tr key={p.wearMultiple}>
                  <td className="num px-5 py-2">
                    {n(p.resistanceMohm, 2)} mΩ <span className="text-xs text-faint">({p.wearMultiple === 1 ? "datasheet max, new" : `× ${p.wearMultiple}, illustrative`})</span>
                  </td>
                  <td className="num px-3 py-2 text-right">{n(p.voltageDropMv, 1)} mV</td>
                  <td className="num px-3 py-2 text-right">{n(p.heatPerContactW, 2)} W</td>
                  <td className="num px-3 py-2 text-right">{n(p.heatTotalW, 2)} W</td>
                  <td className="num px-3 py-2 text-right">{formatPercent(p.shareOfDelivered, 3)}</td>
                  <td className="num px-3 py-2 text-right">{n(p.benchEquivalentDropMv, 3)} mV</td>
                  <td className={cn("px-5 py-2", p.detectableOnBench ? "text-ok" : "text-muted")}>
                    {p.detectableOnBench ? "Yes" : "No"} <span className="text-xs text-faint">(ADC step {n(p.adcStepMv, 2)} mV)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-faint">
          Current-controlled charging: the charger holds the current, so heat = I² × R and drop = I × R. Temperature rise is not estimated: it needs a calibrated thermal
          resistance, which this hardware does not have.
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Try the bench model" description="Turns a bench voltage into the bench's degradation index with the saved, tested relative-voltage model — experimental-scale inputs only.">
          <BenchEstimator connector={connector} scenario={s.id} scenarioLabel={s.label} references={vrefs} />
          <p className="mt-3 text-xs text-faint">
            Model: degradation = {n(calibration.intercept, 2)} {calibration.slope < 0 ? "−" : "+"} {n(Math.abs(calibration.slope), 2)} × (V ÷ V_ref), fitted on {calibration.fittedOn}{" "}
            readings; held-out error {n(lso.relativeVoltage.mae, 2)} points (MAE).{" "}
            {calibrationConsistent ? "Re-fitted from the database on this page load: identical." : "Warning: the stored readings no longer reproduce the saved model — retrain."}
          </p>
        </Panel>
        <Panel title="Assumptions and calibration still needed">
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted">
            <li>Circuit values (each connector&apos;s load and healthy level V_ref) are measured from the readings. The supply voltage itself was not logged; V_ref stands in for it.</li>
            <li>Degradation % is the log&apos;s own definition, {BENCH_RUN.degradationDefinition}. It is not scaled; a level is only used to pick a bench voltage.</li>
            <li>The run sweeps each connector repeatedly between near-healthy and open circuit. It is a controlled stress pattern, so it gives no rate of wear over time.</li>
            <li>Charger operating points are representative nominal values ({SCENARIOS.length} scenarios), checked against IEC 62196-1 ratings — not measurements of a specific charger.</li>
            <li>AC power factor {ASSUMPTIONS.powerFactor}; balanced three-phase (neutral ≈ 0 A); session length {ASSUMPTIONS.sessionHours} h for energy.</li>
            <li>Wear multiples ({ASSUMPTIONS.wearMultiples.join(", ")} ×) are illustrative: no verified field rate of contact wear was found.</li>
            <li>To calibrate further: log the supply voltage, add an independent current sensor, measure contact resistance with a four-wire method, and fit a thermal resistance (K/W) with a thermocouple.</li>
          </ul>
          <p className="mt-3 text-xs text-faint">Scaling version {SCALING_VERSION}. Run {run.id}, stored from {run.file} (SHA-256 {run.sourceSha256?.slice(0, 12)}…), converted cell for cell from {run.rawFile}.</p>
        </Panel>
      </div>

      <Panel title="References used" description="Only figures that appear on these pages are used as commercial references.">
        <ul className="space-y-2 text-sm">
          {Object.values(references).map((r) => (
            <li key={r.id}>
              <a href={r.url} className="font-medium text-signal hover:underline" rel="noreferrer" target="_blank">{r.title}</a>{" "}
              <span className="text-muted">— {r.publisher}; accessed {r.accessed}. </span>
              <span className="text-faint">{Object.values(r.figures).join(" · ")}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
