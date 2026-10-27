/**
 * Slot, queue and fleet scheduling for driver bookings. Pure functions: no database,
 * no clock (the caller passes `now`), so every rule is unit-tested directly.
 *
 * A booking reserves its charging time [start, end) plus a buffer after it. The next
 * booking on that charger may start only when the buffer has passed, so a session that
 * overruns, or a driver who arrives late, does not push into the next driver's time.
 */
import { BOOKING } from "@/config/booking";
import type { ConnectorType } from "@/config/domain";

const MIN = 60_000;

export interface BookedInterval {
  start: Date;
  end: Date;
  /** Buffer kept free after this booking (minutes), as stored with it. */
  bufferMinutes: number;
}

export interface Candidate {
  start: Date;
  end: Date;
}

/** Time until which a booking keeps its charger busy, buffer included. */
export function occupiedUntil(b: BookedInterval): Date {
  return new Date(b.end.getTime() + b.bufferMinutes * MIN);
}

/**
 * True when `c` (followed by its own buffer) overlaps any existing booking (followed by
 * its buffer). Both directions matter: the new booking must not start inside an earlier
 * booking's buffer, and its own buffer must end before a later booking starts.
 */
export function conflictsWith(c: Candidate, booked: readonly BookedInterval[], bufferMinutes: number = BOOKING.bufferMinutes): BookedInterval | null {
  const cEnd = c.end.getTime() + bufferMinutes * MIN;
  for (const b of booked) {
    if (c.start.getTime() < occupiedUntil(b).getTime() && b.start.getTime() < cEnd) return b;
  }
  return null;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MIN);
}

/** Rounds up to the next multiple of `stepMinutes` (in UTC; IST is a whole multiple of 15 minutes). */
export function ceilToStep(d: Date, stepMinutes: number): Date {
  const step = stepMinutes * MIN;
  return new Date(Math.ceil(d.getTime() / step) * step);
}

// ---- IST calendar ---------------------------------------------------------------------

const OFFSET = BOOKING.utcOffsetMinutes * MIN;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The booking calendar date ("YYYY-MM-DD", IST) that contains `d`. */
export function bookingDateOf(d: Date): string {
  return new Date(d.getTime() + OFFSET).toISOString().slice(0, 10);
}

/** UTC instants bounding an IST calendar day: [start, end). Null for a malformed date. */
export function dayWindow(date: string): { start: Date; end: Date } | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== Number(m[1]) || check.getUTCMonth() !== Number(m[2]) - 1 || check.getUTCDate() !== Number(m[3])) {
    return null;
  }
  const start = new Date(utcMidnight - OFFSET);
  return { start, end: new Date(start.getTime() + 24 * 60 * MIN) };
}

/** Bookable calendar days, today first. */
export function bookableDates(now: Date, horizonDays: number = BOOKING.horizonDays): string[] {
  const out: string[] = [];
  for (let i = 0; i <= horizonDays; i++) out.push(bookingDateOf(new Date(now.getTime() + i * 24 * 60 * MIN)));
  return [...new Set(out)];
}

/** Latest moment a booking may start. */
export function horizonEnd(now: Date, horizonDays: number = BOOKING.horizonDays): Date {
  return new Date(now.getTime() + horizonDays * 24 * 60 * MIN);
}

/** "14:30" in the booking time zone. */
export function formatBookingTime(d: Date): string {
  const t = new Date(d.getTime() + OFFSET);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 27 Oct" for an IST calendar date. */
export function formatBookingDate(date: string): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/** "Tue 27 Oct, 14:30–15:30 IST" */
export function formatBookingWindow(start: Date, end: Date): string {
  return `${formatBookingDate(bookingDateOf(start))}, ${formatBookingTime(start)}–${formatBookingTime(end)} ${BOOKING.timeZoneLabel}`;
}

// ---- Slots and the queue -------------------------------------------------------------

export interface Slot {
  start: Date;
  end: Date;
  available: boolean;
  /** Why an unavailable slot cannot be booked. */
  reason?: "past" | "booked" | "beyond_horizon";
}

/**
 * Start times on the slot grid for one IST day, each with whether a booking of
 * `durationMinutes` could start there. A slot may run past midnight.
 */
export function daySlots(
  date: string,
  durationMinutes: number,
  booked: readonly BookedInterval[],
  now: Date,
  opts: { stepMinutes?: number; bufferMinutes?: number; horizonDays?: number } = {},
): Slot[] {
  const win = dayWindow(date);
  if (!win) return [];
  const step = opts.stepMinutes ?? BOOKING.slotStepMinutes;
  const buffer = opts.bufferMinutes ?? BOOKING.bufferMinutes;
  const earliest = addMinutes(now, BOOKING.minLeadMinutes);
  const latest = horizonEnd(now, opts.horizonDays);
  const out: Slot[] = [];
  for (let t = win.start.getTime(); t < win.end.getTime(); t += step * MIN) {
    const start = new Date(t);
    const end = addMinutes(start, durationMinutes);
    let reason: Slot["reason"];
    if (start < earliest) reason = "past";
    else if (start > latest) reason = "beyond_horizon";
    else if (conflictsWith({ start, end }, booked, buffer)) reason = "booked";
    out.push({ start, end, available: !reason, ...(reason ? { reason } : {}) });
  }
  return out;
}

/**
 * The earliest start at or after `after` where a booking of `durationMinutes` fits,
 * respecting every buffer. This is "join the queue": it returns the moment the charger
 * (and the buffer after the session ahead) becomes free. Starts are rounded up to
 * `roundMinutes` so times read cleanly. Null if nothing fits before `latest`.
 */
export function earliestStart(
  after: Date,
  durationMinutes: number,
  booked: readonly BookedInterval[],
  opts: { bufferMinutes?: number; roundMinutes?: number; latest?: Date } = {},
): Date | null {
  const buffer = opts.bufferMinutes ?? BOOKING.bufferMinutes;
  const round = opts.roundMinutes ?? 5;
  const sorted = [...booked].sort((a, b) => a.start.getTime() - b.start.getTime());
  const candidates = [after, ...sorted.map(occupiedUntil)]
    .filter((d) => d >= after)
    .map((d) => ceilToStep(d, round))
    .sort((a, b) => a.getTime() - b.getTime());
  for (const start of candidates) {
    if (opts.latest && start > opts.latest) return null;
    if (!conflictsWith({ start, end: addMinutes(start, durationMinutes) }, sorted, buffer)) return start;
  }
  return null;
}

/** Bookings still to finish at `now` that start before `start`: the sessions ahead in the queue. */
export function sessionsAhead(start: Date, booked: readonly BookedInterval[], now: Date): number {
  return booked.filter((b) => b.end > now && b.start < start).length;
}

// ---- Charge-time estimate ------------------------------------------------------------

export interface ChargeEstimateInput {
  batteryKwh: number;
  fromPct: number;
  toPct: number;
  chargerKw: number | null;
  connectorType: ConnectorType;
  /** Vehicle's DC charging limit, when known. */
  vehicleMaxKw?: number | null;
}

export interface ChargeEstimate {
  minutes: number;
  energyKwh: number;
  powerKw: number;
  assumptions: string[];
}

const AC_CONNECTORS: readonly ConnectorType[] = ["Type2"];

/**
 * How long a charge from `fromPct` to `toPct` takes on this charger — an estimate, not
 * a promise. Power is the charger rating, capped by the vehicle's DC limit (or a typical
 * 11 kW onboard charger on AC), at 90% efficiency. On DC, charging above 80% is assumed
 * to run at half power, because batteries slow down near full. Rounded up to 5 minutes
 * and clamped to the bookable range. Null when the charger's power is not recorded.
 */
export function estimateChargeMinutes(input: ChargeEstimateInput): ChargeEstimate | null {
  const from = Math.max(0, Math.min(100, input.fromPct));
  const to = Math.max(0, Math.min(100, input.toPct));
  if (!(input.batteryKwh > 0) || to <= from || !input.chargerKw || input.chargerKw <= 0) return null;
  const isAc = AC_CONNECTORS.includes(input.connectorType);
  const assumptions: string[] = [];
  let power = input.chargerKw;
  if (isAc && power > BOOKING.acOnboardLimitKw) {
    power = BOOKING.acOnboardLimitKw;
    assumptions.push(`AC charging is limited to ${BOOKING.acOnboardLimitKw} kW, a typical onboard charger.`);
  }
  if (!isAc && input.vehicleMaxKw && input.vehicleMaxKw > 0 && input.vehicleMaxKw < power) {
    power = input.vehicleMaxKw;
    assumptions.push(`Limited to your vehicle's ${input.vehicleMaxKw} kW DC maximum.`);
  }
  const effective = power * BOOKING.chargeEfficiency;
  const pctToKwh = (p: number) => (input.batteryKwh * p) / 100;
  let hours: number;
  if (isAc) {
    hours = pctToKwh(to - from) / effective;
  } else {
    const fast = Math.max(0, Math.min(to, 80) - from);
    const slow = Math.max(0, to - Math.max(from, 80));
    hours = pctToKwh(fast) / effective + pctToKwh(slow) / (effective / 2);
    if (slow > 0) assumptions.push("Above 80% the battery is assumed to charge at half power.");
  }
  assumptions.push(`${Math.round(BOOKING.chargeEfficiency * 100)}% charging efficiency.`);
  const raw = Math.ceil((hours * 60) / 5) * 5;
  const minutes = Math.min(BOOKING.maxDurationMinutes, Math.max(BOOKING.minDurationMinutes, raw));
  if (raw > BOOKING.maxDurationMinutes) assumptions.push(`Capped at the ${BOOKING.maxDurationMinutes / 60}-hour booking limit.`);
  return { minutes, energyKwh: Math.round(pctToKwh(to - from) * 10) / 10, powerKw: Math.round(power * 10) / 10, assumptions };
}

// ---- Fleet planning ------------------------------------------------------------------

export interface FleetVehicleInput {
  label: string;
  /** Fixed session length; or give `charge` to estimate it per charger. */
  durationMinutes?: number;
  charge?: { batteryKwh: number; fromPct: number; toPct: number; vehicleMaxKw?: number | null };
  /** Connectors this vehicle can use; null or empty = any. */
  connectorTypes?: readonly ConnectorType[] | null;
  /** Must finish charging by this time, if set. */
  finishBy?: Date | null;
}

export interface FleetCharger {
  id: string;
  code: string;
  connectorType: ConnectorType;
  ratedPowerKw: number | null;
  booked: BookedInterval[];
}

export interface FleetAssignment {
  index: number;
  label: string;
  chargerId: string;
  chargerCode: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  /** Finishes after the requested finish-by time. */
  late: boolean;
  estimated: boolean;
}

export interface FleetUnassigned {
  index: number;
  label: string;
  reason: string;
}

export interface FleetPlan {
  assignments: FleetAssignment[];
  unassigned: FleetUnassigned[];
  /** When the last vehicle finishes. */
  finishesAt: Date | null;
  rules: string[];
}

export const FLEET_RULES = [
  "Vehicles with a finish-by time go first, earliest deadline first; then longer charges.",
  "Each vehicle takes the compatible charger where it would finish soonest, so a faster charger can win even if it frees up a little later.",
  `Every session keeps the ${BOOKING.bufferMinutes}-minute buffer after it, including between your own vehicles.`,
  "A vehicle that cannot finish by its finish-by time is still placed at its earliest finish and marked late.",
];

/**
 * Plans a fleet of vehicles across one station's chargers. The rule follows a
 * rule-based fleet scheduler: earliest deadline first, then each vehicle on the
 * compatible charger with the earliest finish, with buffers between all sessions.
 */
export function planFleet(
  vehicles: readonly FleetVehicleInput[],
  chargers: readonly FleetCharger[],
  after: Date,
  opts: { bufferMinutes?: number; latest?: Date } = {},
): FleetPlan {
  const buffer = opts.bufferMinutes ?? BOOKING.bufferMinutes;
  const working = chargers.map((c) => ({ ...c, booked: [...c.booked] }));

  const durationOn = (v: FleetVehicleInput, c: FleetCharger): { minutes: number; estimated: boolean } | null => {
    if (v.durationMinutes) return { minutes: v.durationMinutes, estimated: false };
    if (!v.charge) return null;
    const est = estimateChargeMinutes({ ...v.charge, chargerKw: c.ratedPowerKw, connectorType: c.connectorType });
    return est ? { minutes: est.minutes, estimated: true } : null;
  };

  const order = vehicles
    .map((v, index) => ({ v, index }))
    .sort((a, b) => {
      const da = a.v.finishBy?.getTime() ?? Infinity;
      const db = b.v.finishBy?.getTime() ?? Infinity;
      if (da !== db) return da - db;
      const la = a.v.durationMinutes ?? (a.v.charge ? a.v.charge.batteryKwh * (a.v.charge.toPct - a.v.charge.fromPct) : 0);
      const lb = b.v.durationMinutes ?? (b.v.charge ? b.v.charge.batteryKwh * (b.v.charge.toPct - b.v.charge.fromPct) : 0);
      return lb - la || a.index - b.index;
    });

  const assignments: FleetAssignment[] = [];
  const unassigned: FleetUnassigned[] = [];
  for (const { v, index } of order) {
    const compatible = working.filter((c) => !v.connectorTypes?.length || v.connectorTypes.includes(c.connectorType));
    if (compatible.length === 0) {
      unassigned.push({ index, label: v.label, reason: "No charger at this station has a compatible connector." });
      continue;
    }
    let best: { c: (typeof working)[number]; start: Date; end: Date; minutes: number; estimated: boolean } | null = null;
    for (const c of compatible) {
      const d = durationOn(v, c);
      if (!d) continue;
      const start = earliestStart(after, d.minutes, c.booked, { bufferMinutes: buffer, latest: opts.latest });
      if (!start) continue;
      const end = addMinutes(start, d.minutes);
      if (!best || end < best.end || (end.getTime() === best.end.getTime() && c.code < best.c.code)) {
        best = { c, start, end, minutes: d.minutes, estimated: d.estimated };
      }
    }
    if (!best) {
      unassigned.push({
        index,
        label: v.label,
        reason: v.durationMinutes
          ? "No compatible charger has a free slot within the booking window."
          : "Charge time cannot be estimated: the compatible chargers have no recorded power. Enter a duration instead.",
      });
      continue;
    }
    best.c.booked.push({ start: best.start, end: best.end, bufferMinutes: buffer });
    assignments.push({
      index,
      label: v.label,
      chargerId: best.c.id,
      chargerCode: best.c.code,
      start: best.start,
      end: best.end,
      durationMinutes: best.minutes,
      late: Boolean(v.finishBy && best.end > v.finishBy),
      estimated: best.estimated,
    });
  }
  assignments.sort((a, b) => a.index - b.index);
  unassigned.sort((a, b) => a.index - b.index);
  const finishesAt = assignments.length ? new Date(Math.max(...assignments.map((a) => a.end.getTime()))) : null;
  return { assignments, unassigned, finishesAt, rules: FLEET_RULES };
}
