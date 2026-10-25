import Link from "next/link";
import { HEALTH_LABELS, type HealthStatus } from "@/config/domain";
import { HealthGlyph } from "@/components/ui/status";
import { cn } from "@/lib/utils/cn";

const SEGMENT: Record<HealthStatus, string> = {
  inspection_recommended: "bg-inspect",
  monitor: "bg-watch",
  normal: "bg-ok",
  insufficient_data: "bg-unknown-soft hatch",
};
const TEXT: Record<HealthStatus, string> = {
  inspection_recommended: "text-inspect",
  monitor: "text-watch",
  normal: "text-ok",
  insufficient_data: "text-unknown",
};
const ORDER: HealthStatus[] = ["inspection_recommended", "monitor", "normal", "insufficient_data"];

export function HealthDistribution({ counts, total }: { counts: Record<HealthStatus, number>; total: number }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={ORDER.map((s) => `${HEALTH_LABELS[s]}: ${counts[s]}`).join(", ")}>
        {ORDER.map((s) =>
          counts[s] > 0 ? (
            <div key={s} className={cn("h-full border-r-2 border-surface last:border-r-0", SEGMENT[s])} style={{ width: `${(counts[s] / Math.max(total, 1)) * 100}%` }} />
          ) : null,
        )}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {ORDER.map((s) => (
          <li key={s}>
            <Link href={`/chargers?health=${s}`} className="group block rounded-md focus-visible:outline-offset-4">
              <span className={cn("flex items-center gap-1.5 text-sm", TEXT[s])}>
                <HealthGlyph status={s} />
                <span className="text-muted group-hover:text-ink">{HEALTH_LABELS[s]}</span>
              </span>
              <span className="num mt-0.5 block text-2xl font-medium text-ink">{counts[s]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
