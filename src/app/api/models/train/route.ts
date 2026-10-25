import { trainModels } from "@/features/learning/service";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";

/** Re-trains and re-evaluates every labelled target on the stored sessions. */
export const POST = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  return json(await trainModels());
});
