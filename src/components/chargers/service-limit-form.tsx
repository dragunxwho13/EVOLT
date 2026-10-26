"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

/** Lets an operator set the contact-resistance limit the forecast aims at. */
export function ServiceLimitForm({ chargerId, current }: { chargerId: string; current: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current !== null ? String(current) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; unlock?: boolean } | null>(null);
  const [, startTransition] = useTransition();

  const save = async (limit: number | null) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/chargers/${chargerId}/service-limit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactResistanceLimitMohm: limit }),
      });
      setMessage({ ok: true, text: limit === null ? "Default limit restored; forecast updated." : "Limit saved; forecast updated." });
      if (limit === null) setValue("");
      startTransition(() => router.refresh());
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("The limit could not be saved.", 0);
      setMessage({ ok: false, text: e.message, unlock: e.status === 401 || e.status === 503 });
    } finally {
      setBusy(false);
    }
  };

  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed <= 100;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save(parsed);
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`limit-${chargerId}`} className="text-xs font-medium text-muted">
          Your service limit (mΩ)
        </label>
        <input
          id={`limit-${chargerId}`}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 0.5"
          className={`${inputClass} h-8 w-28`}
        />
      </div>
      <Button type="submit" size="sm" variant="primary" disabled={!valid || busy}>
        {busy ? "Saving…" : "Set limit"}
      </Button>
      {current !== null && (
        <Button size="sm" disabled={busy} onClick={() => void save(null)}>
          Use default
        </Button>
      )}
      {message && (
        <p role="status" className={message.ok ? "w-full text-xs text-ok" : "w-full text-xs text-inspect"}>
          {message.text}{" "}
          {message.unlock && (
            <Link href="/company/settings" className="underline">
              Go to Settings
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
