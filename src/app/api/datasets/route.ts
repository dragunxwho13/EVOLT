import { readImportRequest } from "@/features/data-ingestion/request";
import { commitImport, listImports } from "@/features/data-ingestion/service";
import { withErrorHandling } from "@/lib/errors";
import { dynamicGet, json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";

/** Import history. */
export const GET = dynamicGet(async () => json(await listImports(50)));

/** Validates the file again server-side and writes accepted rows in one transaction. Admin only. */
export const POST = withErrorHandling(async (request: Request) => {
  requireAdmin(request);
  const input = await readImportRequest(request);
  const result = await commitImport(input);
  return json(result, { status: 201 });
});
