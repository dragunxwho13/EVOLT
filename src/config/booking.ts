/**
 * Driver slot and queue booking: every rule in one place. Dependency-free so the
 * browser (slot picker) and the server (validation, conflict checks) share it.
 */
export const BOOKING = {
  /** Start times are offered on this grid (minutes). */
  slotStepMinutes: 15,
  /**
   * Gap kept free after every booking before the next one may start. It absorbs a
   * session that overruns or a driver who arrives a little late, so one delay does
   * not cascade into the next driver's slot.
   */
  bufferMinutes: 10,
  minDurationMinutes: 15,
  maxDurationMinutes: 240,
  /** How far ahead a slot can be booked. */
  horizonDays: 7,
  /** "Join the queue" never offers a start sooner than this from now (time to drive there). */
  minLeadMinutes: 10,
  /** Vehicles in one fleet booking. */
  maxFleetVehicles: 6,
  /** Shown to drivers: how long a booked slot is held after its start time. */
  graceMinutes: 10,
  /**
   * Stations in the data are in India, so the day grid and every displayed time use IST.
   * IST has no daylight saving, which keeps the day boundaries a fixed offset.
   */
  timeZone: "Asia/Kolkata",
  timeZoneLabel: "IST",
  utcOffsetMinutes: 330,
  /** Charge-time estimate: share of charger power that reaches the battery. */
  chargeEfficiency: 0.9,
  /** Ceiling for AC charging when the vehicle's onboard charger limit is unknown (kW). */
  acOnboardLimitKw: 11,
  /**
   * The booking's free-text fields: lengths are capped and no contact details are asked for,
   * because the booking code (not an account) is what identifies a booking.
   */
  maxNameLength: 60,
  maxVehicleLabelLength: 40,
} as const;

/** Health states in which a charger does not take new bookings. */
export const NOT_BOOKABLE_HEALTH = ["inspection_recommended"] as const;
/** Operational states in which a charger does not take new bookings. */
export const NOT_BOOKABLE_STATUS = ["offline"] as const;
