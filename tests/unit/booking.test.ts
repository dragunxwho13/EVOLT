import { describe, expect, it } from "vitest";
import { BOOKING } from "@/config/booking";
import {
  bookableDates,
  bookingDateOf,
  conflictsWith,
  daySlots,
  dayWindow,
  earliestStart,
  estimateChargeMinutes,
  formatBookingTime,
  formatBookingWindow,
  planFleet,
  sessionsAhead,
  type BookedInterval,
  type FleetCharger,
} from "@/features/booking/schedule";

const at = (iso: string) => new Date(iso);
/** IST wall-clock time on 28 Oct 2026 → Date. */
const ist = (hhmm: string, date = "2026-10-28") => new Date(`${date}T${hhmm}:00+05:30`);
const booking = (from: string, to: string, buffer: number = BOOKING.bufferMinutes): BookedInterval => ({ start: ist(from), end: ist(to), bufferMinutes: buffer });

describe("IST booking calendar", () => {
  it("bounds a day at IST midnight", () => {
    const w = dayWindow("2026-10-28")!;
    expect(w.start.toISOString()).toBe("2026-10-27T18:30:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-28T18:30:00.000Z");
  });

  it("rejects malformed and impossible dates", () => {
    expect(dayWindow("2026-13-01")).toBeNull();
    expect(dayWindow("2026-02-30")).toBeNull();
    expect(dayWindow("28-10-2026")).toBeNull();
  });

  it("assigns late-evening UTC instants to the next IST day", () => {
    expect(bookingDateOf(at("2026-10-27T18:29:00Z"))).toBe("2026-10-27");
    expect(bookingDateOf(at("2026-10-27T18:30:00Z"))).toBe("2026-10-28");
  });

  it("offers today plus the horizon", () => {
    const dates = bookableDates(ist("09:00"));
    expect(dates[0]).toBe("2026-10-28");
    expect(dates).toHaveLength(BOOKING.horizonDays + 1);
  });

  it("formats times in IST", () => {
    expect(formatBookingTime(ist("14:30"))).toBe("14:30");
    expect(formatBookingWindow(ist("14:30"), ist("15:30"))).toBe("Wed 28 Oct, 14:30–15:30 IST");
  });
});

describe("conflicts with the buffer", () => {
  const existing = [booking("10:00", "11:00")];

  it("blocks a start inside the previous booking's buffer", () => {
    expect(conflictsWith({ start: ist("11:05"), end: ist("12:00") }, existing)).not.toBeNull();
  });

  it("allows a start exactly when the buffer ends", () => {
    expect(conflictsWith({ start: ist("11:10"), end: ist("12:00") }, existing)).toBeNull();
  });

  it("blocks a booking whose own buffer would run into the next booking", () => {
    // Ends 09:55; with its 10-minute buffer it is busy until 10:05.
    expect(conflictsWith({ start: ist("09:00"), end: ist("09:55") }, existing)).not.toBeNull();
    expect(conflictsWith({ start: ist("09:00"), end: ist("09:50") }, existing)).toBeNull();
  });

  it("uses the buffer stored with each existing booking", () => {
    const longBuffer = [booking("10:00", "11:00", 30)];
    expect(conflictsWith({ start: ist("11:20"), end: ist("12:00") }, longBuffer)).not.toBeNull();
    expect(conflictsWith({ start: ist("11:30"), end: ist("12:00") }, longBuffer)).toBeNull();
  });
});

describe("day slots", () => {
  const now = ist("09:00");

  it("marks past, booked and free slots on the 15-minute grid", () => {
    const slots = daySlots("2026-10-28", 60, [booking("12:00", "13:00")], now);
    expect(slots).toHaveLength(96);
    const byTime = new Map(slots.map((s) => [formatBookingTime(s.start), s]));
    expect(byTime.get("09:00")?.reason).toBe("past"); // inside the minimum lead time
    expect(byTime.get("09:15")?.available).toBe(true);
    expect(byTime.get("11:00")?.reason).toBe("booked"); // 11:00–12:00 + buffer runs into 12:00
    expect(byTime.get("10:45")?.available).toBe(true); // 10:45–11:45, buffer to 11:55
    expect(byTime.get("13:00")?.reason).toBe("booked"); // inside the 12:00 booking's buffer
    expect(byTime.get("13:15")?.available).toBe(true);
  });

  it("refuses slots beyond the booking horizon", () => {
    const last = bookableDates(now).at(-1)!;
    const slots = daySlots(last, 30, [], now);
    expect(slots.some((s) => s.reason === "beyond_horizon")).toBe(true);
  });
});

describe("join the queue", () => {
  it("starts immediately when the charger is free", () => {
    expect(earliestStart(ist("09:02"), 30, [])?.toISOString()).toBe(ist("09:05").toISOString());
  });

  it("starts when the session ahead and its buffer are over", () => {
    const start = earliestStart(ist("10:15"), 30, [booking("10:00", "11:00")]);
    expect(formatBookingTime(start!)).toBe("11:10");
  });

  it("uses a gap between bookings only if the session and its buffer fit", () => {
    const booked = [booking("10:00", "11:00"), booking("12:00", "13:00")];
    // 11:10 + 40 min = 11:50, buffer to 12:00: fits exactly.
    expect(formatBookingTime(earliestStart(ist("10:30"), 40, booked)!)).toBe("11:10");
    // 45 minutes would push the buffer past 12:00, so it waits for 13:10.
    expect(formatBookingTime(earliestStart(ist("10:30"), 45, booked)!)).toBe("13:10");
  });

  it("returns null when nothing fits before the limit", () => {
    expect(earliestStart(ist("10:30"), 60, [booking("10:00", "23:00")], { latest: ist("20:00") })).toBeNull();
  });

  it("counts the sessions ahead", () => {
    const booked = [booking("08:00", "09:00"), booking("10:00", "11:00"), booking("11:10", "12:00")];
    expect(sessionsAhead(ist("12:10"), booked, ist("09:30"))).toBe(2); // the 08:00 session is finished
  });
});

describe("charge-time estimate", () => {
  it("estimates a DC charge with a slower phase above 80%", () => {
    // 60 kWh, 20→80% = 36 kWh at 60 kW × 0.9 = 54 kW → 40 min.
    expect(estimateChargeMinutes({ batteryKwh: 60, fromPct: 20, toPct: 80, chargerKw: 60, connectorType: "CCS2" })?.minutes).toBe(40);
    // 80→90% = 6 kWh at half power (27 kW) → 13.3 min, total 53.3 → 55.
    const est = estimateChargeMinutes({ batteryKwh: 60, fromPct: 20, toPct: 90, chargerKw: 60, connectorType: "CCS2" })!;
    expect(est.minutes).toBe(55);
    expect(est.assumptions.join(" ")).toMatch(/80%/);
  });

  it("caps AC at a typical onboard charger and DC at the vehicle limit", () => {
    expect(estimateChargeMinutes({ batteryKwh: 40, fromPct: 50, toPct: 80, chargerKw: 22, connectorType: "Type2" })?.powerKw).toBe(11);
    expect(estimateChargeMinutes({ batteryKwh: 60, fromPct: 20, toPct: 60, chargerKw: 150, connectorType: "CCS2", vehicleMaxKw: 50 })?.powerKw).toBe(50);
  });

  it("clamps to the booking limits and refuses impossible input", () => {
    expect(estimateChargeMinutes({ batteryKwh: 100, fromPct: 0, toPct: 100, chargerKw: 7, connectorType: "Type2" })?.minutes).toBe(BOOKING.maxDurationMinutes);
    expect(estimateChargeMinutes({ batteryKwh: 60, fromPct: 70, toPct: 72, chargerKw: 150, connectorType: "CCS2" })?.minutes).toBe(BOOKING.minDurationMinutes);
    expect(estimateChargeMinutes({ batteryKwh: 60, fromPct: 80, toPct: 50, chargerKw: 60, connectorType: "CCS2" })).toBeNull();
    expect(estimateChargeMinutes({ batteryKwh: 60, fromPct: 20, toPct: 80, chargerKw: null, connectorType: "CCS2" })).toBeNull();
  });
});

describe("fleet plan", () => {
  const charger = (id: string, connectorType: FleetCharger["connectorType"], kw: number, booked: BookedInterval[] = []): FleetCharger => ({
    id,
    code: id,
    connectorType,
    ratedPowerKw: kw,
    booked,
  });

  it("spreads vehicles across chargers with buffers between sessions", () => {
    const plan = planFleet(
      [
        { label: "Van 1", durationMinutes: 60 },
        { label: "Van 2", durationMinutes: 60 },
        { label: "Van 3", durationMinutes: 60 },
      ],
      [charger("A", "CCS2", 60), charger("B", "CCS2", 60)],
      ist("09:00"),
    );
    expect(plan.unassigned).toHaveLength(0);
    const times = plan.assignments.map((a) => `${a.label}@${a.chargerCode} ${formatBookingTime(a.start)}`);
    expect(times).toEqual(["Van 1@A 09:00", "Van 2@B 09:00", "Van 3@A 10:10"]);
    expect(formatBookingTime(plan.finishesAt!)).toBe("11:10");
  });

  it("puts the earliest deadline first and flags a vehicle that will be late", () => {
    const plan = planFleet(
      [
        { label: "Relaxed", durationMinutes: 60 },
        { label: "Urgent", durationMinutes: 60, finishBy: ist("10:00") },
        { label: "Tight", durationMinutes: 60, finishBy: ist("10:30") },
      ],
      [charger("A", "CCS2", 60)],
      ist("09:00"),
    );
    const byLabel = new Map(plan.assignments.map((a) => [a.label, a]));
    expect(formatBookingTime(byLabel.get("Urgent")!.start)).toBe("09:00");
    expect(byLabel.get("Urgent")!.late).toBe(false);
    expect(formatBookingTime(byLabel.get("Tight")!.start)).toBe("10:10");
    expect(byLabel.get("Tight")!.late).toBe(true);
    expect(formatBookingTime(byLabel.get("Relaxed")!.start)).toBe("11:20");
  });

  it("chooses the charger that finishes soonest, not the one free soonest", () => {
    // A is free now but slow; B is busy until 09:20 (+buffer 09:30) but fast.
    const plan = planFleet(
      [{ label: "Car", charge: { batteryKwh: 60, fromPct: 20, toPct: 80 } }],
      [charger("A", "CCS2", 25), charger("B", "CCS2", 150, [booking("08:30", "09:20")])],
      ist("09:00"),
    );
    expect(plan.assignments[0].chargerCode).toBe("B");
    expect(plan.assignments[0].estimated).toBe(true);
  });

  it("respects connector compatibility and explains what it could not place", () => {
    const plan = planFleet(
      [
        { label: "AC only", durationMinutes: 60, connectorTypes: ["Type2"] },
        { label: "CHAdeMO car", durationMinutes: 30, connectorTypes: ["CHAdeMO"] },
      ],
      [charger("A", "CCS2", 60), charger("T", "Type2", 22)],
      ist("09:00"),
    );
    expect(plan.assignments.map((a) => `${a.label}@${a.chargerCode}`)).toEqual(["AC only@T"]);
    expect(plan.unassigned[0]).toMatchObject({ label: "CHAdeMO car" });
  });
});
