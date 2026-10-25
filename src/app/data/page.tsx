import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { METRICS, METRIC_KEYS } from "@/config/domain";
import { DemoDataControl } from "@/components/data/demo-data-control";
import { ImportWizard } from "@/components/data/import-wizard";
import { ErrorState, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { DATASET_FIELDS } from "@/features/data-ingestion/fields";
import { maxUploadBytes } from "@/features/data-ingestion/parse";
import { dataInventory, listImports } from "@/features/data-ingestion/service";
import { load } from "@/lib/http/load";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Data import" };

export default function DataPage() {
  return (
    <>
      <PageHeader
        title="Data import"
        description="Drop in a charging-session dataset, a station registry or health readings. EVOLT recognises the file, checks every row and shows you what will happen before anything is saved — then analyses the chargers and trains a model on any labels."
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-5">
          <Suspense fallback={<PanelSkeleton rows={5} />}>
            <WizardLoader />
          </Suspense>
          <Suspense fallback={<PanelSkeleton rows={4} />}>
            <ImportHistory />
          </Suspense>
        </div>
        <aside className="space-y-5">
          <Suspense fallback={<PanelSkeleton rows={2} />}>
            <InventoryPanel />
          </Suspense>
          <DataDictionary />
        </aside>
      </div>
    </>
  );
}

async function WizardLoader() {
  await connection();
  return <ImportWizard maxBytes={maxUploadBytes()} />;
}

async function ImportHistory() {
  await connection();
  const result = await load(() => listImports(20));
  if (!result.ok) return <ErrorState {...result.error} />;
  return (
    <Panel title="Import history" flush>
      {result.data.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No files have been imported yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">File</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Type</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Result</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Accepted</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Rejected</th>
                <th scope="col" className="px-5 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.data.map((i) => (
                <tr key={i.id}>
                  <td className="num max-w-56 truncate px-5 py-2.5">{i.fileName}</td>
                  <td className="px-3 py-2.5">{{ registry: "Registry", observations: "Readings", sessions: "Sessions" }[i.kind]}</td>
                  <td className={i.status === "completed" ? "px-3 py-2.5 text-ok" : "px-3 py-2.5 text-inspect"}>{i.status}</td>
                  <td className="num px-3 py-2.5 text-right">{i.acceptedRows}</td>
                  <td className="num px-3 py-2.5 text-right">{i.rejectedRows + i.duplicateRows}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap text-muted">{formatDateTime(i.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

async function InventoryPanel() {
  await connection();
  const result = await load(dataInventory);
  if (!result.ok) return <ErrorState {...result.error} />;
  const inv = result.data;
  return (
    <Panel title="What is loaded" description="Demo records are synthetic and labelled everywhere they appear.">
      <dl className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted">Imported stations</dt>
          <dd className="num text-lg text-ink">{inv.imported}</dd>
        </div>
        <div>
          <dt className="text-muted">Sessions</dt>
          <dd className="num text-lg text-ink">{inv.sessions.toLocaleString("en-GB")}</dd>
        </div>
        <div>
          <dt className="text-muted">Demo stations</dt>
          <dd className="num text-lg text-ink">{inv.synthetic}</dd>
        </div>
      </dl>
      <DemoDataControl synthetic={inv.synthetic} />
    </Panel>
  );
}

function DataDictionary() {
  return (
    <div className="space-y-5">
      <Panel title="Example files" description="Small synthetic files in the expected format.">
        <ul className="space-y-1.5 text-sm">
          <li>
            <a className="text-signal hover:underline" href="/samples/ev-charging-grid-sessions.csv" download>
              ev-charging-grid-sessions.csv
            </a>{" "}
            <span className="text-muted">— 1,000 labelled charging sessions (the dataset used for model training)</span>
          </li>
          <li>
            <a className="text-signal hover:underline" href="/samples/registry-example.csv" download>
              registry-example.csv
            </a>{" "}
            <span className="text-muted">— two stations, three chargers</span>
          </li>
          <li>
            <a className="text-signal hover:underline" href="/samples/observations-example.csv" download>
              observations-example.csv
            </a>{" "}
            <span className="text-muted">— readings for those chargers, including rows that will be rejected</span>
          </li>
          <li>
            <a className="text-signal hover:underline" href="/samples/observations-example.json" download>
              observations-example.json
            </a>{" "}
            <span className="text-muted">— the same format as JSON</span>
          </li>
        </ul>
      </Panel>
      {(["sessions", "registry", "observations"] as const).map((kind) => (
        <details key={kind} className="group rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[0.95rem] font-semibold text-ink sm:px-5">
            {{ sessions: "Session file columns", registry: "Registry columns", observations: "Health-reading columns" }[kind]}
            <span className="ml-2 text-sm font-normal text-muted">{DATASET_FIELDS[kind].length} fields</span>
          </summary>
          <dl className="space-y-2.5 border-t border-line px-4 py-4 text-sm sm:px-5">
            {DATASET_FIELDS[kind].map((f) => (
              <div key={f.key}>
                <dt>
                  <code className="num text-ink">{f.key}</code>
                  {f.required && <span className="ml-2 text-xs text-inspect">required</span>}
                </dt>
                <dd className="text-muted">{f.description}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      <details className="rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-[0.95rem] font-semibold text-ink sm:px-5">Metrics and accepted units</summary>
        <div className="border-t border-line px-4 py-4 sm:px-5">
        <dl className="space-y-2.5 text-sm">
          {METRIC_KEYS.map((k) => (
            <div key={k}>
              <dt>
                <code className="num text-ink">{k}</code> <span className="text-muted">stored in {METRICS[k].unit}</span>
              </dt>
              <dd className="text-muted">
                Accepts {Object.keys(METRICS[k].acceptedUnits).join(", ")}; plausible range {METRICS[k].plausible[0]}–{METRICS[k].plausible[1]}.
              </dd>
            </div>
          ))}
        </dl>
        </div>
      </details>
    </div>
  );
}
