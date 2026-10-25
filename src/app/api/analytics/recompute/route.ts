import { recomputeHealth } from "@/features/connector-health/service";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";

/** Re-runs the deterministic analysis for every charger. Admin only. */
export const POST = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  const result = await recomputeHealth();
  return json(result);
});
