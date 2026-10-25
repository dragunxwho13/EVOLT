import { AppError, describeError } from "@/lib/errors";

export type Loaded<T> =
  | { ok: true; data: T }
  | { ok: false; notFound: boolean; error: { title: string; message: string } };

/**
 * Runs a server-side data loader and converts failures into renderable states.
 * Pages call `notFound()` themselves when `notFound` is true (outside any try/catch,
 * so Next.js can handle it).
 */
export async function load<T>(fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof AppError && err.code === "not_found") {
      return { ok: false, notFound: true, error: { title: "Not found", message: err.message } };
    }
    if (!(err instanceof AppError)) console.error("[evolt] page data failed:", err);
    return { ok: false, notFound: false, error: describeError(err) };
  }
}
