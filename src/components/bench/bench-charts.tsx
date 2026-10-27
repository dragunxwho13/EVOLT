"use client";

import dynamic from "next/dynamic";

const skeleton = () => <div className="skeleton h-[240px] w-full" aria-busy="true" />;

export const ConnectorTraces = dynamic(() => import("./bench-charts-inner").then((m) => m.ConnectorTraces), { ssr: false, loading: skeleton });
export const LayerBars = dynamic(() => import("./bench-charts-inner").then((m) => m.LayerBars), { ssr: false, loading: skeleton });
export const RelativeVoltageScatter = dynamic(() => import("./bench-charts-inner").then((m) => m.RelativeVoltageScatter), { ssr: false, loading: skeleton });
export type { BarDatum, CalibrationPoint, TracePoint } from "./bench-charts-inner";
