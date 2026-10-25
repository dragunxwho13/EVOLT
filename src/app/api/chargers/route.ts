import type { NextRequest } from "next/server";
import { listChargers } from "@/features/connector-health/queries";
import { dynamicGet, json } from "@/lib/http/route";
import { chargerQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

export const GET = dynamicGet(async (request: NextRequest) => {
  const query = chargerQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return json(await listChargers(query));
});
