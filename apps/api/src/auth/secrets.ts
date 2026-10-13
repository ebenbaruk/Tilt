// Random secrets handed to clients. Only their sha256 is stored: a database leak does not
// leak usable codes or tokens, and 256-bit inputs need no salt or slow hash.
import { createHash, randomBytes } from "node:crypto";

const SECRET_BYTES = 32;

export const newSecret = (prefix = "") => prefix + randomBytes(SECRET_BYTES).toString("base64url");

export const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Unambiguous for people reading it aloud: no I/1, O/0. 32 symbols, so a byte maps without bias. */
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LENGTH = 8;

/** e.g. "WDJB-MJHT" (32^8 ≈ 1.1e12 codes). */
export function newUserCode(): string {
  const chars = Array.from(randomBytes(USER_CODE_LENGTH), (b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Canonical form of what a player typed ("wdjb mjht" -> "WDJB-MJHT"), or null if it cannot be a code. */
export function normalizeUserCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (compact.length !== USER_CODE_LENGTH || [...compact].some((c) => !USER_CODE_ALPHABET.includes(c))) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
