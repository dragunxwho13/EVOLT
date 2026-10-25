import { getAlertDetail } from "@/features/connector-health/queries";
import { updateAlertStatus } from "@/features/connector-health/service";
import { validationError, withErrorHandling } from "@/lib/errors";
import { dynamicGet, json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";
import { alertStatusUpdateSchema, uuidSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const GET = dynamicGet(async (_request: Request, ctx: Ctx) => {
  const id = uuidSchema.parse((await ctx.params).id);
  return json(await getAlertDetail(id));
});

/** Changes an alert's status (acknowledge / resolve / dismiss / reopen). Admin only. */
export const PATCH = withErrorHandling(async (request: Request, ctx: Ctx) => {
  requireAdmin(request);
  const id = uuidSchema.parse((await ctx.params).id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const { status, note } = alertStatusUpdateSchema.parse(body);
  const updated = await updateAlertStatus(id, status, note ?? null);
  return json(updated);
});
