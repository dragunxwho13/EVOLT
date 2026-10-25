import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "conflict"
  | "unauthorized"
  | "payload_too_large"
  | "unsupported_media_type"
  | "configuration_error"
  | "database_unavailable"
  | "internal_error";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const validationError = (message: string, details?: unknown) => new AppError("validation_error", message, 400, details);
export const notFound = (what: string) => new AppError("not_found", `${what} was not found.`, 404);
export const conflict = (message: string, details?: unknown) => new AppError("conflict", message, 409, details);
export const unauthorized = (message = "This action requires the EVOLT admin token.") =>
  new AppError("unauthorized", message, 401);
export const configurationError = (message: string) => new AppError("configuration_error", message, 503);

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

/** Drizzle wraps driver errors; walk the `cause` chain to the original error. */
function unwrap(err: unknown): unknown {
  let current = err;
  for (let i = 0; i < 5; i++) {
    const cause = (current as { cause?: unknown } | null)?.cause;
    if (!cause) break;
    current = cause;
  }
  return current;
}

/** PostgreSQL SQLSTATE code of an error (or its cause), if any. */
export function pgErrorCode(err: unknown): string | undefined {
  const direct = (err as { code?: unknown } | null)?.code;
  if (typeof direct === "string") return direct;
  const inner = (unwrap(err) as { code?: unknown } | null)?.code;
  return typeof inner === "string" ? inner : undefined;
}

function isDatabaseConnectionError(raw: unknown): boolean {
  const err = unwrap(raw);
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "57P01" ||
    code === "3D000" ||
    code === "28P01" ||
    /ECONNREFUSED|ETIMEDOUT|getaddrinfo|Connection terminated|connection timeout/i.test(err.message)
  );
}

/** Converts any thrown value into a safe, consistent JSON error response. */
export function toErrorResponse(err: unknown): NextResponse<ErrorBody> {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error" as const,
          message: "The request is invalid.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  if (isDatabaseConnectionError(err)) {
    console.error("[evolt] database unavailable:", (unwrap(err) as Error).message);
    return NextResponse.json(
      { error: { code: "database_unavailable" as const, message: "The database is unavailable. Check DATABASE_URL and that the database is running." } },
      { status: 503 },
    );
  }
  console.error("[evolt] unexpected error:", err);
  return NextResponse.json(
    { error: { code: "internal_error" as const, message: "An unexpected error occurred." } },
    { status: 500 },
  );
}

/** Wraps a route handler so every failure path returns the standard error format. */
export function withErrorHandling<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

/** User-facing description of a failure, used by server-rendered pages. */
export function describeError(err: unknown): { title: string; message: string } {
  if (err instanceof AppError && err.code === "configuration_error") {
    return { title: "Configuration required", message: err.message };
  }
  if (isDatabaseConnectionError(err)) {
    return {
      title: "Database unavailable",
      message: "EVOLT could not reach PostgreSQL. Check DATABASE_URL and that migrations have been applied.",
    };
  }
  const databaseMessage = (unwrap(err) as { message?: unknown } | null)?.message;
  if (pgErrorCode(err) === "42P01" && typeof databaseMessage === "string" && /relation .* does not exist|table .* does not exist/i.test(databaseMessage)) {
    return { title: "Database not migrated", message: "Tables are missing. Run `npm run db:migrate` against this database." };
  }
  return { title: "Something went wrong", message: "The data could not be loaded. Try again shortly." };
}
