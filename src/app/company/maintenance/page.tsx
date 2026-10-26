import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { MAINTENANCE_ACTION_LABELS, METRICS } from "@/config/domain";
import { RepairOutcomeTag } from "@/components/chargers/repair-outcome";
import { EmptyState, ErrorState, PageHeader, Panel, PanelSkeleton } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import { fleetRepairs } from "@/features/connector-health/maintenance";
import { load } from "@/lib/http/load";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Repair checks" };

export default function MaintenancePage() {
  return (
    <>
      <PageHeader
        title="Repair checks"
        description="Maintenance logs say work was done. This page says whether it worked: each recorded job is checked against the connector's readings afterwards."
      />
      <Suspense fallback={<PanelSkeleton rows={8} />}>
        <RepairList />
      </Suspense>
    </>
  );
}

async function RepairList() {
  await connection();
  const result = await load(() => fleetRepairs());
  if (!result.ok) return <ErrorState {...result.error} />;
  const { rows, summary, unverifiable, totalEvents } = result.data;

  if (totalEvents === 0) {
    return (
      <EmptyState title="No maintenance recorded yet">
        Open a charger and use <span className="font-medium">Record work</span> after cleaning or replacing contacts. EVOLT then checks the next readings.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Does the work hold?"
        description={`A job “held” when readings returned to the connector's normal range and stayed there for at least ${ANALYSIS_PARAMS.repairVerifyMinReadings} readings over ${ANALYSIS_PARAMS.repairVerifyMinDays} days. Jobs still being confirmed are not counted in the rate.`}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Work</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Recorded</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Held</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Relapsed</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Partial / none</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Confirming</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Held rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.map((s) => (
                <tr key={s.action}>
                  <td className="px-5 py-2.5 font-medium text-ink">{MAINTENANCE_ACTION_LABELS[s.action]}</td>
                  <td className="num px-3 py-2.5 text-right">{s.recorded}</td>
                  <td className="num px-3 py-2.5 text-right">{s.held}</td>
                  <td className="num px-3 py-2.5 text-right">
                    {s.relapsed}
                    {s.medianDaysToRelapse !== null && <span className="block text-xs text-faint">median {formatNumber(s.medianDaysToRelapse, 0)} days</span>}
                  </td>
                  <td className="num px-3 py-2.5 text-right">{s.partial + s.noEffect}</td>
                  <td className="num px-3 py-2.5 text-right">{s.pending}</td>
                  <td className="num px-5 py-2.5 text-right font-medium">
                    {s.successRate === null ? "—" : `${formatPercent(s.successRate)} of ${s.conclusive}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-faint">
          Small numbers: a rate from a handful of jobs is an early signal, not a verdict on a method or a technician.
        </p>
      </Panel>

      <Panel title="Every recorded job" flush>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.eventId} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <Link href={`/company/chargers/${r.chargerId}`} className="num font-medium text-signal hover:underline">
                    {r.chargerCode}
                  </Link>{" "}
                  <span className="text-muted">
                    · {MAINTENANCE_ACTION_LABELS[r.action]} · {formatDate(r.performedAt)} · checked on {METRICS[r.metric].label.toLowerCase()}
                  </span>{" "}
                  {r.isDemo && <DemoTag />}
                </span>
                <RepairOutcomeTag outcome={r.outcome} />
              </div>
              <p className="mt-1 text-muted">{r.explanation}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {unverifiable.length > 0 && (
        <p className="text-sm text-muted">
          Not checkable yet: {unverifiable.map((u) => u.chargerCode).join(", ")} — {unverifiable[0]!.reason}
        </p>
      )}
    </div>
  );
}
