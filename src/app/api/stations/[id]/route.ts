import { getStation } from "@/features/station-discovery/service";
import { dynamicGet, json } from "@/lib/http/route";
import { uuidSchema } from "@/lib/validation/schemas";

export const GET = dynamicGet(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = uuidSchema.parse((await ctx.params).id);
  return json(await getStation(id));
});
