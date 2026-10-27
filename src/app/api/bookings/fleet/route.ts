import { readBookingRequest } from "@/features/booking/http";
import { planOrBookFleet } from "@/features/booking/service";
import { fleetRequestSchema } from "@/features/booking/validation";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";

/** Plans several vehicles across a station's chargers; books them when `preview` is false. */
export const POST = withErrorHandling(async (request: Request) => {
  const input = fleetRequestSchema.parse(await readBookingRequest(request));
  const result = await planOrBookFleet(input);
  return json(result, { status: result.booked ? 201 : 200 });
});
