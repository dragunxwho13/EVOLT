"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui/primitives";
import type { WorkflowStatus } from "@/features/insights/service";
import { ApiError, apiFetch } from "@/lib/http/client";

type Target = "reviewed" | "resolved" | "dismissed" | "open";

const ACTIONS: Record<WorkflowStatus, { to: Target; label: string; variant: "primary" | "secondary" | "danger" }[]> = {
  new: [
    { to: "reviewed", label: "Mark reviewed", variant: "primary" },
    { to: "resolved", label: "Mark resolved", variant: "secondary" },
    { to: "dismissed", label: "Dismiss", variant: "danger" },
  ],
  reviewed: [
    { to: "resolved", label: "Mark resolved", variant: "primary" },
    { to: "open", label: "Reopen", variant: "secondary" },
    { to: "dismissed", label: "Dismiss", variant: "danger" },
  ],
  resolved: [{ to: "open", label: "Reopen", variant: "secondary" }],
  dismissed: [{ to: "open", label: "Reopen", variant: "secondary" }],
  acknowledged: [],
};

/** Workflow buttons for a dataset-derived action item. Saves to the server; shows real errors. */
export function ReviewControls({ insightKey, status }: { insightKey: string; status: WorkflowStatus }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const submit = async (to: Target) => {
    setPending(to);
    setError(null);
    try {
      await apiFetch("/api/insights/review", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: insightKey, status: to, note: note.trim() || null }),
      });
      setNote("");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The change could not be saved.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted" htmlFor={`note-${insightKey}`}>
        Note (optional)
      </label>
      <input
        id={`note-${insightKey}`}
        className={inputClass}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was checked or decided"
      />
      <div className="flex flex-wrap gap-2">
        {ACTIONS[status].map((a) => (
          <Button key={a.to} size="sm" variant={a.variant} disabled={pending !== null} onClick={() => submit(a.to)}>
            {pending === a.to ? "Saving…" : a.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-inspect">
          {error}
        </p>
      )}
    </div>
  );
}
