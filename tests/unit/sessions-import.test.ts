import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectKind, suggestMapping } from "@/features/data-ingestion/fields";
import { parseTimestamp } from "@/features/data-ingestion/normalize";
import { parseDatasetText } from "@/features/data-ingestion/parse";
import { planSessions, sessionKey } from "@/features/data-ingestion/plan";
import { importOptionsSchema } from "@/lib/validation/schemas";

const NOW = new Date("2026-10-25T00:00:00Z");
const csv = readFileSync("public/samples/ev-charging-grid-sessions.csv", "utf8");
const parsed = parseDatasetText(csv, "csv");

describe("file type detection", () => {
  it("recognises each supported format from its headers", () => {
    expect(detectKind(parsed.headers)).toMatchObject({ kind: "sessions", confidence: "high" });
    expect(detectKind(["charger_code", "observed_at", "metric", "value", "unit"]).kind).toBe("observations");
    expect(detectKind(["station_code", "station_name", "charger_code", "connector_type", "latitude", "longitude"]).kind).toBe("registry");
    expect(detectKind(["foo", "bar"]).confidence).toBe("low");
  });
});

describe("timestamps without a timezone", () => {
  it("are rejected unless a timezone is chosen, then converted to UTC", () => {
    expect(parseTimestamp("2024-01-01 00:15:00").ok).toBe(false);
    expect(parseTimestamp("2024-01-01 00:15:00", 0)).toEqual({ ok: true, value: new Date("2024-01-01T00:15:00Z") });
    expect(parseTimestamp("2024-01-01 05:45", 330)).toEqual({ ok: true, value: new Date("2024-01-01T00:15:00Z") });
  });

  it("parse the timezone option", () => {
    expect(importOptionsSchema.parse({ kind: "sessions" }).timezone).toBe(0);
    expect(importOptionsSchema.parse({ timezone: "+05:30" }).timezone).toBe(330);
    expect(importOptionsSchema.parse({ timezone: "-04:00" }).timezone).toBe(-240);
    expect(importOptionsSchema.parse({ timezone: "none" }).timezone).toBeNull();
    expect(importOptionsSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(importOptionsSchema.parse({}).kind).toBe("auto");
  });
});

describe("planSessions on the bundled dataset", () => {
  const mapping = suggestMapping("sessions", parsed.headers);
  const plan = planSessions(parsed.rows, parsed.headers, mapping, new Set(), NOW, 0);

  it("maps the dataset's columns automatically", () => {
    expect(mapping).toMatchObject({
      station_code: "station_id",
      observed_at: "timestamp",
      charging_mode: "charging_type",
      area: "location",
      power_loss: "power_loss",
      voltage_fluctuation: "voltage_fluctuation",
      power_loss_label: "reduced_power_loss_category",
      voltage_stability_label: "voltage_stability_category",
    });
  });

  it("creates one charger per station and charging type and keeps every session", () => {
    expect(plan.counts).toMatchObject({ total: 1000, accepted: 1000, rejected: 0, duplicate: 0 });
    expect(plan.stations).toHaveLength(19);
    expect(plan.chargers).toHaveLength(57);
    expect(plan.chargers.every((c) => c.connectorType === "Unknown")).toBe(true);
    expect(plan.chargers.map((c) => c.code)).toContain("ST-07-FAST");
    expect(plan.sessions[0]!.values).toHaveProperty("power_loss");
    expect(plan.sessions[0]!.values).not.toHaveProperty("station_id");
    expect(plan.labelColumns.map((l) => l.column)).toEqual(["reduced_power_loss_category", "voltage_stability_category"]);
  });

  it("states the dataset's data-quality problems plainly", () => {
    const text = plan.findings.map((f) => f.message).join("\n");
    expect(text).toMatch(/19 of 19 stations appear with more than one area/);
    expect(text).toMatch(/35 session\(s\) report more power lost than consumed/);
    expect(text).toMatch(/derived, not an independent measurement/);
  });

  it("reports re-imported sessions as duplicates", () => {
    const first = plan.sessions[0]!;
    const again = planSessions(parsed.rows, parsed.headers, mapping, new Set([sessionKey(first.chargerCode, first.startedAt)]), NOW, 0);
    expect(again.counts.duplicate).toBe(1);
    expect(again.counts.accepted).toBe(999);
  });

  it("still describes the whole file when every session is already stored", () => {
    const all = new Set(plan.sessions.map((s) => sessionKey(s.chargerCode, s.startedAt)));
    const again = planSessions(parsed.rows, parsed.headers, mapping, all, NOW, 0);
    expect(again.counts).toMatchObject({ accepted: 0, duplicate: 1000 });
    expect(again.file).toMatchObject({ stations: 19, chargers: 57, sessions: 1000 });
    expect(again.labelColumns.every((l) => l.classes.length === 3)).toBe(true);
    expect(again.findings.map((f) => f.message).join(" ")).toMatch(/more power lost than consumed/);
  });

  it("rejects invalid rows with reasons and never treats blanks as zero", () => {
    const rows = [
      { station_id: "1", timestamp: "2024-01-01 00:00:00", charging_type: "Fast", power_loss: "999" },
      { station_id: "1", timestamp: "not a date", charging_type: "Fast", power_loss: "1" },
      { station_id: "1", timestamp: "2024-01-01 00:15:00", charging_type: "Fast", power_loss: "" },
    ];
    const headers = ["station_id", "timestamp", "charging_type", "power_loss"];
    const p = planSessions(rows, headers, suggestMapping("sessions", headers), new Set(), NOW, 0);
    expect(p.counts).toMatchObject({ accepted: 1, rejected: 2 });
    expect(p.issues.map((i) => i.message).join(" ")).toMatch(/Implausible power_loss/);
    expect(p.sessions[0]!.values).not.toHaveProperty("power_loss");
  });
});
