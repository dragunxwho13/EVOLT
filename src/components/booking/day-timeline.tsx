import { BOOKING } from "@/config/booking";
import { formatBookingTime } from "@/features/booking/schedule";

interface Busy {
  start: string;
  end: string;
  bufferEnd: string;
}

/**
 * One IST day as a bar: booked sessions in solid colour, the buffer kept after each
 * one hatched, and the driver's chosen slot outlined. Purely visual; the slot buttons
 * carry the same information for screen readers.
 */
export function DayTimeline({ dayStart, busy, selected }: { dayStart: Date; busy: Busy[]; selected?: { start: Date; end: Date } | null }) {
  const span = 24 * 60 * 60_000;
  const pos = (iso: string | Date) => {
    const t = (typeof iso === "string" ? new Date(iso) : iso).getTime() - dayStart.getTime();
    return Math.min(100, Math.max(0, (t / span) * 100));
  };
  return (
    <div aria-hidden>
      <div className="relative h-7 overflow-hidden rounded-md border border-line bg-sunken">
        {busy.map((b) => (
          <div key={b.start}>
            <div className="absolute inset-y-0 bg-ink/70" style={{ left: `${pos(b.start)}%`, width: `${pos(b.end) - pos(b.start)}%` }} />
            <div
              className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--watch)_0_3px,transparent_3px_6px)] opacity-70"
              style={{ left: `${pos(b.end)}%`, width: `${pos(b.bufferEnd) - pos(b.end)}%` }}
            />
          </div>
        ))}
        {selected && (
          <div
            className="absolute inset-y-0 rounded-sm border-2 border-signal bg-signal/20"
            style={{ left: `${pos(selected.start)}%`, width: `${Math.max(0.6, pos(selected.end) - pos(selected.start))}%` }}
          />
        )}
      </div>
      <div className="num mt-1 flex justify-between text-[0.6875rem] text-faint">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h}>{h === 24 ? "24:00" : formatBookingTime(new Date(dayStart.getTime() + h * 3_600_000))}</span>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-ink/70" /> Booked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,var(--watch)_0_3px,transparent_3px_6px)]" /> {BOOKING.bufferMinutes}-min gap kept free
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm border-2 border-signal bg-signal/20" /> Your slot
        </span>
      </div>
    </div>
  );
}
