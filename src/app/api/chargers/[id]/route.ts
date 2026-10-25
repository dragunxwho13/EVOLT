import { getChargerDetail } from "@/features/connector-health/queries";
import { dynamicGet, json } from "@/lib/http/route";
import { uuidSchema } from "@/lib/validation/schemas";

/** Charger record, parent station, health assessment, alerts and the latest observations. */
export const GET = dynamicGet(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = uuidSchema.parse((await ctx.params).id);
  const detail = await getChargerDetail(id, 100);
  return json(detail);
});
