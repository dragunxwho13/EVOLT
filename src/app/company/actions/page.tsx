import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AlertActions } from "@/components/alerts/alert-actions";
import { PriorityTag, WorkflowTag } from "@/components/insights/insight-card";
import { OpenFromHash } from "@/components/insights/open-from-hash";
import { ReviewControls } from "@/components/insights/review-controls";
import { EmptyState, ErrorState, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { FilterForm } from "@/components/ui/filter-form";
import { CATEGORY_LABELS, PRIORITY_CRITERIA, type InsightCategory, type Priority } from "@/features/insights/rules";
import { listInsights, type InsightWithWorkflow } from "@/features/insights/service";
import { load } from "@/lib/http/load";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Action items" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const STATUS_FILTERS = [
  { value: "open", label: "Open (new, acknowledged or reviewed)" },
  { value: "resolved", label: "Marked resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

export default function ActionsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <PageHeader
        title="Action items"
        description="Every item comes from an explicit rule over your records: the evidence, the rule that fired, why it matters and the next step. A detected pattern is a reason to investigate, not proof of a specific fault."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <ActionsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

async function ActionsContent({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  await connection();
  const priority = (["high", "medium", "low"] as const).find((p) => p === one(sp.priority));
  const category = (Object.keys(CATEGORY_LABELS) as InsightCategory[]).find((c) => c === one(sp.category));
  const statusFilter = STATUS_FILTERS.find((s) => s.value === one(sp.status))?.value ?? "open";

  const result = await load(() => listInsights());
  if (!result.ok) return <ErrorState {...result.error} />;
  const all = result.data.items;
  const items = all.filter((i) => {
    if (priority && i.priority !== priority) return false;
    if (category && i.category !== category) return false;
    const st = i.workflow.status;
    if (statusFilter === "open") return st !== "resolved" && st !== "dismissed";
    if (statusFilter === "all") return true;
    return st === statusFilter;
  });

  return (
    <>
      <FilterForm
        action="/company/actions"
        selects={[
          { name: "priority", label: "Priority", value: priority, options: (["high", "medium", "low"] as Priority[]).map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) })) },
          { name: "category", label: "Category", value: category, options: (Object.keys(CATEGORY_LABELS) as InsightCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
          { name: "status", label: "Workflow status", value: statusFilter === "open" ? undefined : statusFilter, anyLabel: "Open (default)", options: STATUS_FILTERS.filter((s) => s.value !== "open") },
        ]}
      />
      <p className="mb-4 text-sm text-muted" aria-live="polite">
        Showing {items.length} of {all.length} items. Generated {formatDateTime(result.data.generatedAt)} from the stored data.
      </p>

      {items.length === 0 ? (
        <EmptyState title="No items match these filters">Clear the filters to see every action item.</EmptyState>
      ) : (
        <>
          <OpenFromHash />
          <ol className="space-y-3">
            {items.map((i) => (
              <ActionItem key={i.key} item={i} />
            ))}
          </ol>
        </>
      )}

      <Panel title="How priority is set" className="mt-8">
        <dl className="space-y-2 text-sm">
          {(["high", "medium", "low"] as Priority[]).map((p) => (
            <div key={p} className="grid gap-1 sm:grid-cols-[150px_1fr]">
              <dt>
                <PriorityTag priority={p} />
              </dt>
              <dd className="text-muted">{PRIORITY_CRITERIA[p]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted">
          “Marked resolved” records a person’s decision in EVOLT. It does not verify that a charger was repaired: if the data still
          shows the pattern, the item stays visible under “Marked resolved” and is flagged when its evidence changes.
        </p>
      </Panel>
    </>
  );
}

function ActionItem({ item }: { item: InsightWithWorkflow }) {
  return (
    <li id={item.key} className="scroll-mt-24">
      <details className="group rounded-lg border border-line bg-surface open:shadow-lift" data-action-item>
        <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-4 gap-y-2 p-4 sm:px-5 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <PriorityTag priority={item.priority} />
              <span className="text-xs text-muted">{CATEGORY_LABELS[item.category]}</span>
              <WorkflowTag status={item.workflow.status} />
              {item.workflow.evidenceChanged && <span className="text-xs font-medium text-watch">Evidence changed since review</span>}
            </div>
            <h2 className="text-[1.02rem] font-semibold leading-snug">{item.headline}</h2>
            <p className="mt-0.5 text-sm text-muted">{item.subject.label}</p>
            <p className="mt-2 text-sm">
              <span className="font-medium">Next step: </span>
              {item.action}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {item.metric && (
              <p className="text-right">
                <span className="block text-xs text-muted">{item.metric.label}</span>
                <span className="num text-lg font-medium">{item.metric.value}</span>
                {item.metric.comparison && <span className="block text-xs text-muted">{item.metric.comparison}</span>}
              </p>
            )}
            <span className="text-sm font-medium text-signal">
              <span className="group-open:hidden">Evidence &amp; status ▾</span>
              <span className="hidden group-open:inline">Hide ▴</span>
            </span>
          </div>
        </summary>
        <div className="grid gap-4 border-t border-line p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="font-medium">What is happening</dt>
              <dd className="mt-0.5">
                <ul className="space-y-1 text-muted">
                  {item.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="font-medium">Why it matters</dt>
              <dd className="mt-0.5 text-muted">{item.whyItMatters}</dd>
            </div>
            <div>
              <dt className="font-medium">Rule that triggered it</dt>
              <dd className="mt-0.5 text-muted">{item.rule}</dd>
            </div>
            {item.qualification && (
              <div>
                <dt className="font-medium">Confidence and data quality</dt>
                <dd className="mt-0.5 text-muted">{item.qualification}</dd>
              </div>
            )}
            {item.subject.href && (
              <div>
                <Link href={item.subject.href} className="font-medium text-signal underline-offset-4 hover:underline">
                  Open {item.subject.kind === "charger" ? "the charger" : "the station"} →
                </Link>
              </div>
            )}
          </dl>
          <aside className="rounded-md bg-sunken p-3.5 lg:self-start" aria-label="Workflow">
            <p className="mb-2 text-sm font-medium">Workflow</p>
            {item.source === "health_alert" && item.alertId ? (
              <>
                <AlertActions alertId={item.alertId} status={item.alertStatus!} />
                <Link href={`/company/alerts/${item.alertId}`} className="mt-3 inline-block text-sm text-signal hover:underline">
                  Open the alert and its evidence chart
                </Link>
              </>
            ) : (
              <>
                {item.workflow.updatedAt && (
                  <p className="mb-2 text-xs text-muted">
                    Last updated {formatDateTime(item.workflow.updatedAt)}
                    {item.workflow.note ? ` — “${item.workflow.note}”` : ""}
                  </p>
                )}
                <ReviewControls insightKey={item.key} status={item.workflow.status} />
              </>
            )}
          </aside>
        </div>
      </details>
    </li>
  );
}
