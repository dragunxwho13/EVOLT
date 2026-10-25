"use client";

import dynamic from "next/dynamic";
import type { MetricTraceProps } from "./metric-trace-inner";

/** Charts are lazy-loaded so pages without history do not ship the charting code. */
export const MetricTrace = dynamic<MetricTraceProps>(() => import("./metric-trace-inner"), {
  ssr: false,
  loading: () => <div className="skeleton h-[220px] w-full" aria-busy="true" />,
});

export type { MetricTraceProps, TracePoint } from "./metric-trace-inner";
