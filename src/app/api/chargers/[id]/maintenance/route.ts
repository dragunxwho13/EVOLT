import { listMaintenance, recordMaintenance } from "@/features/connector-health/maintenance";
import { validationError, withErrorHandling } from "@/lib/errors";
import { dynamicGet, json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";
import { maintenanceCreateSchema, uuidSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Maintenance recorded on this charger, newest first. */
export const GET = dynamicGet(async (_request: Request, ctx: Ctx) => {
  const id = uuidSchema.parse((await ctx.params).id);
  return json({ items: await listMaintenance(id) });
});

/** Records work done on the connector, then re-runs its analysis. Admin only. */
export const POST = withErrorHandling(async (request: Request, ctx: Ctx) => {
  requireAdmin(request);
  const id = uuidSchema.parse((await ctx.params).id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const input = maintenanceCreateSchema.parse(body);
  return json(await recordMaintenance(id, input), { status: 201 });
});
