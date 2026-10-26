/**
 * Company action items. Each item is produced by an explicit rule over stored records and
 * carries the evidence, the rule that fired, why it matters, the next step, a priority and —
 * where relevant — a data-quality qualification. No rule asserts a root cause: an abnormal
 * pattern is a reason to investigate, not proof of a hardware fault.
 */
import { ALERT_RULE_LABELS, METRICS, type AlertRule, type AlertSeverity, type AlertStatus, type HealthStatus, type MetricKey } from "@/config/domain";
import { ANALYSIS_PARAMS } from "@/config/analysis";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils/format";
import type { ChargerHealthSummary } from "@/types/analysis";
import { bonferroniZ, dailySeries, groupBy, summarizeSessions, wilson, type NormalizedSession, type SessionSummary } from "@/features/sessions/metrics";

export type Priority = "high" | "medium" | "low";
export type InsightCategory = "connector_health" | "energy_loss" | "supply_quality" | "data_quality" | "demand" | "coverage";

export const PRIORITY_CRITERIA: Record<Priority, string> = {
  high:
    "A connector-health analysis currently recommends inspection (persistent deviation, sustained trend or recurring faults), or a connector is forecast to reach its service limit within 14 days (or is already above it).",
  medium:
    "A connector forecast to reach its service limit within 30 days, a connector-health pattern to monitor, a station whose high-loss or poor-stability share is statistically above the fleet, or inconsistent records in at least 5 % of a station's sessions.",
  low: "Data gaps, historical-only evidence, low demand relative to other stations, isolated inconsistent records, or an alert whose pattern is no longer detected.",
};

export const CATEGORY_LABELS: Record<InsightCategory, string> = {
  connector_health: "Connector health",
  energy_loss: "Energy loss",
  supply_quality: "Supply quality",
  data_quality: "Data quality",
  demand: "Demand",
  coverage: "Evidence coverage",
};

export interface InsightSubject {
  kind: "charger" | "station" | "fleet";
  id?: string;
  label: string;
  href?: string;
}

export interface Insight {
  key: string;
  category: InsightCategory;
  priority: Priority;
  subject: InsightSubject;
  headline: string;
  /** Key figure and its comparison, for the card. */
  metric?: { label: string; value: string; comparison?: string };
  evidence: string[];
  rule: string;
  whyItMatters: string;
  action: string;
  qualification?: string;
  /** Small trend for the card (e.g. daily share); values are fractions or raw numbers. */
  trend?: { label: string; values: (number | null)[] };
  source: "health_alert" | "dataset";
  alertId?: string;
  alertStatus?: AlertStatus;
  /** Fingerprint of the evidence, so a review can be flagged when the evidence changes. */
  digest: string;
}

export interface AlertInput {
  id: string;
  chargerId: string;
  chargerCode: string;
  stationName: string;
  isDemo: boolean;
  metric: MetricKey;
  rule: AlertRule;
  severity: AlertSeverity;
  status: AlertStatus;
  explanation: string;
  confidenceNote: string;
  suggestedAction: string;
  conditionActive: boolean;
  windowStart: Date;
  windowEnd: Date;
  occurrences: number;
}

export interface ChargerInput {
  id: string;
  code: string;
  stationName: string;
  isDemo: boolean;
  healthStatus: HealthStatus;
  lastObservationAt: Date | null;
  historical: boolean;
}

export interface ForecastChargerInput {
  id: string;
  code: string;
  stationName: string;
  isDemo: boolean;
  summary: ChargerHealthSummary | null;
}

const DAY = 86_400_000;

/**
 * Service-limit forecasts become action items when the earliest likely date is close. The
 * forecast itself is computed by the health analysis; this rule only decides what is urgent.
 */
export function forecastInsights(chargers: readonly ForecastChargerInput[], now: Date): Insight[] {
  const out: Insight[] = [];
  for (const c of chargers) {
    if (!c.summary || c.summary.historical) continue;
    for (const m of c.summary.metrics) {
      const f = m.forecast;
      if (!f || (f.status !== "projected" && f.status !== "already_above")) continue;
      const label = METRICS[m.metric].label;
      const subject = { kind: "charger" as const, id: c.id, label: `${c.code} · ${c.stationName}${c.isDemo ? " (demo)" : ""}`, href: `/company/chargers/${c.id}` };
      const limitText = `${formatNumber(f.limit, 3)} ${f.unit} (${f.limitSource === "operator" ? "operator-set" : "default: baseline + 50%"})`;
      if (f.status === "already_above") {
        out.push({
          key: `forecast:${c.id}:${m.metric}`,
          category: "connector_health",
          priority: "high",
          subject,
          headline: `${label} is already at its service limit`,
          metric: { label: "Current level", value: `${formatNumber(f.currentLevel ?? 0, 3)} ${f.unit}`, comparison: `limit ${limitText}` },
          evidence: [f.explanation],
          rule: "Median of the three latest readings ≥ service limit.",
          whyItMatters: "The connector has passed the level at which it was meant to be serviced; heating and failed sessions become more likely.",
          action: "Service the connector now, record the work on the charger page, and take a new reading to confirm the fix.",
          source: "dataset",
          digest: digestOf(["above", f.currentLevel, f.limit]),
        });
        continue;
      }
      if (!f.earliestDate) continue;
      const daysToEarliest = (new Date(f.earliestDate).getTime() - now.getTime()) / DAY;
      if (daysToEarliest > ANALYSIS_PARAMS.forecastActionDays) continue;
      const expectedDays = f.expectedDate ? (new Date(f.expectedDate).getTime() - now.getTime()) / DAY : null;
      const priority: Priority = expectedDays !== null && expectedDays <= 14 ? "high" : "medium";
      out.push({
        key: `forecast:${c.id}:${m.metric}`,
        category: "connector_health",
        priority,
        subject,
        headline: `${label} forecast to reach its service limit ${f.expectedDate ? `around ${formatDate(f.expectedDate)}` : `from ${formatDate(f.earliestDate)}`}`,
        metric: {
          label: "Likely date",
          value: f.expectedDate ? formatDate(f.expectedDate) : `after ${formatDate(f.earliestDate)}`,
          comparison: `${formatPercent(f.confidence)} range ${formatDate(f.earliestDate)} – ${f.latestDate ? formatDate(f.latestDate) : "later"}`,
        },
        evidence: [f.explanation],
        rule: `Theil–Sen rate over the latest readings, Sen ${formatPercent(f.confidence)} interval entirely above zero, earliest date within ${ANALYSIS_PARAMS.forecastActionDays} days.`,
        whyItMatters: "Servicing before the limit avoids the heating, derating and failed sessions that follow it, and lets the visit be planned rather than urgent.",
        action: `Plan a service visit before ${formatDate(f.earliestDate)}; record the work on the charger page so EVOLT can check it held.`,
        qualification: f.extrapolated ? "The date is further ahead than the readings cover, so treat it as indicative." : undefined,
        source: "dataset",
        digest: digestOf(["projected", f.expectedDate?.slice(0, 10) ?? null, f.earliestDate.slice(0, 10), f.limit]),
      });
    }
  }
  return out;
}

/** Thresholds for the dataset rules, in one place so the UI can state them. */
export const INSIGHT_PARAMS = {
  minSessionsForRate: 20,
  minRateExcess: 0.1,
  inconsistentShareMedium: 0.05,
  energyOverBatteryMedium: 0.1,
  /** z below which a station's session count is "unusually low" (one-sided, ≈1 %). */
  lowDemandZ: -2.33,
  minStationsForDemand: 5,
  modePowerMinRelativeGap: 0.1,
} as const;

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function digestOf(parts: (string | number | null)[]): string {
  return parts.map((p) => (typeof p === "number" ? p.toFixed(4) : String(p))).join("|");
}

function period(s: SessionSummary): string {
  return `${formatDate(s.firstAt)} – ${formatDate(s.lastAt)}`;
}

function pct(v: number | null, d = 0): string {
  return v === null ? "—" : formatPercent(v, d);
}

/** Connector-health alerts become action items; workflow status lives on the alert itself. */
export function alertInsights(alerts: readonly AlertInput[]): Insight[] {
  return alerts
    .filter((a) => a.status === "open" || a.status === "acknowledged")
    .map((a) => {
      const high = a.severity === "inspection_recommended" && a.conditionActive;
      const priority: Priority = !a.conditionActive ? "low" : high ? "high" : "medium";
      return {
        key: `alert:${a.id}`,
        category: "connector_health" as const,
        priority,
        subject: { kind: "charger" as const, id: a.chargerId, label: `${a.chargerCode} · ${a.stationName}${a.isDemo ? " (demo)" : ""}`, href: `/company/chargers/${a.chargerId}` },
        headline: a.conditionActive
          ? `${ALERT_RULE_LABELS[a.rule]} in ${METRICS[a.metric].label.toLowerCase()}`
          : `No longer detected: ${ALERT_RULE_LABELS[a.rule].toLowerCase()} in ${METRICS[a.metric].label.toLowerCase()}`,
        evidence: [
          a.explanation,
          `Evidence window ${formatDate(a.windowStart)} – ${formatDate(a.windowEnd)}; seen in ${a.occurrences} analysis run(s).`,
          a.conditionActive ? "The latest analysis still finds this pattern." : "The latest analysis no longer finds this pattern.",
        ],
        rule: `Connector-health rule “${ALERT_RULE_LABELS[a.rule]}” (see Analysis method for thresholds).`,
        whyItMatters: high
          ? "Rising resistance, voltage drop or repeated faults in the charging path can lead to heating and failed sessions if left unchecked."
          : "The pattern is not yet strong enough to call for inspection, but it is the kind that can precede one.",
        action: a.conditionActive
          ? a.suggestedAction
          : "The latest analysis no longer finds this pattern. Confirm on the alert page, then resolve or dismiss it so it stops appearing.",
        qualification: a.confidenceNote,
        source: "health_alert" as const,
        alertId: a.id,
        alertStatus: a.status,
        digest: digestOf([a.severity, a.occurrences, a.windowEnd.toISOString(), a.conditionActive ? 1 : 0]),
      };
    });
}

/** Health evidence coverage: chargers with too little data, and assessments based only on old data. */
export function coverageInsights(chargers: readonly ChargerInput[]): Insight[] {
  const out: Insight[] = [];
  const insufficient = chargers.filter((c) => c.healthStatus === "insufficient_data");
  if (insufficient.length > 0) {
    out.push({
      key: "coverage:insufficient",
      category: "coverage",
      priority: "low",
      subject: { kind: "fleet", label: `${insufficient.length} charger${insufficient.length === 1 ? "" : "s"}`, href: "/company/chargers?health=insufficient_data" },
      headline: `${insufficient.length} of ${chargers.length} chargers have too little health data to assess`,
      metric: { label: "Not assessable", value: String(insufficient.length), comparison: `of ${chargers.length} chargers` },
      evidence: [
        `Examples: ${insufficient.slice(0, 5).map((c) => c.code).join(", ")}${insufficient.length > 5 ? ", …" : ""}.`,
        "A charger needs at least 6 baseline readings and 3 recent readings of a primary metric to be assessed.",
      ],
      rule: "Health status is “Insufficient data” (missing data is never treated as healthy).",
      whyItMatters: "Problems on these chargers would go unnoticed: no evidence is not the same as no fault.",
      action: "Schedule regular contact-resistance or voltage-drop readings for these chargers, then import them.",
      source: "dataset",
      digest: digestOf([insufficient.length, chargers.length]),
    });
  }
  const historical = chargers.filter((c) => c.historical);
  if (historical.length > 0) {
    const newest = historical.reduce<Date | null>((m, c) => (c.lastObservationAt && (!m || c.lastObservationAt > m) ? c.lastObservationAt : m), null);
    out.push({
      key: "coverage:historical",
      category: "coverage",
      priority: "low",
      subject: { kind: "fleet", label: `${historical.length} charger${historical.length === 1 ? "" : "s"}` },
      headline: `${historical.length} chargers are assessed on historical data only`,
      metric: { label: "Newest reading", value: newest ? formatDate(newest) : "—" },
      evidence: [`Their newest reading is more than 45 days old (latest: ${newest ? formatDate(newest) : "unknown"}).`],
      rule: "Newest valid reading older than 45 days → assessment labelled historical.",
      whyItMatters: "A historical assessment describes the connector at that time, not today.",
      action: "Import recent measurements for these chargers before making maintenance decisions about them.",
      source: "dataset",
      digest: digestOf([historical.length, newest?.toISOString() ?? null]),
    });
  }
  return out;
}

interface StationGroup {
  stationId: string;
  stationCode: string;
  stationName: string;
  sessions: NormalizedSession[];
  summary: SessionSummary;
}

function stationGroups(sessions: readonly NormalizedSession[]): StationGroup[] {
  return [...groupBy(sessions, (s) => s.stationId).values()].map((list) => ({
    stationId: list[0]!.stationId,
    stationCode: list[0]!.stationCode,
    stationName: list[0]!.stationName,
    sessions: list,
    summary: summarizeSessions(list),
  }));
}

function elevatedRateInsights(
  groups: readonly StationGroup[],
  fleet: SessionSummary,
  pick: (s: SessionSummary) => SessionSummary["highLoss"],
  cfg: {
    keyPrefix: string;
    category: InsightCategory;
    noun: string;
    why: string;
    action: string;
    daily: (s: NormalizedSession) => boolean | null;
  },
): Insight[] {
  const fleetRate = pick(fleet);
  if (fleetRate.rate === null) return [];
  const out: Insight[] = [];
  const tested = groups.filter((g) => pick(g.summary).of >= INSIGHT_PARAMS.minSessionsForRate).length;
  const z = bonferroniZ(tested);
  for (const g of groups) {
    const r = pick(g.summary);
    if (r.rate === null || r.of < INSIGHT_PARAMS.minSessionsForRate) continue;
    const adjusted = wilson(r.count, r.of, z);
    if (!(adjusted.low > fleetRate.rate && r.rate - fleetRate.rate >= INSIGHT_PARAMS.minRateExcess)) continue;
    const days = [...groupBy(g.sessions, (s) => s.startedAt.toISOString().slice(0, 10)).entries()].sort(([a], [b]) => a.localeCompare(b));
    out.push({
      key: `${cfg.keyPrefix}:${g.stationId}`,
      category: cfg.category,
      priority: "medium",
      subject: { kind: "station", id: g.stationId, label: g.stationName, href: `/company/stations/${g.stationId}` },
      headline: `${g.stationName} has a higher share of ${cfg.noun} sessions than the fleet`,
      metric: { label: `${cfg.noun[0]!.toUpperCase()}${cfg.noun.slice(1)} share`, value: pct(r.rate), comparison: `fleet ${pct(fleetRate.rate)}` },
      evidence: [
        `${r.count} of ${r.of} labelled sessions (${pct(r.rate)}; adjusted interval ${pct(adjusted.low)}–${pct(adjusted.high)}) versus ${fleetRate.count} of ${fleetRate.of} across the fleet (${pct(fleetRate.rate)}).`,
        `Period: ${period(g.summary)}.`,
      ],
      rule: `The station's share is at least ${formatPercent(INSIGHT_PARAMS.minRateExcess)} points above the fleet and the lower end of its interval is still above the fleet share. The interval is a 95 % Wilson interval widened (Bonferroni) for testing ${tested} stations at once, so a station is not flagged by chance alone. Minimum ${INSIGHT_PARAMS.minSessionsForRate} labelled sessions.`,
      whyItMatters: cfg.why,
      action: cfg.action,
      qualification: "Labels come from the dataset. The difference is statistically clear, but it does not identify a cause.",
      trend: {
        label: `Daily ${cfg.noun} share`,
        values: days.map(([, list]) => {
          const flags = list.map(cfg.daily).filter((v): v is boolean => v !== null);
          return flags.length ? flags.filter(Boolean).length / flags.length : null;
        }),
      },
      source: "dataset",
      digest: digestOf([r.count, r.of, fleetRate.count, fleetRate.of]),
    });
  }
  return out;
}

/** Insights computed from stored charging sessions. */
export function sessionInsights(sessions: readonly NormalizedSession[]): Insight[] {
  if (sessions.length === 0) return [];
  const fleet = summarizeSessions(sessions);
  const groups = stationGroups(sessions);
  const out: Insight[] = [];

  out.push(
    ...elevatedRateInsights(groups, fleet, (s) => s.highLoss, {
      keyPrefix: "high-loss",
      category: "energy_loss",
      noun: "high-loss",
      why: "Power lost between supply and vehicle is energy paid for but not delivered. A persistent excess can point to extra resistance in cables, contacts or power electronics — or to a metering problem.",
      action: "Compare this station's loss readings by charger and charging type, check meter calibration, then inspect cabling and contacts on the chargers that contribute most.",
      daily: (s) => (s.lossCategory === null ? null : s.lossCategory.toLowerCase() === "high"),
    }),
    ...elevatedRateInsights(groups, fleet, (s) => s.poorStability, {
      keyPrefix: "poor-stability",
      category: "supply_quality",
      noun: "poor-stability",
      why: "Unstable supply voltage can slow or interrupt charging and stress equipment. It usually originates upstream of the charger.",
      action: "Review this station's supply-voltage logs with the site's electrical contractor or grid operator before replacing charger hardware.",
      daily: (s) => (s.stabilityCategory === null ? null : s.stabilityCategory.toLowerCase() === "poor"),
    }),
  );

  // Records that cannot both be true: more power lost than consumed.
  const inconsistent = groups.filter((g) => g.summary.lossExceedsConsumed.count > 0);
  const minor: StationGroup[] = [];
  for (const g of inconsistent) {
    const r = g.summary.lossExceedsConsumed;
    if (r.rate === null || r.rate < INSIGHT_PARAMS.inconsistentShareMedium) {
      minor.push(g);
      continue;
    }
    out.push({
      key: `loss-exceeds-consumed:${g.stationId}`,
      category: "data_quality",
      priority: "medium",
      subject: { kind: "station", id: g.stationId, label: g.stationName, href: `/company/stations/${g.stationId}` },
      headline: `${g.stationName}: ${r.count} sessions report more power lost than consumed`,
      metric: { label: "Inconsistent sessions", value: `${r.count} / ${r.of}`, comparison: pct(r.rate, 1) },
      evidence: [
        `${r.count} of ${r.of} sessions have power loss greater than power consumed, which cannot happen in a correct measurement.`,
        `Period: ${period(g.summary)}.`,
      ],
      rule: `Sessions with power_loss > power_consumed make up at least ${formatPercent(INSIGHT_PARAMS.inconsistentShareMedium)} of the station's sessions.`,
      whyItMatters: "Loss figures from this station cannot be trusted until the cause is found, so loss-based findings here may be wrong.",
      action: "Check meter calibration and the data export for this station; correct or exclude the affected sessions and re-import.",
      source: "dataset",
      digest: digestOf([r.count, r.of]),
    });
  }
  if (minor.length > 0) {
    const total = minor.reduce((a, g) => a + g.summary.lossExceedsConsumed.count, 0);
    out.push({
      key: "loss-exceeds-consumed:minor",
      category: "data_quality",
      priority: "low",
      subject: { kind: "fleet", label: `${minor.length} station${minor.length === 1 ? "" : "s"}` },
      headline: `${total} isolated session${total === 1 ? "" : "s"} report more power lost than consumed`,
      metric: { label: "Stations affected", value: String(minor.length) },
      evidence: [
        minor
          .sort((a, b) => b.summary.lossExceedsConsumed.count - a.summary.lossExceedsConsumed.count)
          .map((g) => `${g.stationName}: ${g.summary.lossExceedsConsumed.count} of ${g.summary.lossExceedsConsumed.of}`)
          .join("; ") + ".",
      ],
      rule: `Stations where fewer than ${formatPercent(INSIGHT_PARAMS.inconsistentShareMedium)} of sessions have power_loss > power_consumed.`,
      whyItMatters: "Individually small, but every such record is a measurement that cannot be correct.",
      action: "Ask the data provider how power loss and power consumed are measured, and exclude these sessions from loss reporting until resolved.",
      source: "dataset",
      digest: digestOf([minor.length, total]),
    });
  }

  // Energy that exceeds the vehicle battery (fleet-wide check of units/fields).
  const eb = fleet.energyExceedsBattery;
  if (eb.count > 0 && eb.rate !== null) {
    out.push({
      key: "energy-exceeds-battery:fleet",
      category: "data_quality",
      priority: eb.rate >= INSIGHT_PARAMS.energyOverBatteryMedium ? "medium" : "low",
      subject: { kind: "fleet", label: "All stations" },
      headline: `${pct(eb.rate)} of sessions deliver more energy than the vehicle's battery can hold`,
      metric: { label: "Affected sessions", value: `${eb.count} / ${eb.of}`, comparison: pct(eb.rate, 1) },
      evidence: [
        `Energy is derived as charging power × charging time (minutes assumed). ${eb.count} of ${eb.of} sessions exceed the recorded battery capacity.`,
        `Period: ${period(fleet)}.`,
      ],
      rule: `Derived energy (kWh) > battery capacity (kWh); medium priority when at least ${formatPercent(INSIGHT_PARAMS.energyOverBatteryMedium)} of sessions are affected.`,
      whyItMatters: "Energy, utilisation and revenue figures built on these fields would be overstated.",
      action: "Confirm with the data provider whether charging time is in minutes and whether charging power is an average or a peak value.",
      qualification: "The energy figure is derived, not metered; the time unit is not stated in the file.",
      source: "dataset",
      digest: digestOf([eb.count, eb.of]),
    });
  }

  // Charging-type labels that do not differ in delivered power.
  const modes = [...groupBy(sessions.filter((s) => s.chargingMode && s.chargingPowerKw !== null), (s) => s.chargingMode!).entries()].map(([mode, list]) => ({
    mode,
    n: list.length,
    avg: list.reduce((a, s) => a + s.chargingPowerKw!, 0) / list.length,
  }));
  if (modes.length >= 2 && modes.every((m) => m.n >= INSIGHT_PARAMS.minSessionsForRate)) {
    const lo = Math.min(...modes.map((m) => m.avg));
    const hi = Math.max(...modes.map((m) => m.avg));
    if (lo > 0 && (hi - lo) / lo < INSIGHT_PARAMS.modePowerMinRelativeGap) {
      out.push({
        key: "mode-power-indistinct:fleet",
        category: "data_quality",
        priority: "low",
        subject: { kind: "fleet", label: "All stations" },
        headline: "Charging types do not differ in delivered power",
        metric: { label: "Average power by type", value: `${formatNumber(lo, 1)}–${formatNumber(hi, 1)} kW` },
        evidence: [modes.map((m) => `${m.mode}: ${formatNumber(m.avg, 1)} kW average over ${m.n} sessions`).join("; ") + "."],
        rule: `Largest gap between charging types' average power is under ${formatPercent(INSIGHT_PARAMS.modePowerMinRelativeGap)}.`,
        whyItMatters: "If “Fast” chargers deliver the same power as others, either the labels are wrong or fast chargers are being throttled — both matter for planning and for drivers.",
        action: "Check the charger-type labels against each charger's nameplate, and check for power limits on chargers labelled Fast.",
        source: "dataset",
        digest: digestOf(modes.flatMap((m) => [m.mode, m.avg, m.n])),
      });
    }
  }

  // Unusually low demand compared with the other stations (Poisson / normal approximation).
  if (groups.length >= INSIGHT_PARAMS.minStationsForDemand) {
    const counts = groups.map((g) => g.sessions.length);
    const meanCount = counts.reduce((a, b) => a + b, 0) / counts.length;
    for (const g of groups) {
      const z = (g.sessions.length - meanCount) / Math.sqrt(meanCount);
      if (z > INSIGHT_PARAMS.lowDemandZ) continue;
      out.push({
        key: `low-demand:${g.stationId}`,
        category: "demand",
        priority: "low",
        subject: { kind: "station", id: g.stationId, label: g.stationName, href: `/company/stations/${g.stationId}` },
        headline: `${g.stationName} has fewer sessions than other stations`,
        metric: { label: "Sessions", value: String(g.sessions.length), comparison: `station average ${formatNumber(meanCount, 1)}` },
        evidence: [`${g.sessions.length} sessions versus an average of ${formatNumber(meanCount, 1)} per station (z = ${formatNumber(z, 2)}).`, `Period: ${period(g.summary)}.`],
        rule: `Session count's z-score against the station average is at or below ${INSIGHT_PARAMS.lowDemandZ} (about a 1 % chance under equal demand).`,
        whyItMatters: "Low use can mean poor visibility, access problems or unreliable chargers — or simply lower local demand.",
        action: "Review demand, accessibility, opening hours and recent availability before changing capacity at this station.",
        qualification: "Session counts only; utilisation cannot be calculated because the number of chargers per station is not recorded consistently.",
        source: "dataset",
        digest: digestOf([g.sessions.length, meanCount]),
      });
    }
  }

  return out;
}

export function sortInsights(items: Insight[]): Insight[] {
  // Within a priority and category, confirmed health alerts come before forecasts and dataset findings.
  const sourceRank = (i: Insight) => (i.source === "health_alert" ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.category.localeCompare(b.category) ||
      sourceRank(a) - sourceRank(b) ||
      a.headline.localeCompare(b.headline),
  );
}

/** Daily series for the overview trend charts. */
export { dailySeries };
