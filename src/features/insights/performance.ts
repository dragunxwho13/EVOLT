/**
 * Performance figures for the company workspace, computed from stored sessions.
 * Takeaways are generated from the numbers (never hand-written results), and every
 * comparison states its sample size and uncertainty.
 */
import { formatNumber, formatPercent } from "@/lib/utils/format";
import {
  bonferroniZ,
  coverage,
  dailySeries,
  dailySlope,
  groupBy,
  summarizeSessions,
  type DailyPoint,
  type NormalizedSession,
  type SessionSummary,
  wilson,
} from "@/features/sessions/metrics";

export interface GroupRow {
  key: string;
  label: string;
  href?: string;
  summary: SessionSummary;
}

export interface Performance {
  fleet: SessionSummary;
  stations: GroupRow[];
  byArea: GroupRow[];
  byMode: GroupRow[];
  daily: DailyPoint[];
  coverage: ReturnType<typeof coverage>;
  takeaways: {
    /** Session volume over the period. */
    dailySessions: string;
    /** Direction of the daily high-loss share. */
    dailyLoss: string;
    area: string;
    mode: string;
    stations: string;
  };
  filters: { chargingModes: string[]; areas: string[] };
}

function groupRows(sessions: readonly NormalizedSession[], key: (s: NormalizedSession) => string | null, label?: (s: NormalizedSession) => string, href?: (s: NormalizedSession) => string): GroupRow[] {
  return [...groupBy(sessions, (s) => key(s) ?? "Not recorded").entries()]
    .map(([k, list]) => ({ key: k, label: label ? label(list[0]!) : k, href: href?.(list[0]!), summary: summarizeSessions(list) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** "clearly differ" only when the highest and lowest groups' 95 % intervals do not overlap. */
export function compareRates(rows: readonly GroupRow[], noun: string, groupNoun: string): string {
  const rated = rows.filter((r) => r.summary.highLoss.rate !== null && r.summary.highLoss.of >= 20);
  if (rated.length < 2) return `Not enough labelled sessions to compare ${noun} between ${groupNoun}.`;
  const hi = rated.reduce((a, b) => (b.summary.highLoss.rate! > a.summary.highLoss.rate! ? b : a));
  const lo = rated.reduce((a, b) => (b.summary.highLoss.rate! < a.summary.highLoss.rate! ? b : a));
  const gap = hi.summary.highLoss.rate! - lo.summary.highLoss.rate!;
  const overlap = hi.summary.highLoss.low! <= lo.summary.highLoss.high!;
  return overlap
    ? `The ${noun} ranges from ${formatPercent(lo.summary.highLoss.rate!)} (${lo.label}) to ${formatPercent(hi.summary.highLoss.rate!)} (${hi.label}), but the 95 % intervals overlap — the ${formatPercent(gap)}-point gap is within what chance alone could produce.`
    : `${hi.label} has a clearly higher ${noun} (${formatPercent(hi.summary.highLoss.rate!)}) than ${lo.label} (${formatPercent(lo.summary.highLoss.rate!)}); their 95 % intervals do not overlap.`;
}

export function computePerformance(sessions: readonly NormalizedSession[]): Performance {
  const fleet = summarizeSessions(sessions);
  const stations = groupRows(
    sessions,
    (s) => s.stationId,
    (s) => s.stationName,
    (s) => `/company/stations/${s.stationId}`,
  );
  const byArea = groupRows(sessions, (s) => s.area);
  const byMode = groupRows(sessions, (s) => s.chargingMode);
  const daily = dailySeries(sessions);

  // Daily takeaways: range and a robust slope, stated against the period length.
  let dailySessions = "No sessions in the selected data.";
  let dailyLoss = "Not enough labelled days to describe a trend.";
  if (daily.length > 0) {
    const counts = daily.map((d) => d.sessions);
    dailySessions = `Sessions per day ranged from ${Math.min(...counts)} to ${Math.max(...counts)} over ${daily.length} days (the first and last day may be partial).`;
    const rates = daily.map((d) => d.highLossRate).filter((v): v is number => v !== null);
    const slope = dailySlope(daily, (d) => d.highLossRate);
    if (rates.length >= 4 && slope !== null) {
      const change = slope * (daily.length - 1);
      dailyLoss =
        Math.abs(change) < 0.05
          ? `The daily high-loss share moved between ${formatPercent(Math.min(...rates))} and ${formatPercent(Math.max(...rates))} with no consistent upward or downward trend (robust slope ${formatNumber(slope * 100, 2)} points per day).`
          : `The daily high-loss share ${change > 0 ? "rose" : "fell"} by about ${formatPercent(Math.abs(change))} points across the period (robust slope ${formatNumber(slope * 100, 2)} points per day).`;
    }
  }

  const ratedStations = stations.filter((r) => r.summary.highLoss.rate !== null);
  let stationText = "No labelled sessions to rank stations by high-loss share.";
  if (ratedStations.length >= 2) {
    const sorted = [...ratedStations].sort((a, b) => b.summary.highLoss.rate! - a.summary.highLoss.rate!);
    const fleetRate = fleet.highLoss.rate ?? 0;
    // Same test as the action-item rule: a Bonferroni-adjusted interval across the stations compared.
    const z = bonferroniZ(sorted.filter((r) => r.summary.highLoss.of >= 20).length);
    const clear = sorted.filter(
      (r) => r.summary.highLoss.of >= 20 && wilson(r.summary.highLoss.count, r.summary.highLoss.of, z).low > fleetRate && r.summary.highLoss.rate! - fleetRate >= 0.1,
    );
    stationText = clear.length
      ? `${clear.length} station${clear.length === 1 ? "" : "s"} (${clear.map((c) => c.label).join(", ")}) ${clear.length === 1 ? "has" : "have"} a high-loss share clearly above the fleet's ${formatPercent(fleetRate)} — see Action items.`
      : `Station high-loss shares range from ${formatPercent(sorted.at(-1)!.summary.highLoss.rate!)} to ${formatPercent(sorted[0]!.summary.highLoss.rate!)} (fleet ${formatPercent(fleetRate)}). None is clearly above the fleet once sample size and the number of stations compared are taken into account.`;
  }

  return {
    fleet,
    stations,
    byArea,
    byMode,
    daily,
    coverage: coverage(sessions),
    takeaways: {
      dailySessions,
      dailyLoss,
      area: compareRates(byArea, "high-loss share", "area types"),
      mode: compareRates(byMode, "high-loss share", "charging types"),
      stations: stationText,
    },
    filters: {
      chargingModes: [...new Set(sessions.map((s) => s.chargingMode).filter((m): m is string => Boolean(m)))].sort(),
      areas: [...new Set(sessions.map((s) => s.area).filter((a): a is string => Boolean(a)))].sort(),
    },
  };
}

/** CSV of station rows (RFC 4180 quoting). */
export function performanceCsv(p: Performance): string {
  const header = [
    "station",
    "sessions",
    "first_session",
    "last_session",
    "energy_kwh_derived",
    "avg_session_min",
    "avg_charging_power_kw",
    "median_power_loss_kw",
    "median_loss_share",
    "high_loss_sessions",
    "labelled_sessions",
    "high_loss_share",
    "poor_stability_share",
    "loss_exceeds_consumed_sessions",
    "energy_exceeds_battery_sessions",
  ];
  const q = (v: string | number | null) => {
    if (v === null) return "";
    const s = typeof v === "number" ? String(Math.round(v * 10000) / 10000) : v;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = p.stations.map((r) => {
    const s = r.summary;
    return [
      r.label,
      s.sessions,
      s.firstAt,
      s.lastAt,
      s.energyKwh,
      s.avgDurationMin,
      s.avgChargingPowerKw,
      s.medianPowerLossKw,
      s.medianLossShare,
      s.highLoss.count,
      s.highLoss.of,
      s.highLoss.rate,
      s.poorStability.rate,
      s.lossExceedsConsumed.count,
      s.energyExceedsBattery.count,
    ]
      .map(q)
      .join(",");
  });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
