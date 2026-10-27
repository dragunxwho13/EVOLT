"use client";

import { Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { BOOKING } from "@/config/booking";
import { CONNECTOR_LABELS, KNOWN_CONNECTOR_TYPES, type ConnectorType } from "@/config/domain";
import { Button, Field, Notice, Panel, inputClass } from "@/components/ui/primitives";
import { bookingDateOf, formatBookingDate, formatBookingTime } from "@/features/booking/schedule";
import type { FleetResult } from "@/features/booking/service";
import { ApiError, apiFetch } from "@/lib/http/client";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { Confirmation } from "./slot-booker";
import { saveCode } from "./saved-codes";

interface Row {
  key: number;
  label: string;
  connector: ConnectorType | "";
  mode: "duration" | "battery";
  duration: number;
  battery: string;
  fromPct: string;
  toPct: string;
  finishBy: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
/** datetime-local value, read as IST wall-clock time. */
const toIstIso = (local: string) => (local ? `${local}:00+05:30` : undefined);

function newRow(key: number, connector: ConnectorType | ""): Row {
  return { key, label: `Vehicle ${key}`, connector, mode: "duration", duration: 60, battery: "", fromPct: "20", toPct: "80", finishBy: "" };
}

export function FleetPlanner({ station, connectorTypes }: { station: { id: string; name: string }; connectorTypes: ConnectorType[] }) {
  const defaultConnector = connectorTypes.length === 1 ? connectorTypes[0] : "";
  const [rows, setRows] = useState<Row[]>([newRow(1, defaultConnector), newRow(2, defaultConnector)]);
  const [nextKey, setNextKey] = useState(3);
  const [after, setAfter] = useState("");
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<FleetResult | null>(null);
  const [busy, setBusy] = useState<"plan" | "book" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: NonNullable<FleetResult["booked"]>; saved: boolean } | null>(null);

  if (done) return <Confirmation result={done.result} saved={done.saved} />;

  const update = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setPlan(null);
  };

  function payload(preview: boolean) {
    return {
      stationId: station.id,
      after: toIstIso(after),
      driverName: name.trim(),
      preview,
      vehicles: rows.map((r) => ({
        label: r.label.trim() || `Vehicle ${r.key}`,
        ...(r.connector ? { connectorTypes: [r.connector] } : {}),
        ...(r.mode === "duration"
          ? { durationMinutes: r.duration }
          : { charge: { batteryKwh: Number(r.battery), fromPct: Number(r.fromPct), toPct: Number(r.toPct) } }),
        ...(r.finishBy ? { finishBy: toIstIso(r.finishBy) } : {}),
      })),
    };
  }

  async function run(preview: boolean) {
    setBusy(preview ? "plan" : "book");
    setError(null);
    try {
      const result = await apiFetch<FleetResult>("/api/bookings/fleet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(preview)),
      });
      if (result.booked) {
        const saved = saveCode(result.booked.code, `${result.booked.bookings.length} vehicles · ${station.name}`);
        setDone({ result: result.booked, saved });
      } else {
        setPlan(result);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The plan could not be made. Try again.");
      if (!preview) setPlan(null);
    } finally {
      setBusy(null);
    }
  }

  const canPlan = rows.length > 0 && name.trim().length > 0 && busy === null;

  return (
    <div className="space-y-5">
      <Panel
        title="Vehicles"
        description={`Up to ${BOOKING.maxFleetVehicles}. Give each one a charging time, or its battery details and EVOLT estimates the time on each charger.`}
        actions={
          <Button
            size="sm"
            disabled={rows.length >= BOOKING.maxFleetVehicles}
            onClick={() => {
              setRows((rs) => [...rs, newRow(nextKey, defaultConnector)]);
              setNextKey((k) => k + 1);
              setPlan(null);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add vehicle
          </Button>
        }
        flush
      >
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.key} className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[1.1fr_1fr_1.6fr_1.1fr_auto] lg:items-end">
              <Field label="Name" htmlFor={`fl-label-${r.key}`}>
                <input id={`fl-label-${r.key}`} className={inputClass} maxLength={BOOKING.maxVehicleLabelLength} value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} />
              </Field>
              <Field label="Connector" htmlFor={`fl-conn-${r.key}`}>
                <select id={`fl-conn-${r.key}`} className={inputClass} value={r.connector} onChange={(e) => update(r.key, { connector: e.target.value as ConnectorType | "" })}>
                  <option value="">Any at this station</option>
                  {KNOWN_CONNECTOR_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {CONNECTOR_LABELS[c]}
                      {connectorTypes.includes(c) ? "" : " (none here)"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted">
                  Charging
                  <button type="button" className="text-xs font-normal text-signal underline-offset-2 hover:underline" onClick={() => update(r.key, { mode: r.mode === "duration" ? "battery" : "duration" })}>
                    {r.mode === "duration" ? "use battery details" : "set a time instead"}
                  </button>
                </span>
                {r.mode === "duration" ? (
                  <select aria-label={`Charging time for vehicle ${i + 1}`} className={inputClass} value={r.duration} onChange={(e) => update(r.key, { duration: Number(e.target.value) })}>
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {d < 60 ? `${d} min` : `${d / 60} h`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    <input aria-label={`Battery kWh, vehicle ${i + 1}`} placeholder="kWh" inputMode="decimal" className={inputClass} value={r.battery} onChange={(e) => update(r.key, { battery: e.target.value })} />
                    <input aria-label={`Charge now %, vehicle ${i + 1}`} inputMode="numeric" className={inputClass} value={r.fromPct} onChange={(e) => update(r.key, { fromPct: e.target.value })} />
                    <input aria-label={`Charge to %, vehicle ${i + 1}`} inputMode="numeric" className={inputClass} value={r.toPct} onChange={(e) => update(r.key, { toPct: e.target.value })} />
                  </div>
                )}
              </div>
              <Field label={`Finish by (${BOOKING.timeZoneLabel}, optional)`} htmlFor={`fl-by-${r.key}`}>
                <input id={`fl-by-${r.key}`} type="datetime-local" className={inputClass} value={r.finishBy} onChange={(e) => update(r.key, { finishBy: e.target.value })} />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${r.label || `vehicle ${i + 1}`}`}
                disabled={rows.length === 1}
                onClick={() => {
                  setRows((rs) => rs.filter((x) => x.key !== r.key));
                  setPlan(null);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Booking">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name for the booking" htmlFor="fl-name" hint="e.g. your name or company. No account needed.">
            <input id="fl-name" className={inputClass} maxLength={BOOKING.maxNameLength} value={name} onChange={(e) => { setName(e.target.value); setPlan(null); }} />
          </Field>
          <Field label={`Earliest start (${BOOKING.timeZoneLabel}, optional)`} htmlFor="fl-after" hint="Leave empty to start as soon as possible.">
            <input id="fl-after" type="datetime-local" className={inputClass} value={after} onChange={(e) => { setAfter(e.target.value); setPlan(null); }} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-inspect">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!canPlan} onClick={() => run(true)}>
            {busy === "plan" ? "Planning…" : "Plan the schedule"}
          </Button>
          {!name.trim() && <span className="self-center text-xs text-faint">Add a name for the booking to continue.</span>}
        </div>
      </Panel>

      {plan && <PlanView plan={plan} onBook={() => run(false)} booking={busy === "book"} />}
    </div>
  );
}

function PlanView({ plan, onBook, booking }: { plan: FleetResult; onBook: () => void; booking: boolean }) {
  const { assignments, unassigned, finishesAt, rules } = plan.plan;
  const late = assignments.filter((a) => a.late);
  return (
    <Panel
      title="Proposed schedule"
      description={
        finishesAt
          ? `The last vehicle finishes ${formatBookingDate(bookingDateOf(new Date(finishesAt)))}, ${formatBookingTime(new Date(finishesAt))} ${BOOKING.timeZoneLabel}. Nothing is booked until you confirm.`
          : undefined
      }
      flush
    >
      {assignments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Proposed schedule">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium sm:px-5">Vehicle</th>
                <th className="px-4 py-2 font-medium">Charger</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Length</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {assignments.map((a) => (
                <tr key={a.index} className={cn(a.late && "bg-watch-soft/50")}>
                  <td className="px-4 py-2.5 font-medium sm:px-5">{a.label}</td>
                  <td className="num px-4 py-2.5">{a.chargerCode}</td>
                  <td className="num px-4 py-2.5">
                    {a.window}
                    {a.late && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-watch">
                        <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> after its finish-by time
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-2.5">
                    {formatNumber(a.durationMinutes, 0)} min{a.estimated && <span className="text-muted"> (estimated)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {unassigned.length > 0 && (
          <Notice tone="warn">
            Not placed: {unassigned.map((u) => `${u.label} — ${u.reason}`).join(" ")}
          </Notice>
        )}
        {late.length > 0 && <Notice tone="warn">{late.length} vehicle{late.length === 1 ? " finishes" : "s finish"} after the finish-by time you set. This is the earliest they can finish here.</Notice>}
        {plan.excludedChargers.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted">
            {plan.excludedChargers.map((c) => (
              <li key={c.code}>
                Not used: <span className="num">{c.code}</span> — {c.reason}
              </li>
            ))}
          </ul>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">How the schedule is made</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
        {assignments.length > 0 && (
          <Button variant="primary" onClick={onBook} disabled={booking}>
            {booking ? "Booking…" : `Book ${assignments.length === 1 ? "this vehicle" : `all ${assignments.length} vehicles`}`}
          </Button>
        )}
      </div>
    </Panel>
  );
}
