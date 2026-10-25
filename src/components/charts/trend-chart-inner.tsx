"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendChartProps {
  /** Accessible description of what the line shows. */
  label: string;
  points: { x: string; y: number | null }[];
  /** Formats values for axis ticks and the tooltip. */
  kind: "count" | "percent" | "kwh";
  reference?: { value: number; label: string };
  height?: number;
}

function fmt(kind: TrendChartProps["kind"], v: number): string {
  if (kind === "percent") return `${Math.round(v * 100)}%`;
  if (kind === "kwh") return `${Math.round(v).toLocaleString("en-GB")} kWh`;
  return Math.round(v).toLocaleString("en-GB");
}

function day(x: string) {
  return new Date(`${x}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/** A single-series line (one measure, one axis), with a crosshair tooltip. */
export default function TrendChartInner({ label, points, kind, reference, height = 180 }: TrendChartProps) {
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="x" tickFormatter={day} tick={{ fontSize: 11, fill: "var(--ink-muted)" }} stroke="var(--line-strong)" minTickGap={18} />
          <YAxis
            tickFormatter={(v: number) => fmt(kind, v)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            stroke="var(--line-strong)"
            width={kind === "kwh" ? 70 : 44}
            domain={kind === "percent" ? [0, (max: number) => Math.min(1, Math.max(0.1, max * 1.2))] : [0, "auto"]}
          />
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke="var(--ink-faint)"
              strokeDasharray="4 4"
              label={{ value: reference.label, position: "insideTopRight", fontSize: 11, fill: "var(--ink-muted)" }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
            labelFormatter={(x) => day(String(x))}
            formatter={(v) => [typeof v === "number" ? fmt(kind, v) : "—", label]}
          />
          <Line type="monotone" dataKey="y" stroke="var(--signal)" strokeWidth={2} dot={{ r: 3, fill: "var(--signal)", stroke: "var(--surface)", strokeWidth: 1 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
