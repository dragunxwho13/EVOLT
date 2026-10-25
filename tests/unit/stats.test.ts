import { describe, expect, it } from "vitest";
import { mad, median, robustScale, seededRandom, theilSen } from "@/features/anomaly-detection/stats";

describe("robust statistics", () => {
  it("computes medians for odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });

  it("computes the median absolute deviation", () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });

  it("floors the robust scale for flat baselines", () => {
    expect(robustScale([5, 5, 5, 5], 0.1)).toBeCloseTo(0.1);
    // 2% of the median dominates when larger than the configured floor
    expect(robustScale([100, 100, 100], 0.1)).toBeCloseTo(2);
  });

  it("estimates a Theil–Sen slope that ignores a single outlier", () => {
    const day = 86_400_000;
    const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ t: i * day, value: i * 2 + (i === 3 ? 50 : 0) }));
    const est = theilSen(pts)!;
    expect(est.slopePerDay).toBeCloseTo(2, 5);
    expect(est.spanDays).toBe(6);
    expect(theilSen(pts.slice(0, 2))).toBeNull();
  });

  it("produces reproducible pseudo-random sequences", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
