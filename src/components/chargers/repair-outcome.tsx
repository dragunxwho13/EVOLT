import { cn } from "@/lib/utils/cn";
import { REPAIR_OUTCOME_LABELS, type RepairOutcome } from "@/features/connector-health/repair-verification";

const TONE: Record<RepairOutcome, string> = {
  held: "border-ok/40 text-ok",
  relapsed: "border-inspect/50 text-inspect",
  partial: "border-watch/50 text-watch",
  no_effect: "border-inspect/50 text-inspect",
  restored_pending: "border-signal/40 text-signal",
  awaiting_measurement: "border-line text-muted",
};

export function RepairOutcomeTag({ outcome, className }: { outcome: RepairOutcome; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded border px-1.5 py-px text-xs font-medium whitespace-nowrap", TONE[outcome], className)}>
      {REPAIR_OUTCOME_LABELS[outcome]}
    </span>
  );
}
