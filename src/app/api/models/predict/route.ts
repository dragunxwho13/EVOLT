import { predictSession } from "@/features/learning/service";
import { validationError, withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { predictionRequestSchema } from "@/lib/validation/schemas";

/** Classifies one session with a stored, cross-validated model. Read-only (no data is written). */
export const POST = withErrorHandling(async (request: Request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const input = predictionRequestSchema.parse(body);
  return json(await predictSession(input));
});
