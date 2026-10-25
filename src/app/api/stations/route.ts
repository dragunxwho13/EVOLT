import type { NextRequest } from "next/server";
import { listStations } from "@/features/station-discovery/service";
import { dynamicGet, json } from "@/lib/http/route";
import { searchParamsToObject, stationQuerySchema } from "@/lib/validation/schemas";

export const GET = dynamicGet(async (request: NextRequest) => {
  const query = stationQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return json(await listStations(query));
});
