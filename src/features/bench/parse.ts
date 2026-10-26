/**
 * Parses the Arduino bench log (Time_s, C1_V, C1_mA, C1_Deg_pct, … C3_Deg_pct, Avg_Deg_pct)
 * into one record per connector and time step. Values are kept exactly as logged: blanks stay
 * null, zeros stay zero. Pure and dependency-free.
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
  /** The file's own average-degradation column, kept for cross-checking. */
  avgDegradation: { timeS: number; value: number | null }[];
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
  const need = ["Time_s", ...BENCH_CONNECTORS.flatMap((c) => [`${c}_V`, `${c}_mA`, `${c}_Deg_pct`])];
  const missing = need.filter((h) => !header.includes(h));
  if (missing.length) throw new Error(`Bench file is missing column(s): ${missing.join(", ")}.`);
  const idx = (h: string) => header.indexOf(h);
  const records: BenchRecord[] = [];
  const avgDegradation: BenchParse["avgDegradation"] = [];
  const seen = new Set<number>();
  lines.slice(1).forEach((line, i) => {
    const row = i + 1;
    const cells = line.split(",");
    const timeS = num(cells[idx("Time_s")], "Time_s", row, true)!;
    if (seen.has(timeS)) throw new Error(`Row ${row}: duplicate Time_s ${timeS}.`);
    seen.add(timeS);
    for (const c of BENCH_CONNECTORS) {
      records.push({
        connector: c,
        timeS,
        voltageV: num(cells[idx(`${c}_V`)], `${c}_V`, row, true)!,
        currentMa: num(cells[idx(`${c}_mA`)], `${c}_mA`, row, true)!,
        degradationPct: num(cells[idx(`${c}_Deg_pct`)], `${c}_Deg_pct`, row, false),
        sourceRow: row,
      });
    }
    avgDegradation.push({ timeS, value: idx("Avg_Deg_pct") >= 0 ? num(cells[idx("Avg_Deg_pct")], "Avg_Deg_pct", row, false) : null });
  });
  return { records, rows: lines.length - 1, avgDegradation };
}
