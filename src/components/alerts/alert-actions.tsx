"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AlertStatus } from "@/config/domain";
import { Button, inputClass } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

const ACTIONS: Record<AlertStatus, { to: AlertStatus; label: string; variant: "primary" | "secondary" | "danger" }[]> = {
  open: [
    { to: "acknowledged", label: "Acknowledge", variant: "primary" },
    { to: "resolved", label: "Mark resolved", variant: "secondary" },
    { to: "dismissed", label: "Dismiss as not relevant", variant: "danger" },
  ],
  acknowledged: [
    { to: "resolved", label: "Mark resolved", variant: "primary" },
    { to: "open", label: "Reopen", variant: "secondary" },
    { to: "dismissed", label: "Dismiss as not relevant", variant: "danger" },
  ],
  resolved: [],
  dismissed: [],
};

const DONE: Record<AlertStatus, string> = {
  open: "Reopened",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function AlertActions({ alertId, status }: { alertId: string; status: AlertStatus }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<AlertStatus | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; needsUnlock?: boolean } | null>(null);
  const [, startTransition] = useTransition();
  const actions = ACTIONS[status];

  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted">
        This alert is {status}. Closed alerts are final; if new evidence appears, the analysis raises a new alert.
      </p>
    );
  }

  const submit = async (to: AlertStatus) => {
    setPending(to);
    setMessage(null);
    try {
      await apiFetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, note: note.trim() || null }),
      });
      setMessage({ tone: "ok", text: `${DONE[to]}.` });
      setNote("");
      startTransition(() => router.refresh());
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("The status could not be changed.", 0);
      setMessage({ tone: "error", text: e.message, needsUnlock: e.status === 401 || e.status === 503 });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="alert-note" className="text-[0.8125rem] font-medium text-muted">
          Note (optional, saved with the status change)
        </label>
        <textarea
          id="alert-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className={`${inputClass} mt-1 h-auto py-2`}
          placeholder="e.g. Contacts cleaned on site, re-measured 0.31 mΩ"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a.to} variant={a.variant} disabled={pending !== null} onClick={() => submit(a.to)}>
            {pending === a.to ? "Saving…" : a.label}
          </Button>
        ))}
      </div>
      {message && (
        <p role="status" className={message.tone === "ok" ? "text-sm text-ok" : "text-sm text-inspect"}>
          {message.text}{" "}
          {message.needsUnlock && (
            <Link href="/settings" className="underline">
              Go to Settings
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
