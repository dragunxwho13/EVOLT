"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/utils/format";

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, color: "var(--ink)" };
const axis = { fontSize: 11, fill: "var(--ink-muted)" };
const COLORS = { C1: "var(--signal)", C2: "var(--watch)", C3: "var(--ok)" } as const;

export interface TracePoint {
  t: number;
  C1: number | null;
  C2: number | null;
  C3: number | null;
}

/** Raw bench voltage of each connector over the run — one line per connector, never averaged. */
export function ConnectorTraces({ points, healthyV, degradedV }: { points: TracePoint[]; healthyV: number; degradedV: number }) {
  return (
    <div className="space-y-2">
      <div style={{ height: 260 }} role="img" aria-label="Voltage of connectors C1, C2 and C3 over the bench run">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={axis} stroke="var(--line-strong)" unit=" s" />
            <YAxis domain={[0, 4.6]} tick={axis} stroke="var(--line-strong)" width={44} unit=" V" />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => `${t} s`} formatter={(v, n) => [`${formatNumber(Number(v), 3)} V`, String(n)]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {(["C1", "C2", "C3"] as const).map((c) => (
              <Line key={c} dataKey={c} name={c} type="linear" stroke={COLORS[c]} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">
        Experimental circuit, as logged. Healthy level ≈ {formatNumber(healthyV, 2)} V; worn level ≈ {formatNumber(degradedV, 2)} V. Zero readings are the start of
        the run and one dropout at 10 s.
      </p>
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  layer: "experimental" | "estimate" | "reference";
  note?: string;
}

const LAYER_FILL = { experimental: "var(--ink)", estimate: "var(--signal)", reference: "var(--ok)" } as const;

/** Horizontal bars on a log axis, coloured by where the number comes from. */
export function LayerBars({ data, unit, label, log = true }: { data: BarDatum[]; unit: string; label: string; log?: boolean }) {
  const positive = data.map((d) => d.value).filter((v) => v > 0);
  // Explicit decade bounds so the smallest bar is never cut off on a log axis.
  const domain: [number, number] | [number, "auto"] = log && positive.length
    ? [10 ** Math.floor(Math.log10(Math.min(...positive))), 10 ** Math.ceil(Math.log10(Math.max(...positive)))]
    : [0, "auto"];
  return (
    <div style={{ height: Math.max(180, data.length * 46) }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            scale={log ? "log" : "linear"}
            domain={domain}
            allowDataOverflow={false}
            tick={axis}
            stroke="var(--line-strong)"
            tickFormatter={(v: number) => formatNumber(v, 2)}
          />
          <YAxis type="category" dataKey="label" width={190} tick={axis} stroke="var(--line-strong)" />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${formatNumber(Number(v), 3)} ${unit}`, label]} />
          <Bar dataKey="value" isAnimationActive={false} label={{ position: "right", fontSize: 11, fill: "var(--ink)", formatter: (v: unknown) => `${formatNumber(Number(v), 2)} ${unit}` }}>
            {data.map((d) => (
              <Cell key={d.label} fill={LAYER_FILL[d.layer]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
