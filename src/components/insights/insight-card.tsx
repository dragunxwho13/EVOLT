import Link from "next/link";
import { Sparkline } from "@/components/charts/sparkline";
import { CATEGORY_LABELS, type Priority } from "@/features/insights/rules";
import type { InsightWithWorkflow, WorkflowStatus } from "@/features/insights/service";
import { cn } from "@/lib/utils/cn";

const PRIORITY_STYLE: Record<Priority, string> = {
  high: "bg-inspect-soft text-inspect",
  medium: "bg-watch-soft text-watch",
  low: "bg-unknown-soft text-unknown",
};
const PRIORITY_GLYPH: Record<Priority, string> = { high: "▲", medium: "◆", low: "●" };

export function PriorityTag({ priority }: { priority: Priority }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", PRIORITY_STYLE[priority])}>
      <span aria-hidden>{PRIORITY_GLYPH[priority]}</span>
      {priority === "high" ? "High" : priority === "medium" ? "Medium" : "Low"} priority
    </span>
  );
}

export const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  reviewed: "Reviewed",
  resolved: "Marked resolved",
  dismissed: "Dismissed",
};

export function WorkflowTag({ status }: { status: WorkflowStatus }) {
  return (
    <span className={cn("rounded border px-1.5 py-px text-xs", status === "new" ? "border-ink/40 text-ink" : "border-line text-muted")}>
      {WORKFLOW_LABELS[status]}
    </span>
  );
}

/** Compact card: what is happening, why it matters, what to do next. */
export function InsightCard({ insight }: { insight: InsightWithWorkflow }) {
  return (
    <article className="flex h-full flex-col rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PriorityTag priority={insight.priority} />
        <span className="text-xs text-muted">{CATEGORY_LABELS[insight.category]}</span>
        <span className="ml-auto">
          <WorkflowTag status={insight.workflow.status} />
        </span>
      </div>
      <h3 className="font-semibold leading-snug text-ink">{insight.headline}</h3>
      {insight.subject.href ? (
        <Link href={insight.subject.href} className="mt-0.5 text-sm text-signal underline-offset-4 hover:underline">
          {insight.subject.label}
        </Link>
      ) : (
        <p className="mt-0.5 text-sm text-muted">{insight.subject.label}</p>
      )}
      {(insight.metric || insight.trend) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          {insight.metric && (
            <p>
              <span className="block text-xs text-muted">{insight.metric.label}</span>
              <span className="num text-xl font-medium text-ink">{insight.metric.value}</span>
              {insight.metric.comparison && <span className="ml-2 text-sm text-muted">{insight.metric.comparison}</span>}
            </p>
          )}
          {insight.trend && <Sparkline values={insight.trend.values} label={insight.trend.label} />}
        </div>
      )}
      <p className="mt-3 text-sm text-muted">
        <span className="font-medium text-ink">Why it matters: </span>
        {insight.whyItMatters}
      </p>
      <p className="mt-2 text-sm">
        <span className="font-medium">Next step: </span>
        {insight.action}
      </p>
      <div className="mt-auto pt-3">
        <Link href={`/company/actions#${encodeURIComponent(insight.key)}`} className="text-sm font-medium text-signal underline-offset-4 hover:underline">
          See evidence and update status
        </Link>
      </div>
    </article>
  );
}
