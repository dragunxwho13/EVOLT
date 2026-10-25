import type { NextRequest } from "next/server";
import { performanceCsv } from "@/features/insights/performance";
import { getPerformance } from "@/features/insights/performance-service";
import { dynamicGet, json } from "@/lib/http/route";
import { performanceQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

/** Station, area, charging-type and daily performance from stored sessions. `?format=csv` downloads station rows. */
export const GET = dynamicGet(async (request: NextRequest) => {
  const q = performanceQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  const perf = await getPerformance({ area: q.area, chargingMode: q.chargingMode });
  if (q.format === "csv") {
    return new Response(performanceCsv(perf), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="evolt-station-performance.csv"',
        "Cache-Control": "no-store",
      },
    });
  }
  return json(perf);
});
