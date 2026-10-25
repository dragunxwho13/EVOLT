import { Panel } from "@/components/ui/primitives";
import type { SessionSummary } from "@/features/sessions/metrics";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils/format";

function Item({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 text-base text-ink">{value}</dd>
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

const fmt = (v: number | null, digits: number, unit: string) => (v === null ? "Not in data" : `${formatNumber(v, digits)}${unit}`);

/**
 * Historical session figures for one station. The period is always shown so these values are
 * never read as current conditions. Drivers see usage facts; the company view adds loss and
 * data-quality figures.
 */
export function StationHistoryPanel({ history, audience }: { history: SessionSummary; audience: "driver" | "company" }) {
  if (history.sessions === 0) {
    return (
      <Panel title="Session history">
        <p className="text-sm text-muted">No charging sessions are stored for this station.</p>
      </Panel>
    );
  }
  const modes = Object.entries(history.chargingModes)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${m} (${n})`)
    .join(", ");
  return (
    <Panel
      title="Session history"
      description={`Historical data · ${formatDate(history.firstAt)} – ${formatDate(history.lastAt)} · ${history.sessions} sessions. Not live conditions.`}
    >
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <Item label="Average charging power" value={fmt(history.avgChargingPowerKw, 1, " kW")} />
        <Item label="Average session length" value={fmt(history.avgDurationMin, 0, " min")} hint="Duration unit assumed to be minutes" />
        <Item
          label="Cost per kWh in the data"
          value={history.costPerKwh === null ? "Not in data" : formatNumber(history.costPerKwh, 3)}
          hint="Median session cost ÷ derived energy; currency not stated"
        />
        {audience === "company" && (
          <>
            <Item label="Energy delivered (derived)" value={fmt(history.energyKwh, 0, " kWh")} hint="Σ charging power × duration" />
            <Item label="Median power loss" value={fmt(history.medianPowerLossKw, 2, " kW")} />
            <Item label="Median loss share" value={history.medianLossShare === null ? "Not in data" : formatPercent(history.medianLossShare, 1)} hint="Power loss ÷ power consumed" />
            <Item
              label="High-loss sessions"
              value={history.highLoss.rate === null ? "Not labelled" : `${formatPercent(history.highLoss.rate, 0)} (${history.highLoss.count}/${history.highLoss.of})`}
            />
            <Item
              label="Poor voltage stability"
              value={history.poorStability.rate === null ? "Not labelled" : `${formatPercent(history.poorStability.rate, 0)} (${history.poorStability.count}/${history.poorStability.of})`}
            />
            <Item
              label="Inconsistent records"
              value={`${history.lossExceedsConsumed.count} loss > consumed`}
              hint={`${history.energyExceedsBattery.count} sessions exceed battery capacity`}
            />
          </>
        )}
      </dl>
      <p className="mt-4 text-sm text-muted">Charging types in the data: {modes}.</p>
    </Panel>
  );
}
