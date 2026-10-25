import { ANALYSIS_PARAMS } from "@/config/analysis";
import type { AlertEvidence } from "@/types/analysis";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/utils/format";

const v = (n: number, unit: string) => (unit === "count" ? formatNumber(n, 0) : `${formatNumber(n)} ${unit}`);

/** The exact numbers that triggered an alert, next to the rule's thresholds. */
export function EvidenceSummary({ evidence }: { evidence: AlertEvidence }) {
  const rows: [string, string, string][] = [];
  if (evidence.kind === "persistent_deviation") {
    rows.push(["Readings above threshold", `${evidence.exceedCount} of last ${evidence.windowSize}`, `needs ${evidence.requiredCount}`]);
    rows.push(["Deviation threshold", v(evidence.thresholdValue, evidence.unit), `median + ${evidence.thresholdZ} spreads, at least +${formatPercent(ANALYSIS_PARAMS.minRelativeDeviation)}`]);
    rows.push(["Baseline median", v(evidence.baseline.median, evidence.unit), `${evidence.baseline.n} readings`]);
    rows.push(["Largest deviation", `${formatNumber(evidence.maxZ, 1)} spreads`, `spread ${v(evidence.baseline.scale, evidence.unit)}`]);
  } else if (evidence.kind === "sustained_trend") {
    rows.push(["Change across window", formatPercent(evidence.relativeChange), `needs ${formatPercent(evidence.requiredRelativeChange)}`]);
    rows.push(["Consistent increases", formatPercent(evidence.consistency), `needs ${formatPercent(evidence.requiredConsistency)}`]);
    rows.push(["Slope", `${formatNumber(evidence.slopePerDay * 30, 3)} ${evidence.unit} / 30 days`, "Theil–Sen median slope"]);
    rows.push(["Baseline median", v(evidence.baseline.median, evidence.unit), `${evidence.baseline.n} readings`]);
  } else {
    rows.push([`Faults in ${evidence.windowDays} days`, formatNumber(evidence.total, 0), `monitor at ${evidence.monitorThreshold}, inspect at ${evidence.inspectThreshold}`]);
    rows.push([
      "Historical rate",
      evidence.baselineTotal === null ? "No earlier history" : `${formatNumber(evidence.baselineTotal, 1)} per ${evidence.windowDays} days`,
      "",
    ]);
  }
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <caption className="sr-only">Triggering evidence</caption>
        <tbody className="divide-y divide-line">
          {rows.map(([k, val, note]) => (
            <tr key={k}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted">{k}</th>
              <td className="num py-1.5 pr-3 text-ink">{val}</td>
              <td className="py-1.5 text-faint">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="group text-sm">
        <summary className="cursor-pointer text-signal hover:underline">Readings in the window ({evidence.points.length})</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {evidence.points.map((p) => (
            <li key={p.at} className="flex justify-between gap-3 rounded bg-sunken px-2 py-1">
              <span className="text-muted">{formatDateTime(p.at)}</span>
              <span className="num">
                {v(p.value, evidence.unit)}
                {p.z !== undefined && <span className="text-faint"> ({formatNumber(p.z, 1)}σ)</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
