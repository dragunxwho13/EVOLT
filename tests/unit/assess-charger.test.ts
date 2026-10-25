import { describe, expect, it } from "vitest";
import { assessCharger } from "@/features/connector-health/assess-charger";
import { nowAfter, weekly, wobble } from "../support/series";

describe("assessCharger", () => {
  it("is insufficient when nothing is recorded", () => {
    const s = assessCharger({}, new Date());
    expect(s.status).toBe("insufficient_data");
    expect(s.reasons[0]).toMatch(/No health observations/);
  });

  it("does not let supporting-only data establish health", () => {
    const t = weekly(wobble(10, 20));
    const s = assessCharger({ temperature_rise: t }, nowAfter(t));
    expect(s.status).toBe("insufficient_data");
    expect(s.reasons[0]).toMatch(/supporting/i);
  });

  it("is normal only for the metrics it could assess, and says so", () => {
    const cr = weekly(wobble(0.3, 20));
    const s = assessCharger({ contact_resistance: cr }, nowAfter(cr));
    expect(s.status).toBe("normal");
    expect(s.coverageNote).toMatch(/No usable data for: connector voltage drop/);
  });

  it("analyses old data as a labelled historical assessment instead of discarding it", () => {
    const cr = weekly(wobble(0.3, 20));
    const now = new Date(cr[cr.length - 1]!.observedAt.getTime() + 400 * 86_400_000);
    const s = assessCharger({ contact_resistance: cr }, now);
    expect(s.historical).toBe(true);
    expect(s.status).toBe("normal");
    expect(s.reasons[0]).toMatch(/Historical assessment/);
    expect(s.nextAction).toMatch(/Collect current measurements/);
    expect(new Date(s.assessedAsOf!).getTime()).toBeLessThan(now.getTime());
    const fresh = assessCharger({ contact_resistance: cr }, nowAfter(cr));
    expect(fresh.historical).toBe(false);
  });

  it("escalates when two independent metrics both show monitor-level patterns", () => {
    const cr = weekly([...wobble(0.3, 15), 0.34, 0.35, 0.345, 0.35, 0.352]);
    const vd = weekly([...wobble(30, 15), 34, 34.5, 35, 34.8, 35.2]);
    const single = assessCharger({ contact_resistance: cr }, nowAfter(cr));
    expect(single.status).toBe("monitor");
    const both = assessCharger({ contact_resistance: cr, voltage_drop: vd }, nowAfter(cr));
    expect(both.status).toBe("inspection_recommended");
    expect(both.reasons[0]).toMatch(/independent metrics/);
  });
});
