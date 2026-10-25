import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ALERT_RULE_LABELS, METRICS } from "@/config/domain";
import { AlertDetailLink, AlertRow } from "@/components/alerts/alert-row";
import { EvidenceSummary } from "@/components/alerts/evidence-summary";
import { FilterForm } from "@/components/ui/filter-form";
import { ButtonLink, EmptyState, ErrorState, PageHeader, Pagination, PanelSkeleton } from "@/components/ui/primitives";
import { AlertStatusTag, HealthBadge } from "@/components/ui/status";
import { listAlerts } from "@/features/connector-health/queries";
import { load } from "@/lib/http/load";
import { formatAge, formatDateTime } from "@/lib/utils/format";
import { alertQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

export const metadata: Metadata = { title: "Alerts" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default function AlertsPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Each alert states the rule that fired, the readings behind it, the threshold it crossed and how confident you can be. Repeated detections update one alert rather than creating new ones."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <AlertList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function AlertList({ searchParams }: { searchParams: SP }) {
  const raw = searchParamsToObject(await searchParams);
  await connection();
  const parsed = alertQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return (
      <ErrorState
        title="Those filters are not valid"
        message="Reset the filters and choose again."
        action={<ButtonLink href="/alerts">Reset filters</ButtonLink>}
      />
    );
  }
  const q = parsed.data;
  const result = await load(() => listAlerts(q));
  const now = new Date();
  const hrefFor = (page: number) => {
    const s = new URLSearchParams(raw);
    s.set("page", String(page));
    return `/alerts?${s}`;
  };

  return (
    <>
      <FilterForm
        action="/alerts"
        selects={[
          {
            name: "status",
            label: "Status",
            value: q.status === "active" ? undefined : q.status,
            anyLabel: "Unresolved (open or acknowledged)",
            options: [
              { value: "open", label: "Open" },
              { value: "acknowledged", label: "Acknowledged" },
              { value: "resolved", label: "Resolved" },
              { value: "dismissed", label: "Dismissed" },
              { value: "all", label: "All" },
            ],
          },
          {
            name: "severity",
            label: "Severity",
            value: q.severity,
            options: [
              { value: "inspection_recommended", label: "Inspection recommended" },
              { value: "monitor", label: "Monitor" },
            ],
          },
        ]}
      />
      {!result.ok ? (
        <ErrorState {...result.error} />
      ) : result.data.items.length === 0 ? (
        <EmptyState title={result.data.status === "active" ? "No unresolved alerts" : "No alerts match these filters"}>
          {result.data.status === "active"
            ? "The analysis has not found any persistent deviation, sustained trend or recurring fault pattern that is still open."
            : "Choose a different status or severity."}
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-line bg-surface">
          <ul>
            {result.data.items.map(({ alert, chargerCode, stationName }) => (
              <AlertRow
                key={alert.id}
                summary={
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {ALERT_RULE_LABELS[alert.rule]} in {METRICS[alert.metric].label.toLowerCase()}
                      </p>
                      <p className="text-sm text-muted">
                        <span className="num">{chargerCode}</span> at {stationName}, last evidence {formatAge(alert.windowEnd, now)}
                        {!alert.conditionActive && <span className="text-ok"> — no longer detected</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <HealthBadge status={alert.severity} short />
                      <AlertStatusTag status={alert.status} />
                    </div>
                  </div>
                }
              >
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div className="space-y-3 text-sm">
                    <p className="text-ink">{alert.explanation}</p>
                    <p className="text-muted">
                      <span className="font-medium text-ink">Confidence: </span>
                      {alert.confidenceNote}
                    </p>
                    <p className="text-muted">
                      <span className="font-medium text-ink">Suggested action: </span>
                      {alert.suggestedAction}
                    </p>
                    <p className="text-xs text-faint">
                      Window {formatDateTime(alert.windowStart)} to {formatDateTime(alert.windowEnd)}. Detected{" "}
                      {alert.occurrences} time{alert.occurrences === 1 ? "" : "s"} with new evidence.
                    </p>
                    <AlertDetailLink id={alert.id} />
                  </div>
                  <EvidenceSummary evidence={alert.evidence} />
                </div>
              </AlertRow>
            ))}
          </ul>
          <div className="border-t border-line px-5 pb-4">
            <Pagination page={result.data.page} pageSize={result.data.pageSize} total={result.data.total} hrefFor={hrefFor} />
          </div>
        </div>
      )}
    </>
  );
}
