"use client";

import { Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

export function AdminSession({ configured, authenticated }: { configured: boolean; authenticated: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(authenticated);

  if (!configured) {
    return (
      <p className="text-sm text-muted">
        Editing is disabled because <code className="num text-ink">EVOLT_ADMIN_TOKEN</code> is not set on the server (it must be at
        least 16 characters). Add it to <code className="num">.env.local</code> or the Vercel project settings and redeploy.
      </p>
    );
  }

  if (unlocked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-ok">
          <LockOpen aria-hidden className="h-4 w-4" />
          Editing is unlocked in this browser for up to 8 hours.
        </p>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await apiFetch("/api/session", { method: "DELETE" });
              setUnlocked(false);
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Lock aria-hidden className="h-4 w-4" />
          Lock editing
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!token.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await apiFetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token.trim() }),
          });
          setToken("");
          setUnlocked(true);
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Editing could not be unlocked.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Admin token" htmlFor="admin-token" hint="Kept in an httpOnly cookie as a signed session; the token itself is not stored in the browser.">
        <input
          id="admin-token"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "admin-token-error" : undefined}
        />
      </Field>
      {error && (
        <p id="admin-token-error" role="alert" className="text-sm text-inspect">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy || !token.trim()}>
        <LockOpen aria-hidden className="h-4 w-4" />
        {busy ? "Checking…" : "Unlock editing"}
      </Button>
    </form>
  );
}
