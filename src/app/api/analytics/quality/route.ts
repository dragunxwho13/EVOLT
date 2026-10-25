import { getDataQualityReport } from "@/lib/analytics/overview";
import { dynamicGet, json } from "@/lib/http/route";

export const GET = dynamicGet(async () => json(await getDataQualityReport()));
