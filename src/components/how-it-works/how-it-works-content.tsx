import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/primitives";
import { howItWorksFacts } from "@/features/how-it-works/facts";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

/* ───────────── small building blocks ───────────── */

type Kind = "measured" | "estimate" | "prediction" | "reference" | "demo";
const KIND: Record<Kind, { label: string; tone: string; hint: string }> = {
  measured: { label: "Measured", tone: "border-ink/30 text-ink", hint: "Logged by our Arduino bench or present in an imported record" },
  estimate: { label: "Calculated estimate", tone: "border-signal/40 text-signal", hint: "Derived by a documented formula; not a measurement" },
  prediction: { label: "Model output", tone: "border-watch/50 text-ink", hint: "From a fitted model, with its tested error" },
  reference: { label: "Published reference", tone: "border-ok/40 text-ok", hint: "Figure published by a standard or manufacturer" },
  demo: { label: "Demo data", tone: "border-line-strong text-muted", hint: "Generated, labelled demo records — not real sites" },
};

function Tag({ kind }: { kind: Kind }) {
  return (
    <span title={KIND[kind].hint} className={cn("inline-flex items-center rounded border px-1.5 py-px text-xs font-medium whitespace-nowrap", KIND[kind].tone)}>
      {KIND[kind].label}
    </span>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0 scroll-mt-20 border-t border-line pt-10">
      <h2 id={`${id}-h`} className="text-[1.4rem] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-3xl text-[0.95rem] text-muted">{lead}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-line bg-surface p-4 text-sm sm:p-5", className)}>
      {title && <h3 className="mb-2 font-semibold text-ink">{title}</h3>}
      <div className="space-y-2 text-muted [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function Table({ head, rows, label }: { head: ReactNode[]; rows: ReactNode[][]; label: string }) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] text-sm" aria-label={label}>
        <thead className="border-b border-line bg-sunken/60 text-left text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 font-medium first:pl-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line align-top">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-3 py-2 pl-4 text-left font-medium text-ink">
                    {c}
                  </th>
                ) : (
                  <td key={j} className="px-3 py-2 text-muted">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A left-to-right flow of boxes that wraps on small screens; arrows turn downward when stacked. */
function Flow({ steps, label }: { steps: { title: string; body: string; kind?: Kind }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
      {steps.map((s, i) => (
        <li key={s.title} className="flex flex-col items-center gap-2 lg:flex-1 lg:flex-row">
          <div className="w-full flex-1 rounded-lg border border-line bg-surface p-3 text-sm lg:h-full">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
              <span className="num text-xs text-faint">{i + 1}</span> {s.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{s.body}</p>
            {s.kind && (
              <p className="mt-2">
                <Tag kind={s.kind} />
              </p>
            )}
          </div>
          {i < steps.length - 1 && (
            <span aria-hidden className="text-lg text-faint lg:rotate-0">
              <span className="lg:hidden">↓</span>
              <span className="hidden lg:inline">→</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return <pre className="num overflow-x-auto rounded-md border border-line bg-sunken px-3 py-2 text-[0.8125rem] leading-relaxed text-ink">{children}</pre>;
}

const n = (v: number, d = 2) => formatNumber(v, d);

const TOC = [
  ["architecture", "Architecture"],
  ["data-flow", "Data flow"],
  ["data-kinds", "What each number is"],
  ["arduino", "Arduino bench"],
  ["connectors", "Three connectors"],
  ["scaling", "Bench → real charger"],
  ["degradation", "Degradation model"],
  ["session-ml", "Session data & ML"],
  ["company", "Company workflow"],
  ["driver", "Driver workflow"],
  ["apis", "APIs & database"],
  ["limits", "Limits"],
  ["faq", "Judge FAQ"],
] as const;

/* ───────────── page ───────────── */

/** The "How it works" section, shown inside the company workspace and the driver experience. */
export function HowItWorksContent() {
  const f = howItWorksFacts();
  const { analysis } = f.bench;
  const p = f.params;
  const lso = f.model.lso;
  const range = (v: number[]) => `${n(Math.min(...v))}–${n(Math.max(...v))}`;

  return (
    <>
      <PageHeader
        title="How it works"
        description="What EVOLT actually does, traced from the code: where each number comes from, how it is checked, and what it cannot tell you. Every figure here is read from the repository's own configuration and saved model when the site is built."
      />
        <nav aria-label="On this page" className="flex flex-wrap gap-1.5">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-md border border-line bg-surface px-2.5 py-1 text-sm text-muted hover:border-ink/40 hover:text-ink">
              {label}
            </a>
          ))}
        </nav>

        <div className="mt-10 space-y-12">
          {/* ── Architecture ── */}
          <Section
            id="architecture"
            title="System architecture"
            lead="One Next.js application serves both experiences and every API from one PostgreSQL database. There are no external APIs: maps are drawn from a bundled outline, and distances are computed locally."
          >
            <div className="grid gap-3 md:grid-cols-3" role="img" aria-label="Architecture: inputs, the EVOLT application with its analysis modules, and the two experiences, all on one PostgreSQL database">
              <Card title="Inputs">
                <p>• Charging-session dataset (1,000 sessions, 19 stations) and labelled demo stations with health readings</p>
                <p>• Arduino bench log (run 2): three connectors, stored unchanged</p>
                <p>• Optional bench-sensor readings over <code className="num">/api/sensor-readings</code> (supporting context only)</p>
              </Card>
              <Card title="EVOLT application (Next.js 16, TypeScript)" className="border-signal/40">
                <p>• Connector-health analysis: baselines, deviations, trends, faults, temperature correction, forecasts, repair checks</p>
                <p>• Learning: session classifiers and the bench degradation model</p>
                <p>• Bench scaling: Arduino → representative chargers</p>
                <p>• Action-item rules, driver ranking, slot booking</p>
                <p className="text-xs text-faint">Pure, unit-tested logic in <code className="num">src/features/*</code>; route handlers in <code className="num">src/app/api</code></p>
              </Card>
              <Card title="Experiences">
                <p>
                  • <Link href="/driver" className="text-signal hover:underline">Driver</Link>: find, compare and book chargers
                </p>
                <p>
                  • <Link href="/company" className="text-signal hover:underline">Company workspace</Link>: action items, fleet health, forecasts, repair checks, performance, bench, model
                </p>
                <p className="text-xs text-faint">PostgreSQL via Drizzle ORM, forward-only SQL migrations. Deployed on Vercel with Neon PostgreSQL.</p>
              </Card>
            </div>
            <Table
              label="Technology stack"
              head={["Layer", "What is used", "Where"]}
              rows={[
                ["Frontend", "Next.js 16 (App Router, partial prerendering), React 19, Tailwind CSS 4, Recharts", "src/app, src/components"],
                ["Backend", "Next.js route handlers, Zod validation, one shared error format", "src/app/api, src/lib"],
                ["Database", "PostgreSQL with Drizzle ORM; migrations in SQL", "database/migrations, src/lib/db/schema.ts"],
                ["Analysis & ML", "Pure TypeScript (no ML service): robust statistics, Theil–Sen, logistic regression, ridge, least squares", "src/features"],
                ["Tests", "Vitest (unit + real-PostgreSQL integration), Playwright (desktop + mobile); GitHub Actions CI", "tests/"],
              ]}
            />
          </Section>

          {/* ── Data flow ── */}
          <Section id="data-flow" title="End-to-end data flow" lead="Two pipelines feed the same database. Neither ever falls back to invented data: if the database is missing, the app says so.">
            <h3 className="font-semibold text-ink">Charger health → company and driver</h3>
            <Flow
              label="Charger health data flow"
              steps={[
                { title: "Records", body: "Stations, chargers, health readings (contact resistance, voltage drop, faults), sessions.", kind: "measured" },
                { title: "Validated & stored", body: "Units converted to canonical (mΩ, mV), implausible values and future timestamps rejected.", kind: "measured" },
                { title: "Per-charger analysis", body: "Baseline from the earliest readings, robust deviations, Theil–Sen trends, fault counts.", kind: "estimate" },
                { title: "Health status & alerts", body: "Normal · Monitor · Inspection recommended · Insufficient data, each with its evidence.", kind: "estimate" },
                { title: "Used twice", body: "Company: action items, forecasts. Driver: ranking puts healthy evidence first." },
              ]}
            />
            <h3 className="pt-2 font-semibold text-ink">Arduino bench → model and scaling</h3>
            <Flow
              label="Arduino bench data flow"
              steps={[
                { title: "Arduino log", body: `${f.bench.rows} time steps × 3 connectors, as delivered (xlsx), converted cell for cell to CSV.`, kind: "measured" },
                { title: "bench_readings", body: "Loaded unchanged with source row, file and SHA-256; a changed file is refused.", kind: "measured" },
                { title: "Per-connector analysis", body: "Load, healthy level V_ref, sweeps, reading bands — measured from the readings.", kind: "estimate" },
                { title: "Model & scaling", body: "Relative-voltage model (tested on held-out data); law-by-law scaling to chargers.", kind: "prediction" },
                { title: "Bench page", body: "Every value tagged as measured, estimate or published reference." },
              ]}
            />
          </Section>

          {/* ── Data kinds ── */}
          <Section id="data-kinds" title="What each number is" lead="The app keeps these kinds of numbers apart in code, in the database and on screen. This page uses the same tags.">
            <Table
              label="Kinds of numbers"
              head={["Kind", "Meaning", "Examples in EVOLT"]}
              rows={[
                [<Tag key="m" kind="measured" />, KIND.measured.hint, "Bench voltage/current/degradation; imported session values; recorded health readings"],
                [<Tag key="e" kind="estimate" />, KIND.estimate.hint, "Charger-scale heat and voltage loss; temperature-corrected resistance; derived session energy"],
                [<Tag key="p" kind="prediction" />, KIND.prediction.hint, "Bench degradation index from a voltage; power-loss category; service-date forecast"],
                [<Tag key="r" kind="reference" />, KIND.reference.hint, "IEC 62196-1 ratings; MIDA/HARTING CCS2 datasheets; ADAC charging-loss tests"],
                [<Tag key="d" kind="demo" />, KIND.demo.hint, "13 “Demo Site” stations and their readings, labelled Demo everywhere"],
              ]}
            />
            <p className="text-sm text-muted">There is no live charger telemetry: availability is the last status recorded, and no figure is presented as a real-time measurement.</p>
          </Section>

          {/* ── Arduino ── */}
          <Section
            id="arduino"
            title="Arduino bench: experimental readings and storage"
            lead={`${f.bench.run.description} It is a low-voltage experimental circuit, not a commercial charger.`}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Card title={<>What is logged <Tag kind="measured" /></>}>
                <p>
                  Per connector and time step: voltage (V), current (mA) and a degradation index (%). {f.bench.rows} time steps from {n(analysis.startS, 1)} s to {n(analysis.endS, 1)} s every{" "}
                  {n(analysis.stepS, 1)} s = {f.bench.readings} readings, no blank cells.
                </p>
                <p>The log defines degradation per connector as:</p>
                <Formula>{`degradation % = 100 × (1 − V ÷ V_ref)
V_ref = that connector's healthy (0 %) level`}</Formula>
                <p>
                  Reproduced to within {n(f.model.maxDeviation, 2)} points. The ADC is 10-bit on {f.bench.run.adcReferenceV} V (one step = {n((f.bench.run.adcReferenceV / 2 ** f.bench.run.adcBits) * 1000, 2)} mV).
                </p>
              </Card>
              <Card title="How it is stored">
                <p>
                  Raw workbook <code className="num">{f.bench.run.rawFile}</code> → CSV <code className="num">{f.bench.run.file}</code> → table <code className="num">bench_readings</code>, run{" "}
                  <code className="num">{f.bench.run.id}</code>.
                </p>
                <p>Each row keeps its source row, file name and the file&apos;s SHA-256. The loader is idempotent and refuses a changed file rather than merging it. Readings of earlier runs are deleted by a migration.</p>
                <p>On every bench-page load, the model is re-fitted from the stored rows and checked against the saved model file; the page says whether they match.</p>
                <p className="text-xs text-faint">
                  Hardware: an Arduino sketch (<code className="num">hardware/evolt_bench</code>) and a serial collector. No ESP32/ESP8266 code is in the repository.
                </p>
              </Card>
            </div>
          </Section>

          {/* ── Connectors ── */}
          <Section id="connectors" title="The three connectors, separately" lead="Each connector is summarised from its own readings and never averaged with the others. They genuinely differ, which is why each needs its own reference.">
            <Table
              label="Per-connector comparison"
              head={["Parameter", "C1", "C2", "C3", "How it is obtained"]}
              rows={[
                ["Load resistance", ...analysis.connectors.map((c) => `${n(c.loadOhm, 0)} Ω`), "Median V ÷ I, readings ≥ 1 mA"],
                ["Healthy level V_ref", ...analysis.connectors.map((c) => `${n(c.referenceV, 3)} V`), "Median V ÷ (1 − degradation/100)"],
                ["Healthy current", ...analysis.connectors.map((c) => `${n(c.healthyMa, 2)} mA`), "V_ref ÷ load"],
                ["Sweep to open circuit", ...analysis.connectors.map((c) => (c.sweepPeriodS ? `every ${n(c.sweepPeriodS, 1)} s (${c.sweeps}×)` : `${c.sweeps}×`)), "Time between open-circuit episodes"],
                ["Near healthy / moderate / severe / open", ...analysis.connectors.map((c) => `${c.counts.healthy} / ${c.counts.moderate} / ${c.counts.severe} / ${c.counts.open_circuit}`), "< 10 % · 10–40 % · ≥ 40 % · 0 V"],
                ["Largest gap to the log's formula", ...analysis.connectors.map((c) => `${n(c.formulaMaxDeviation ?? 0, 2)} pts`), "Check that the definition holds"],
                [
                  "50 % state at 50 kW DC",
                  ...f.bench.dc50.map((d) => `${n(d.report.proportional.realVoltageLostV, 0)} V lost, ${n(d.report.proportional.realHeatW / 1000, 1)} kW heat`),
                  "Method A estimate (same ratio for all)",
                ],
                [
                  "Real wear first visible on the bench (50 kW DC)",
                  ...f.bench.dc50.map((d) => {
                    const first = d.report.physics.find((x) => x.detectableOnBench);
                    return first ? `${first.wearMultiple} × new (${n(first.resistanceMohm, 1)} mΩ)` : "not within 20 ×";
                  }),
                  "Method B vs one ADC step",
                ],
              ]}
            />
            <p className="text-sm text-muted">
              Healthy levels differ by {n(analysis.comparison.referenceSpreadV * 1000, 0)} mV ({n(analysis.comparison.referenceSpreadPct * 100, 1)} %). Reading all three against one shared level
              would misstate degradation by about {n(analysis.comparison.pooledReferenceError, 1)} points (median). The run is a repeated sweep — a controlled stress pattern — so it calibrates the
              voltage–degradation curve but gives no rate of wear over time.
            </p>
          </Section>

          {/* ── Scaling ── */}
          <Section
            id="scaling"
            title="From the bench to a real charger"
            lead="Each quantity is scaled by the physical law that governs it — never by one common multiplier. The results are calculated estimates, not charger measurements."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={<>Scaling factors <Tag kind="estimate" /></>}>
                <Formula>{`k_V = V_path ÷ V_ref          (voltage)
k_I = I_rated ÷ I_healthy      (current)
k_R = k_V ÷ k_I                (resistance, Ohm's law)
k_P = k_V × k_I                (power per path)
ratios (degradation %, loss share) unchanged
temperature: not scaled (no calibrated K/W)`}</Formula>
                <p>
                  Method A keeps the bench&apos;s resistance ratio at a chosen degradation level: R_extra = R_load × (V_ref ÷ V − 1); heat = paths × I² × R_extra. Method B starts from a new CCS2
                  contact ({f.referenceValues.newContactResistanceMaxMohm.value} mΩ, datasheet) × illustrative wear multiples ({f.assumptions.wearMultiples.join(", ")}) at the charger&apos;s current.
                </p>
              </Card>
              <Card title="Assumptions (configurable)">
                <p>Representative operating points, checked against IEC 62196-1 ratings in tests:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {f.scenarios.map((s) => (
                    <li key={s.id}>{s.label}</li>
                  ))}
                </ul>
                <p>
                  AC power factor {f.assumptions.powerFactor}; balanced three-phase; {f.assumptions.sessionHours} h session for energy. The bench supply voltage was not logged; each connector&apos;s
                  V_ref stands in for it.
                </p>
              </Card>
            </div>
            <Table
              label="Bench to charger, C1 at 50 % and 7.4 kW AC"
              head={["Quantity", "Bench (C1)", "Scaled to 7.4 kW AC", "Published reference"]}
              rows={f.bench.ac7.rows
                .filter((r) => ["voltage", "current", "extra_resistance", "voltage_lost", "heat", "loss_share"].includes(r.key))
                .map((r) => [r.parameter, r.bench === null ? "—" : `${n(r.bench, 3)} ${r.unit.bench}`, r.scaled === null ? "—" : `${n(r.scaled, 3)} ${r.unit.real}`, r.reference ?? "—"])}
            />
            <Card title="What the comparison shows">
              <p>
                A 50 % bench state is a <strong className="text-ink">fault</strong> at charger scale (115 V lost, ≈ {n(f.bench.ac7.proportional.realHeatW / 1000, 1)} kW of heat in one connector at 7.4 kW AC):
                the bench proves the direction of the effect, not its size. Early real-world wear changes resistance by milliohms and stays below the bench&apos;s ADC resolution. ADAC figures cover the
                whole charging chain, so that comparison is not like-for-like and is labelled as such.
              </p>
              <p>
                Calibration still needed: a slow one-way wear test, a logged supply voltage, an independent current sensor, four-wire contact-resistance measurement, and a thermal resistance (K/W)
                from a thermocouple.
              </p>
            </Card>
          </Section>

          {/* ── Degradation model ── */}
          <Section
            id="degradation"
            title="Degradation modelling"
            lead="Two questions, answered separately and honestly: can degradation be predicted from the bench, and can it be predicted from the session dataset?"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={<>Deployed: bench model (relative voltage) <Tag kind="prediction" /></>}>
                <Formula>{`degradation % = ${n(f.model.intercept, 2)} − ${n(Math.abs(f.model.slope), 2)} × (V ÷ V_ref)   clipped 0–100
V_ref: C1 ${n(f.model.references.C1, 3)} V · C2 ${n(f.model.references.C2, 3)} V · C3 ${n(f.model.references.C3, 3)} V`}</Formula>
                <p>
                  Feature: voltage relative to the connector&apos;s healthy level. Least squares on {f.model.fittedOn} conducting readings below 100 % (open circuit is 100 % by definition and
                  excluded). The coefficients rediscover the log&apos;s own definition; what the data adds is that V_ref must be per connector.
                </p>
                <p>Inputs above {f.bench.run.adcReferenceV} V are refused: they are not bench readings, and scaling electrical values does not scale degradation.</p>
              </Card>
              <Card title="How it was evaluated (MAE, points of the index)">
                <Table
                  label="Bench model comparison"
                  head={["Model", "Held-out sweeps", "Unseen connector"]}
                  rows={[
                    ["One voltage line for all", n(lso.pooledVoltage.mae), range(f.model.loco.map((l) => l.pooledVoltage.mae))],
                    ["A line per connector", n(lso.perConnectorVoltage.mae), "needs full history"],
                    ["Relative voltage (deployed)", n(lso.relativeVoltage.mae), range(f.model.loco.map((l) => l.relativeVoltage.mae))],
                  ]}
                />
                <p>Held-out sweeps: each sweep of each connector left out in turn. Unseen connector: trained on the other two, given only that connector&apos;s first sweep (commissioning) to set V_ref.</p>
              </Card>
            </div>
            <Card title={<>Not deployed: degradation from the session dataset</>}>
              <p>
                The {f.study.rows}-row unified training file has Arduino-style columns derived from the session data (its degradation equals clip(100 × power_loss ÷ power_consumed)). A ridge
                regression study with station-grouped cross-validation and a time-ordered hold-out shows why no predictor is deployed from it:
              </p>
              <Table
                label="Unified dataset regression study"
                head={["Features", "Split", "Baseline MAE", "Ridge MAE", "R²"]}
                rows={f.study.featureSets.flatMap((fs) =>
                  fs.results.map((r) => [fs.label, r.split === "station_grouped_cv" ? "Held-out stations" : "Latest 20 % in time", n(r.baseline), n(r.ridgeMae), n(r.r2, 3)]),
                )}
              />
              <p>With the target&apos;s own inputs the fit is perfect because it is the definition; without them, nothing beats the baseline. Deployed from this dataset: nothing.</p>
            </Card>
            <Card title="Uncertainty and limits">
              <p>• The model maps a bench voltage to the bench&apos;s index; it does not measure or forecast real connector wear, and no field wear rate is used.</p>
              <p>• Errors are on one run of one rig; a different rig needs its own commissioning sweep. Near open circuit (V ÷ V_ref below the fitted range) estimates are flagged as extrapolated.</p>
            </Card>
          </Section>

          {/* ── Session ML ── */}
          <Section
            id="session-ml"
            title="Session dataset: cleaning, training, evaluation, inference"
            lead="The supplied charging-session dataset (1,000 sessions, 19 stations, 1–11 Jan 2024) is checked, not trusted blindly. Its origin is unverified, so findings describe the file, not a real network."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Cleaning & data quality">
                <p>• Values validated and units converted; duplicates refused.</p>
                <p>• Inconsistencies are surfaced, not silently fixed: sessions losing more power than they consume, and sessions delivering more energy than the battery holds, become data-quality action items.</p>
                <p>• Fields the data lacks (availability, downtime, price) are not shown, and the app says why.</p>
              </Card>
              <Card title="Training & evaluation">
                <p>• Features: numeric columns present in every row plus one-hot area and charging type; identifiers excluded.</p>
                <p>• Models: majority baseline, an explainable threshold model, multinomial logistic regression.</p>
                <p>• Stratified 5-fold cross-validation; a label counts as predictable only if the best model beats guessing by ≥ 5 points and by more than two fold standard deviations.</p>
              </Card>
              <Card title={<>Inference <Tag kind="prediction" /></>}>
                <p>• Fitted parameters are stored in <code className="num">model_runs</code> and reloaded for each prediction (<code className="num">/api/models/predict</code>).</p>
                <p>• Predictions are refused for labels that were not predictable, and inputs outside the training range are flagged.</p>
              </Card>
            </div>
            <Table
              label="Session classifier results"
              head={["Question", "Cross-validated accuracy", "Guessing", "Verdict"]}
              rows={[
                ["Power-loss category", "91.7 %", "37.4 %", "Predictable — rule: ≤ 1.88 kW Low · ≤ 3.67 kW Medium · else High (it recovers the labelling rule)"],
                ["…without the power-loss reading", "37.0 %", "37.4 %", "Not predictable: loss must be measured"],
                ["Voltage-stability category", "41.5 %", "40.4 %", "Not predictable — no prediction offered"],
              ]}
            />
            <p className="text-xs text-faint">Results of the training run on the supplied dataset, as recorded in docs/machine-learning.md; the live figures are on the Learned model page.</p>
          </Section>

          {/* ── Company ── */}
          <Section
            id="company"
            title="Company workflow"
            lead="Charger analytics turn readings into a short list of what needs attention, each item with the rule that fired, the evidence, why it matters and the next step."
          >
            <Table
              label="Connector-health rules"
              head={["Rule", "Fires when (all thresholds from the analysis config)", "Severity"]}
              rows={[
                [
                  "Persistent deviation",
                  `${p.persistenceMinCount} of the last ${p.persistenceWindow} readings exceed the baseline median by > ${p.deviationZ} robust spreads (median/MAD) and by ≥ ${p.minRelativeDeviation * 100} %`,
                  `Monitor; inspection when ≥ ${p.severeRelativeDeviation * 100} % above baseline`,
                ],
                [
                  "Sustained trend",
                  `Theil–Sen slope over the last ${p.trendWindow} readings: ≥ ${p.trendConsistency * 100} % of pairwise slopes adverse and a change ≥ ${p.trendMinRelativeChange * 100} % of baseline (and ≥ ${p.trendMinScaleMultiple} spreads)`,
                  `Monitor; inspection at ≥ ${p.trendSevereRelativeChange * 100} %`,
                ],
                ["Fault recurrence", `Connector faults in ${p.faultWindowDays} days ≥ ${p.faultMonitorTotal} (above the historical rate)`, `Monitor; inspection at ≥ ${p.faultInspectTotal}`],
                ["Insufficient data", `Fewer than ${p.minBaselinePoints} baseline or ${p.minRecentPoints} recent readings — never treated as healthy`, "Insufficient data"],
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title={<>Degradation indicators <Tag kind="estimate" /></>}>
                <p>Metrics: contact resistance (mΩ), connector voltage drop (mV), connector faults (count). Readings older than {p.staleAfterDays} days are labelled historical.</p>
                <p>
                  Temperature correction restates resistance at {p.temperatureReferenceC} °C (copper, {p.temperatureCoefficientPerC * 100} %/°C), all-or-nothing per metric so it never creates jumps.
                </p>
              </Card>
              <Card title={<>Service forecast & repair checks <Tag kind="prediction" /></>}>
                <p>
                  Theil–Sen rate over up to {p.forecastWindow} readings since the last maintenance, with an {p.forecastConfidence * 100} % Sen interval, to the operator&apos;s limit (default baseline +
                  {p.forecastLimitRelative * 100} %). No date unless the rise is statistically clear; within {p.forecastActionDays} days it becomes an action item.
                </p>
                <p>After recorded work, later readings decide: held, relapsed, partly improved or no effect ({p.repairVerifyMinReadings}+ readings over {p.repairVerifyMinDays}+ days).</p>
              </Card>
              <Card title="Evidence-backed recommendations">
                <p>Action items: high = inspection recommended; medium = statistically clear station excess or significant data issues; low = data gaps.</p>
                <p>Reviewers mark items reviewed / resolved / dismissed (admin token on the live site). “Resolved” records a decision; it never claims a repair.</p>
                <p className="text-xs text-faint">An anomaly is a reason to inspect, not proof of a fault.</p>
              </Card>
            </div>
          </Section>

          {/* ── Driver ── */}
          <Section id="driver" title="Driver workflow" lead="Find a charger you can rely on, see why it ranks where it does, and optionally book it.">
            <Flow
              label="Driver workflow"
              steps={[
                { title: "Location", body: "Browser location (with permission), a city from the data, or typed coordinates. A denied permission is never replaced by a guess." },
                { title: "Radius filter", body: "Default 25 km (choices 5–100). Stations without recorded coordinates are listed separately, never ranked by distance." },
                { title: "Distance", body: "Haversine great-circle distance on stored coordinates — straight-line, not driving distance.", kind: "estimate" },
                { title: "Hard constraints", body: "Not offline; your connector (or vehicle profile); minimum power; optionally ‘available only’; inspection-flagged chargers excluded unless included." },
                { title: "Ranking", body: "Health tier → reported availability → distance in 5 km bands → usable power → exact distance. Each result explains itself." },
              ]}
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Compatibility and availability — what is and is not known">
                <p>• Compatibility uses the charger&apos;s recorded connector type; chargers with no recorded connector are left out when a connector is chosen, because compatibility cannot be confirmed.</p>
                <p>• Usable power = rated power capped by the vehicle profile&apos;s DC limit.</p>
                <p>• Availability is the last status recorded with its time — not live. “Unknown” is never shown as available. Price and opening hours are not in the data, so they are not used.</p>
              </Card>
              <Card title="Comparing and booking">
                <p>• Compare up to four chargers side by side; only objective bests are highlighted.</p>
                <p>
                  • Book a slot (today + {f.booking.horizonDays} days, quarter-hour starts) or join the queue. A {f.booking.bufferMinutes}-minute gap is kept after every booking so a late finish
                  never runs into the next driver; several vehicles can be planned across a station&apos;s chargers. Times are {f.booking.timeZoneLabel}. No account: a private booking code, stored only as a hash.
                </p>
                <p>• Offline and inspection-flagged chargers do not take bookings. The booking does not know whether the previous driver has actually left.</p>
              </Card>
            </div>
          </Section>

          {/* ── APIs ── */}
          <Section id="apis" title="APIs, database and error handling" lead="All endpoints are same-origin JSON. Reads are open; operator changes need the admin token in token mode (the live site); driver bookings are protected by same-site checks, validation and booking codes.">
            <Table
              label="Main endpoints"
              head={["Area", "Endpoints", "Database"]}
              rows={[
                ["Driver", "GET /api/recommendations · /api/stations · /api/stations/[id] · /api/recommendations/vehicles", "stations, chargers, alerts, vehicle_profiles"],
                ["Bookings", "GET /api/bookings/availability · POST /api/bookings · /fleet · /lookup · /cancel", "bookings (per-charger advisory lock)"],
                ["Company", "GET /api/analytics/overview · /api/insights · /api/alerts · /api/chargers/[id] · /api/maintenance · /api/company/performance; PUT/POST review, alert, maintenance, service limit (admin)", "alerts, alert_events, health_observations, maintenance_events, insight_reviews, charging_sessions"],
                ["Models", "GET /api/models · POST /api/models/predict", "model_runs"],
                ["Bench", "GET /api/bench (scenario, connector, level) · GET /api/bench/estimate (voltage, connector or referenceV)", "bench_readings + models/degradation-report.json"],
                ["Platform", "GET /api/health · POST /api/sensor-readings (optional bench sensor, supporting only)", "sensor_readings"],
              ]}
            />
            <Table
              label="Error handling"
              head={["Situation", "Response"]}
              rows={[
                ["Invalid input (Zod)", "400 validation_error with the field and reason; unknown query parameters are ignored, unknown body fields refused"],
                ["Not found / conflict", "404 not_found · 409 conflict (e.g. a booking overlapping another booking or its gap, with the next free start)"],
                ["Not allowed", "401 unauthorized: cross-site requests, or operator changes without the admin token"],
                ["Database missing or down", "503 configuration_error / database_unavailable — never fake data; /api/health reports not_configured, not_migrated or unreachable"],
                ["Anything else", "500 internal_error without internal details"],
              ]}
            />
          </Section>

          {/* ── Limits ── */}
          <Section id="limits" title="Limits and what is not verified" lead="Stated plainly, so nobody has to guess.">
            <ul className="grid gap-2 text-sm text-muted sm:grid-cols-2">
              {[
                "No live charger telemetry, price or opening hours.",
                "The session dataset's origin is unverified and internally inconsistent.",
                "Demo stations are generated and labelled Demo; they are not real sites.",
                "No validated real-world degradation accuracy: the bench model describes the bench's index only.",
                "No field wear rate: none verified was found, and the bench run is a controlled sweep.",
                "Temperature rise is not estimated: no calibrated thermal resistance.",
                "Distances are straight-line; no routing or turn-by-turn directions.",
                "No user accounts: the driver/company switch is a view choice; the live site protects operator changes with one admin token.",
                "No ESP-based hardware in the repository; the bench is Arduino.",
                "Health categories summarise recorded evidence; they are not safety certifications.",
              ].map((t) => (
                <li key={t} className="rounded-md border border-line bg-surface px-3 py-2">
                  {t}
                </li>
              ))}
            </ul>
          </Section>

          {/* ── FAQ ── */}
          <Section id="faq" title="Judge FAQ">
            <div className="space-y-2">
              {[
                [
                  "What is new compared with charging-management platforms?",
                  "They typically alert on a threshold. EVOLT follows each connector against its own baseline, separates real rises from hot-day effects (temperature correction), forecasts when a connector reaches its service limit with a range, and checks afterwards whether a repair held.",
                ],
                ["Is any of this live data?", "No. Readings come from the stored records and the Arduino log. Availability is the last recorded status with its time. The app never presents a figure as real-time."],
                [
                  "How accurate is the degradation model?",
                  `On the bench's own index: ${n(lso.relativeVoltage.mae)} points mean absolute error on sweeps it never saw, ${range(f.model.loco.map((l) => l.relativeVoltage.mae))} on an unseen connector given one commissioning sweep. Its accuracy on real connector wear is not known — that has not been measured.`,
                ],
                [
                  "Why not one model for all three connectors?",
                  `Their healthy levels differ by ${n(analysis.comparison.referenceSpreadPct * 100, 1)} %. One shared voltage line errs by ${n(lso.pooledVoltage.mae)} points on held-out sweeps; using each connector's own reference cuts that to ${n(lso.relativeVoltage.mae)}.`,
                ],
                [
                  "How do you scale a 5 V circuit to a 400 V charger?",
                  "Quantity by quantity: voltage by k_V, current by k_I, resistance by k_V ÷ k_I, power by k_V × k_I, ratios unchanged. The result shows the bench's worn states are faults at charger scale — the bench demonstrates the direction of the effect, not its size.",
                ],
                ["Can a recommendation be wrong?", "Yes. Every alert carries a confidence note: a deviation from a charger's own history is not proof of degradation; method changes, sensor faults or conditions can cause it. It is a reason to inspect."],
                ["What happens with missing data?", "Missing data is never treated as healthy: the charger is shown as “Insufficient data”, and drivers see that label rather than a guess."],
                ["How is it tested?", "Unit tests check every rule, formula and model against independent pandas/SciPy figures; integration tests run the real API handlers on PostgreSQL; Playwright runs both journeys on desktop and mobile; GitHub Actions runs it all on every pull request."],
              ].map(([q, a]) => (
                <details key={q} className="group rounded-lg border border-line bg-surface px-4 py-3">
                  <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
                    <span className="mr-2 inline-block text-faint transition-transform group-open:rotate-90">›</span>
                    {q}
                  </summary>
                  <p className="mt-2 pl-4 text-sm text-muted">{a}</p>
                </details>
              ))}
            </div>
          </Section>
        </div>

        <p className="mt-12 border-t border-line pt-6 text-xs text-faint">
          Sources in the repository: src/config (analysis, scaling, booking), models/degradation-report.json, database/data, docs/. Health categories describe recorded evidence and are not
          safety certifications.
        </p>
    </>
  );
}
