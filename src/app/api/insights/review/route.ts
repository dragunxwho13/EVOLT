import { setInsightReview } from "@/features/insights/service";
import { validationError, withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";
import { insightReviewSchema } from "@/lib/validation/schemas";

/** Marks an action item reviewed / resolved / dismissed (or reopens it). Admin only. */
export const PUT = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const { key, status, note } = insightReviewSchema.parse(body);
  return json(await setInsightReview(key, status, note?.trim() ? note.trim() : null));
});
