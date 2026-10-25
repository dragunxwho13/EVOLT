import { describe, expect, it } from "vitest";
import { clusterPoints, fitView, fromScreen, metresPerPixel, project, scaleBar, toScreen, unproject } from "@/components/map/geo";
import { haversineKm } from "@/features/station-discovery/geo";

describe("map projection", () => {
  it("round-trips coordinates through Web Mercator", () => {
    for (const [lng, lat] of [
      [80.2707, 13.0827],
      [-0.1276, 51.5072],
      [151.2093, -33.8688],
    ] as const) {
      const [x, y] = project(lng, lat);
      const [lng2, lat2] = unproject(x, y);
      expect(lng2).toBeCloseTo(lng, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
  });

  it("puts the view centre in the middle of the screen and inverts screen positions", () => {
    const view = { lng: 80.2, lat: 13.0, zoom: 10 };
    const size = { width: 800, height: 400 };
    expect(toScreen(view, size, 80.2, 13.0)).toEqual([400, 200]);
    const [lng, lat] = fromScreen(view, size, 123, 321);
    const [x, y] = toScreen(view, size, lng, lat);
    expect(x).toBeCloseTo(123, 6);
    expect(y).toBeCloseTo(321, 6);
  });

  it("draws distances to scale: screen distance × metres-per-pixel matches the Haversine distance", () => {
    const view = { lng: 80.22, lat: 13.03, zoom: 11 };
    const size = { width: 1000, height: 800 };
    const a = { lat: 13.0067, lng: 80.2206 };
    const b = { lat: 13.0418, lng: 80.2341 };
    const [ax, ay] = toScreen(view, size, a.lng, a.lat);
    const [bx, by] = toScreen(view, size, b.lng, b.lat);
    const km = (Math.hypot(bx - ax, by - ay) * metresPerPixel((a.lat + b.lat) / 2, view.zoom)) / 1000;
    expect(km).toBeCloseTo(haversineKm(a, b), 1);
  });

  it("chooses a 1-2-5 scale bar that fits", () => {
    const s = scaleBar(13, 11);
    expect([1, 2, 5]).toContain(Number(String(s.metres).replace(/0+$/, "")));
    expect(s.px).toBeLessThanOrEqual(110);
    expect(s.label).toMatch(/ (k)?m$/);
  });
});

describe("view fitting and clustering", () => {
  const size = { width: 600, height: 400 };

  it("fits every point inside the padded box", () => {
    const pts = [
      { lng: 79.1559, lat: 12.9692 },
      { lng: 80.2707, lat: 13.0827 },
      { lng: 80.1, lat: 12.9249 },
    ];
    const v = fitView(pts, size, 40);
    for (const p of pts) {
      const [x, y] = toScreen(v, size, p.lng, p.lat);
      expect(x).toBeGreaterThanOrEqual(39);
      expect(x).toBeLessThanOrEqual(561);
      expect(y).toBeGreaterThanOrEqual(39);
      expect(y).toBeLessThanOrEqual(361);
    }
  });

  it("frames India when there is nothing to show and caps the zoom for a single point", () => {
    expect(fitView([], size).zoom).toBeLessThan(6);
    expect(fitView([{ lng: 80, lat: 13 }], size, 40, 12).zoom).toBe(12);
  });

  it("groups pins that would overlap and keeps distant ones separate", () => {
    const clusters = clusterPoints(
      [
        { item: { id: "a" }, x: 100, y: 100 },
        { item: { id: "b" }, x: 110, y: 105 },
        { item: { id: "c" }, x: 400, y: 300 },
      ],
      30,
    );
    expect(clusters.map((c) => c.items.map((i) => i.id).sort())).toEqual([["a", "b"], ["c"]]);
    expect(clusters[0]!.key).toBe("a|b");
  });
});
