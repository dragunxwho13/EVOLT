import "server-only";
import { unauthorized, validationError } from "@/lib/errors";
import { isSameOrigin } from "@/lib/security/admin";

/**
 * Driver booking writes need no admin token (drivers have no accounts), so they are
 * protected differently: same-site requests only, strict validation, and a booking code
 * that only its holder knows for anything after creation.
 */
export async function readBookingRequest(request: Request): Promise<unknown> {
  if (!isSameOrigin(request)) throw unauthorized("This booking was sent from a different website, so EVOLT refused it.");
  try {
    return await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
}
