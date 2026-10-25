import { getOverview } from "@/lib/analytics/overview";
import { dynamicGet, json } from "@/lib/http/route";

export const GET = dynamicGet(async () => json(await getOverview(new Date())));
