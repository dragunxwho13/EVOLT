import type { NextRequest } from "next/server";
import { listObservations } from "@/features/connector-health/queries";
import { dynamicGet, json } from "@/lib/http/route";
import { observationQuerySchema, searchParamsToObject, uuidSchema } from "@/lib/validation/schemas";

export const GET = dynamicGet(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const id = uuidSchema.parse((await ctx.params).id);
  const { limit } = observationQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return json(await listObservations(id, limit));
});
