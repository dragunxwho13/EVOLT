"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

/** Two-step removal of the synthetic demo records (imported data is never touched). */
export function DemoDataControl({ synthetic }: { synthetic: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (synthetic === 0) return <p className="text-sm text-muted">No demo data is loaded.</p>;

  const remove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await apiFetch<{ stations: number }>("/api/datasets/synthetic", { method: "DELETE" });
      setMessage(`Removed ${r.stations} demo stations and everything attached to them.`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "The demo data could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" size="sm" disabled={busy} onClick={remove}>
            {busy ? "Removing…" : `Yes, remove ${synthetic} demo stations`}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
            Keep them
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => setConfirming(true)}>
          Remove demo data
        </Button>
      )}
      {message && (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
