import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { configurationError, unauthorized } from "@/lib/errors";

export const ADMIN_COOKIE = "evolt_admin";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_TOKEN_LENGTH = 16;

export type EditMode = "open" | "token";

/**
 * How write operations are authorised.
 *  - "open" (default): anyone who can reach the app can import data and change alert
 *    status. Right for a local install or a demo; cross-site requests are still refused.
 *  - "token": writes need EVOLT_ADMIN_TOKEN (Settings → Unlock editing, or a Bearer
 *    header). Use this for any deployment reachable by people you do not trust.
 */
export function editMode(): EditMode {
  const configured = process.env.EVOLT_EDIT_MODE?.trim().toLowerCase();
  return configured === "open" && process.env.EVOLT_LOCAL_DB === "true" ? "open" : "token";
}

/** True when write operations can currently succeed. */
export function writesEnabled(): boolean {
  return editMode() === "open" || isAdminConfigured();
}

function adminToken(): string | null {
  const t = process.env.EVOLT_ADMIN_TOKEN;
  return t && t.length > 0 ? t : null;
}

export function isAdminConfigured(): boolean {
  const t = adminToken();
  return t !== null && t.length >= MIN_TOKEN_LENGTH;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`evolt-admin:${payload}`).digest("base64url");
}

export function verifyToken(candidate: string): boolean {
  const t = adminToken();
  return t !== null && isAdminConfigured() && safeEqual(candidate, t);
}

/** Creates a signed, expiring session value. The token itself is never stored in the cookie. */
export function createSessionValue(nowMs: number = Date.now()): string {
  const t = adminToken();
  if (!t) throw configurationError("EVOLT_ADMIN_TOKEN is not configured.");
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${sign(String(exp), t)}`;
}

export function verifySessionValue(value: string | undefined, nowMs: number = Date.now()): boolean {
  const t = adminToken();
  if (!t || !value || !isAdminConfigured()) return false;
  const [expStr, sig] = value.split(".");
  const exp = Number(expStr);
  if (!expStr || !sig || !Number.isInteger(exp) || exp * 1000 < nowMs) return false;
  return safeEqual(sig, sign(expStr, t));
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Rejects cross-site browser requests (another website posting to EVOLT).
 *
 * The browser's Origin is compared with the Host header the browser sent. It must NOT
 * be compared with `request.url`: Next.js may rebuild that URL with a different host
 * name (e.g. "localhost" when the page was opened as 127.0.0.1), which wrongly blocked
 * every save in the first release.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return origin === null; // scripts omit it; "null" = sandboxed/opaque origin
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (hosts.includes(originHost)) return true;
    return originHost === new URL(request.url).host.toLowerCase();
  } catch {
    return false;
  }
}

/** Throws unless the request may perform a write in the current edit mode. */
export function requireAdmin(request: Request): void {
  if (!isSameOrigin(request)) {
    throw unauthorized("This change was sent from a different website, so EVOLT refused it.");
  }
  if (editMode() === "open") return;
  if (!isAdminConfigured()) {
    throw configurationError(
      `Write operations are disabled: set EVOLT_ADMIN_TOKEN (at least ${MIN_TOKEN_LENGTH} characters) in the server environment.`,
    );
  }
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    if (verifyToken(auth.slice(7).trim())) return;
    throw unauthorized("The bearer token is not valid.");
  }
  if (verifySessionValue(readCookie(request, ADMIN_COOKIE))) return;
  throw unauthorized("Unlock editing in Settings with the EVOLT admin token to perform this action.");
}

export function hasAdminSession(cookieValue: string | undefined): boolean {
  return verifySessionValue(cookieValue);
}
