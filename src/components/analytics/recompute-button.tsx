"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";

interface RecomputeResult {
  chargersEvaluated: number;
  alertsCreated: number;
  alertsUpdated: number;
  alertsDeactivated: number;
}

export function RecomputeButton() {
  const router = useRouter();
  const [state, setState] = useState<{ status: "idle" | "running" } | { status: "done"; r: RecomputeResult } | { status: "error"; message: string; unlock: boolean }>({
    status: "idle",
  });

  const run = async () => {
    setState({ status: "running" });
    try {
      const r = await apiFetch<RecomputeResult>("/api/analytics/recompute", { method: "POST" });
      setState({ status: "done", r });
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("Analysis could not be run.", 0);
      setState({ status: "error", message: err.message, unlock: err.status === 401 || err.status === 503 });
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button onClick={run} disabled={state.status === "running"}>
        <RefreshCw aria-hidden className={state.status === "running" ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        {state.status === "running" ? "Running analysis…" : "Re-run analysis"}
      </Button>
      <p role="status" className="text-sm">
        {state.status === "done" && (
          <span className="text-ok">
            Evaluated {state.r.chargersEvaluated} chargers: {state.r.alertsCreated} new, {state.r.alertsUpdated} updated,{" "}
            {state.r.alertsDeactivated} no longer detected.
          </span>
        )}
        {state.status === "error" && (
          <span className="text-inspect">
            {state.message}{" "}
            {state.unlock && (
              <Link className="underline" href="/company/settings">
                Settings
              </Link>
            )}
          </span>
        )}
      </p>
    </div>
  );
}
