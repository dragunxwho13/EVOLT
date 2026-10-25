import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validationError, unauthorized, withErrorHandling, configurationError } from "@/lib/errors";
import { dynamicGet } from "@/lib/http/route";
import {
  ADMIN_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionValue,
  editMode,
  hasAdminSession,
  isAdminConfigured,
  verifyToken,
} from "@/lib/security/admin";
import { sessionLoginSchema } from "@/lib/validation/schemas";

export const GET = dynamicGet(async () => {
  const store = await cookies();
  return NextResponse.json(
    {
      data: {
        editMode: editMode(),
        configured: isAdminConfigured(),
        authenticated: editMode() === "open" || hasAdminSession(store.get(ADMIN_COOKIE)?.value),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});

/** Exchanges the admin token for an httpOnly, signed, expiring session cookie. */
export const POST = withErrorHandling(async (request: Request) => {
  if (!isAdminConfigured()) throw configurationError("EVOLT_ADMIN_TOKEN is not configured on the server.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("The request body must be JSON.");
  }
  const { token } = sessionLoginSchema.parse(body);
  if (!verifyToken(token)) throw unauthorized("The admin token is not valid.");
  const store = await cookies();
  store.set(ADMIN_COOKIE, createSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return NextResponse.json({ data: { authenticated: true } });
});

export const DELETE = withErrorHandling(async () => {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return NextResponse.json({ data: { authenticated: false } });
});
