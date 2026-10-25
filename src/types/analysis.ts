import type { AlertRule, AlertSeverity, HealthStatus, MetricKey } from "@/config/domain";

export interface ObservationInput {
  observedAt: Date;
  value: number;
}

export interface PointEvidence {
  at: string;
  value: number;
  /** Robust z-score against the baseline, when a baseline exists. */
  z?: number;
}

export interface BaselineSummary {
  median: number;
  /** Robust scale: 1.4826 × MAD, floored by the metric's minimum scale. */
  scale: number;
  n: number;
  from: string;
  to: string;
}

export type AlertEvidence =
  | {
      kind: "persistent_deviation";
      unit: string;
      baseline: BaselineSummary;
      thresholdZ: number;
      thresholdValue: number;
      windowSize: number;
      exceedCount: number;
      requiredCount: number;
      maxZ: number;
      points: PointEvidence[];
    }
  | {
      kind: "sustained_trend";
      unit: string;
      baseline: BaselineSummary;
      slopePerDay: number;
      consistency: number;
      requiredConsistency: number;
      relativeChange: number;
      requiredRelativeChange: number;
      points: PointEvidence[];
    }
  | {
      kind: "fault_recurrence";
      unit: string;
      windowDays: number;
      total: number;
      monitorThreshold: number;
      inspectThreshold: number;
      baselineTotal: number | null;
      points: PointEvidence[];
    };

export interface Finding {
  metric: MetricKey;
  rule: AlertRule;
  severity: AlertSeverity;
  windowStart: string;
  windowEnd: string;
  evidence: AlertEvidence;
  explanation: string;
  confidenceNote: string;
  suggestedAction: string;
}

export type QualityFlagCode =
  | "implausible_value"
  | "non_finite_value"
  | "future_timestamp"
  | "duplicate_timestamp"
  | "stale"
  | "insufficient_history"
  | "irregular_sampling"
  | "non_canonical_provenance";

export interface QualityFlag {
  code: QualityFlagCode;
  message: string;
  count?: number;
}

export interface MetricAssessment {
  metric: MetricKey;
  status: HealthStatus;
  validPoints: number;
  excludedPoints: number;
  latest: PointEvidence | null;
  baseline: BaselineSummary | null;
  /** Median spacing between observations, in days. */
  medianIntervalDays: number | null;
  findings: Finding[];
  qualityFlags: QualityFlag[];
  /** Plain-language statements of what was (and was not) found. */
  notes: string[];
}

export interface ChargerHealthSummary {
  status: HealthStatus;
  evaluatedAt: string;
  /** The point in time the assessment describes (the newest reading when historical). */
  assessedAsOf?: string;
  /** True when nothing recent exists and the assessment describes past data. */
  historical?: boolean;
  analysisVersion: string;
  latestObservationAt: string | null;
  stale: boolean;
  reasons: string[];
  coverageNote: string;
  nextAction: string;
  metrics: MetricAssessment[];
}

export interface ImportRowIssue {
  /** 1-based data row number (header excluded). */
  row: number;
  kind: "rejected" | "duplicate" | "skipped";
  field?: string;
  message: string;
}
