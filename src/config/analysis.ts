/**
 * Every tunable parameter of the connector-health analysis lives here so the rules
 * are documented in one place, shown verbatim on the Analytics page, and versioned.
 * Changing a value changes ANALYSIS_VERSION so stored results can be traced.
 */
export const ANALYSIS_PARAMS = {
  /** Minimum valid observations needed to establish a baseline for one metric. */
  minBaselinePoints: 6,
  /** The baseline is the earliest observations, at most this many. */
  maxBaselinePoints: 12,
  /** Minimum valid observations after the baseline before anything can be assessed. */
  minRecentPoints: 3,
  /** How many of the most recent observations are examined for persistence. */
  persistenceWindow: 5,
  /** How many of those must exceed the deviation threshold to count as persistent. */
  persistenceMinCount: 3,
  /** Robust z-score (median/MAD) above which a point can count as a deviation. */
  deviationZ: 3.5,
  /**
   * A deviating point must ALSO be at least this fraction above the baseline median,
   * so very precise instruments do not turn physically trivial changes into alerts.
   */
  minRelativeDeviation: 0.08,
  /**
   * If more than this fraction of the BASELINE readings already exceed the deviation
   * threshold, the baseline is too variable to define "abnormal" and no deviation alert
   * is raised (the trend rule still applies).
   */
  maxBaselineExceedFraction: 0.2,
  /** Sustained deviations at least this fraction above baseline escalate to "inspection recommended". */
  severeRelativeDeviation: 0.3,
  /** Recent window used for trend estimation (Theil–Sen slope). */
  trendWindow: 10,
  /** Minimum fraction of adverse pairwise slopes for a trend to count as consistent. */
  trendConsistency: 0.75,
  /** Minimum projected change across the trend window, relative to the baseline median. */
  trendMinRelativeChange: 0.15,
  /** The projected change must also exceed this many baseline scales (noise guard). */
  trendMinScaleMultiple: 3,
  /** Relative change across the window that escalates a trend to "inspection recommended". */
  trendSevereRelativeChange: 0.4,
  /** Fault evidence: look-back window in days. */
  faultWindowDays: 30,
  /** Total connector faults in the window that triggers "monitor" (if above baseline). */
  faultMonitorTotal: 3,
  /** Total connector faults in the window that triggers "inspection recommended". */
  faultInspectTotal: 8,
  /** Observations older than this (relative to analysis time) are stale. */
  staleAfterDays: 45,
  /** Observations timestamped further than this into the future are rejected. */
  futureToleranceMinutes: 10,

  /* ── Temperature correction (contact resistance and connector voltage drop) ── */
  /** Readings are restated at this contact temperature so summer and winter readings compare fairly. */
  temperatureReferenceC: 20,
  /**
   * Fractional resistance change per °C. 0.00393 is annealed copper's coefficient; contact
   * alloys are similar, so this is an approximation the operator can tune.
   */
  temperatureCoefficientPerC: 0.00393,
  /** Recorded contact temperatures outside this range are treated as errors, not corrected. */
  temperaturePlausibleC: [-40, 150] as readonly [number, number],

  /* ── Service-limit forecast ── */
  /** Most recent readings (after the latest maintenance) used for the forecast slope. */
  forecastWindow: 12,
  /** Fewer readings than this → no forecast. */
  forecastMinPoints: 6,
  /** Two-sided confidence level of the Theil–Sen slope interval that sets the date range. */
  forecastConfidence: 0.8,
  /** Default service limit when the operator has not set one: baseline median + this fraction. */
  forecastLimitRelative: 0.5,
  /** Forecasts further out than this are reported as "more than a year" rather than a date. */
  forecastHorizonDays: 365,
  /** A forecast whose earliest date is within this many days becomes an action item. */
  forecastActionDays: 30,

  /* ── Repair verification ── */
  /** Readings after a repair needed before "held" can be concluded. */
  repairVerifyMinReadings: 3,
  /** …spanning at least this many days. */
  repairVerifyMinDays: 14,
  /** A repair that removes at least this share of the excess over baseline counts as a partial improvement. */
  repairPartialFraction: 0.5,
} as const;

export const ANALYSIS_VERSION = "2026.10-3";

export type AnalysisParams = typeof ANALYSIS_PARAMS;
