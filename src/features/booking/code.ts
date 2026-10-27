import "server-only";
import { createHash, randomInt } from "node:crypto";

/** No 0/O, 1/I/L: codes are read aloud and typed on phones. 31 symbols × 10 ≈ 49.5 bits. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A new booking code, e.g. "EV-7KQ3P-9XMDA". Shown to the driver once; only its hash is stored. */
export function newBookingCode(): { display: string; normalized: string } {
  let raw = "";
  for (let i = 0; i < 10; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return { display: `EV-${raw.slice(0, 5)}-${raw.slice(5)}`, normalized: raw };
}

/** Hash of a normalised code (10 symbols, no prefix or dashes). */
export function hashBookingCode(normalized: string): string {
  return createHash("sha256").update(`evolt-booking:${normalized}`).digest("hex");
}

export function displayCode(normalized: string): string {
  return `EV-${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}
