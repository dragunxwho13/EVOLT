/** Browser-side helpers for calling EVOLT's API with consistent error messages. */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, { ...init, headers: { Accept: "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("The server could not be reached. Check your connection and try again.", 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error bodies (e.g. a platform 413) fall through to the generic message.
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    const fallback =
      res.status === 413 ? "The file is too large." : res.status === 401 ? "This action is not allowed. See Settings → Editing access." : `Request failed (${res.status}).`;
    throw new ApiError(err?.message ?? fallback, res.status, err?.code, err?.details);
  }
  return (body as { data: T }).data;
}
