"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils/format";

export interface TracePoint {
  t: number;
  value: number;
}

export interface MetricTraceProps {
  label: string;
  unit: string;
  points: TracePoint[];
  baseline: { median: number; from: string; to: string } | null;
  threshold: number | null;
  highlightWindow?: { start: string; end: string } | null;
  height?: number;
}

const tickDate = (t: number) => formatDate(new Date(t)).replace(/ \d{4}$/, "");

/**
 * Instrument-style trace: the baseline period is shaded, the baseline median and
 * deviation threshold are drawn as reference lines, and readings above the
 * threshold are marked with a different shape (not just a different colour).
 */
export default function MetricTraceInner({ label, unit, points, baseline, threshold, highlightWindow, height = 220 }: MetricTraceProps) {
  const data = points.map((p) => ({
    t: p.t,
    value: p.value,
    over: threshold !== null && p.value > threshold ? p.value : null,
  }));
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, baseline?.median ?? Infinity);
  const hi = Math.max(...values, threshold ?? -Infinity);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const unitSuffix = unit === "count" ? "" : ` ${unit}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink" /> Recorded reading</span>
        {baseline && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[var(--trace-band)]" /> Usual starting period</span>}
        {threshold !== null && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-inspect" /> Needs a closer look</span>}
      </div>
      <div style={{ height }} className="w-full" role="img" aria-label={`${label} over time, ${points.length} readings`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={tickDate}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            stroke="var(--line-strong)"
            minTickGap={36}
          />
          <YAxis
            domain={[Math.max(0, lo - pad), hi + pad]}
            tickFormatter={(v: number) => formatNumber(v)}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            stroke="var(--line-strong)"
            width={52}
          />
          {baseline && (
            <ReferenceArea
              x1={new Date(baseline.from).getTime()}
              x2={new Date(baseline.to).getTime()}
              fill="var(--trace-band)"
              stroke="none"
              label={{ value: "Baseline period", position: "insideTopLeft", fontSize: 11, fill: "var(--ink-muted)" }}
            />
          )}
          {highlightWindow && (
            <ReferenceArea
              x1={new Date(highlightWindow.start).getTime()}
              x2={new Date(highlightWindow.end).getTime()}
              fill="var(--inspect)"
              fillOpacity={0.07}
              stroke="var(--inspect)"
              strokeOpacity={0.3}
              strokeDasharray="3 3"
            />
          )}
          {baseline && (
            <ReferenceLine
              y={baseline.median}
              stroke="var(--ink-muted)"
              strokeDasharray="5 4"
              label={{ value: "Baseline median", position: "insideBottomRight", fontSize: 11, fill: "var(--ink-muted)" }}
            />
          )}
          {threshold !== null && (
            <ReferenceLine
              y={threshold}
              stroke="var(--inspect)"
              strokeDasharray="2 3"
              label={{ value: "Deviation threshold", position: "insideTopRight", fontSize: 11, fill: "var(--inspect)" }}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--ink)",
            }}
            labelFormatter={(t) => formatDateTime(new Date(Number(t)))}
            formatter={(v, name) => (name === "over" ? [] : [`${formatNumber(Number(v))}${unitSuffix}`, label])}
          />
          <Line
            dataKey="value"
            type="linear"
            stroke="var(--ink)"
            strokeWidth={1.5}
            dot={{ r: 2.5, fill: "var(--surface)", stroke: "var(--ink)", strokeWidth: 1.2 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
          <Scatter dataKey="over" fill="var(--inspect)" shape="diamond" legendType="none" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">Read left to right: compare recent readings with the shaded starting period. Diamonds mark readings above the analysis threshold.</p>
    </div>
  );
}
