import { z } from "zod";
import { readBookingRequest } from "@/features/booking/http";
import { getBookingsByCode } from "@/features/booking/service";
import { bookingCodeSchema } from "@/features/booking/validation";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";

const schema = z.object({ code: bookingCodeSchema }).strict();

/** The sessions under a booking code. POST so the code never appears in a URL or a log. */
export const POST = withErrorHandling(async (request: Request) => {
  const { code } = schema.parse(await readBookingRequest(request));
  return json({ bookings: await getBookingsByCode(code) });
});
