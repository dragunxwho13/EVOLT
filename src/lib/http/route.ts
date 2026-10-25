import { connection, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/errors";

/**
 * Wraps a GET handler: opts out of build-time prerendering (data is always live)
 * and applies the shared error format. `connection()` is awaited outside the error
 * handler so Next.js can end prerendering without it being reported as a failure.
 */
export function dynamicGet<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  const safe = withErrorHandling(handler);
  return async (...args: A): Promise<Response> => {
    await connection();
    return safe(...args);
  };
}

export function json<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  const res = NextResponse.json({ data }, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
