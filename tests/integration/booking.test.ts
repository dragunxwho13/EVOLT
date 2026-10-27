import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as availabilityGET } from "@/app/api/bookings/availability/route";
import { POST as cancelPOST } from "@/app/api/bookings/cancel/route";
import { POST as fleetPOST } from "@/app/api/bookings/fleet/route";
import { POST as lookupPOST } from "@/app/api/bookings/lookup/route";
import { POST as bookPOST } from "@/app/api/bookings/route";
import { BOOKING } from "@/config/booking";
import { getDb } from "@/lib/db/client";
import { bookings, chargers, stations } from "@/lib/db/schema";
import { body } from "./helpers";

type Data<T> = { data: T };
type View = { id: string; start: string; end: string; state: string; chargerCode: string; vehicleLabel: string | null; kind: string; cancellable: boolean };
type Created = { code: string; bookings: View[]; sessionsAhead: number };

const MIN = 60_000;
/** Driver requests carry no admin token: bookings must work in token mode without one. */
const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload) });
const get = (path: string) => new NextRequest(`http://localhost${path}`);
/** A start on the 15-minute grid, `hours` from now. */
const startIn = (hours: number) => new Date(Math.ceil((Date.now() + hours * 3_600_000) / (15 * MIN)) * 15 * MIN);
const iso = (d: Date) => d.toISOString();

let fast: string; // CCS2 150 kW
let slow: string; // CCS2 25 kW
let ac: string; // Type 2, 22 kW
let offline: string;
let inspect: string;
let stationId: string;

beforeAll(async () => {
  const db = getDb();
  const [s] = await db.insert(stations).values({ code: "BK-01", name: "Booking test station", isSynthetic: true }).returning();
  stationId = s.id;
  const rows = await db
    .insert(chargers)
    .values([
      { stationId, code: "BK-01-FAST", connectorType: "CCS2", ratedPowerKw: 150, operationalStatus: "available", healthStatus: "normal" },
      { stationId, code: "BK-01-SLOW", connectorType: "CCS2", ratedPowerKw: 25, operationalStatus: "available", healthStatus: "normal" },
      { stationId, code: "BK-01-AC", connectorType: "Type2", ratedPowerKw: 22, operationalStatus: "unknown", healthStatus: "insufficient_data" },
      { stationId, code: "BK-01-OFF", connectorType: "CCS2", ratedPowerKw: 60, operationalStatus: "offline", healthStatus: "normal" },
      { stationId, code: "BK-01-INSP", connectorType: "CCS2", ratedPowerKw: 60, operationalStatus: "available", healthStatus: "inspection_recommended" },
    ])
    .returning();
  const by = new Map(rows.map((r) => [r.code, r.id]));
  fast = by.get("BK-01-FAST")!;
  slow = by.get("BK-01-SLOW")!;
  ac = by.get("BK-01-AC")!;
  offline = by.get("BK-01-OFF")!;
  inspect = by.get("BK-01-INSP")!;
});

describe("driver slot booking", () => {
  it("books a slot without an admin token, in token mode", async () => {
    expect(process.env.EVOLT_EDIT_MODE).toBe("token");
    const start = startIn(3);
    const res = await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(start), durationMinutes: 60, driverName: "Asha", vehicleLabel: "Nexon EV" }));
    expect(res.status).toBe(201);
    const d = (await body<Data<Created>>(res)).data;
    expect(d.code).toMatch(/^EV-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(d.bookings[0]).toMatchObject({ kind: "slot", state: "upcoming", start: iso(start), end: iso(new Date(start.getTime() + 60 * MIN)), cancellable: true });
    // Only a hash of the code is stored.
    const [row] = await getDb().select().from(bookings).where(eq(bookings.id, d.bookings[0].id));
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(d.code.replace(/-/g, "").slice(2));
  });

  it("refuses an overlapping slot and one inside the buffer, and suggests the next free start", async () => {
    const first = startIn(10);
    expect((await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(first), durationMinutes: 60, driverName: "A" }))).status).toBe(201);
    const overlap = await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(new Date(first.getTime() + 30 * MIN)), durationMinutes: 30, driverName: "B" }));
    expect(overlap.status).toBe(409);
    // Starts 5 minutes after the first ends: inside its buffer.
    const inBuffer = await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(new Date(first.getTime() + 65 * MIN)), durationMinutes: 30, driverName: "B" }));
    expect(inBuffer.status).toBe(409);
    const err = (await body<{ error: { message: string; details: { nextStart: string } } }>(inBuffer)).error;
    expect(err.details.nextStart).toBe(iso(new Date(first.getTime() + (60 + BOOKING.bufferMinutes) * MIN)));
    // Exactly when the buffer ends is fine.
    const ok = await bookPOST(post("/api/bookings", { chargerId: fast, start: err.details.nextStart, durationMinutes: 30, driverName: "B" }));
    expect(ok.status).toBe(201);
  });

  it("joins the queue at the earliest start that fits and reports sessions ahead", async () => {
    // AC charger: occupy from the earliest possible start for 2 hours.
    const first = (await body<Data<Created>>(await bookPOST(post("/api/bookings", { chargerId: ac, durationMinutes: 120, driverName: "Q1" })))).data;
    expect(first.bookings[0].kind).toBe("queue");
    const res = await bookPOST(post("/api/bookings", { chargerId: ac, durationMinutes: 45, driverName: "Q2" }));
    expect(res.status).toBe(201);
    const second = (await body<Data<Created>>(res)).data;
    expect(second.sessionsAhead).toBe(1);
    expect(new Date(second.bookings[0].start).getTime()).toBe(new Date(first.bookings[0].end).getTime() + BOOKING.bufferMinutes * MIN);
  });

  it("shows availability with busy periods but no driver details", async () => {
    const res = await availabilityGET(get(`/api/bookings/availability?chargerId=${fast}&duration=60&utm_source=x`));
    expect(res.status).toBe(200);
    const d = (await body<Data<{ slots: { available: boolean; reason?: string }[]; busy: unknown[]; next: { start: string } | null; bufferMinutes: number }>>(res)).data;
    expect(d.slots.length).toBe(96);
    expect(d.bufferMinutes).toBe(BOOKING.bufferMinutes);
    expect(d.next).not.toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/Asha|Nexon/);
  });

  it("refuses offline and inspection-recommended chargers", async () => {
    for (const id of [offline, inspect]) {
      const res = await bookPOST(post("/api/bookings", { chargerId: id, start: iso(startIn(5)), durationMinutes: 30, driverName: "X" }));
      expect(res.status).toBe(409);
    }
    const avail = (await body<Data<{ slots: unknown[]; next: unknown; charger: { bookable: boolean } }>>(await availabilityGET(get(`/api/bookings/availability?chargerId=${offline}`)))).data;
    expect(avail.charger.bookable).toBe(false);
    expect(avail.slots).toHaveLength(0);
    expect(avail.next).toBeNull();
  });

  it("validates input: past starts, off-grid starts, beyond the horizon, bad durations, cross-site requests", async () => {
    const past = await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(new Date(Date.now() - 3_600_000)), durationMinutes: 30, driverName: "X" }));
    expect(past.status).toBe(400);
    const offGrid = new Date(startIn(4).getTime() + 7 * MIN);
    expect((await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(offGrid), durationMinutes: 30, driverName: "X" }))).status).toBe(400);
    const far = startIn(24 * (BOOKING.horizonDays + 1));
    expect((await bookPOST(post("/api/bookings", { chargerId: fast, start: iso(far), durationMinutes: 30, driverName: "X" }))).status).toBe(400);
    expect((await bookPOST(post("/api/bookings", { chargerId: fast, durationMinutes: 5, driverName: "X" }))).status).toBe(400);
    expect((await bookPOST(post("/api/bookings", { chargerId: fast, durationMinutes: 30, driverName: "" }))).status).toBe(400);
    expect((await bookPOST(post("/api/bookings", { chargerId: fast, durationMinutes: 30, driverName: "X", extra: 1 }))).status).toBe(400);
    const crossSite = await bookPOST(post("/api/bookings", { chargerId: fast, durationMinutes: 30, driverName: "X" }, { origin: "https://evil.example" }));
    expect(crossSite.status).toBe(401);
  });

  it("keeps two simultaneous bookings for the same slot from both succeeding", async () => {
    const start = iso(startIn(30));
    const attempt = (name: string) => bookPOST(post("/api/bookings", { chargerId: slow, start, durationMinutes: 60, driverName: name }));
    const results = await Promise.all([attempt("R1"), attempt("R2"), attempt("R3")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });
});

describe("booking code: look up and cancel", () => {
  it("finds a booking by its code in any format, cancels it, and frees the slot", async () => {
    const start = startIn(40);
    const created = (await body<Data<Created>>(await bookPOST(post("/api/bookings", { chargerId: slow, start: iso(start), durationMinutes: 30, driverName: "C" })))).data;
    const messy = ` ${created.code.toLowerCase().replace(/-/g, " ")} `;
    const found = await lookupPOST(post("/api/bookings/lookup", { code: messy }));
    expect(found.status).toBe(200);
    expect((await body<Data<{ bookings: View[] }>>(found)).data.bookings[0].id).toBe(created.bookings[0].id);

    const cancelled = await cancelPOST(post("/api/bookings/cancel", { code: created.code }));
    expect(cancelled.status).toBe(200);
    expect((await body<Data<{ bookings: View[] }>>(cancelled)).data.bookings[0].state).toBe("cancelled");
    expect((await cancelPOST(post("/api/bookings/cancel", { code: created.code }))).status).toBe(409);
    // The same slot can be booked again.
    expect((await bookPOST(post("/api/bookings", { chargerId: slow, start: iso(start), durationMinutes: 30, driverName: "D" }))).status).toBe(201);
  });

  it("returns 404 for an unknown code and 400 for a malformed one", async () => {
    expect((await lookupPOST(post("/api/bookings/lookup", { code: "EV-22222-22222" }))).status).toBe(404);
    expect((await lookupPOST(post("/api/bookings/lookup", { code: "hello" }))).status).toBe(400);
  });
});

describe("fleet booking", () => {
  const after = () => iso(startIn(50));

  it("previews a plan without booking, then books it under one code", async () => {
    const payload = {
      stationId,
      after: after(),
      driverName: "Depot",
      vehicles: [
        { label: "Van 1", durationMinutes: 60, connectorTypes: ["CCS2"] },
        { label: "Van 2", durationMinutes: 60, connectorTypes: ["CCS2"] },
        { label: "Van 3", durationMinutes: 60, connectorTypes: ["Type2"] },
        { label: "CHAdeMO car", durationMinutes: 30, connectorTypes: ["CHAdeMO"] },
      ],
    };
    const before = (await getDb().select().from(bookings)).length;
    const preview = await fleetPOST(post("/api/bookings/fleet", { ...payload, preview: true }));
    expect(preview.status).toBe(200);
    const p = (await body<Data<{ plan: { assignments: { label: string; chargerCode: string; start: string }[]; unassigned: { label: string }[] }; excludedChargers: { code: string }[]; booked: null }>>(preview)).data;
    expect((await getDb().select().from(bookings)).length).toBe(before);
    expect(p.booked).toBeNull();
    expect(p.plan.unassigned.map((u) => u.label)).toEqual(["CHAdeMO car"]);
    expect(p.excludedChargers.map((c) => c.code).sort()).toEqual(["BK-01-INSP", "BK-01-OFF"]);
    const map = new Map(p.plan.assignments.map((a) => [a.label, a]));
    expect(map.get("Van 3")!.chargerCode).toBe("BK-01-AC");
    expect(new Set([map.get("Van 1")!.chargerCode, map.get("Van 2")!.chargerCode])).toEqual(new Set(["BK-01-FAST", "BK-01-SLOW"]));

    const booked = await fleetPOST(post("/api/bookings/fleet", { ...payload, preview: false }));
    expect(booked.status).toBe(201);
    const b = (await body<Data<{ booked: Created }>>(booked)).data.booked;
    expect(b.bookings).toHaveLength(3);
    expect(b.bookings.every((x) => x.kind === "fleet")).toBe(true);
    const all = (await body<Data<{ bookings: View[] }>>(await lookupPOST(post("/api/bookings/lookup", { code: b.code })))).data.bookings;
    expect(all.map((x) => x.vehicleLabel).sort()).toEqual(["Van 1", "Van 2", "Van 3"]);

    // Cancelling one vehicle leaves the others booked.
    const one = await cancelPOST(post("/api/bookings/cancel", { code: b.code, bookingId: all[0].id }));
    const states = (await body<Data<{ bookings: View[] }>>(one)).data.bookings.map((x) => x.state).sort();
    expect(states).toEqual(["cancelled", "upcoming", "upcoming"]);
  });

  it("estimates charge time per charger from battery details", async () => {
    const res = await fleetPOST(
      post("/api/bookings/fleet", {
        stationId,
        after: iso(startIn(70)),
        driverName: "Depot",
        vehicles: [{ label: "Car", charge: { batteryKwh: 60, fromPct: 20, toPct: 80 }, connectorTypes: ["CCS2"] }],
        preview: true,
      }),
    );
    const a = (await body<Data<{ plan: { assignments: { chargerCode: string; estimated: boolean; durationMinutes: number }[] } }>>(res)).data.plan.assignments[0];
    expect(a).toMatchObject({ chargerCode: "BK-01-FAST", estimated: true });
    expect(a.durationMinutes).toBeLessThan(30);
  });

  it("validates the fleet request", async () => {
    const base = { stationId, driverName: "D", preview: true };
    expect((await fleetPOST(post("/api/bookings/fleet", { ...base, vehicles: [] }))).status).toBe(400);
    expect((await fleetPOST(post("/api/bookings/fleet", { ...base, vehicles: [{ label: "x" }] }))).status).toBe(400);
    const tooMany = Array.from({ length: BOOKING.maxFleetVehicles + 1 }, (_, i) => ({ label: `V${i}`, durationMinutes: 30 }));
    expect((await fleetPOST(post("/api/bookings/fleet", { ...base, vehicles: tooMany }))).status).toBe(400);
  });
});
