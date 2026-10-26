import { setServiceLimit } from "@/features/connector-health/maintenance";
import { validationError, withErrorHandling } from "@/lib/errors";
import { json } from "@/lib/http/route";
import { requireAdmin } from "@/lib/security/admin";
import { serviceLimitSchema, uuidSchema } from "@/lib/validation/schemas";

type Ctx = { params: Promise<{ id: string }> };

/** Sets the contact-resistance service limit the forecast aims at (null = default). Admin only. */
export const PUT = withErrorHandling(async (request: Request, ctx: Ctx) => {
  requireAdmin(request);
  const id = uuidSchema.parse((await ctx.params).id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const { contactResistanceLimitMohm } = serviceLimitSchema.parse(body);
  return json(await setServiceLimit(id, contactResistanceLimitMohm));
});
