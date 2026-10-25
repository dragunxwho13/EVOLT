"use client";

import dynamic from "next/dynamic";
import type { DistributionChartProps } from "./distribution-chart-inner";

export const DistributionChart = dynamic<DistributionChartProps>(() => import("./distribution-chart-inner"), {
  ssr: false,
  loading: () => <div className="skeleton h-56 w-full" aria-busy="true" />,
});
