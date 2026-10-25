"use client";

import dynamic from "next/dynamic";
import type { TrendChartProps } from "./trend-chart-inner";

export const TrendChart = dynamic<TrendChartProps>(() => import("./trend-chart-inner"), {
  ssr: false,
  loading: () => <div className="skeleton h-[180px] w-full" aria-busy="true" />,
});
