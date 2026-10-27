import { z } from "zod";
import { readBookingRequest } from "@/features/booking/http";
import { cancelBookings } from "@/features/booking/service";
import { bookingCodeSchema } from "@/features/booking/validation";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";

const schema = z.object({ code: bookingCodeSchema, bookingId: z.string().uuid().optional() }).strict();

/** Cancels the upcoming sessions under a booking code, or one of them. */
export const POST = withErrorHandling(async (request: Request) => {
  const { code, bookingId } = schema.parse(await readBookingRequest(request));
  return json({ bookings: await cancelBookings(code, { bookingId }) });
});
