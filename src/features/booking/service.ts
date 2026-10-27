import "server-only";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { BOOKING, NOT_BOOKABLE_HEALTH, NOT_BOOKABLE_STATUS } from "@/config/booking";
import type { ConnectorType, HealthStatus, OperationalStatus } from "@/config/domain";
import { conflict, notFound, validationError } from "@/lib/errors";
import { getDb, type Database } from "@/lib/db/client";
import { bookings, chargers, stations } from "@/lib/db/schema";
import { hashBookingCode, newBookingCode } from "./code";
import {
  addMinutes,
  bookableDates,
  bookingDateOf,
  conflictsWith,
  daySlots,
  dayWindow,
  earliestStart,
  formatBookingWindow,
  horizonEnd,
  planFleet,
  sessionsAhead,
  type BookedInterval,
  type FleetPlan,
} from "./schedule";
import type { BookingCreateInput, FleetRequest } from "./validation";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

export interface BookableCharger {
  id: string;
  code: string;
  connectorType: ConnectorType;
  ratedPowerKw: number | null;
  operationalStatus: OperationalStatus;
  healthStatus: HealthStatus;
  stationId: string;
  stationName: string;
  isDemo: boolean;
  bookable: boolean;
  notBookableReason: string | null;
}

function bookability(c: { operationalStatus: OperationalStatus; healthStatus: HealthStatus }): string | null {
  if ((NOT_BOOKABLE_STATUS as readonly string[]).includes(c.operationalStatus)) return "This charger is reported offline, so it is not taking bookings.";
  if ((NOT_BOOKABLE_HEALTH as readonly string[]).includes(c.healthStatus)) {
    return "An inspection is recommended for this charger, so it is not taking bookings until that is resolved.";
  }
  return null;
}

const chargerColumns = {
  id: chargers.id,
  code: chargers.code,
  connectorType: chargers.connectorType,
  ratedPowerKw: chargers.ratedPowerKw,
  operationalStatus: chargers.operationalStatus,
  healthStatus: chargers.healthStatus,
  stationId: chargers.stationId,
  stationName: stations.name,
  isDemo: stations.isSynthetic,
};

async function loadChargers(db: Executor, where: ReturnType<typeof eq>): Promise<BookableCharger[]> {
  const rows = await db.select(chargerColumns).from(chargers).innerJoin(stations, eq(stations.id, chargers.stationId)).where(where).orderBy(asc(chargers.code));
  return rows.map((r) => {
    const reason = bookability(r);
    return { ...r, bookable: reason === null, notBookableReason: reason };
  });
}

export async function getBookableCharger(id: string, db: Executor = getDb()): Promise<BookableCharger> {
  const [c] = await loadChargers(db, eq(chargers.id, id));
  if (!c) throw notFound("Charger");
  return c;
}

/** Active bookings on these chargers that are still busy (buffer included) after `from`. */
async function loadBooked(db: Executor, chargerIds: string[], from: Date, to: Date): Promise<Map<string, BookedInterval[]>> {
  const map = new Map<string, BookedInterval[]>(chargerIds.map((id) => [id, []]));
  if (chargerIds.length === 0) return map;
  const rows = await db
    .select({ chargerId: bookings.chargerId, start: bookings.startAt, end: bookings.endAt, bufferMinutes: bookings.bufferMinutes })
    .from(bookings)
    .where(
      and(
        inArray(bookings.chargerId, chargerIds),
        eq(bookings.status, "booked"),
        // busy until end + buffer; the buffer is at most 60 minutes
        gt(bookings.endAt, new Date(from.getTime() - 60 * 60_000)),
        lt(bookings.startAt, to),
      ),
    )
    .orderBy(asc(bookings.startAt));
  for (const r of rows) {
    const b = { start: r.start, end: r.end, bufferMinutes: r.bufferMinutes };
    if (b.end.getTime() + b.bufferMinutes * 60_000 > from.getTime()) map.get(r.chargerId)!.push(b);
  }
  return map;
}

/**
 * Serialises booking writes per charger. Taken in a fixed order (sorted ids) so a fleet
 * booking and a single booking can never deadlock; released when the transaction ends.
 */
async function lockChargers(tx: Tx, chargerIds: string[]): Promise<void> {
  for (const id of [...chargerIds].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`evolt-booking:${id}`}, 0))`);
  }
}

// ---- Availability ---------------------------------------------------------------------

export interface Availability {
  charger: BookableCharger;
  date: string;
  dates: string[];
  durationMinutes: number;
  bufferMinutes: number;
  graceMinutes: number;
  timeZone: string;
  slots: { start: string; end: string; available: boolean; reason?: string }[];
  /** Busy periods on this day: the session, then the buffer kept after it. No driver details. */
  busy: { start: string; end: string; bufferEnd: string }[];
  /** "Join the queue": the earliest start from now, and how many sessions are ahead. */
  next: { start: string; end: string; sessionsAhead: number } | null;
}

export async function getAvailability(q: { chargerId: string; date?: string; duration: number }, now: Date = new Date()): Promise<Availability> {
  const db = getDb();
  const charger = await getBookableCharger(q.chargerId, db);
  const dates = bookableDates(now);
  const date = q.date ?? dates[0];
  if (!dates.includes(date)) {
    throw validationError(`Bookings can be made from today up to ${BOOKING.horizonDays} days ahead.`);
  }
  const win = dayWindow(date)!;
  const latest = horizonEnd(now);
  const from = now < win.start ? now : win.start;
  const booked = await loadBooked(db, [charger.id], from, new Date(Math.max(latest.getTime(), win.end.getTime()) + BOOKING.maxDurationMinutes * 60_000));
  const list = booked.get(charger.id)!;

  const slots = charger.bookable ? daySlots(date, q.duration, list, now) : [];
  const nextStart = charger.bookable ? earliestStart(addMinutes(now, BOOKING.minLeadMinutes), q.duration, list, { latest }) : null;
  const busy = list
    .filter((b) => b.start < win.end && b.end.getTime() + b.bufferMinutes * 60_000 > win.start.getTime())
    .map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString(), bufferEnd: addMinutes(b.end, b.bufferMinutes).toISOString() }));

  return {
    charger,
    date,
    dates,
    durationMinutes: q.duration,
    bufferMinutes: BOOKING.bufferMinutes,
    graceMinutes: BOOKING.graceMinutes,
    timeZone: BOOKING.timeZone,
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), available: s.available, ...(s.reason ? { reason: s.reason } : {}) })),
    busy,
    next: nextStart
      ? { start: nextStart.toISOString(), end: addMinutes(nextStart, q.duration).toISOString(), sessionsAhead: sessionsAhead(nextStart, list, now) }
      : null,
  };
}

// ---- Creating bookings ------------------------------------------------------------------

export interface BookingView {
  id: string;
  kind: "slot" | "queue" | "fleet";
  chargerId: string;
  chargerCode: string;
  connectorType: ConnectorType;
  stationId: string;
  stationName: string;
  isDemo: boolean;
  driverName: string;
  vehicleLabel: string | null;
  start: string;
  end: string;
  bufferMinutes: number;
  /** Derived from the clock: cancelled · upcoming · in_progress · finished. */
  state: "cancelled" | "upcoming" | "in_progress" | "finished";
  window: string;
  cancellable: boolean;
}

export interface BookingCreated {
  code: string;
  bookings: BookingView[];
  sessionsAhead: number;
}

function assertBookable(c: BookableCharger) {
  if (!c.bookable) throw conflict(c.notBookableReason!);
}

function assertWindow(start: Date, now: Date) {
  if (start < addMinutes(now, BOOKING.minLeadMinutes - 1)) {
    throw validationError(`Choose a start at least ${BOOKING.minLeadMinutes} minutes from now.`);
  }
  if (start > horizonEnd(now)) throw validationError(`Bookings can be made up to ${BOOKING.horizonDays} days ahead.`);
}

/**
 * Books one session. With `start` it is a slot booking and must not overlap any booking or
 * buffer; without it the driver joins the queue and gets the earliest start that fits.
 */
export async function createBooking(input: BookingCreateInput, now: Date = new Date()): Promise<BookingCreated> {
  const db = getDb();
  const code = newBookingCode();
  return db.transaction(async (tx) => {
    await lockChargers(tx, [input.chargerId]);
    const charger = await getBookableCharger(input.chargerId, tx);
    assertBookable(charger);
    const latest = horizonEnd(now);
    const list = (await loadBooked(tx, [charger.id], now, addMinutes(latest, BOOKING.maxDurationMinutes))).get(charger.id)!;

    let start: Date;
    if (input.start) {
      start = input.start;
      if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0 || start.getUTCMinutes() % 5 !== 0) {
        throw validationError("Start times must be on a 5-minute mark.");
      }
      assertWindow(start, now);
      const end = addMinutes(start, input.durationMinutes);
      if (conflictsWith({ start, end }, list)) {
        const alt = earliestStart(start, input.durationMinutes, list, { latest });
        throw conflict(
          alt
            ? `That time overlaps another booking or the ${BOOKING.bufferMinutes}-minute gap kept after it. The next free start is ${formatBookingWindow(alt, addMinutes(alt, input.durationMinutes))}.`
            : "That time overlaps another booking, and nothing later fits within the booking window.",
          alt ? { nextStart: alt.toISOString() } : undefined,
        );
      }
    } else {
      const found = earliestStart(addMinutes(now, BOOKING.minLeadMinutes), input.durationMinutes, list, { latest });
      if (!found) throw conflict("This charger is fully booked for the booking window.");
      start = found;
    }
    const end = addMinutes(start, input.durationMinutes);
    const [row] = await tx
      .insert(bookings)
      .values({
        chargerId: charger.id,
        codeHash: hashBookingCode(code.normalized),
        kind: input.start ? "slot" : "queue",
        driverName: input.driverName,
        vehicleLabel: input.vehicleLabel ?? null,
        startAt: start,
        endAt: end,
        bufferMinutes: BOOKING.bufferMinutes,
      })
      .returning();
    return { code: code.display, bookings: [toView(row, charger, now)], sessionsAhead: sessionsAhead(start, list, now) };
  });
}

// ---- Fleet ------------------------------------------------------------------------------

export interface FleetResult {
  station: { id: string; name: string; isDemo: boolean };
  plan: {
    assignments: (Omit<FleetPlan["assignments"][number], "start" | "end"> & { start: string; end: string; window: string })[];
    unassigned: FleetPlan["unassigned"];
    finishesAt: string | null;
    rules: string[];
  };
  excludedChargers: { code: string; reason: string }[];
  booked: BookingCreated | null;
}

/** Plans (and, when `preview` is false, books) several vehicles across one station's chargers. */
export async function planOrBookFleet(input: FleetRequest, now: Date = new Date()): Promise<FleetResult> {
  const db = getDb();
  const [station] = await db.select({ id: stations.id, name: stations.name, isDemo: stations.isSynthetic }).from(stations).where(eq(stations.id, input.stationId));
  if (!station) throw notFound("Station");
  const earliest = addMinutes(now, BOOKING.minLeadMinutes);
  const after = input.after && input.after > earliest ? input.after : earliest;
  const latest = horizonEnd(now);
  if (after > latest) throw validationError(`Bookings can be made up to ${BOOKING.horizonDays} days ahead.`);

  const run = async (tx: Executor, commit: boolean): Promise<FleetResult> => {
    const all = await loadChargers(tx, eq(chargers.stationId, station.id));
    if (commit) await lockChargers(tx as Tx, all.map((c) => c.id));
    const usable = all.filter((c) => c.bookable);
    const excludedChargers = all.filter((c) => !c.bookable).map((c) => ({ code: c.code, reason: c.notBookableReason! }));
    const booked = await loadBooked(tx, usable.map((c) => c.id), now, addMinutes(latest, BOOKING.maxDurationMinutes));
    const plan = planFleet(
      input.vehicles.map((v) => ({ ...v, finishBy: v.finishBy ?? null })),
      usable.map((c) => ({ id: c.id, code: c.code, connectorType: c.connectorType, ratedPowerKw: c.ratedPowerKw, booked: booked.get(c.id)! })),
      after,
      { latest },
    );
    let created: BookingCreated | null = null;
    if (commit) {
      if (plan.assignments.length === 0) throw conflict("None of these vehicles could be placed, so nothing was booked.", { unassigned: plan.unassigned });
      const code = newBookingCode();
      const byId = new Map(usable.map((c) => [c.id, c]));
      const rows = await (tx as Tx)
        .insert(bookings)
        .values(
          plan.assignments.map((a) => ({
            chargerId: a.chargerId,
            codeHash: hashBookingCode(code.normalized),
            groupSize: plan.assignments.length,
            kind: "fleet" as const,
            driverName: input.driverName,
            vehicleLabel: a.label,
            startAt: a.start,
            endAt: a.end,
            bufferMinutes: BOOKING.bufferMinutes,
          })),
        )
        .returning();
      created = {
        code: code.display,
        bookings: rows.sort((x, y) => x.startAt.getTime() - y.startAt.getTime()).map((r) => toView(r, byId.get(r.chargerId)!, now)),
        sessionsAhead: 0,
      };
    }
    return {
      station,
      plan: {
        assignments: plan.assignments.map((a) => ({ ...a, start: a.start.toISOString(), end: a.end.toISOString(), window: formatBookingWindow(a.start, a.end) })),
        unassigned: plan.unassigned,
        finishesAt: plan.finishesAt?.toISOString() ?? null,
        rules: plan.rules,
      },
      excludedChargers,
      booked: created,
    };
  };

  return input.preview ? run(db, false) : db.transaction((tx) => run(tx, true));
}

// ---- Looking up and cancelling --------------------------------------------------------

function stateOf(row: { status: string; startAt: Date; endAt: Date }, now: Date): BookingView["state"] {
  if (row.status === "cancelled") return "cancelled";
  if (row.endAt <= now) return "finished";
  if (row.startAt <= now) return "in_progress";
  return "upcoming";
}

function toView(
  row: typeof bookings.$inferSelect,
  c: { id: string; code: string; connectorType: ConnectorType; stationId: string; stationName: string; isDemo: boolean },
  now: Date,
): BookingView {
  const state = stateOf(row, now);
  return {
    id: row.id,
    kind: row.kind,
    chargerId: c.id,
    chargerCode: c.code,
    connectorType: c.connectorType,
    stationId: c.stationId,
    stationName: c.stationName,
    isDemo: c.isDemo,
    driverName: row.driverName,
    vehicleLabel: row.vehicleLabel,
    start: row.startAt.toISOString(),
    end: row.endAt.toISOString(),
    bufferMinutes: row.bufferMinutes,
    state,
    window: formatBookingWindow(row.startAt, row.endAt),
    cancellable: state === "upcoming",
  };
}

async function rowsByCode(db: Executor, normalized: string) {
  return db
    .select({ b: bookings, c: chargerColumns })
    .from(bookings)
    .innerJoin(chargers, eq(chargers.id, bookings.chargerId))
    .innerJoin(stations, eq(stations.id, chargers.stationId))
    .where(eq(bookings.codeHash, hashBookingCode(normalized)))
    .orderBy(asc(bookings.startAt));
}

export async function getBookingsByCode(normalized: string, now: Date = new Date()): Promise<BookingView[]> {
  const rows = await rowsByCode(getDb(), normalized);
  if (rows.length === 0) throw notFound("Booking");
  return rows.map((r) => toView(r.b, r.c, now));
}

/**
 * Cancels the upcoming sessions under a booking code (or one of them, by id). Sessions that
 * have started or finished are left as they are. The freed time is bookable at once.
 */
export async function cancelBookings(normalized: string, opts: { bookingId?: string } = {}, now: Date = new Date()): Promise<BookingView[]> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await rowsByCode(tx, normalized);
    if (rows.length === 0) throw notFound("Booking");
    const targets = rows.filter((r) => (!opts.bookingId || r.b.id === opts.bookingId) && stateOf(r.b, now) === "upcoming");
    if (opts.bookingId && !rows.some((r) => r.b.id === opts.bookingId)) throw notFound("Booking");
    if (targets.length === 0) throw conflict("Nothing to cancel: these sessions have already started, finished or been cancelled.");
    await lockChargers(tx, [...new Set(targets.map((t) => t.b.chargerId))]);
    await tx
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(inArray(bookings.id, targets.map((t) => t.b.id)), eq(bookings.status, "booked")));
    const after = await rowsByCode(tx, normalized);
    return after.map((r) => toView(r.b, r.c, now));
  });
}

/** For the booking date picker: today in IST. */
export function bookingToday(now: Date = new Date()): string {
  return bookingDateOf(now);
}
