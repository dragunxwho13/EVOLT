import { readImportRequest } from "@/features/data-ingestion/request";
import { previewImport } from "@/features/data-ingestion/service";
import { withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";

/** Parses and validates an upload without writing anything. Admin only. */
export const POST = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  const input = await readImportRequest(request);
  return json(await previewImport(input));
});
