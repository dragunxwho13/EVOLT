import "server-only";
import { AppError, validationError } from "@/lib/errors";
import { importOptionsSchema } from "@/lib/validation/schemas";
import { maxUploadBytes } from "./parse";
import type { ImportInput } from "./service";

/** Reads and validates a multipart upload request into an ImportInput. */
export async function readImportRequest(request: Request): Promise<ImportInput> {
  const declared = Number(request.headers.get("content-length"));
  // Allow some headroom for multipart boundaries and form fields.
  if (Number.isFinite(declared) && declared > maxUploadBytes() + 64 * 1024) {
    throw new AppError("payload_too_large", `The upload exceeds the ${Math.round(maxUploadBytes() / 1024)} KiB limit.`, 413);
  }
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    throw new AppError("unsupported_media_type", "Send the file as multipart/form-data.", 415);
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw validationError("The upload could not be read.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw validationError('Attach a file in the "file" field.');
  const options = importOptionsSchema.parse({
    kind: form.get("kind") ?? undefined,
    mapping: form.get("mapping") ?? undefined,
    defaultProvenance: form.get("defaultProvenance") ?? undefined,
    timezone: form.get("timezone") ?? undefined,
  });
  if (file.size > maxUploadBytes()) {
    throw new AppError("payload_too_large", `The file exceeds the ${Math.round(maxUploadBytes() / 1024)} KiB limit.`, 413);
  }
  return {
    fileName: file.name || "upload",
    mimeType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    kind: options.kind,
    mapping: options.mapping,
    defaultProvenance: options.defaultProvenance,
    assumeOffsetMinutes: options.timezone,
  };
}
