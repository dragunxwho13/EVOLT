import { describe, expect, it } from "vitest";
import { missingRequiredFields, normalizeHeader, suggestMapping } from "@/features/data-ingestion/fields";
import {
  convertToCanonical,
  normalizeConnector,
  normalizeMetric,
  normalizeOperationalStatus,
  parseNumber,
  parseTimestamp,
} from "@/features/data-ingestion/normalize";
import { assertSupportedFile, parseDatasetText } from "@/features/data-ingestion/parse";
import { observationKey, planObservations, planRegistry } from "@/features/data-ingestion/plan";
import { AppError } from "@/lib/errors";

const NOW = new Date("2026-06-01T00:00:00Z");

describe("parsing", () => {
  it("parses CSV with a BOM, trimmed headers and blank lines", () => {
    const p = parseDatasetText("﻿ charger_code , value\nA, 1\n\nB,2\n", "csv");
    expect(p.headers).toEqual(["charger_code", "value"]);
    expect(p.rows).toEqual([
      { charger_code: "A", value: "1" },
      { charger_code: "B", value: "2" },
    ]);
  });

  it("parses JSON arrays and {records} objects as data only", () => {
    expect(parseDatasetText('[{"a":1,"b":null}]', "json").rows).toEqual([{ a: "1", b: "" }]);
    expect(parseDatasetText('{"records":[{"a":"x"},{"b":true}]}', "json").rows).toEqual([
      { a: "x", b: "" },
      { a: "", b: "true" },
    ]);
  });

  it("rejects malformed input with clear messages", () => {
    expect(() => parseDatasetText("", "csv")).toThrow(/empty/);
    expect(() => parseDatasetText("{not json", "json")).toThrow(/not valid JSON/);
    expect(() => parseDatasetText('{"x":1}', "json")).toThrow(/records/);
    expect(() => parseDatasetText('[{"a":{"nested":1}}]', "json")).toThrow(AppError);
    expect(() => parseDatasetText("a,a\n1,2", "csv")).toThrow(/duplicate column/);
    expect(() => assertSupportedFile("data.xlsx", "application/vnd.ms-excel")).toThrow(/\.csv and \.json/);
  });
});

describe("normalisation", () => {
  it("requires timezones on timestamps but accepts date-only values as UTC", () => {
    expect(parseTimestamp("2026-05-01T10:00:00Z")).toMatchObject({ ok: true });
    expect(parseTimestamp("2026-05-01T10:00:00+05:30")).toMatchObject({ ok: true });
    expect(parseTimestamp("2026-05-01")).toEqual({ ok: true, value: new Date("2026-05-01T00:00:00Z") });
    expect(parseTimestamp("2026-05-01 10:00")).toMatchObject({ ok: false });
    expect(parseTimestamp("yesterday")).toMatchObject({ ok: false });
  });

  it("never turns an empty value into zero", () => {
    expect(parseNumber("", "Value")).toEqual({ ok: false, error: "Value is missing." });
    expect(parseNumber("1e-3", "Value")).toEqual({ ok: true, value: 0.001 });
    expect(parseNumber("12abc", "Value").ok).toBe(false);
  });

  it("normalises connectors, statuses and metrics", () => {
    expect(normalizeConnector("Type 2")).toEqual({ ok: true, value: "Type2" });
    expect(normalizeConnector("ccs2")).toEqual({ ok: true, value: "CCS2" });
    expect(normalizeConnector("GB/T")).toEqual({ ok: true, value: "GBT" });
    expect(normalizeConnector("Schuko").ok).toBe(false);
    expect(normalizeOperationalStatus("Out of service")).toEqual({ ok: true, value: "offline" });
    expect(normalizeOperationalStatus("")).toEqual({ ok: true, value: "unknown" });
    expect(normalizeMetric("Contact resistance (mohm)")).toEqual({ ok: true, value: "contact_resistance" });
  });

  it("converts units to the canonical unit and rejects unknown units", () => {
    expect(convertToCanonical("contact_resistance", 0.0003, "ohm")).toEqual({ ok: true, value: 0.3 });
    expect(convertToCanonical("voltage_drop", 0.032, "V")).toEqual({ ok: true, value: 32 });
    expect(convertToCanonical("contact_resistance", 1, "furlong").ok).toBe(false);
  });

  it("suggests column mappings from common aliases", () => {
    expect(normalizeHeader(" Rated Power (kW) ")).toBe("rated_power");
    const m = suggestMapping("observations", ["EVSE ID", "Timestamp", "Metric", "Reading", "Units"]);
    expect(m).toMatchObject({ charger_code: "EVSE ID", observed_at: "Timestamp", metric: "Metric", value: "Reading", unit: "Units" });
    expect(missingRequiredFields("observations", { ...m, unit: null })).toEqual(["unit"]);
  });
});

describe("planObservations", () => {
  const mapping = { charger_code: "c", observed_at: "t", metric: "m", value: "v", unit: "u", provenance: "p", source: null };
  const ids = new Map([["CH-1", "id-1"]]);
  const row = (c: string, t: string, m: string, v: string, u: string, p = "") => ({ c, t, m, v, u, p });

  it("accepts, rejects, de-duplicates and skips rows with row-level reasons", () => {
    const rows = [
      row("CH-1", "2026-05-01T00:00:00Z", "contact_resistance", "0.3", "mΩ"),
      row("CH-1", "2026-05-01T00:00:00Z", "contact_resistance", "0.31", "mΩ"), // in-file duplicate
      row("CH-2", "2026-05-01T00:00:00Z", "contact_resistance", "0.3", "mΩ"), // unknown charger
      row("CH-1", "2026-05-02T00:00:00Z", "contact_resistance", "", "mΩ"), // missing value
      row("CH-1", "2026-05-03T00:00:00Z", "contact_resistance", "900", "mΩ"), // implausible
      row("CH-1", "2030-01-01T00:00:00Z", "contact_resistance", "0.3", "mΩ"), // future
      row("CH-1", "2026-05-04T00:00:00Z", "fault_count", "1.5", "count"), // non-integer faults
      row("CH-1", "2026-05-05T00:00:00Z", "voltage_drop", "0.03", "V", "derived"),
      { c: "", t: "", m: "", v: "", u: "", p: "" }, // blank
    ];
    const plan = planObservations(rows, mapping, ids, new Set(), NOW, "observed");
    expect(plan.counts).toEqual({ total: 9, accepted: 2, rejected: 5, duplicate: 1, skipped: 1 });
    expect(plan.candidates[1]).toMatchObject({ metric: "voltage_drop", value: 30, provenance: "derived", sourceUnit: "V" });
    expect(plan.issues.find((i) => i.row === 4)?.message).toMatch(/missing/);
    expect(plan.issues.find((i) => i.row === 3)?.message).toMatch(/Unknown charger/);
  });

  it("reports rows already stored as duplicates", () => {
    const rows = [row("CH-1", "2026-05-01T00:00:00Z", "contact_resistance", "0.3", "mΩ")];
    const existing = new Set([observationKey("id-1", "contact_resistance", new Date("2026-05-01T00:00:00Z"))]);
    const plan = planObservations(rows, mapping, ids, existing, NOW, "observed");
    expect(plan.counts.duplicate).toBe(1);
    expect(plan.candidates).toHaveLength(0);
  });
});

describe("planRegistry", () => {
  const mapping = {
    station_code: "s",
    station_name: "n",
    latitude: "lat",
    longitude: "lng",
    charger_code: "c",
    connector_type: "t",
    rated_power_kw: "p",
    operational_status: "st",
  };
  const r = (s: string, n: string, lat: string, lng: string, c: string, t = "CCS2", p = "60", st = "") => ({ s, n, lat, lng, c, t, p, st });

  it("groups chargers under stations and validates coordinates honestly", () => {
    const plan = planRegistry(
      [
        r("S1", "One", "13.0", "80.2", "C1"),
        r("S1", "One", "13.0", "80.2", "C2", "Type 2", "22", "in use"),
        r("S2", "Two", "", "", "C3"),
        r("S3", "Three", "13.0", "", "C4"), // half coordinates
        r("S4", "Four", "0", "0", "C5"), // placeholder coordinates
        r("S1", "One renamed", "13.0", "80.2", "C6"), // conflicting station attributes
        r("S2", "Two", "", "", "C3"), // duplicate charger
        r("S5", "Five", "", "", "C7", "CCS2", "-5"),
      ],
      mapping,
      new Map(),
    );
    expect(plan.stations.map((s) => s.code)).toEqual(["S1", "S2"]);
    expect(plan.stations[1]).toMatchObject({ latitude: null, longitude: null });
    expect(plan.chargers.map((c) => c.code)).toEqual(["C1", "C2", "C3"]);
    expect(plan.chargers[1]).toMatchObject({ connectorType: "Type2", operationalStatus: "in_use", ratedPowerKw: 22 });
    expect(plan.counts).toMatchObject({ accepted: 3, rejected: 4, duplicate: 1 });
  });

  it("refuses to move an existing charger to another station and marks updates", () => {
    const plan = planRegistry([r("S1", "One", "", "", "C1"), r("S2", "Two", "", "", "C2")], mapping, new Map([["C1", "S1"], ["C2", "S9"]]));
    expect(plan.chargers).toEqual([expect.objectContaining({ code: "C1", isUpdate: true })]);
    expect(plan.issues[0]!.message).toMatch(/moving chargers/);
  });
});
