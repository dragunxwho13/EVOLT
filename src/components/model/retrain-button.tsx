"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

export function RetrainButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const r = await apiFetch<{ targets: unknown[]; rows: number }>("/api/models/train", { method: "POST" });
            setMessage({ ok: true, text: `Re-trained ${r.targets.length} model(s) on ${r.rows.toLocaleString("en-GB")} labelled sessions.` });
            router.refresh();
          } catch (e) {
            setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Training failed." });
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw aria-hidden className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        {busy ? "Training…" : "Re-train and re-test"}
      </Button>
      {message && (
        <p role="status" className={message.ok ? "text-sm text-ok" : "text-sm text-inspect"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
