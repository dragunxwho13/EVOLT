import { afterEach, describe, expect, it } from "vitest";
import { runEvaluation } from "@/features/anomaly-detection/evaluation";
import { AppError } from "@/lib/errors";
import { createSessionValue, editMode, isSameOrigin, requireAdmin, verifySessionValue, verifyToken, writesEnabled } from "@/lib/security/admin";
import { alertQuerySchema, recommendationQuerySchema, stationQuerySchema } from "@/lib/validation/schemas";
import { formatAge, formatMetricValue } from "@/lib/utils/format";

const TOKEN = "unit-test-admin-token-0123456789";

describe("admin security", () => {
  const original = process.env.EVOLT_ADMIN_TOKEN;
  const originalMode = process.env.EVOLT_EDIT_MODE;
  const originalLocalDb = process.env.EVOLT_LOCAL_DB;
  afterEach(() => {
    process.env.EVOLT_ADMIN_TOKEN = original;
    if (originalMode === undefined) delete process.env.EVOLT_EDIT_MODE;
    else process.env.EVOLT_EDIT_MODE = originalMode;
    if (originalLocalDb === undefined) delete process.env.EVOLT_LOCAL_DB;
    else process.env.EVOLT_LOCAL_DB = originalLocalDb;
  });

  it("is protected by default, open for the local launcher, and an explicit mode always wins", () => {
    delete process.env.EVOLT_EDIT_MODE;
    delete process.env.EVOLT_ADMIN_TOKEN;
    delete process.env.EVOLT_LOCAL_DB;
    expect(editMode()).toBe("token");
    expect(writesEnabled()).toBe(false);
    expect(() => requireAdmin(new Request("http://x/api", { method: "POST" }))).toThrow(/disabled/);
    // Regression: run-evolt writes EVOLT_LOCAL_DB=true but no EVOLT_EDIT_MODE; that must be open.
    process.env.EVOLT_LOCAL_DB = "true";
    expect(editMode()).toBe("open");
    process.env.EVOLT_EDIT_MODE = "token";
    expect(editMode()).toBe("token");
    delete process.env.EVOLT_LOCAL_DB;
    process.env.EVOLT_EDIT_MODE = "open";
    expect(editMode()).toBe("open");
    expect(writesEnabled()).toBe(true);
    expect(() => requireAdmin(new Request("http://x/api", { method: "POST" }))).not.toThrow();
    const sameSite = new Request("http://x/api", { method: "POST", headers: { origin: "http://x", host: "x" } });
    expect(() => requireAdmin(sameSite)).not.toThrow();
    const crossSite = new Request("http://x/api", { method: "POST", headers: { origin: "https://evil.example", host: "x" } });
    expect(() => requireAdmin(crossSite)).toThrow(/different website/);
  });

  it("compares the Origin with the Host header, not the rebuilt request URL (regression)", () => {
    // Next.js can rebuild request.url as localhost while the browser used 127.0.0.1.
    const req = new Request("http://localhost:3000/api", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
    });
    expect(isSameOrigin(req)).toBe(true);
    expect(isSameOrigin(new Request("http://localhost:3000/api", { headers: { origin: "null", host: "localhost:3000" } }))).toBe(false);
  });

  it("verifies tokens and signed, expiring sessions", () => {
    process.env.EVOLT_ADMIN_TOKEN = TOKEN;
    expect(verifyToken(TOKEN)).toBe(true);
    expect(verifyToken("wrong")).toBe(false);
    const now = Date.now();
    const session = createSessionValue(now);
    expect(verifySessionValue(session, now)).toBe(true);
    expect(verifySessionValue(session, now + 9 * 3600 * 1000)).toBe(false);
    expect(verifySessionValue(session.replace(/.$/, "x"), now)).toBe(false);
    process.env.EVOLT_ADMIN_TOKEN = `${TOKEN}-rotated`;
    expect(verifySessionValue(session, now)).toBe(false);
  });

  it("in token mode, refuses writes when unconfigured, unauthenticated or cross-origin", () => {
    process.env.EVOLT_EDIT_MODE = "token";
    delete process.env.EVOLT_ADMIN_TOKEN;
    expect(() => requireAdmin(new Request("http://x/api"))).toThrow(/disabled/);
    process.env.EVOLT_ADMIN_TOKEN = "short";
    expect(() => requireAdmin(new Request("http://x/api"))).toThrow(/disabled/);
    process.env.EVOLT_ADMIN_TOKEN = TOKEN;
    expect(() => requireAdmin(new Request("http://x/api"))).toThrow(AppError);
    expect(() => requireAdmin(new Request("http://x/api", { headers: { authorization: "Bearer nope" } }))).toThrow(/not valid/);
    expect(() => requireAdmin(new Request("http://x/api", { headers: { authorization: `Bearer ${TOKEN}` } }))).not.toThrow();
    const cookie = `evolt_admin=${createSessionValue()}`;
    expect(() => requireAdmin(new Request("http://x/api", { headers: { cookie, origin: "http://x", host: "x" } }))).not.toThrow();
    expect(() => requireAdmin(new Request("http://x/api", { headers: { cookie, origin: "http://evil.example", host: "x" } }))).toThrow(
      /different website/,
    );
  });
});

describe("request validation", () => {
  it("parses and bounds station queries", () => {
    expect(stationQuerySchema.parse({ q: "", minPowerKw: "50", limit: "" })).toMatchObject({ q: undefined, minPowerKw: 50, limit: 100 });
    expect(stationQuerySchema.safeParse({ lat: "13" }).success).toBe(false);
    expect(stationQuerySchema.safeParse({ connector: "Schuko" }).success).toBe(false);
    expect(stationQuerySchema.safeParse({ limit: "100000" }).success).toBe(false);
  });

  it("requires a starting point for recommendations", () => {
    expect(recommendationQuerySchema.safeParse({}).success).toBe(false);
    expect(recommendationQuerySchema.parse({ lat: "13", lng: "80" })).toMatchObject({ radiusKm: 25, includeInspection: false });
  });

  it("validates alert filters", () => {
    expect(alertQuerySchema.parse({}).page).toBe(1);
    expect(alertQuerySchema.safeParse({ status: "closed" }).success).toBe(false);
  });
});

describe("formatting", () => {
  it("formats values and ages deterministically", () => {
    expect(formatMetricValue("contact_resistance", 0.31234)).toBe("0.312 mΩ");
    expect(formatMetricValue("fault_count", 3)).toBe("3");
    expect(formatAge("2026-01-01T00:00:00Z", new Date("2026-01-03T00:00:00Z"))).toBe("2 days ago");
    expect(formatAge(null, new Date())).toBe("never");
  });
});

describe("synthetic detector evaluation", () => {
  it("is reproducible and shows the trend-aware rules suppressing spike false alarms", () => {
    const a = runEvaluation(10);
    const b = runEvaluation(10);
    expect(a).toEqual(b);
    expect(a.trendAware.perScenario.stable_with_spikes.flagged).toBeLessThan(a.singlePoint.perScenario.stable_with_spikes.flagged);
    expect(a.trendAware.perScenario.gradual_drift.flagged).toBe(10);
  });
});
