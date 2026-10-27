# Slot and queue booking (drivers)

[← Back to README](../README.md)

Drivers can reserve charging time before they set off, so the charger is free when they
arrive. This is a driver-side feature only: the company workspace is unchanged.

| Option | What the driver does | What EVOLT does |
|---|---|---|
| **Book a slot** | Picks a day (today + 7 days) and a start time on the quarter hour | Offers only starts where the whole session *and* the gap after it fit |
| **Join the queue** | Asks for the next opening | Returns the earliest start after the session ahead and its gap, and says how many booked sessions are ahead |
| **Book several vehicles** | Lists up to 6 vehicles at one station, each with a charging time or battery details, and optional finish-by times | Plans them across the station's chargers, shows the plan, and books it under one code when the driver confirms |
| **My bookings** | Opens the bookings saved in this browser, or types a code | Shows each session as upcoming, in progress, finished or cancelled; upcoming ones can be cancelled |

Entry points: **Book a slot** on each charger of a station page and on every search result, **Book
several vehicles** on the station page, and **My bookings** in the driver navigation.

## The gap between drivers

Every booking reserves its charging time **plus a 10-minute buffer after it**. The next booking on
that charger may start only when the buffer has passed:

```
 Driver A  ██████████████▒▒▒          ▒ = 10-minute gap kept free
 Driver B                    ████████████▒▒▒
           10:00        11:00 11:10        12:10
```

If driver A finishes late, or driver B arrives a little early, neither runs into the other's time.
The rule is checked in both directions: a new booking may not start inside an earlier booking's gap,
and its own gap must end before a later booking starts. The buffer is stored with each booking, so
changing the setting later never makes existing bookings overlap. A slot is held for 10 minutes after
its start time; drivers are told to arrive by their start time.

## Charge-time estimate

A driver who does not know how long to book can enter battery size, current charge and target. The
estimate is shown with its assumptions and is not a promise:

- power = the charger's rated power, capped at the vehicle's DC limit (when a vehicle profile is
  chosen) or at 11 kW on AC (a typical onboard charger);
- 90% of that power reaches the battery;
- on DC, charging above 80% is assumed to run at half power;
- rounded up to 5 minutes and kept between 15 minutes and 4 hours.

Chargers without a recorded power rating cannot be estimated; the driver chooses a length instead.

## Fleet plan

The plan follows a rule-based fleet scheduler (inspired by the EVOS fleet scheduling reference):

1. Vehicles with a finish-by time go first, earliest deadline first; then longer charges.
2. Each vehicle takes the compatible charger where it would **finish** soonest, so a faster charger
   can win even if it frees up a little later. With battery details, the time is estimated per charger.
3. Every session keeps the 10-minute gap, including between the fleet's own vehicles.
4. A vehicle that cannot meet its finish-by time is still placed at its earliest finish and marked late.
   A vehicle with no compatible connector at the station is listed as not placed, with the reason.

Nothing is booked until the driver presses **Book all**; the bookings are then made in one
transaction under one code. Each vehicle can be cancelled on its own afterwards.

## Which chargers take bookings

Chargers reported **offline**, or with an **inspection recommended** by the connector-health analysis,
do not take new bookings and say why. Existing bookings are not cancelled automatically.

## No accounts: the booking code

The driver side has no sign-in, so a booking is identified by a random code such as
`EV-7KQ3P-9XMDA` (10 symbols from 31, ≈ 49 bits). It is shown once, saved in the browser for
*My bookings* when the browser allows it, and stored on the server only as a SHA-256 hash. Anyone with
the code can view or cancel that booking, so drivers are told to keep it private. Codes are sent in the
request body, never in a URL, so they do not end up in logs or browser history.

Booking writes need no admin token, even when the site runs in token mode, because drivers have no
token. They are protected instead by: same-site requests only, strict validation (no unknown fields,
names ≤ 60 characters, vehicle labels ≤ 40, lengths 15–240 minutes, starts on a 5-minute mark, at least
10 minutes ahead and at most 7 days ahead), and a per-charger database lock that makes simultaneous
requests for the same time succeed at most once. Availability shows busy periods but never names.

## Time zone

The stations in the data are in India, so the day grid and every displayed time are **IST**
(UTC+05:30, no daylight saving). Times are stored in UTC.

## Limits

- No live occupancy: a booking does not know whether the previous driver has actually left. The gap
  and the grace period are the protection.
- No payment, reminders or notifications.
- No accounts, so there is no per-driver limit on how many slots one person books.
- Opening hours are not in the data, so every charger is bookable around the clock.

## Configuration

All rules live in [`src/config/booking.ts`](../src/config/booking.ts): slot step (15 min), buffer
(10 min), grace (10 min), minimum lead (10 min), length limits, horizon (7 days), fleet size (6),
time zone and the estimate's assumptions. The scheduling logic is pure and unit-tested in
[`src/features/booking/schedule.ts`](../src/features/booking/schedule.ts).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bookings/availability?chargerId=&date=YYYY-MM-DD&duration=60` | Slots for one day, busy periods with their gaps, and the next queue start |
| POST | `/api/bookings` | `{chargerId, start?, durationMinutes, driverName, vehicleLabel?}`: with `start` books that slot; without it joins the queue. Returns the code once (201); 409 with `details.nextStart` when the time is taken |
| POST | `/api/bookings/fleet` | `{stationId, after?, driverName, vehicles[], preview}`: returns the plan; with `preview: false` books it (201) |
| POST | `/api/bookings/lookup` | `{code}`: the sessions under a code |
| POST | `/api/bookings/cancel` | `{code, bookingId?}`: cancels all upcoming sessions under the code, or one |

Each vehicle in a fleet request gives `durationMinutes` **or** `charge: {batteryKwh, fromPct, toPct}`,
plus optional `connectorTypes` and `finishBy`.
