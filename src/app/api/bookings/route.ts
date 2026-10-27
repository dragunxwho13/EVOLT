import { readBookingRequest } from "@/features/booking/http";
import { createBooking } from "@/features/booking/service";
import { bookingCreateSchema } from "@/features/booking/validation";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";

/** Books a slot (with `start`) or joins the queue (without it). Returns the booking code once. */
export const POST = withErrorHandling(async (request: Request) => {
  const input = bookingCreateSchema.parse(await readBookingRequest(request));
  return json(await createBooking(input), { status: 201 });
});
