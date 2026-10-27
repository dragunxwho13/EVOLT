import { getAvailability } from "@/features/booking/service";
import { availabilityQuerySchema } from "@/features/booking/validation";
import { dynamicGet, json } from "@/lib/http/route";

/** Free slots on one charger for one day, the busy periods (no driver details) and the next queue start. */
export const GET = dynamicGet(async (request: Request) => {
  const q = availabilityQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return json(await getAvailability(q));
});
