"use client";

import { CircleAlert, FileUp, Info, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { PROVENANCES, PROVENANCE_DESCRIPTIONS, PROVENANCE_LABELS, type DatasetKind, type Provenance } from "@/config/domain";
import { Button, ButtonLink, Field, inputClass } from "@/components/ui/primitives";
import { DATASET_FIELDS, type ColumnMapping } from "@/features/data-ingestion/fields";
import type { CommitResult, PreviewResult } from "@/features/data-ingestion/service";
import { ApiError, apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatPercent } from "@/lib/utils/format";

type Phase = "idle" | "checking" | "ready" | "importing" | "done";
type KindChoice = DatasetKind | "auto";

const KIND_TEXT: Record<DatasetKind, { title: string; body: string }> = {
  sessions: { title: "Charging sessions", body: "One row per session. Creates stations, chargers and readings in one go." },
  registry: { title: "Stations and chargers", body: "A list of sites and their chargers, with locations and connectors." },
  observations: { title: "Health readings", body: "Measurements for chargers that are already in EVOLT." },
};

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "+05:30", label: "India (IST, UTC+05:30)" },
  { value: "+00:00", label: "UK winter (UTC+00:00)" },
  { value: "+01:00", label: "Central Europe (UTC+01:00)" },
  { value: "-05:00", label: "US Eastern (UTC−05:00)" },
  { value: "-08:00", label: "US Pacific (UTC−08:00)" },
  { value: "+08:00", label: "China / Singapore (UTC+08:00)" },
  { value: "+09:00", label: "Japan (UTC+09:00)" },
  { value: "none", label: "Reject times without a timezone" },
];

const EXAMPLES = [
  { file: "ev-charging-grid-sessions.csv", label: "EV grid sessions (1,000 rows, labelled)", type: "text/csv" },
  { file: "registry-example.csv", label: "Station registry", type: "text/csv" },
  { file: "observations-example.csv", label: "Health readings", type: "text/csv" },
];

interface ErrorState {
  message: string;
  details?: unknown;
  forbidden: boolean;
}

export function ImportWizard({ maxBytes }: { maxBytes: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<KindChoice>("auto");
  const [timezone, setTimezone] = useState("UTC");
  const [provenance, setProvenance] = useState<Provenance>("observed");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ErrorState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);

  const busy = phase === "checking" || phase === "importing";

  const reset = () => {
    setFile(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setKind("auto");
    setPhase("idle");
    setMappingOpen(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const fail = (e: unknown) => {
    const err = e instanceof ApiError ? e : new ApiError("Something went wrong. Try again.", 0);
    setError({ message: err.message, details: err.details, forbidden: err.status === 401 });
  };

  const form = (f: File, opts: { kind: KindChoice; mapping: ColumnMapping | null; timezone: string; provenance: Provenance }) => {
    const fd = new FormData();
    fd.set("file", f);
    fd.set("kind", opts.kind);
    fd.set("timezone", opts.timezone);
    fd.set("defaultProvenance", opts.provenance);
    if (opts.mapping) fd.set("mapping", JSON.stringify(opts.mapping));
    return fd;
  };

  const check = async (
    f: File,
    opts: { kind?: KindChoice; mapping?: ColumnMapping | null; timezone?: string; provenance?: Provenance } = {},
  ) => {
    const o = {
      kind: opts.kind ?? kind,
      mapping: opts.mapping === undefined ? mapping : opts.mapping,
      timezone: opts.timezone ?? timezone,
      provenance: opts.provenance ?? provenance,
    };
    setPhase("checking");
    setError(null);
    try {
      const p = await apiFetch<PreviewResult>("/api/datasets/preview", { method: "POST", body: form(f, o) });
      setPreview(p);
      setMapping(p.mapping);
      setKind(p.kind);
      if (p.missingRequired.length) setMappingOpen(true);
      setPhase("ready");
    } catch (e) {
      fail(e);
      setPhase(preview ? "ready" : "idle");
    }
  };

  const choose = (f: File | null) => {
    setError(null);
    setPreview(null);
    setMapping(null);
    setResult(null);
    setKind("auto");
    if (!f) return setFile(null);
    if (!/\.(csv|json)$/i.test(f.name)) {
      setFile(null);
      setError({ message: "Choose a .csv or .json file.", forbidden: false });
      return;
    }
    if (f.size > maxBytes) {
      setFile(null);
      setError({ message: `The file is ${(f.size / 1024).toFixed(0)} KiB; the limit is ${(maxBytes / 1024).toFixed(0)} KiB.`, forbidden: false });
      return;
    }
    if (f.size === 0) {
      setFile(null);
      setError({ message: "The file is empty.", forbidden: false });
      return;
    }
    setFile(f);
    void check(f, { kind: "auto", mapping: null });
  };

  const loadExample = async (ex: (typeof EXAMPLES)[number]) => {
    setError(null);
    try {
      const res = await fetch(`/samples/${ex.file}`);
      if (!res.ok) throw new Error();
      choose(new File([await res.blob()], ex.file, { type: ex.type }));
    } catch {
      setError({ message: "The example file could not be loaded.", forbidden: false });
    }
  };

  const runImport = async () => {
    if (!file || !preview) return;
    setPhase("importing");
    setError(null);
    try {
      const r = await apiFetch<CommitResult>("/api/datasets", {
        method: "POST",
        body: form(file, { kind: preview.kind, mapping, timezone, provenance }),
      });
      setResult(r);
      setPhase("done");
      router.refresh();
    } catch (e) {
      fail(e);
      setPhase("ready");
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) choose(e.dataTransfer.files?.[0] ?? null);
  };

  const mappingDirty = Boolean(preview && mapping && JSON.stringify(mapping) !== JSON.stringify(preview.mapping));

  if (phase === "done" && result) return <ImportDone result={result} onAgain={reset} />;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="space-y-5 px-4 py-5 sm:px-5">
        {/* 1 — choose a file */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-lg border-2 border-dashed px-5 py-6 text-center transition-colors",
            dragging ? "border-signal bg-signal-soft" : "border-line-strong",
          )}
        >
          <FileUp aria-hidden className="mx-auto h-7 w-7 text-faint" />
          {file ? (
            <p className="mt-2 font-medium text-ink">
              {file.name} <span className="font-normal text-muted">· {(file.size / 1024).toFixed(0)} KiB</span>
            </p>
          ) : (
            <p className="mt-2 font-medium text-ink">Drop a CSV or JSON file here</p>
          )}
          <p className="mt-1 text-sm text-muted">EVOLT detects what the file contains. Nothing is saved until you confirm.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant={file ? "secondary" : "primary"} onClick={() => inputRef.current?.click()} disabled={busy}>
              {file ? "Choose another file" : "Choose file"}
            </Button>
            {file && (
              <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>
                Clear
              </Button>
            )}
          </div>
          <input
            ref={inputRef}
            id="import-file"
            aria-label="Choose a file to import"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          {!file && (
            <p className="mt-4 text-sm text-muted">
              Or try an example:{" "}
              {EXAMPLES.map((ex, i) => (
                <span key={ex.file}>
                  {i > 0 && ", "}
                  <button type="button" className="text-signal underline-offset-4 hover:underline" onClick={() => loadExample(ex)}>
                    {ex.label}
                  </button>
                </span>
              ))}
            </p>
          )}
          <p className="mt-2 text-xs text-faint">Up to {(maxBytes / 1024).toFixed(0)} KiB. Files are read as data only; nothing in them is run.</p>
        </div>

        {phase === "checking" && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> Reading and checking every row…
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-inspect/40 bg-inspect-soft/60 px-3.5 py-2.5 text-sm">
            <p className="text-ink">{error.message}</p>
            {Array.isArray(error.details) && (
              <ul className="mt-1 list-disc pl-5 text-muted">
                {(error.details as { path: string; message: string }[]).slice(0, 5).map((d, i) => (
                  <li key={i}>
                    {d.path}: {d.message}
                  </li>
                ))}
              </ul>
            )}
            {error.forbidden && (
              <Link href="/company/settings" className="mt-1 inline-block text-signal underline">
                Open Settings → Editing access
              </Link>
            )}
          </div>
        )}

        {preview && file && (
          <>
            {/* 2 — what the file is */}
            <section aria-labelledby="detected-heading" className="space-y-3 border-t border-line pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="detected-heading" className="font-semibold text-ink">
                    Detected: {KIND_TEXT[preview.kind].title}
                  </h3>
                  <p className="text-sm text-muted">
                    {preview.detected.reason}
                    {preview.detected.confidence !== "high" && " Check the type below."}
                  </p>
                </div>
                <div className="inline-flex rounded-md border border-line-strong p-0.5" role="group" aria-label="File type">
                  {(Object.keys(KIND_TEXT) as DatasetKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={busy}
                      aria-pressed={preview.kind === k}
                      title={KIND_TEXT[k].body}
                      onClick={() => check(file, { kind: k, mapping: null })}
                      className={cn("rounded px-2.5 py-1 text-sm", preview.kind === k ? "bg-ink text-surface" : "text-muted hover:text-ink")}
                    >
                      {KIND_TEXT[k].title}
                    </button>
                  ))}
                </div>
              </div>

              {preview.sessionSummary && (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Stations in file", preview.sessionSummary.stations],
                      ["Chargers in file", preview.sessionSummary.chargers],
                      ["Sessions in file", preview.sessionSummary.sessions],
                      [
                        "Time span",
                        preview.sessionSummary.timeRange
                          ? `${formatDate(preview.sessionSummary.timeRange.from)} – ${formatDate(preview.sessionSummary.timeRange.to)}`
                          : "—",
                      ],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="rounded-md bg-sunken px-3 py-2">
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="num text-base text-ink">{typeof v === "number" ? v.toLocaleString("en-GB") : v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {preview.sessionSummary && preview.sessionSummary.labelColumns.length > 0 && (
                <p className="text-sm text-ink">
                  <span className="font-medium">Labels found for model training: </span>
                  {preview.sessionSummary.labelColumns
                    .map((l) => (l.classes.length ? `${l.column} (${l.classes.join(", ")})` : l.column))
                    .join("; ")}
                  . After import, EVOLT trains and tests a classifier for each one.
                </p>
              )}
            </section>

            {/* 3 — options for this file */}
            <section className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Timezone for times without one"
                htmlFor="import-tz"
                hint={preview.needsTimezone ? undefined : "Used only for timestamps like 2024-01-01 00:15:00."}
              >
                <select
                  id="import-tz"
                  className={cn(inputClass, preview.needsTimezone && "border-watch")}
                  value={timezone}
                  disabled={busy}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    void check(file, { timezone: e.target.value });
                  }}
                >
                  {TIMEZONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {preview.needsTimezone && <p className="text-xs text-watch">Some rows have no timezone. Choose one to accept them.</p>}
              </Field>
              {preview.kind !== "registry" && (
                <Field label="Where the data comes from" htmlFor="import-prov" hint={PROVENANCE_DESCRIPTIONS[provenance]}>
                  <select
                    id="import-prov"
                    className={inputClass}
                    value={provenance}
                    disabled={busy}
                    onChange={(e) => setProvenance(e.target.value as Provenance)}
                  >
                    {PROVENANCES.map((p) => (
                      <option key={p} value={p}>
                        {PROVENANCE_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </section>

            {preview.findings.length > 0 && (
              <section aria-label="Data quality" className="space-y-1.5">
                <h3 className="text-sm font-semibold text-ink">What EVOLT noticed about this file</h3>
                <ul className="space-y-1.5">
                  {preview.findings.map((f, i) => (
                    <li key={i} className={cn("flex gap-2 rounded-md px-3 py-2 text-sm", f.level === "warning" ? "bg-watch-soft text-ink" : "bg-sunken text-muted")}>
                      {f.level === "warning" ? (
                        <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-watch" />
                      ) : (
                        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                      )}
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 4 — column mapping */}
            {mapping && (
              <MappingSection
                preview={preview}
                mapping={mapping}
                setMapping={setMapping}
                open={mappingOpen}
                setOpen={setMappingOpen}
                dirty={mappingDirty}
                busy={busy}
                onApply={() => check(file, { mapping })}
              />
            )}

            {preview.counts && !mappingDirty && <PreviewDetails preview={preview} />}

            {/* 5 — confirm */}
            {preview.counts && !mappingDirty && (
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <Button variant="primary" size="lg" disabled={!preview.canCommit || busy} onClick={runImport}>
                  {phase === "importing" ? (
                    <>
                      <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> Importing and analysing…
                    </>
                  ) : (
                    `Import ${preview.counts.accepted.toLocaleString("en-GB")} row${preview.counts.accepted === 1 ? "" : "s"}`
                  )}
                </Button>
                {phase === "importing" && (
                  <p className="text-sm text-muted">
                    Saving, analysing each charger{preview.sessionSummary?.labelColumns.length ? " and training the model" : ""} — usually a few seconds.
                  </p>
                )}
                {!preview.canCommit && !preview.alreadyImportedAt && phase !== "importing" && (
                  <p className="text-sm text-muted">Nothing in this file can be imported yet — see the problems above.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MappingSection({
  preview,
  mapping,
  setMapping,
  open,
  setOpen,
  dirty,
  busy,
  onApply,
}: {
  preview: PreviewResult;
  mapping: ColumnMapping;
  setMapping: (m: ColumnMapping) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  dirty: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  const fields = DATASET_FIELDS[preview.kind];
  const matched = fields.filter((f) => mapping[f.key]).length;
  return (
    <section className="rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm"
      >
        <span>
          <span className="font-semibold text-ink">Column matching</span>{" "}
          <span className="text-muted">
            — {matched} of {fields.length} fields matched automatically
            {preview.missingRequired.length > 0 && <span className="text-inspect"> · {preview.missingRequired.length} required field(s) need a column</span>}
          </span>
        </span>
        <span className="text-signal">{open ? "Hide" : "Review"}</span>
      </button>
      <div className="reveal" data-open={open} inert={!open}>
        <div>
          <div className="grid gap-3 border-t border-line px-3.5 py-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => {
              const col = mapping[f.key];
              const samples = col ? preview.columnSamples[col] : undefined;
              return (
                <Field key={f.key} label={`${f.label}${f.required ? " (required)" : ""}`} htmlFor={`map-${f.key}`}>
                  <select
                    id={`map-${f.key}`}
                    className={cn(inputClass, f.required && !col && "border-inspect")}
                    value={col ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}
                  >
                    <option value="">Not in file</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <p className="truncate text-xs text-faint" title={f.description}>
                    {samples?.length ? `e.g. ${samples.join(", ")}` : f.description}
                  </p>
                </Field>
              );
            })}
          </div>
          {dirty && (
            <div className="border-t border-line px-3.5 py-3">
              <Button variant="primary" disabled={busy} onClick={onApply}>
                Check again with these columns
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PreviewDetails({ preview }: { preview: PreviewResult }) {
  const c = preview.counts!;
  return (
    <section className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(
          [
            ["Rows", c.total, "text-ink"],
            ["Ready to import", c.accepted, "text-ok"],
            ["Rejected", c.rejected, c.rejected ? "text-inspect" : "text-ink"],
            ["Duplicates", c.duplicate, c.duplicate ? "text-watch" : "text-ink"],
            ["Blank", c.skipped, "text-ink"],
          ] as const
        ).map(([label, n, tone]) => (
          <div key={label} className="rounded-md bg-sunken px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className={cn("num text-xl", tone)}>{n.toLocaleString("en-GB")}</dd>
          </div>
        ))}
      </dl>

      {preview.alreadyImportedAt && (
        <p className="rounded-md border border-watch/40 bg-watch-soft px-3.5 py-2.5 text-sm">
          This exact file was already imported on {formatDate(preview.alreadyImportedAt)}. Importing it again is blocked to prevent duplicate data.
        </p>
      )}

      {preview.issues.length > 0 && (
        <details open={preview.issues.length <= 10} className="text-sm">
          <summary className="cursor-pointer font-medium text-ink">
            Row problems ({preview.issues.length}
            {preview.issuesTruncated ? "+, first 200 shown" : ""})
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[520px]">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Row</th>
                  <th scope="col" className="px-3 py-2 font-medium">Outcome</th>
                  <th scope="col" className="px-3 py-2 font-medium">Column</th>
                  <th scope="col" className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.issues.map((i, idx) => (
                  <tr key={idx}>
                    <td className="num px-3 py-1.5">{i.row}</td>
                    <td className={cn("px-3 py-1.5", i.kind === "rejected" ? "text-inspect" : i.kind === "duplicate" ? "text-watch" : "text-muted")}>{i.kind}</td>
                    <td className="num px-3 py-1.5 text-muted">{i.field ?? "—"}</td>
                    <td className="px-3 py-1.5">{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {preview.sample.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-ink">Preview of rows to import (first {preview.sample.length})</summary>
          <div className="mt-2 overflow-auto rounded-md border border-line">
            <table className="w-full text-xs">
              <thead className="bg-sunken text-left text-muted">
                <tr>
                  {Object.keys(preview.sample[0]!).map((k) => (
                    <th key={k} scope="col" className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.sample.map((r, i) => (
                  <tr key={i}>
                    {Object.values(r).map((v, j) => (
                      <td key={j} className="num px-2.5 py-1.5 whitespace-nowrap">
                        {v === null ? "—" : typeof v === "number" ? Number(v.toFixed(4)) : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function ImportDone({ result, onAgain }: { result: CommitResult; onAgain: () => void }) {
  const a = result.analysis;
  return (
    <div className="space-y-4 rounded-lg border border-ok/40 bg-surface px-4 py-5 sm:px-5" role="status">
      <p className="text-lg font-semibold text-ok">Import complete</p>
      <ul className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
        {result.kind === "sessions" ? (
          <>
            <li>
              <span className="num">{result.counts.accepted.toLocaleString("en-GB")}</span> sessions stored across{" "}
              <span className="num">{result.stationsTouched}</span> stations and <span className="num">{result.chargersTouched}</span> chargers
            </li>
            <li>
              <span className="num">{result.observationsStored.toLocaleString("en-GB")}</span> health readings added
            </li>
          </>
        ) : result.kind === "registry" ? (
          <>
            <li>
              <span className="num">{result.inserted}</span> chargers added, <span className="num">{result.updated}</span> updated
            </li>
            <li>
              <span className="num">{result.stationsTouched}</span> stations created or updated
            </li>
          </>
        ) : (
          <li>
            <span className="num">{result.observationsStored}</span> readings stored
          </li>
        )}
        <li>
          <span className="num">{result.counts.rejected}</span> rejected, <span className="num">{result.counts.duplicate}</span> duplicates,{" "}
          <span className="num">{result.counts.skipped}</span> blank
        </li>
        <li>
          Analysis re-run for <span className="num">{a.chargersEvaluated}</span> charger{a.chargersEvaluated === 1 ? "" : "s"}:{" "}
          {a.alertsCreated} new alert{a.alertsCreated === 1 ? "" : "s"}
        </li>
      </ul>
      {result.training && result.training.targets.length > 0 && (
        <div className="rounded-md bg-sunken px-3.5 py-3 text-sm">
          <p className="font-medium text-ink">Model training</p>
          <ul className="mt-1 space-y-1 text-muted">
            {result.training.targets.map((t) => (
              <li key={t.target}>
                <span className="text-ink">{t.label}:</span>{" "}
                {t.learnable
                  ? `${formatPercent(t.accuracy, 1)} accuracy on unseen sessions (baseline ${formatPercent(t.baseline, 1)}).`
                  : `not predictable from this data (best attempt no better than the ${formatPercent(t.baseline, 1)} baseline).`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <ButtonLink href="/company" variant="primary">
          Open overview
        </ButtonLink>
        <ButtonLink href="/company/chargers">View chargers</ButtonLink>
        {result.training && result.training.targets.length > 0 && <ButtonLink href="/company/model">See model results</ButtonLink>}
        <Button variant="ghost" onClick={onAgain}>
          Import another file
        </Button>
      </div>
    </div>
  );
}
