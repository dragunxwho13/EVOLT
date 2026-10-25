import { describe, expect, it } from "vitest";
import { recommend, type CandidateCharger } from "@/features/recommendations/engine";
import { haversineKm, isValidLatLng } from "@/features/station-discovery/geo";

const origin = { lat: 13.0, lng: 80.2 };
// ~0.009° latitude ≈ 1 km
const at = (km: number) => ({ latitude: 13.0 + km * 0.008993, longitude: 80.2 });

function c(id: string, km: number, extra: Partial<CandidateCharger> = {}): CandidateCharger {
  return {
    chargerId: id,
    chargerCode: id,
    stationId: `s-${id}`,
    stationName: `Station ${id}`,
    ...at(km),
    connectorType: "CCS2",
    ratedPowerKw: 60,
    operationalStatus: "available",
    healthStatus: "normal",
    activeAlerts: 0,
    ...extra,
  };
}

const base = { origin, connectorTypes: ["CCS2" as const], radiusKm: 25, includeInspection: false, limit: 10 };

describe("geo", () => {
  it("computes great-circle distance", () => {
    expect(haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeGreaterThan(340);
    expect(haversineKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeLessThan(346);
    expect(haversineKm(origin, origin)).toBe(0);
  });
  it("validates coordinates", () => {
    expect(isValidLatLng(13, 80)).toBe(true);
    expect(isValidLatLng(null, 80)).toBe(false);
    expect(isValidLatLng(91, 0)).toBe(false);
  });
});

describe("recommend", () => {
  it("never lets a small distance advantage outrank a health concern", () => {
    const r = recommend([c("monitor-near", 0.5, { healthStatus: "monitor" }), c("normal-far", 8)], base);
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["normal-far", "monitor-near"]);
  });

  it("ranks insufficient-data chargers between normal and monitor", () => {
    const r = recommend(
      [c("m", 1, { healthStatus: "monitor" }), c("i", 1, { healthStatus: "insufficient_data" }), c("n", 1)],
      base,
    );
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["n", "i", "m"]);
    expect(r.recommendations[1]!.limitations.join(" ")).toMatch(/Not enough health evidence/);
  });

  it("excludes incompatible, offline, out-of-radius, unmapped and inspection-flagged chargers", () => {
    const r = recommend(
      [
        c("ok", 2),
        c("chademo", 2, { connectorType: "CHAdeMO" }),
        c("offline", 2, { operationalStatus: "offline" }),
        c("far", 40),
        c("nocoords", 2, { latitude: null, longitude: null }),
        c("inspect", 2, { healthStatus: "inspection_recommended" }),
      ],
      base,
    );
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["ok"]);
    expect(r.excluded).toMatchObject({
      incompatible_connector: 1,
      offline: 1,
      outside_radius: 1,
      no_coordinates: 1,
      inspection_recommended: 1,
    });
  });

  it("can include inspection-flagged chargers, ranked last", () => {
    const r = recommend([c("inspect", 1, { healthStatus: "inspection_recommended" }), c("ok", 10)], { ...base, includeInspection: true });
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["ok", "inspect"]);
  });

  it("never offers a charger with an unrecorded connector as compatible", () => {
    const r = recommend([c("unknown", 1, { connectorType: "Unknown" }), c("ok", 3)], base);
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["ok"]);
    expect(r.excluded.unknown_connector).toBe(1);
  });

  it("discloses when compatibility could not be checked", () => {
    const r = recommend([c("x", 1, { connectorType: "GBT" })], { ...base, connectorTypes: null });
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]!.limitations.join(" ")).toMatch(/Compatibility not checked/);
  });

  it("prefers available over in-use within the same health tier and caps power by the vehicle", () => {
    const r = recommend(
      [c("busy", 1, { operationalStatus: "in_use", ratedPowerKw: 150 }), c("free", 3, { ratedPowerKw: 150 })],
      { ...base, vehicleMaxKw: 50 },
    );
    expect(r.recommendations[0]!.chargerId).toBe("free");
    expect(r.recommendations[0]!.effectivePowerKw).toBe(50);
  });

  it("labels distance as straight-line and excludes the reference charger", () => {
    const r = recommend([c("ref", 0), c("other", 2)], { ...base, excludeChargerId: "ref" });
    expect(r.recommendations.map((x) => x.chargerId)).toEqual(["other"]);
    expect(r.recommendations[0]!.reasons.join(" ")).toMatch(/straight-line/);
  });
});
