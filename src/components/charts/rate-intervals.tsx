import { formatPercent } from "@/lib/utils/format";

export interface RateRow {
  label: string;
  rate: number | null;
  low: number | null;
  high: number | null;
  count: number;
  of: number;
}

/**
 * Dot-and-interval rows: each group's share with its 95 % interval, against the fleet share.
 * Every value is printed, so nothing depends on reading the geometry or on hover.
 */
export function RateIntervals({ rows, fleet, caption }: { rows: RateRow[]; fleet: number | null; caption: string }) {
  const max = Math.min(1, Math.max(0.1, ...rows.map((r) => r.high ?? 0), fleet ?? 0) * 1.1);
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(84px,140px)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-muted" title={r.label}>
              {r.label}
            </span>
            <span className="relative h-5 rounded bg-sunken" aria-hidden>
              {fleet !== null && <span className="absolute inset-y-0 w-px bg-ink-faint" style={{ left: x(fleet), background: "var(--ink-faint)" }} />}
              {r.rate !== null && r.low !== null && r.high !== null && (
                <>
                  <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-signal/35" style={{ left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})` }} />
                  <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-signal" style={{ left: x(r.rate) }} />
                </>
              )}
            </span>
            <span className="num w-36 text-right text-xs text-muted">
              {r.rate === null ? "no labels" : `${formatPercent(r.rate)} (${formatPercent(r.low!)}–${formatPercent(r.high!)}) n=${r.of}`}
            </span>
          </li>
        ))}
      </ul>
      {fleet !== null && <p className="mt-2 text-xs text-muted">Thin vertical line: fleet share {formatPercent(fleet)}. Bars: 95 % interval.</p>}
    </figure>
  );
}
