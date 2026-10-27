import { z } from "zod";
import { BOOKING } from "@/config/booking";
import { KNOWN_CONNECTOR_TYPES } from "@/config/domain";

const uuid = z.string().uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const duration = z.coerce.number().int().min(BOOKING.minDurationMinutes).max(BOOKING.maxDurationMinutes);
const isoInstant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
const driverName = z.string().trim().min(1, "Enter a name for the booking.").max(BOOKING.maxNameLength);
const vehicleLabel = z.preprocess(blankToUndefined, z.string().trim().max(BOOKING.maxVehicleLabelLength).optional());

/** Query strings ignore unknown parameters (tracking or share tokens). */
export const availabilityQuerySchema = z
  .object({
    chargerId: uuid,
    date: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.").optional()),
    duration: z.preprocess(blankToUndefined, duration.default(60)),
  })
  .strip();

export const bookingCreateSchema = z
  .object({
    chargerId: uuid,
    /** Omit to join the queue: the earliest start that fits. */
    start: isoInstant.optional(),
    durationMinutes: duration,
    driverName,
    vehicleLabel,
  })
  .strict();

const fleetVehicle = z
  .object({
    label: z.string().trim().min(1, "Name each vehicle.").max(BOOKING.maxVehicleLabelLength),
    durationMinutes: duration.optional(),
    charge: z
      .object({
        batteryKwh: z.number().positive().max(300),
        fromPct: z.number().min(0).max(99),
        toPct: z.number().min(1).max(100),
        vehicleMaxKw: z.number().positive().max(1500).optional().nullable(),
      })
      .strict()
      .refine((c) => c.toPct > c.fromPct, { message: "Target charge must be above the current charge." })
      .optional(),
    connectorTypes: z.array(z.enum(KNOWN_CONNECTOR_TYPES)).max(6).optional(),
    finishBy: isoInstant.optional().nullable(),
  })
  .strict()
  .refine((v) => Boolean(v.durationMinutes) !== Boolean(v.charge), {
    message: "Give each vehicle either a duration or its battery details, not both.",
  });

export const fleetRequestSchema = z
  .object({
    stationId: uuid,
    /** Earliest start for the whole fleet; defaults to now. */
    after: isoInstant.optional(),
    driverName,
    vehicles: z.array(fleetVehicle).min(1).max(BOOKING.maxFleetVehicles),
    /** true = return the plan only; false = book it. */
    preview: z.boolean().default(true),
  })
  .strict();

export const bookingCodeSchema = z
  .string()
  .trim()
  .transform((s) => {
    const clean = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Strip the "EV" prefix only when it is a prefix: a bare code can itself start with "EV".
    return clean.length === 12 && clean.startsWith("EV") ? clean.slice(2) : clean;
  })
  .pipe(z.string().length(10, "A booking code has 10 letters and digits after “EV”."));

export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
export type FleetRequest = z.infer<typeof fleetRequestSchema>;
