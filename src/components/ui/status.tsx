import {
  HEALTH_LABELS,
  HEALTH_SHORT_LABELS,
  OPERATIONAL_LABELS,
  PROVENANCE_DESCRIPTIONS,
  type AlertSeverity,
  type AlertStatus,
  type HealthStatus,
  type OperationalStatus,
  type Provenance,
} from "@/config/domain";
import { cn } from "@/lib/utils/cn";

const HEALTH_STYLE: Record<HealthStatus, { fg: string; bg: string }> = {
  normal: { fg: "text-ok", bg: "bg-ok-soft" },
  monitor: { fg: "text-watch", bg: "bg-watch-soft" },
  inspection_recommended: { fg: "text-inspect", bg: "bg-inspect-soft" },
  insufficient_data: { fg: "text-unknown", bg: "bg-unknown-soft hatch" },
};

export const HEALTH_HEX_VAR: Record<HealthStatus, string> = {
  normal: "var(--ok)",
  monitor: "var(--watch)",
  inspection_recommended: "var(--inspect)",
  insufficient_data: "var(--unknown)",
};

/** Each status has its own shape so meaning never depends on colour alone. */
export function HealthGlyph({ status, className }: { status: HealthStatus; className?: string }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true, className: cn("shrink-0", className) };
  switch (status) {
    case "normal":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill="currentColor" />
          <path d="M4.2 7.2l1.9 1.9 3.8-4" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "monitor":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 1.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor" />
        </svg>
      );
    case "inspection_recommended":
      return (
        <svg {...common}>
          <path d="M7 .6l6.4 6.4L7 13.4.6 7z" fill="currentColor" />
          <path d="M7 3.9v3.6" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="9.9" r=".95" fill="var(--surface)" />
        </svg>
      );
    case "insufficient_data":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 2" />
          <path d="M4.5 7h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
  }
}

export function HealthBadge({ status, short = false, className }: { status: HealthStatus; short?: boolean; className?: string }) {
  const s = HEALTH_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap",
        s.fg,
        s.bg,
        className,
      )}
      title={HEALTH_LABELS[status]}
    >
      <HealthGlyph status={status} />
      <span className="text-ink/90 dark:text-ink">{short ? HEALTH_SHORT_LABELS[status] : HEALTH_LABELS[status]}</span>
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <HealthBadge status={severity} />;
}

const OP_DOT: Record<OperationalStatus, string> = {
  available: "bg-ok",
  in_use: "bg-signal",
  offline: "bg-inspect",
  unknown: "bg-faint",
};

export function OperationalBadge({ status }: { status: OperationalStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap text-muted">
      <span
        aria-hidden
        className={cn(
          "inline-block h-2 w-2",
          OP_DOT[status],
          status === "offline" ? "rotate-45 rounded-[1px]" : status === "unknown" ? "rounded-full opacity-60" : "rounded-full",
        )}
      />
      {OPERATIONAL_LABELS[status]}
    </span>
  );
}

const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function AlertStatusTag({ status }: { status: AlertStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-fit shrink-0 items-center rounded border px-1.5 py-px text-xs font-medium",
        status === "open" && "border-ink/40 text-ink",
        status === "acknowledged" && "border-signal/50 text-signal",
        (status === "resolved" || status === "dismissed") && "border-line text-muted",
      )}
    >
      {ALERT_STATUS_LABEL[status]}
    </span>
  );
}

export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-xs",
        provenance === "simulated" ? "border-dashed border-watch/60 text-watch" : "border-line text-muted",
      )}
      title={PROVENANCE_DESCRIPTIONS[provenance]}
    >
      {provenance === "simulated" ? "Generated" : provenance}
    </span>
  );
}

export function SyntheticTag() {
  return (
    <span
      className="inline-flex items-center rounded border border-dashed border-watch/60 px-1.5 py-px text-xs text-watch"
      title="Development record — not live operational data"
    >
      Development
    </span>
  );
}
