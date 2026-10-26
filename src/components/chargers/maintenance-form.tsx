"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MAINTENANCE_ACTIONS, MAINTENANCE_ACTION_LABELS, type MaintenanceAction } from "@/config/domain";
import { Button, inputClass } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Records work done on a connector so EVOLT can check whether it worked. */
export function MaintenanceForm({ chargerId }: { chargerId: string }) {
  const router = useRouter();
  const [when, setWhen] = useState(localNow);
  const [action, setAction] = useState<MaintenanceAction>("cleaned");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; unlock?: boolean } | null>(null);
  const [, startTransition] = useTransition();

  const submit = async () => {
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) {
      setMessage({ ok: false, text: "Enter when the work was done." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/chargers/${chargerId}/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performedAt: at.toISOString(), action, note: note.trim() || null }),
      });
      setMessage({ ok: true, text: "Recorded. Take a new reading so EVOLT can check the work had an effect." });
      setNote("");
      startTransition(() => router.refresh());
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("The work could not be recorded.", 0);
      setMessage({ ok: false, text: e.message, unlock: e.status === 401 || e.status === 503 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="maint-when" className="text-[0.8125rem] font-medium text-muted">
          When
        </label>
        <input id="maint-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="maint-action" className="text-[0.8125rem] font-medium text-muted">
          Work done
        </label>
        <select id="maint-action" value={action} onChange={(e) => setAction(e.target.value as MaintenanceAction)} className={inputClass}>
          {MAINTENANCE_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {MAINTENANCE_ACTION_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label htmlFor="maint-note" className="text-[0.8125rem] font-medium text-muted">
          Note (optional)
        </label>
        <input id="maint-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="e.g. Oxidation on DC+ pin cleaned" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Record work"}
        </Button>
        {message && (
          <p role="status" className={message.ok ? "mt-2 text-sm text-ok" : "mt-2 text-sm text-inspect"}>
            {message.text}{" "}
            {message.unlock && (
              <Link href="/company/settings" className="underline">
                Go to Settings
              </Link>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
