"use client";

import { useState } from "react";
import { Button, Field, inputClass } from "@/components/ui/primitives";
import type { PredictionResult } from "@/features/learning/service";
import { ApiError, apiFetch } from "@/lib/http/client";
import { formatNumber, formatPercent } from "@/lib/utils/format";

export interface ClassifyFeature {
  key: string;
  label: string;
  min: number | null;
  max: number | null;
}

/** Calls the prediction endpoint with validated inputs and shows the result with its accuracy and rule. */
export function ClassifyForm({ target, features }: { target: string; features: ClassifyFeature[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const parsed: Record<string, number> = {};
    for (const f of features) {
      const raw = (values[f.key] ?? "").trim();
      const n = Number(raw);
      if (!raw || !Number.isFinite(n)) {
        setError(`Enter a number for ${f.label}.`);
        return;
      }
      parsed[f.key] = n;
    }
    setPending(true);
    try {
      setResult(
        await apiFetch<PredictionResult>("/api/models/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, values: parsed }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The prediction could not be made.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="space-y-3">
        {features.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            htmlFor={`cls-${target}-${f.key}`}
            hint={f.min !== null && f.max !== null ? `Training range ${formatNumber(f.min, 2)}–${formatNumber(f.max, 2)}` : undefined}
          >
            <input
              id={`cls-${target}-${f.key}`}
              inputMode="decimal"
              className={inputClass}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Classifying…" : "Classify"}
        </Button>
      </div>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-inspect">
            {error}
          </p>
        )}
        {result && (
          <div className="rounded-md bg-sunken p-4 text-sm">
            <p className="text-muted">Predicted category</p>
            <p className="mt-0.5 text-2xl font-semibold">{result.predicted}</p>
            <p className="mt-2">{result.explanation}</p>
            <p className="mt-2 text-muted">
              {result.modelName}: {formatPercent(result.accuracy, 1)} correct on unseen sessions (always guessing the most common class:{" "}
              {formatPercent(result.baselineAccuracy, 1)}). A prediction, not a measurement.
            </p>
            {result.warnings.map((w) => (
              <p key={w} className="mt-2 text-watch">
                {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}
