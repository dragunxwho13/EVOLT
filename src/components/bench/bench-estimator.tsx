"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";
import { formatNumber } from "@/lib/utils/format";

interface EstimateResponse {
  estimate: { voltageV: number; degradationPct: number; extrapolated: boolean };
  model: { intercept: number; slope: number; heldOutMae: number };
  realWorld: { realVoltageLostV: number; realHeatW: number; realExtraOhm: number; voltageShareLost: number } | null;
  note: string;
}

/** Runs the saved bench calibration on a typed bench voltage. */
export function BenchEstimator({ connector, scenario, scenarioLabel }: { connector: string; scenario: string; scenarioLabel: string }) {
  const [voltage, setVoltage] = useState("2.4");
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<EstimateResponse>(`/api/bench/estimate?voltage=${encodeURIComponent(voltage)}&connector=${connector}&scenario=${scenario}`);
      setResult(res);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "The estimate could not be calculated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="bench-voltage" className="text-[0.8125rem] font-medium text-muted">
            Bench voltage on {connector} (V, experimental circuit)
          </label>
          <input id="bench-voltage" inputMode="decimal" value={voltage} onChange={(e) => setVoltage(e.target.value)} className={`${inputClass} w-40`} />
        </div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Calculating…" : "Estimate"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-inspect">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-1 rounded-md border border-line bg-sunken px-3 py-2.5 text-sm">
          <p>
            <span className="font-medium text-ink">Bench degradation index: {formatNumber(result.estimate.degradationPct, 1)} %</span>{" "}
            <span className="text-muted">
              (calibration {formatNumber(result.model.intercept, 2)} {result.model.slope < 0 ? "−" : "+"} {formatNumber(Math.abs(result.model.slope), 2)} × V; held-out error{" "}
              {formatNumber(result.model.heldOutMae, 2)} points{result.estimate.extrapolated ? "; below the fitted range" : ""})
            </span>
          </p>
          {result.realWorld ? (
            <p className="text-muted">
              Same state at {scenarioLabel}: {formatNumber(result.realWorld.realVoltageLostV, 0)} V lost and {formatNumber(result.realWorld.realHeatW, 0)} W of heat in the
              connector (Method A estimate).
            </p>
          ) : (
            <p className="text-muted">At or above the healthy level: no real-world loss is implied.</p>
          )}
          <p className="text-xs text-faint">{result.note}</p>
        </div>
      )}
    </div>
  );
}
