import { removeSyntheticData } from "@/features/data-ingestion/service";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";

/** Removes the synthetic demonstration data, leaving imported data untouched. */
export const DELETE = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  return json(await removeSyntheticData());
});
