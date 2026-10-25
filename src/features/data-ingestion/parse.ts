import Papa from "papaparse";
import { validationError } from "@/lib/errors";

export type RawRow = Record<string, string>;

export interface ParsedFile {
  format: "csv" | "json";
  headers: string[];
  rows: RawRow[];
}

export const MAX_ROWS = 20_000;
export const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const HARD_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function maxUploadBytes(): number {
  const configured = Number(process.env.EVOLT_MAX_UPLOAD_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return Math.min(configured, HARD_MAX_UPLOAD_BYTES);
}

export function detectFormat(fileName: string, mimeType: string): "csv" | "json" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (mimeType === "text/csv") return "csv";
  if (mimeType === "application/json") return "json";
  return null;
}

export function assertSupportedFile(fileName: string, mimeType: string): "csv" | "json" {
  const format = detectFormat(fileName, mimeType);
  if (!format) throw validationError("Only .csv and .json files are accepted.");
  return format;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw validationError("JSON records may only contain strings, numbers, booleans or null values.");
}

/**
 * Parses uploaded text as data only — nothing in the file is ever evaluated.
 * Every cell becomes a trimmed string; type conversion happens in validation.
 */
export function parseDatasetText(text: string, format: "csv" | "json"): ParsedFile {
  const content = text.replace(/^﻿/, "");
  if (!content.trim()) throw validationError("The file is empty.");

  if (format === "csv") {
    const result = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    const fatal = result.errors.find((e) => e.type === "Delimiter" || e.code === "UndetectableDelimiter");
    if (fatal) throw validationError("Could not detect the CSV delimiter. Use comma-separated values with a header row.");
    const renamed = (result.meta as { renamedHeaders?: Record<string, string> | null }).renamedHeaders;
    if (renamed && Object.keys(renamed).length > 0) throw validationError("The CSV header contains duplicate column names.");
    const headers = (result.meta.fields ?? []).filter((h) => h.length > 0);
    if (headers.length === 0) throw validationError("The CSV file has no header row.");
    if (new Set(headers).size !== headers.length) throw validationError("The CSV header contains duplicate column names.");
    if (result.data.length > MAX_ROWS) throw validationError(`The file has more than ${MAX_ROWS} rows. Split it into smaller files.`);
    const rows = result.data.map((r) => {
      const out: RawRow = {};
      for (const h of headers) out[h] = cell(r[h]);
      return out;
    });
    return { format, headers, rows };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw validationError("The JSON file is not valid JSON.");
  }
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records)
      ? (parsed as { records: unknown[] }).records
      : null;
  if (!records) throw validationError('JSON must be an array of records or an object with a "records" array.');
  if (records.length > MAX_ROWS) throw validationError(`The file has more than ${MAX_ROWS} records. Split it into smaller files.`);
  const headerSet = new Set<string>();
  for (const r of records) {
    if (!r || typeof r !== "object" || Array.isArray(r)) throw validationError("Every JSON record must be an object.");
    for (const k of Object.keys(r)) headerSet.add(k.trim());
  }
  const headers = [...headerSet];
  if (headers.length === 0) throw validationError("The JSON records have no fields.");
  const rows = records.map((r) => {
    const obj = r as Record<string, unknown>;
    const out: RawRow = {};
    for (const [k, v] of Object.entries(obj)) out[k.trim()] = cell(v);
    for (const h of headers) out[h] ??= "";
    return out;
  });
  return { format, headers, rows };
}
