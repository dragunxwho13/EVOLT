import type { NextRequest } from "next/server";
import { listAlerts } from "@/features/connector-health/queries";
import { dynamicGet, json } from "@/lib/http/route";
import { alertQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

export const GET = dynamicGet(async (request: NextRequest) => {
  const query = alertQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return json(await listAlerts(query));
});
