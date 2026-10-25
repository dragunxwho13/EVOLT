import type { NextRequest } from "next/server";
import { getRecommendations } from "@/features/recommendations/service";
import { dynamicGet, json } from "@/lib/http/route";
import { recommendationQuerySchema, searchParamsToObject } from "@/lib/validation/schemas";

export const GET = dynamicGet(async (request: NextRequest) => {
  const query = recommendationQuerySchema.parse(searchParamsToObject(request.nextUrl.searchParams));
  return json(await getRecommendations(query));
});
