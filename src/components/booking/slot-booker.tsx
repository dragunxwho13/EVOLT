"use client";

import { CalendarClock, Check, Clock3, ListOrdered } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BOOKING } from "@/config/booking";
import { CONNECTOR_LABELS } from "@/config/domain";
import { Button, ButtonLink, ErrorState, Field, Notice, Panel, inputClass } from "@/components/ui/primitives";
import { DemoTag } from "@/components/ui/status";
import { dayWindow, estimateChargeMinutes, formatBookingDate, formatBookingTime, formatBookingWindow } from "@/features/booking/schedule";
import type { Availability, BookableCharger, BookingCreated } from "@/features/booking/service";
import { ApiError, apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { DayTimeline } from "./day-timeline";
import { saveCode } from "./saved-codes";

export interface VehicleOption {
  code: string;
  name: string;
  maxDcPowerKw: number | null;
}

const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240];

type When = "queue" | "slot";
type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: T };

export function SlotBooker({ charger, vehicles }: { charger: BookableCharger; vehicles: VehicleOption[] }) {
  const [mode, setMode] = useState<"duration" | "estimate">("duration");
  const [duration, setDuration] = useState(60);
  const [battery, setBattery] = useState("");
  const [fromPct, setFromPct] = useState("20");
  const [toPct, setToPct] = useState("80");
  const [vehicleCode, setVehicleCode] = useState("");

  const [when, setWhen] = useState<When>("queue");
  const [date, setDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [avail, setAvail] = useState<Load<Availability>>({ state: "loading" });
  const [refresh, setRefresh] = useState(0);

  const [name, setName] = useState("");
  const [vehicleLabel, setVehicleLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: BookingCreated; saved: boolean } | null>(null);

  const vehicle = vehicles.find((v) => v.code === vehicleCode) ?? null;
  const estimate = useMemo(() => {
    if (mode !== "estimate") return null;
    return estimateChargeMinutes({
      batteryKwh: Number(battery),
      fromPct: Number(fromPct),
      toPct: Number(toPct),
      chargerKw: charger.ratedPowerKw,
      connectorType: charger.connectorType,
      vehicleMaxKw: vehicle?.maxDcPowerKw ?? null,
    });
  }, [mode, battery, fromPct, toPct, charger.ratedPowerKw, charger.connectorType, vehicle?.maxDcPowerKw]);
  const minutes = mode === "duration" ? duration : (estimate?.minutes ?? null);

  useEffect(() => {
    if (!charger.bookable || minutes === null) return;
    let cancelled = false;
    const params = new URLSearchParams({ chargerId: charger.id, duration: String(minutes) });
    if (date) params.set("date", date);
    apiFetch<Availability>(`/api/bookings/availability?${params}`)
      .then((data) => {
        if (cancelled) return;
        setAvail({ state: "ok", data });
        if (!date) setDate(data.date);
      })
      .catch((e: unknown) => !cancelled && setAvail({ state: "error", message: e instanceof ApiError ? e.message : "Availability could not be loaded." }));
    return () => {
      cancelled = true;
    };
  }, [charger.id, charger.bookable, minutes, date, refresh]);

  if (done) return <Confirmation result={done.result} saved={done.saved} />;

  if (!charger.bookable) {
    return (
      <ErrorState
        title="This charger is not taking bookings"
        message={charger.notBookableReason ?? "It cannot be booked right now."}
        action={<ButtonLink href={`/driver/stations/${charger.stationId}`}>Other chargers at this station</ButtonLink>}
      />
    );
  }

  const data = avail.state === "ok" ? avail.data : null;
  const dayStart = date ? dayWindow(date)?.start ?? null : null;
  const freeSlots = data?.slots.filter((s) => s.available) ?? [];
  const chosen = when === "queue" ? (data?.next ? { start: data.next.start, end: data.next.end } : null) : selected ? (freeSlots.find((s) => s.start === selected) ?? null) : null;
  const canSubmit = minutes !== null && chosen !== null && name.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit || minutes === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<BookingCreated>("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chargerId: charger.id,
          ...(when === "slot" && chosen ? { start: chosen.start } : {}),
          durationMinutes: minutes,
          driverName: name.trim(),
          vehicleLabel: vehicleLabel.trim() || undefined,
        }),
      });
      const b = result.bookings[0];
      const saved = saveCode(result.code, `${charger.code} · ${b.window}`);
      setDone({ result, saved });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The booking could not be made. Try again.");
      // Someone may have taken the slot: refresh what is free.
      if (e instanceof ApiError && e.status === 409) setRefresh((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Panel title="1 · How long will you charge?">
          <div className="mb-4 inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="How to set the length">
            {(
              [
                ["duration", "I know how long"],
                ["estimate", "Estimate from my battery"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={mode === k}
                onClick={() => setMode(k)}
                className={cn("rounded px-3 py-1.5 text-sm", mode === k ? "bg-ink font-medium text-surface" : "text-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "duration" ? (
            <Field label="Charging time" htmlFor="bk-duration">
              <select id="bk-duration" className={cn(inputClass, "max-w-xs")} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ""}`}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Battery size (kWh)" htmlFor="bk-battery">
                  <input id="bk-battery" inputMode="decimal" className={inputClass} placeholder="e.g. 40" value={battery} onChange={(e) => setBattery(e.target.value)} />
                </Field>
                <Field label="Charge now (%)" htmlFor="bk-from">
                  <input id="bk-from" inputMode="numeric" className={inputClass} value={fromPct} onChange={(e) => setFromPct(e.target.value)} />
                </Field>
                <Field label="Charge to (%)" htmlFor="bk-to">
                  <input id="bk-to" inputMode="numeric" className={inputClass} value={toPct} onChange={(e) => setToPct(e.target.value)} />
                </Field>
                <Field label="Vehicle (optional)" htmlFor="bk-vehicle">
                  <select id="bk-vehicle" className={inputClass} value={vehicleCode} onChange={(e) => setVehicleCode(e.target.value)}>
                    <option value="">Not listed</option>
                    {vehicles.map((v) => (
                      <option key={v.code} value={v.code}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {estimate ? (
                <p className="text-sm" data-testid="charge-estimate">
                  About <strong>{estimate.minutes} min</strong> to add {formatNumber(estimate.energyKwh, 1)} kWh at up to {formatNumber(estimate.powerKw, 0)} kW.{" "}
                  <span className="text-muted">Estimate: {estimate.assumptions.join(" ")}</span>
                </p>
              ) : (
                <p className="text-sm text-muted">
                  {charger.ratedPowerKw === null
                    ? "This charger's power is not recorded, so the time cannot be estimated. Choose a length instead."
                    : "Enter your battery size and a target above your current charge."}
                </p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="2 · When?" description={`Times are ${BOOKING.timeZoneLabel}. A ${BOOKING.bufferMinutes}-minute gap is kept free after every booking, so a late finish never runs into the next driver.`}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Booking type">
            <ChoiceCard active={when === "queue"} onClick={() => setWhen("queue")} icon={<ListOrdered className="h-4 w-4" aria-hidden />} title="Join the queue">
              {avail.state === "loading" ? (
                "Checking…"
              ) : data?.next ? (
                <>
                  Next free start <strong className="num text-ink">{formatBookingWindow(new Date(data.next.start), new Date(data.next.end))}</strong>
                  {" · "}
                  {data.next.sessionsAhead === 0 ? "no one ahead of you" : `${data.next.sessionsAhead} booked session${data.next.sessionsAhead === 1 ? "" : "s"} ahead`}
                </>
              ) : (
                "Nothing free within the booking window."
              )}
            </ChoiceCard>
            <ChoiceCard active={when === "slot"} onClick={() => setWhen("slot")} icon={<CalendarClock className="h-4 w-4" aria-hidden />} title="Pick a time">
              Up to {BOOKING.horizonDays} days ahead, on the quarter hour.
            </ChoiceCard>
          </div>

          {avail.state === "error" && (
            <div className="mt-4">
              <Notice tone="warn">{avail.message}</Notice>
            </div>
          )}

          {when === "slot" && data && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Day">
                {data.dates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={d === date}
                    onClick={() => setDate(d)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-sm",
                      d === date ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface text-ink hover:border-ink/50",
                    )}
                  >
                    {formatBookingDate(d)}
                  </button>
                ))}
              </div>
              {dayStart && <DayTimeline dayStart={dayStart} busy={data.busy} selected={chosen ? { start: new Date(chosen.start), end: new Date(chosen.end) } : null} />}
              {freeSlots.length === 0 ? (
                <p className="text-sm text-muted">No start time on this day fits {minutes} minutes. Try another day or a shorter charge.</p>
              ) : (
                <SlotGroups slots={freeSlots} selected={selected} onSelect={setSelected} />
              )}
            </div>
          )}
        </Panel>

        <Panel title="3 · Your details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name for the booking" htmlFor="bk-name" hint="Shown to no one else. No phone number or account needed.">
              <input id="bk-name" className={inputClass} maxLength={BOOKING.maxNameLength} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Vehicle (optional)" htmlFor="bk-vlabel" hint="e.g. Nexon EV, or a number plate">
              <input id="bk-vlabel" className={inputClass} maxLength={BOOKING.maxVehicleLabelLength} value={vehicleLabel} onChange={(e) => setVehicleLabel(e.target.value)} />
            </Field>
          </div>
        </Panel>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Panel title="Your booking">
          <dl className="space-y-2 text-sm">
            <Row k="Charger" v={`${charger.code} · ${CONNECTOR_LABELS[charger.connectorType]}`} />
            <Row k="Station" v={<>{charger.stationName} {charger.isDemo && <DemoTag />}</>} />
            <Row k="Power" v={charger.ratedPowerKw !== null ? `${formatNumber(charger.ratedPowerKw, 0)} kW rated` : "Not recorded"} />
            <Row k="Length" v={minutes !== null ? `${minutes} min` : "—"} />
            <Row k="Time" v={chosen ? <span className="num">{formatBookingWindow(new Date(chosen.start), new Date(chosen.end))}</span> : when === "slot" ? "Pick a start time" : "—"} />
          </dl>
          {error && (
            <p role="alert" className="mt-3 text-sm text-inspect">
              {error}
            </p>
          )}
          <Button variant="primary" className="mt-4 w-full" disabled={!canSubmit} onClick={submit}>
            {submitting ? "Booking…" : when === "queue" ? "Join the queue" : "Book this slot"}
          </Button>
          {!name.trim() && chosen && <p className="mt-2 text-xs text-faint">Add a name for the booking to continue.</p>}
          <p className="mt-3 text-xs text-muted">
            <Clock3 className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
            Arrive by your start time. The slot is held for {BOOKING.graceMinutes} minutes, then the next driver may use it.
          </p>
        </Panel>
        <p className="text-xs text-muted">
          Charging several vehicles?{" "}
          <Link className="font-medium text-signal underline-offset-4 hover:underline" href={`/driver/book/fleet?station=${charger.stationId}`}>
            Book them together
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}

const BANDS = [
  { label: "Morning", from: 6, to: 12 },
  { label: "Afternoon", from: 12, to: 17 },
  { label: "Evening", from: 17, to: 24 },
  { label: "Night", from: 0, to: 6 },
] as const;

/** Free start times grouped by part of the day; night hours are folded away unless nothing else is free. */
function SlotGroups({ slots, selected, onSelect }: { slots: { start: string }[]; selected: string | null; onSelect: (s: string) => void }) {
  const hour = (iso: string) => Number(formatBookingTime(new Date(iso)).slice(0, 2));
  const groups = BANDS.map((b) => ({ ...b, slots: slots.filter((s) => hour(s.start) >= b.from && hour(s.start) < b.to) })).filter((g) => g.slots.length > 0);
  const onlyNight = groups.length === 1 && groups[0].label === "Night";
  return (
    <div className="space-y-3" aria-label="Free start times" role="group">
      {groups.map((g) => {
        const grid = (
          <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
            {g.slots.map((s) => (
              <button
                key={s.start}
                type="button"
                aria-pressed={selected === s.start}
                onClick={() => onSelect(s.start)}
                className={cn(
                  "num rounded-md border px-2 py-1.5 text-sm",
                  selected === s.start ? "border-signal bg-signal text-surface" : "border-line-strong bg-surface hover:border-ink/50",
                )}
              >
                {formatBookingTime(new Date(s.start))}
              </button>
            ))}
          </div>
        );
        const heading = `${g.label} · ${g.slots.length} free`;
        return g.label === "Night" && !onlyNight && !g.slots.some((s) => s.start === selected) ? (
          <details key={g.label}>
            <summary className="cursor-pointer text-[0.8125rem] font-medium text-muted hover:text-ink">{heading}</summary>
            {grid}
          </details>
        ) : (
          <div key={g.label}>
            <p className="text-[0.8125rem] font-medium text-muted">{heading}</p>
            {grid}
          </div>
        );
      })}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function ChoiceCard({ active, onClick, icon, title, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn("rounded-lg border p-3.5 text-left transition-colors", active ? "border-signal bg-signal-soft/60 ring-1 ring-signal" : "border-line-strong hover:border-ink/40")}
    >
      <span className="flex items-center gap-2 font-medium text-ink">
        {icon}
        {title}
        {active && <Check className="ml-auto h-4 w-4 text-signal" aria-hidden />}
      </span>
      <span className="mt-1 block text-sm text-muted">{children}</span>
    </button>
  );
}

export function Confirmation({ result, saved }: { result: BookingCreated; saved: boolean }) {
  return (
    <div className="mx-auto max-w-xl">
      <Panel>
        <div className="flex flex-col items-start gap-3" role="status">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-soft px-2.5 py-0.5 text-sm font-medium text-signal">
            <Check className="h-4 w-4" aria-hidden /> Booked
          </span>
          <div>
            <p className="text-sm text-muted">Your booking code</p>
            <p className="num mt-0.5 text-2xl font-semibold tracking-[0.06em]" data-testid="booking-code">
              {result.code}
            </p>
            <p className="mt-1 text-sm text-muted">
              Keep this code: it is the only way to view or cancel the booking. {saved ? "It is also saved in this browser." : "This browser could not save it, so note it down."}
            </p>
          </div>
          <ul className="w-full divide-y divide-line rounded-md border border-line">
            {result.bookings.map((b) => (
              <li key={b.id} className="px-3.5 py-2.5 text-sm">
                <p className="num font-medium">{b.window}</p>
                <p className="text-muted">
                  {b.vehicleLabel ? `${b.vehicleLabel} · ` : ""}
                  {b.chargerCode} at {b.stationName}
                </p>
              </li>
            ))}
          </ul>
          {result.bookings.length === 1 && result.bookings[0].kind === "queue" && (
            <p className="text-sm">
              {result.sessionsAhead === 0 ? "No one is booked ahead of you." : `${result.sessionsAhead} booked session${result.sessionsAhead === 1 ? " is" : "s are"} ahead of you.`}
            </p>
          )}
          <p className="text-sm text-muted">
            Arrive by your start time; the slot is held for {BOOKING.graceMinutes} minutes. A {BOOKING.bufferMinutes}-minute gap after your session protects the next driver if you
            finish a little late.
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/driver/bookings" variant="primary">
              My bookings
            </ButtonLink>
            <ButtonLink href={`/driver/stations/${result.bookings[0].stationId}`}>Back to the station</ButtonLink>
          </div>
        </div>
      </Panel>
    </div>
  );
}
