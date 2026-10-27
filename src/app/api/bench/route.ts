import { z } from "zod";
import { BENCH_RUN, SCENARIOS } from "@/config/scaling";
import { benchOverview } from "@/features/bench/service";
import { dynamicGet, json } from "@/lib/http/route";

const query = z
  .object({
    scenario: z.enum(SCENARIOS.map((s) => s.id) as [string, ...string[]]).optional(),
    connector: z.enum(["C1", "C2", "C3"]).optional(),
    level: z.coerce
      .number()
      .refine((v) => (BENCH_RUN.scalingLevelsPct as readonly number[]).includes(v), { message: `Level must be one of ${BENCH_RUN.scalingLevelsPct.join(", ")} %.` })
      .optional(),
  })
  .strip();

/**
 * Arduino experimental circuit: raw readings (as stored), per-connector analysis, the
 * real-world scaling table for one scenario, connector and degradation level, insight cards
 * and references.
 */
export const GET = dynamicGet(async (request: Request) => {
  const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await benchOverview(q.scenario, q.connector, q.level));
});
