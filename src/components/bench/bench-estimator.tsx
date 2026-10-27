"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/http/client";
import { formatNumber } from "@/lib/utils/format";

interface EstimateResponse {
  input: { referenceV: number; customReference: boolean };
  estimate: { voltageV: number; referenceV: number; ratio: number; degradationPct: number; aboveReference: boolean; extrapolated: boolean };
  model: { intercept: number; slope: number; heldOutMae: number };
  realWorld: { realVoltageLostV: number; realHeatW: number; realExtraOhm: number; voltageShareLost: number } | null;
  note: string;
}

/** Runs the saved bench model on a typed bench voltage, for a bench connector or a new one. */
export function BenchEstimator({
  connector,
  scenario,
  scenarioLabel,
  references,
}: {
  connector: string;
  scenario: string;
  scenarioLabel: string;
  references: Record<string, number>;
}) {
  const [voltage, setVoltage] = useState("1.7");
  const [target, setTarget] = useState(connector);
  const [customRef, setCustomRef] = useState("3.30");
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ voltage, connector: target === "new" ? connector : target, scenario });
      if (target === "new") params.set("referenceV", customRef);
      setResult(await apiFetch<EstimateResponse>(`/api/bench/estimate?${params}`));
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
          <label htmlFor="bench-target" className="text-[0.8125rem] font-medium text-muted">
            Connector
          </label>
          <select id="bench-target" className={`${inputClass} w-44`} value={target} onChange={(e) => setTarget(e.target.value)}>
            {Object.entries(references).map(([c, v]) => (
              <option key={c} value={c}>
                {c} (healthy {formatNumber(v, 3)} V)
              </option>
            ))}
            <option value="new">A new connector…</option>
          </select>
        </div>
        {target === "new" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="bench-ref" className="text-[0.8125rem] font-medium text-muted">
              Its healthy level (V)
            </label>
            <input id="bench-ref" inputMode="decimal" value={customRef} onChange={(e) => setCustomRef(e.target.value)} className={`${inputClass} w-28`} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="bench-voltage" className="text-[0.8125rem] font-medium text-muted">
            Bench voltage (V)
          </label>
          <input id="bench-voltage" inputMode="decimal" value={voltage} onChange={(e) => setVoltage(e.target.value)} className={`${inputClass} w-28`} />
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
              ({formatNumber(result.estimate.voltageV, 3)} V is {formatNumber(result.estimate.ratio * 100, 1)} % of the healthy {formatNumber(result.estimate.referenceV, 3)} V;
              held-out error {formatNumber(result.model.heldOutMae, 2)} points{result.estimate.extrapolated ? "; near open circuit, below the fitted range" : ""})
            </span>
          </p>
          {result.estimate.aboveReference ? (
            <p className="text-muted">At or above the healthy level: reported as 0 %, and no real-world loss is implied.</p>
          ) : result.realWorld ? (
            <p className="text-muted">
              Same state at {scenarioLabel}: {formatNumber(result.realWorld.realVoltageLostV, 0)} V lost and {formatNumber(result.realWorld.realHeatW, 0)} W of heat in the
              connector (Method A estimate).
            </p>
          ) : (
            <p className="text-muted">0 V is an open circuit: no current flows, so there is no heat to scale.</p>
          )}
          <p className="text-xs text-faint">{result.note}</p>
        </div>
      )}
    </div>
  );
}
