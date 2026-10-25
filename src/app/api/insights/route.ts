import { listInsights } from "@/features/insights/service";
import { dynamicGet, json } from "@/lib/http/route";

/** Evidence-backed action items for the company workspace. */
export const GET = dynamicGet(async () => json(await listInsights()));
