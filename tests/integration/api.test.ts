import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { GET as alertsGET } from "@/app/api/alerts/route";
import { GET as alertGET, PATCH as alertPATCH } from "@/app/api/alerts/[id]/route";
import { POST as recomputePOST } from "@/app/api/analytics/recompute/route";
import { GET as overviewGET } from "@/app/api/analytics/overview/route";
import { GET as chargerGET } from "@/app/api/chargers/[id]/route";
import { GET as maintenanceGET, POST as maintenancePOST } from "@/app/api/chargers/[id]/maintenance/route";
import { PUT as limitPUT } from "@/app/api/chargers/[id]/service-limit/route";
import { GET as fleetRepairsGET } from "@/app/api/maintenance/route";
import { GET as benchGET } from "@/app/api/bench/route";
import { GET as benchEstimateGET } from "@/app/api/bench/estimate/route";
import { BENCH_RUN } from "@/config/scaling";
import { parseBenchCsv } from "@/features/bench/parse";
import { loadBench } from "../../database/seed/bench";
import { GET as datasetsGET, POST as datasetsPOST } from "@/app/api/datasets/route";
import { POST as previewPOST } from "@/app/api/datasets/preview/route";
import { DELETE as syntheticDELETE } from "@/app/api/datasets/synthetic/route";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as performanceGET } from "@/app/api/company/performance/route";
import { GET as insightsGET } from "@/app/api/insights/route";
import { PUT as reviewPUT } from "@/app/api/insights/review/route";
import { POST as predictPOST } from "@/app/api/models/predict/route";
import { GET as modelsGET } from "@/app/api/models/route";
import { GET as recommendationsGET } from "@/app/api/recommendations/route";
import { POST as sensorPOST } from "@/app/api/sensor-readings/route";
import { GET as stationsGET } from "@/app/api/stations/route";
import { GET as stationGET } from "@/app/api/stations/[id]/route";
import { getDb } from "@/lib/db/client";
import { alerts, benchReadings, chargers, chargingSessions, healthObservations, modelRuns, stations } from "@/lib/db/schema";
import { toErrorResponse } from "@/lib/errors";
import { ADMIN, body, ctx, degradingObservationsCsv, uploadRequest } from "./helpers";

const registryCsv = readFileSync("public/samples/registry-example.csv", "utf8");
const observationsCsv = readFileSync("public/samples/observations-example.csv", "utf8");
const sessionsCsv = readFileSync("public/samples/ev-charging-grid-sessions.csv", "utf8");
const get = (path: string) => new NextRequest(`http://localhost${path}`);

type Data<T> = { data: T };

describe("API and persistence", () => {
  it("reports health with the database connected and migrated", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ status: "ok", database: "ok", writesEnabled: true });
  });

  it("refuses imports without the admin token", async () => {
    const res = await previewPOST(uploadRequest("/api/datasets/preview", { name: "r.csv", content: registryCsv }, { kind: "registry" }, {}));
    expect(res.status).toBe(401);
    expect(await body(res)).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects unsupported and oversized uploads", async () => {
    const bad = await previewPOST(uploadRequest("/api/datasets/preview", { name: "r.xlsx", content: "x" }, { kind: "registry" }));
    expect(bad.status).toBe(400);
    const huge = await previewPOST(
      uploadRequest("/api/datasets/preview", { name: "r.csv", content: "a\n" + "x".repeat(3 * 1024 * 1024) }, { kind: "registry" }),
    );
    expect(huge.status).toBe(413);
    const badKind = await previewPOST(uploadRequest("/api/datasets/preview", { name: "r.csv", content: registryCsv }, { kind: "people" }));
    expect(badKind.status).toBe(400);
  });

  it("previews a registry without writing, then imports it in a transaction", async () => {
    const preview = await previewPOST(uploadRequest("/api/datasets/preview", { name: "registry.csv", content: registryCsv }, { kind: "registry" }));
    expect(preview.status).toBe(200);
    const p = (await body<Data<{ counts: { accepted: number }; canCommit: boolean; mapping: Record<string, string | null> }>>(preview)).data;
    expect(p.counts.accepted).toBe(3);
    expect(p.canCommit).toBe(true);
    expect(p.mapping.latitude).toBe("latitude");
    expect(await getDb().select().from(stations)).toHaveLength(0);

    const commit = await datasetsPOST(uploadRequest("/api/datasets", { name: "registry.csv", content: registryCsv }, { kind: "registry" }));
    expect(commit.status).toBe(201);
    const c = (await body<Data<{ inserted: number; analysis: { chargersEvaluated: number } }>>(commit)).data;
    expect(c.inserted).toBe(3);
    expect(c.analysis.chargersEvaluated).toBe(3);

    const rows = await getDb().select().from(chargers);
    expect(rows.map((r) => r.healthStatus)).toEqual(["insufficient_data", "insufficient_data", "insufficient_data"]);
    const [noCoords] = await getDb().select().from(stations).where(eq(stations.code, "EX-02"));
    expect(noCoords!.latitude).toBeNull();
  });

  it("blocks importing the identical file twice", async () => {
    const again = await datasetsPOST(uploadRequest("/api/datasets", { name: "registry-copy.csv", content: registryCsv }, { kind: "registry" }));
    expect(again.status).toBe(409);
  });

  it("imports observations, reports row-level problems and re-runs analysis", async () => {
    const res = await datasetsPOST(
      uploadRequest("/api/datasets", { name: "obs.csv", content: observationsCsv }, { kind: "observations", defaultProvenance: "observed" }),
    );
    expect(res.status).toBe(201);
    const r = (await body<Data<{ counts: Record<string, number>; inserted: number; issues: { row: number; kind: string }[] }>>(res)).data;
    // The timezone-less row is read as UTC (the import default) and duplicates an existing reading.
    expect(r.counts).toMatchObject({ accepted: 42, rejected: 5, duplicate: 2 });
    expect(r.inserted).toBe(42);
    expect(r.issues.filter((i) => i.kind === "rejected")).toHaveLength(5);

    const [ch] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-A"));
    expect(ch!.healthEvaluatedAt).not.toBeNull();
    expect(ch!.healthSummary?.metrics.length).toBe(3);
    // The sample file is dated mid-2026, so the assessment must flag it as stale rather than call it current.
    expect(ch!.healthSummary?.stale).toBe(true);
    const stored = await getDb().select().from(healthObservations).where(eq(healthObservations.chargerId, ch!.id));
    expect(stored.every((o) => o.provenance === "simulated")).toBe(true);
    // voltage drop supplied in V is stored in mV
    expect(stored.find((o) => o.metric === "voltage_drop")!.value).toBeGreaterThan(10);
  });

  it("treats re-sent rows in a different file as duplicates, not new data", async () => {
    const subset = observationsCsv.split("\n").slice(0, 6).join("\n") + "\n";
    const res = await previewPOST(
      uploadRequest("/api/datasets/preview", { name: "subset.csv", content: subset }, { kind: "observations" }),
    );
    const p = (await body<Data<{ counts: Record<string, number>; canCommit: boolean }>>(res)).data;
    expect(p.counts).toMatchObject({ accepted: 0, duplicate: 5 });
    expect(p.canCommit).toBe(false);
  });

  it("creates explainable alerts, de-duplicates them on re-analysis and persists status changes", async () => {
    const res = await datasetsPOST(
      uploadRequest("/api/datasets", { name: "degrading.csv", content: degradingObservationsCsv("EX-01-B") }, { kind: "observations" }),
    );
    expect(res.status).toBe(201);
    const [ch] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-B"));
    const first = await getDb().select().from(alerts).where(eq(alerts.chargerId, ch!.id));
    expect(first.length).toBeGreaterThan(0);
    const a = first[0]!;
    expect(a.explanation.length).toBeGreaterThan(40);
    expect(a.evidence.points.length).toBeGreaterThan(0);
    expect(a.confidenceNote).toMatch(/not proof|may not continue|outliers/);

    const recompute = await recomputePOST(new Request("http://localhost/api/analytics/recompute", { method: "POST", headers: ADMIN }));
    expect(recompute.status).toBe(200);
    const after = await getDb().select().from(alerts).where(eq(alerts.chargerId, ch!.id));
    expect(after).toHaveLength(first.length);

    const list = (await body<Data<{ total: number }>>(await alertsGET(get("/api/alerts?status=active")))).data;
    expect(list.total).toBeGreaterThanOrEqual(first.length);

    const patch = (status: string) =>
      alertPATCH(
        new Request(`http://localhost/api/alerts/${a.id}`, {
          method: "PATCH",
          headers: { ...ADMIN, "content-type": "application/json" },
          body: JSON.stringify({ status, note: "checked on site" }),
        }),
        ctx(a.id),
      );
    expect((await patch("acknowledged")).status).toBe(200);
    expect((await patch("resolved")).status).toBe(200);
    expect((await patch("open")).status).toBe(409);
    const detail = (await body<Data<{ events: { toStatus: string; note: string | null }[] }>>(await alertGET(get(`/api/alerts/${a.id}`), ctx(a.id)))).data;
    expect(detail.events.map((e) => e.toStatus)).toEqual(["open", "acknowledged", "resolved"]);
    expect(detail.events[2]!.note).toBe("checked on site");

    // A resolved alert is not recreated by re-analysis of the same evidence.
    await recomputePOST(new Request("http://localhost/api/analytics/recompute", { method: "POST", headers: ADMIN }));
    const final = await getDb().select().from(alerts).where(eq(alerts.chargerId, ch!.id));
    expect(final).toHaveLength(first.length);
  });

  it("rejects malformed alert updates", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const req = (b: string) =>
      new Request(`http://localhost/api/alerts/${id}`, { method: "PATCH", headers: { ...ADMIN, "content-type": "application/json" }, body: b });
    expect((await alertPATCH(req("{"), ctx(id))).status).toBe(400);
    expect((await alertPATCH(req('{"status":"closed"}'), ctx(id))).status).toBe(400);
    expect((await alertPATCH(req('{"status":"resolved"}'), ctx(id))).status).toBe(404);
    expect((await alertPATCH(req('{"status":"resolved"}'), ctx("not-a-uuid"))).status).toBe(400);
  });

  it("searches and filters stations, sorts by straight-line distance and handles missing coordinates", async () => {
    const all = (await body<Data<{ total: number; withoutCoordinates: number }>>(await stationsGET(get("/api/stations")))).data;
    expect(all).toMatchObject({ total: 2, withoutCoordinates: 1 });
    const chademo = (await body<Data<{ items: { code: string }[] }>>(await stationsGET(get("/api/stations?connector=CHAdeMO")))).data;
    expect(chademo.items.map((s) => s.code)).toEqual(["EX-02"]);
    const near = (await body<Data<{ items: { code: string; distanceKm: number | null }[]; sortedByDistance: boolean }>>(
      await stationsGET(get("/api/stations?lat=13.06&lng=80.25")),
    )).data;
    expect(near.sortedByDistance).toBe(true);
    expect(near.items[0]!.distanceKm).toBeLessThan(1);
    expect(near.items[1]!.distanceKm).toBeNull();
    expect((await stationsGET(get("/api/stations?lat=500&lng=1"))).status).toBe(400);
    const none = (await body<Data<{ total: number }>>(await stationsGET(get("/api/stations?q=nothing-matches")))).data;
    expect(none.total).toBe(0);
  });

  it("returns station and charger details through real relationships", async () => {
    const [st] = await getDb().select().from(stations).where(eq(stations.code, "EX-01"));
    const res = await stationGET(get(`/api/stations/${st!.id}`), ctx(st!.id));
    const d = (await body<Data<{ chargers: { code: string }[] }>>(res)).data;
    expect(d.chargers.map((c) => c.code)).toEqual(["EX-01-A", "EX-01-B"]);
    const missing = await stationGET(get("/api/stations/x"), ctx("00000000-0000-4000-8000-000000000000"));
    expect(missing.status).toBe(404);

    const [ch] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-A"));
    const detail = (await body<Data<{ station: { code: string }; observations: unknown[] }>>(await chargerGET(get("/"), ctx(ch!.id)))).data;
    expect(detail.station.code).toBe("EX-01");
    expect(detail.observations.length).toBeGreaterThan(0);
  });

  it("recommends compatible alternatives and explains exclusions", async () => {
    const [ch] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-A"));
    const res = await recommendationsGET(get(`/api/recommendations?fromCharger=${ch!.id}&connector=Type2`));
    expect(res.status).toBe(200);
    const r = (await body<Data<{ recommendations: { chargerCode: string }[]; excluded: Record<string, number> }>>(res)).data;
    // EX-01-B is the only Type 2 charger nearby, but its evidence now recommends inspection.
    expect(r.recommendations).toEqual([]);
    expect(r.excluded).toMatchObject({ reference_charger: 1, no_coordinates: 1, inspection_recommended: 1 });
    const incl = (
      await body<Data<{ recommendations: { chargerCode: string; limitations: string[] }[] }>>(
        await recommendationsGET(get(`/api/recommendations?fromCharger=${ch!.id}&connector=Type2&includeInspection=true`)),
      )
    ).data;
    expect(incl.recommendations.map((x) => x.chargerCode)).toEqual(["EX-01-B"]);
    expect(incl.recommendations[0]!.limitations.join(" ")).toMatch(/recommends inspecting/);
    // EX-01-B is "in use", so asking for available chargers only is a hard constraint that removes it.
    const avail = (
      await body<Data<{ recommendations: unknown[]; excluded: Record<string, number>; hardConstraints: string[]; preferences: string[] }>>(
        await recommendationsGET(get(`/api/recommendations?fromCharger=${ch!.id}&connector=Type2&includeInspection=true&availableOnly=true`)),
      )
    ).data;
    expect(avail.recommendations).toEqual([]);
    expect(avail.excluded.not_available).toBe(1);
    expect(avail.hardConstraints.length).toBeGreaterThan(3);
    expect(avail.preferences.join(" ")).toMatch(/Price/);
    expect((await recommendationsGET(get("/api/recommendations"))).status).toBe(400);
    // Unknown query parameters are rejected rather than silently ignored.
    expect((await recommendationsGET(get(`/api/recommendations?fromCharger=${ch!.id}&latitude=1`))).status).toBe(400);
  });

  it("stores optional sensor readings without affecting health", async () => {
    const [before] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-A"));
    const res = await sensorPOST(
      new Request("http://localhost/api/sensor-readings", {
        method: "POST",
        headers: { ...ADMIN, "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: "bench-uno-1",
          chargerCode: "EX-01-A",
          readings: [{ sensor: "temp_c", value: 31.5, unit: "°C", recordedAt: "2026-05-01T10:00:00Z" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const [after] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-A"));
    expect(after!.healthStatus).toBe(before!.healthStatus);
  });

  it("lists import history and overview figures from stored data", async () => {
    expect((await datasetsGET(new NextRequest("http://localhost/api/datasets"))).status).toBe(401);
    const hist = (await body<Data<{ status: string }[]>>(await datasetsGET(new NextRequest("http://localhost/api/datasets", { headers: ADMIN })))).data;
    expect(hist.filter((h) => h.status === "completed")).toHaveLength(3);
    const o = (await body<Data<{ chargers: { total: number }; stations: { total: number } }>>(await overviewGET())).data;
    expect(o.chargers.total).toBe(3);
    expect(o.stations.total).toBe(2);
  });

  it("detects and imports a charging-session dataset, analyses chargers and trains models", async () => {
    const preview = await previewPOST(uploadRequest("/api/datasets/preview", { name: "grid.csv", content: sessionsCsv }, { kind: "auto", timezone: "UTC" }));
    expect(preview.status).toBe(200);
    const p = (await body<Data<{ kind: string; detected: { confidence: string }; sessionSummary: { stations: number; chargers: number }; findings: unknown[]; canCommit: boolean }>>(preview)).data;
    expect(p).toMatchObject({ kind: "sessions", detected: { confidence: "high" }, sessionSummary: { stations: 19, chargers: 57 }, canCommit: true });
    expect(p.findings.length).toBeGreaterThan(2);
    expect(await getDb().select().from(chargingSessions)).toHaveLength(0);

    const commit = await datasetsPOST(
      uploadRequest("/api/datasets", { name: "grid.csv", content: sessionsCsv }, { kind: "sessions", timezone: "UTC", defaultProvenance: "simulated" }),
    );
    expect(commit.status).toBe(201);
    const c = (await body<Data<{ observationsStored: number; chargersTouched: number; training: { targets: { target: string; learnable: boolean; accuracy: number }[] } }>>(commit)).data;
    expect(c.chargersTouched).toBe(57);
    expect(c.observationsStored).toBe(2000);
    const loss = c.training.targets.find((t) => t.target === "reduced_power_loss_category")!;
    const stability = c.training.targets.find((t) => t.target === "voltage_stability_category")!;
    expect(loss.learnable).toBe(true);
    expect(loss.accuracy).toBeGreaterThan(0.89);
    expect(stability.learnable).toBe(false);

    expect(await getDb().select().from(chargingSessions)).toHaveLength(1000);
    // Two labels plus the follow-up test "power-loss category without power loss".
    expect(await getDb().select().from(modelRuns)).toHaveLength(3);
    const [ch] = await getDb().select().from(chargers).where(eq(chargers.code, "ST-07-FAST"));
    expect(ch).toMatchObject({ connectorType: "Unknown", chargingMode: "Fast" });
    expect(ch!.healthSummary?.historical).toBe(true);

    const models = (await body<Data<{ stats: { sessions: number }; reports: { target: string }[] }>>(await modelsGET())).data;
    expect(models.stats.sessions).toBe(1000);
    expect(models.reports.map((r) => r.target).sort()).toEqual([
      "reduced_power_loss_category",
      "reduced_power_loss_category::without::power_loss",
      "voltage_stability_category",
    ]);
    const without = c.training.targets.find((t) => t.target.includes("::without::"))!;
    expect(without.learnable).toBe(false);
  });

  it("classifies a session with the stored model and refuses unsupported predictions", async () => {
    const predict = (b: unknown) => predictPOST(new Request("http://localhost/api/models/predict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));
    const cases: [number, string][] = [[1.0, "Low"], [3.0, "Medium"], [4.5, "High"]];
    for (const [v, expected] of cases) {
      const res = await predict({ target: "reduced_power_loss_category", values: { power_loss: v } });
      expect(res.status).toBe(200);
      const r = (await body<Data<{ predicted: string; accuracy: number; warnings: string[]; explanation: string }>>(res)).data;
      expect(r.predicted).toBe(expected);
      expect(r.accuracy).toBeGreaterThan(0.89);
      expect(r.warnings).toEqual([]);
      expect(r.explanation).toMatch(/power_loss/);
    }
    const far = (await body<Data<{ warnings: string[] }>>(await predict({ target: "reduced_power_loss_category", values: { power_loss: 40 } }))).data;
    expect(far.warnings.join(" ")).toMatch(/outside the range seen in training/);
    expect((await predict({ target: "reduced_power_loss_category", values: { voltage_level: 230 } })).status).toBe(400);
    const unlearnable = await predict({ target: "voltage_stability_category", values: { voltage_fluctuation: 3 } });
    expect(unlearnable.status).toBe(400);
    expect((await body<{ error: { message: string } }>(unlearnable)).error.message).toMatch(/does not make predictions/);
    expect((await predict({ target: "nope", values: { x: 1 } })).status).toBe(404);
    expect((await predict({ target: "reduced_power_loss_category", values: { power_loss: "high" } })).status).toBe(400);
  });

  it("computes station performance from stored sessions, with filters and a CSV export", async () => {
    const res = await performanceGET(get("/api/company/performance"));
    expect(res.status).toBe(200);
    const p = (await body<Data<{ fleet: { sessions: number; highLoss: { count: number; of: number }; lossExceedsConsumed: { count: number }; energyExceedsBattery: { count: number } }; stations: unknown[]; filters: { chargingModes: string[] } }>>(res)).data;
    // Independently computed with pandas from the source CSV.
    expect(p.fleet.sessions).toBe(1000);
    expect(p.fleet.highLoss).toMatchObject({ count: 256, of: 1000 });
    expect(p.fleet.lossExceedsConsumed.count).toBe(35);
    expect(p.fleet.energyExceedsBattery.count).toBe(302);
    expect(p.stations).toHaveLength(19);
    expect(p.filters.chargingModes).toEqual(["Conventional", "Fast", "V2G"]);
    const fast = (await body<Data<{ fleet: { sessions: number }; filters: { chargingModes: string[] } }>>(await performanceGET(get("/api/company/performance?chargingMode=Fast")))).data;
    expect(fast.fleet.sessions).toBe(352);
    expect(fast.filters.chargingModes).toHaveLength(3);
    const csv = await performanceGET(get("/api/company/performance?format=csv"));
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toMatch(/^station,sessions,/);
    expect(lines).toHaveLength(20);
    expect((await performanceGET(get("/api/company/performance?unknown=1"))).status).toBe(400);
  });

  it("lists evidence-backed action items and persists workflow decisions", async () => {
    const list = async () => (await body<Data<{ items: { key: string; priority: string; category: string; evidence: string[]; rule: string; action: string; workflow: { status: string; evidenceChanged: boolean; note: string | null } }[] }>>(await insightsGET())).data.items;
    const items = await list();
    const battery = items.find((i) => i.key === "energy-exceeds-battery:fleet")!;
    expect(battery).toMatchObject({ priority: "medium", category: "data_quality", workflow: { status: "new" } });
    expect(battery.evidence.join(" ")).toMatch(/302 of 1000/);
    expect(items.some((i) => i.key.startsWith("loss-exceeds-consumed:"))).toBe(true);
    for (const i of items) {
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.rule.length).toBeGreaterThan(10);
      expect(i.action.length).toBeGreaterThan(10);
    }

    const put = (b: unknown, headers: Record<string, string> = ADMIN) =>
      reviewPUT(new Request("http://localhost/api/insights/review", { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(b) }));
    expect((await put({ key: battery.key, status: "reviewed" }, {})).status).toBe(401);
    expect((await put({ key: battery.key, status: "reviewed" }, { ...ADMIN, origin: "https://evil.example", host: "localhost" })).status).toBe(401);
    const saved = await put({ key: battery.key, status: "reviewed", note: "Asked the provider about time units" });
    expect(saved.status).toBe(200);
    let after = (await list()).find((i) => i.key === battery.key)!;
    expect(after.workflow).toMatchObject({ status: "reviewed", note: "Asked the provider about time units", evidenceChanged: false });
    // Workflow status survives recomputation; reopening clears it.
    expect((await put({ key: battery.key, status: "open" })).status).toBe(200);
    after = (await list()).find((i) => i.key === battery.key)!;
    expect(after.workflow.status).toBe("new");
    expect((await put({ key: "nope:1", status: "reviewed" })).status).toBe(404);
    expect((await put({ key: battery.key, status: "fixed" })).status).toBe(400);
    const alertItem = items.find((i) => i.key.startsWith("alert:"));
    if (alertItem) expect((await put({ key: alertItem.key, status: "reviewed" })).status).toBe(400);
  });

  it("in open mode accepts same-site writes without a token and refuses cross-site ones", async () => {
    process.env.EVOLT_EDIT_MODE = "open";
    try {
      const ok = await recomputePOST(new Request("http://localhost/api/analytics/recompute", { method: "POST", headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" } }));
      expect(ok.status).toBe(200);
      const blocked = await recomputePOST(new Request("http://localhost/api/analytics/recompute", { method: "POST", headers: { origin: "https://evil.example", host: "127.0.0.1:3000" } }));
      expect(blocked.status).toBe(401);
      expect((await body<{ error: { message: string } }>(blocked)).error.message).toMatch(/different website/);
    } finally {
      process.env.EVOLT_EDIT_MODE = "token";
    }
  });

  it("removes only synthetic demo data", async () => {
    await getDb().insert(stations).values({ code: "DEMO-X", name: "Demo X", isSynthetic: true });
    const res = await syntheticDELETE(new Request("http://localhost/api/datasets/synthetic", { method: "DELETE", headers: ADMIN }));
    expect((await body<Data<{ stations: number }>>(res)).data.stations).toBe(1);
    expect((await getDb().select().from(stations).where(eq(stations.code, "EX-01"))).length).toBe(1);
  });

  it("enforces referential integrity and coordinate constraints in PostgreSQL", async () => {
    const db = getDb();
    const before = ((await db.execute(sql`select count(*)::int as n from stations`)).rows[0] as { n: number }).n;
    await expect(db.insert(stations).values({ code: "BAD", name: "Half coords", latitude: 10, longitude: null })).rejects.toThrow();
    await expect(
      db.insert(chargers).values({ code: "ORPHAN", stationId: "00000000-0000-4000-8000-000000000000", connectorType: "CCS2" }),
    ).rejects.toThrow();
    const count = await db.execute(sql`select count(*)::int as n from stations`);
    expect((count.rows[0] as { n: number }).n).toBe(before);
  });

  it("forecasts against an operator limit, records maintenance and verifies the repair from later readings", async () => {
    const [ch] = await getDb().select().from(chargers).where(eq(chargers.code, "EX-01-B"));
    const id = ch!.id;
    const jsonReq = (method: string, payload: unknown, headers: Record<string, string> = ADMIN) =>
      new Request(`http://localhost/api/chargers/${id}`, { method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(payload) });
    const crForecast = async () => {
      const [row] = await getDb().select().from(chargers).where(eq(chargers.id, id));
      return row!.healthSummary!.metrics.find((m) => m.metric === "contact_resistance")!.forecast!;
    };

    // The degrading series is already above the default limit (baseline + 50 %).
    expect((await crForecast()).status).toBe("already_above");

    expect((await limitPUT(jsonReq("PUT", { contactResistanceLimitMohm: 0.9 }, {}), ctx(id))).status).toBe(401);
    expect((await limitPUT(jsonReq("PUT", { contactResistanceLimitMohm: -1 }), ctx(id))).status).toBe(400);
    expect((await limitPUT(jsonReq("PUT", { contactResistanceLimitMohm: 0.9 }), ctx(id))).status).toBe(200);
    const withLimit = await crForecast();
    expect(withLimit).toMatchObject({ limit: 0.9, limitSource: "operator", status: "projected" });
    expect(withLimit.expectedDate).not.toBeNull();

    expect((await maintenancePOST(jsonReq("POST", { performedAt: "2026-06-17T09:00:00Z", action: "polished" }), ctx(id))).status).toBe(400);
    expect((await maintenancePOST(jsonReq("POST", { performedAt: "2099-01-01T00:00:00Z", action: "cleaned" }), ctx(id))).status).toBe(400);
    const created = await maintenancePOST(jsonReq("POST", { performedAt: "2026-06-17T09:00:00Z", action: "cleaned", note: "pins cleaned" }), ctx(id));
    expect(created.status).toBe(201);
    const list = (await body<Data<{ items: { action: string; note: string }[] }>>(await maintenanceGET(get(`/api/chargers/${id}/maintenance`), ctx(id)))).data;
    expect(list.items).toEqual([expect.objectContaining({ action: "cleaned", note: "pins cleaned" })]);

    // The forecast restarts after maintenance: no readings yet, so no date.
    const restarted = await crForecast();
    expect(restarted.status).toBe("insufficient_data");
    expect(restarted.since).toBe("2026-06-17T09:00:00.000Z");
    let fleet = (await body<Data<{ rows: { chargerCode: string; outcome: string }[] }>>(await fleetRepairsGET())).data;
    expect(fleet.rows.find((r) => r.chargerCode === "EX-01-B")!.outcome).toBe("awaiting_measurement");

    // Readings back at baseline for three weeks → the fix held. Temperatures on only some rows are imported but not used.
    const after = ["charger_code,observed_at,metric,value,unit,temperature_c"];
    for (let i = 0; i < 4; i++) after.push(`EX-01-B,${new Date(Date.UTC(2026, 5, 20 + i * 7, 9)).toISOString()},contact_resistance,0.301,mΩ,${i === 0 ? "41" : ""}`);
    const imported = await datasetsPOST(uploadRequest("/api/datasets", { name: "after-cleaning.csv", content: after.join("\n") }, { kind: "observations" }));
    expect(imported.status).toBe(201);
    const stored = await getDb().select().from(healthObservations).where(eq(healthObservations.chargerId, id));
    expect(stored.filter((o) => o.temperatureC === 41)).toHaveLength(1);
    fleet = (await body<Data<{ rows: { chargerCode: string; outcome: string }[] }>>(await fleetRepairsGET())).data;
    expect(fleet.rows.find((r) => r.chargerCode === "EX-01-B")!.outcome).toBe("held");
    const [row] = await getDb().select().from(chargers).where(eq(chargers.id, id));
    expect(row!.healthSummary!.metrics.find((m) => m.metric === "contact_resistance")!.temperatureCorrection?.applied).toBe(false);
  });

  it("stores the Arduino bench log unchanged and serves the scaling, connectors and calibration from it", async () => {
    expect((await benchGET(get("/api/bench"))).status).toBe(404);
    const url = process.env.TEST_DATABASE_URL!;
    expect(await loadBench(url)).toMatch(/loaded: 95 time steps × 3 connectors = 285 readings/);
    expect(await loadBench(url)).toMatch(/already stored/);

    // Raw readings in the database are exactly the file's values, blanks included.
    const stored = await getDb().select().from(benchReadings);
    const file = parseBenchCsv(readFileSync(BENCH_RUN.file, "utf8")).records;
    expect(stored).toHaveLength(file.length);
    for (const r of file) {
      const s = stored.find((x) => x.connector === r.connector && x.timeS === r.timeS)!;
      expect([s.voltageV, s.currentMa, s.degradationPct, s.sourceRow]).toEqual([r.voltageV, r.currentMa, r.degradationPct, r.sourceRow]);
    }

    const res = await benchGET(get("/api/bench?scenario=ac-22&connector=C2"));
    expect(res.status).toBe(200);
    const d = (await body<Data<{ analysis: { connectors: { connector: string }[] }; scaling: { scenario: { id: string }; connector: string; rows: { key: string }[] }; calibrationConsistent: boolean; insights: unknown[] }>>(res)).data;
    expect(d.analysis.connectors.map((c) => c.connector)).toEqual(["C1", "C2", "C3"]);
    expect(d.scaling).toMatchObject({ scenario: { id: "ac-22" }, connector: "C2" });
    expect(d.scaling.rows.map((r) => r.key)).toContain("extra_resistance");
    expect(d.calibrationConsistent).toBe(true);
    expect(d.insights.length).toBeGreaterThan(3);
    expect((await benchGET(get("/api/bench?scenario=mars"))).status).toBe(400);
    expect((await benchGET(get("/api/bench?connector=C9"))).status).toBe(400);

    const est = (await body<Data<{ estimate: { degradationPct: number }; realWorld: { realHeatW: number } | null }>>(await benchEstimateGET(get("/api/bench/estimate?voltage=2.2&scenario=dc-50")))).data;
    expect(est.estimate.degradationPct).toBeCloseTo(45, 0);
    expect(est.realWorld!.realHeatW).toBeGreaterThan(1000);
    const healthy = (await body<Data<{ realWorld: unknown }>>(await benchEstimateGET(get("/api/bench/estimate?voltage=4.3")))).data;
    expect(healthy.realWorld).toBeNull();
    const refused = await benchEstimateGET(get("/api/bench/estimate?voltage=230"));
    expect(refused.status).toBe(400);
    expect(await body(refused)).toMatchObject({ error: { message: expect.stringMatching(/not a bench reading/) } });
    expect((await benchEstimateGET(get("/api/bench/estimate?voltage=abc"))).status).toBe(400);
  });

  it("maps an unreachable database to a 503 without leaking details", async () => {
    const pool = new Pool({ connectionString: "postgresql://nobody:secret@127.0.0.1:1/none", connectionTimeoutMillis: 2000 });
    let error: unknown;
    try {
      await pool.query("select 1");
    } catch (err) {
      error = err;
    } finally {
      await pool.end();
    }
    const res = toErrorResponse(error);
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toMatch(/database_unavailable/);
    expect(text).not.toMatch(/secret|127\.0\.0\.1/);
  });
});
