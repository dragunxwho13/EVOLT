import type { ObservationInput } from "@/types/analysis";

export const DAY = 86_400_000;
export const T0 = Date.UTC(2026, 0, 5, 10);

/** Weekly observations starting at T0 with the given values (null = skipped week). */
export function weekly(values: (number | null)[], start = T0, stepDays = 7): ObservationInput[] {
  const out: ObservationInput[] = [];
  values.forEach((v, i) => {
    if (v !== null) out.push({ observedAt: new Date(start + i * stepDays * DAY), value: v });
  });
  return out;
}

/** Small deterministic wobble so baselines have non-zero spread. */
export function wobble(base: number, n: number, amplitude = 0.01): number[] {
  const pattern = [0, 1, -1, 0.5, -0.5, 0.8, -0.8, 0.2, -0.2, 0.6, -0.6, 0.3];
  return Array.from({ length: n }, (_, i) => base * (1 + amplitude * pattern[i % pattern.length]!));
}

export function nowAfter(series: ObservationInput[], days = 2): Date {
  return new Date(series[series.length - 1]!.observedAt.getTime() + days * DAY);
}
