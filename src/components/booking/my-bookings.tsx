"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BOOKING } from "@/config/booking";
import { Button, ButtonLink, EmptyState, Field, Panel, inputClass } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import type { BookingView } from "@/features/booking/service";
import { ApiError, apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/utils/cn";
import { forgetCode, readSavedCodes, saveCode, type SavedCode } from "./saved-codes";

const STATE_LABEL: Record<BookingView["state"], string> = {
  upcoming: "Upcoming",
  in_progress: "In progress",
  finished: "Finished",
  cancelled: "Cancelled",
};
const STATE_TONE: Record<BookingView["state"], string> = {
  upcoming: "bg-signal-soft text-signal",
  in_progress: "bg-watch-soft text-ink",
  finished: "bg-sunken text-muted",
  cancelled: "bg-sunken text-muted line-through",
};

type Entry = { code: string; label: string; status: "loading" | "ok" | "missing" | "error"; bookings: BookingView[]; message?: string };

const post = <T,>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function MyBookings() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [code, setCode] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  async function load(saved: SavedCode[]) {
    const results = await Promise.all(
      saved.map(async (s): Promise<Entry> => {
        try {
          const d = await post<{ bookings: BookingView[] }>("/api/bookings/lookup", { code: s.code });
          return { code: s.code, label: s.label, status: "ok", bookings: d.bookings };
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return { code: s.code, label: s.label, status: "missing", bookings: [] };
          return { code: s.code, label: s.label, status: "error", bookings: [], message: e instanceof ApiError ? e.message : "Could not load." };
        }
      }),
    );
    setEntries(results);
  }

  useEffect(() => {
    let active = true;
    const saved = readSavedCodes();
    void Promise.resolve().then(() => {
      if (active) void load(saved);
    });
    return () => {
      active = false;
    };
  }, []);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setLooking(true);
    try {
      const d = await post<{ bookings: BookingView[] }>("/api/bookings/lookup", { code });
      const display = formatCode(code);
      saveCode(display, `${d.bookings[0].chargerCode} · ${d.bookings[0].window}`);
      setCode("");
      await load(readSavedCodes());
    } catch (err) {
      setLookupError(err instanceof ApiError ? (err.status === 404 ? "No booking has this code. Check it and try again." : err.message) : "Could not look up the code.");
    } finally {
      setLooking(false);
    }
  }

  async function cancel(entry: Entry, bookingId?: string) {
    try {
      const d = await post<{ bookings: BookingView[] }>("/api/bookings/cancel", { code: entry.code, ...(bookingId ? { bookingId } : {}) });
      setEntries((es) => es?.map((x) => (x.code === entry.code ? { ...x, status: "ok", bookings: d.bookings, message: undefined } : x)) ?? null);
    } catch (err) {
      setEntries((es) => es?.map((x) => (x.code === entry.code ? { ...x, message: err instanceof ApiError ? err.message : "Could not cancel." } : x)) ?? null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {entries === null ? (
          <p className="text-sm text-muted">Loading your bookings…</p>
        ) : entries.length === 0 ? (
          <EmptyState title="No bookings saved in this browser" action={<ButtonLink href="/driver" variant="primary">Find a charger to book</ButtonLink>}>
            Bookings you make here are remembered in this browser. Booked on another device? Enter its code on the right.
          </EmptyState>
        ) : (
          entries.map((e) => <EntryCard key={e.code} entry={e} onCancel={cancel} onForget={() => { forgetCode(e.code); setEntries((es) => es?.filter((x) => x.code !== e.code) ?? null); }} />)
        )}
      </div>
      <aside>
        <Panel title="Find a booking">
          <form onSubmit={lookup} className="space-y-3">
            <Field label="Booking code" htmlFor="mb-code" hint="e.g. EV-7KQ3P-9XMDA. Letters and dashes can be typed any way.">
              <input id="mb-code" className={cn(inputClass, "num uppercase")} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            {lookupError && (
              <p role="alert" className="text-sm text-inspect">
                {lookupError}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={looking || code.trim().length < 10}>
              <Search className="h-4 w-4" aria-hidden /> {looking ? "Looking…" : "Look up"}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted">
            Anyone with the code can view or cancel the booking, so share it only with people you trust. EVOLT stores the code only in a form it cannot read back.
          </p>
        </Panel>
      </aside>
    </div>
  );
}

function formatCode(raw: string): string {
  let c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length === 12 && c.startsWith("EV")) c = c.slice(2);
  return `EV-${c.slice(0, 5)}-${c.slice(5)}`;
}

function EntryCard({ entry, onCancel, onForget }: { entry: Entry; onCancel: (e: Entry, id?: string) => void; onForget: () => void }) {
  const upcoming = entry.bookings.filter((b) => b.cancellable);
  return (
    <Panel
      title={<span className="num tracking-[0.04em]">{entry.code}</span>}
      description={entry.label}
      actions={
        <Button variant="ghost" size="sm" onClick={onForget}>
          Remove from this browser
        </Button>
      }
      flush
    >
      {entry.status === "loading" && <p className="px-5 py-4 text-sm text-muted">Loading…</p>}
      {entry.status === "missing" && <p className="px-5 py-4 text-sm text-muted">This booking no longer exists (the charger or station was removed).</p>}
      {entry.status === "error" && <p className="px-5 py-4 text-sm text-inspect">{entry.message}</p>}
      {entry.status === "ok" && (
        <>
          <ul className="divide-y divide-line">
            {entry.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="num font-medium">{b.window}</p>
                  <p className="text-sm text-muted">
                    {b.vehicleLabel ? `${b.vehicleLabel} · ` : ""}
                    <Link className="underline-offset-4 hover:underline" href={`/driver/stations/${b.stationId}`}>
                      {b.chargerCode} at {b.stationName}
                    </Link>{" "}
                    {b.isDemo && <DemoTag />}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATE_TONE[b.state])}>{STATE_LABEL[b.state]}</span>
                  {b.cancellable && entry.bookings.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => onCancel(entry, b.id)}>
                      Cancel
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 sm:px-5">
            {upcoming.length > 0 ? (
              <Button variant="danger" size="sm" onClick={() => onCancel(entry)}>
                {upcoming.length === 1 ? "Cancel booking" : `Cancel all ${upcoming.length} upcoming`}
              </Button>
            ) : (
              <span className="text-sm text-muted">Nothing left to cancel.</span>
            )}
            {entry.message && (
              <span role="alert" className="text-sm text-inspect">
                {entry.message}
              </span>
            )}
            <span className="ml-auto text-xs text-faint">Slot held {BOOKING.graceMinutes} min after the start time.</span>
          </div>
        </>
      )}
    </Panel>
  );
}
