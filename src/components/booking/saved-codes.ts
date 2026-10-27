/**
 * Booking codes remembered in this browser, so "My bookings" can list them. A convenience
 * only: storage can be unavailable (private mode, blocked site data), so every access is
 * guarded and the code is always shown on screen to note down as well.
 */
const KEY = "evolt.bookingCodes.v1";

export interface SavedCode {
  code: string;
  label: string;
  savedAt: string;
}

export function readSavedCodes(): SavedCode[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is SavedCode => typeof x?.code === "string" && typeof x?.label === "string" && typeof x?.savedAt === "string");
  } catch {
    return [];
  }
}

function write(list: SavedCode[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
    return true;
  } catch {
    return false;
  }
}

/** Saves a code (newest first). Returns false when this browser cannot store it. */
export function saveCode(code: string, label: string): boolean {
  const list = readSavedCodes().filter((c) => c.code !== code);
  return write([{ code, label, savedAt: new Date().toISOString() }, ...list]);
}

export function forgetCode(code: string): void {
  write(readSavedCodes().filter((c) => c.code !== code));
}
