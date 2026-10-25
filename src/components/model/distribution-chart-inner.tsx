"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/utils/format";

export interface DistributionChartProps {
  feature: string;
  unit: string;
  groups: { label: string; values: number[] }[];
  cuts: number[];
}

const COLORS = ["var(--ok)", "var(--watch)", "var(--inspect)", "var(--signal)", "var(--unknown)"];
const SHAPES = ["circle", "diamond", "triangle", "square", "cross"] as const;

/**
 * Strip plot: one row per true class, each dot one session's value; the learned cut
 * points are drawn as vertical lines. Shows at a glance why the thresholds work.
 */
export default function DistributionChartInner({ feature, unit, groups, cuts }: DistributionChartProps) {
  const series = groups.map((g, gi) =>
    g.values.map((v, i) => ({
      x: v,
      // Deterministic jitter keeps dots from overlapping without randomness between renders.
      y: gi + (((i * 37) % 100) / 100 - 0.5) * 0.55,
      label: g.label,
    })),
  );
  return (
    <div style={{ height: 84 + groups.length * 56 }} className="w-full" role="img" aria-label={`${feature} by class with learned cut points ${cuts.map((c) => formatNumber(c)).join(" and ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 24, right: 16, bottom: 18, left: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            dataKey="x"
            name={feature}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            stroke="var(--line-strong)"
            tickFormatter={(v: number) => formatNumber(v)}
            label={{ value: `${feature}${unit ? ` (${unit})` : ""}`, position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--ink-muted)" }}
            domain={["dataMin", "dataMax"]}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-0.6, groups.length - 0.4]}
            ticks={groups.map((_, i) => i)}
            tickFormatter={(v: number) => groups[Math.round(v)]?.label ?? ""}
            tick={{ fontSize: 12, fill: "var(--ink)" }}
            stroke="var(--line-strong)"
            width={78}
          />
          {cuts.map((c, i) => (
            <ReferenceLine
              key={i}
              x={c}
              stroke="var(--ink)"
              strokeDasharray="4 3"
              label={{ value: `cut ${formatNumber(c)}`, position: "top", fontSize: 11, fill: "var(--ink)" }}
            />
          ))}
          <Tooltip
            cursor={false}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
            formatter={(v, name) => (name === "y" ? [] : [formatNumber(Number(v)), feature])}
            labelFormatter={() => ""}
          />
          {series.map((data, gi) => (
            <Scatter
              key={groups[gi]!.label}
              data={data}
              fill={COLORS[gi % COLORS.length]}
              fillOpacity={0.55}
              shape={SHAPES[gi % SHAPES.length]}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
