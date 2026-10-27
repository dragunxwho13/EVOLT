/**
 * Parses the Arduino bench log (Time_s, Connector1_V, Connector1_mA, Connector1_Deg_%, …
 * Connector3_Deg_%) into one record per connector and time step. Values are kept exactly as
 * logged: zeros stay zero and a blank degradation cell would stay null. Pure and dependency-free.
 */
export const BENCH_CONNECTORS = ["C1", "C2", "C3"] as const;
export type BenchConnector = (typeof BENCH_CONNECTORS)[number];

export interface BenchRecord {
  connector: BenchConnector;
  timeS: number;
  voltageV: number;
  currentMa: number;
  degradationPct: number | null;
  sourceRow: number;
}

export interface BenchParse {
  records: BenchRecord[];
  /** Rows in the file (excluding the header). */
  rows: number;
}

/** The log's column names for connector C1–C3 (number 1–3 in the file). */
export function benchColumns(c: BenchConnector) {
  const n = c.slice(1);
  return { voltage: `Connector${n}_V`, current: `Connector${n}_mA`, degradation: `Connector${n}_Deg_%` };
}

function num(raw: string | undefined, field: string, row: number, required: boolean): number | null {
  const s = (raw ?? "").trim();
  if (s === "") {
    if (required) throw new Error(`Row ${row}: ${field} is missing.`);
    return null;
  }
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`Row ${row}: ${field} "${s}" is not a number.`);
  return v;
}

export function parseBenchCsv(text: string): BenchParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0]?.split(",").map((h) => h.trim()) ?? [];
  const need = ["Time_s", ...BENCH_CONNECTORS.flatMap((c) => Object.values(benchColumns(c)))];
  const missing = need.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`Bench file is missing column(s): ${missing.join(", ")}.`);
  const idx = (h: string) => header.indexOf(h);
  const records: BenchRecord[] = [];
  const seen = new Set<number>();
  lines.slice(1).forEach((line, i) => {
    const row = i + 1;
    const cells = line.split(",");
    const timeS = num(cells[idx("Time_s")], "Time_s", row, true)!;
    if (seen.has(timeS)) throw new Error(`Row ${row}: duplicate Time_s ${timeS}.`);
    seen.add(timeS);
    for (const c of BENCH_CONNECTORS) {
      const col = benchColumns(c);
      records.push({
        connector: c,
        timeS,
        voltageV: num(cells[idx(col.voltage)], col.voltage, row, true)!,
        currentMa: num(cells[idx(col.current)], col.current, row, true)!,
        degradationPct: num(cells[idx(col.degradation)], col.degradation, row, false),
        sourceRow: row,
      });
    }
  });
  return { records, rows: lines.length - 1 };
}
