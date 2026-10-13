// Device-code login: `/tilt login` opens /connect?code=XXXX-XXXX, where the player types the code.
import { ApiError } from "./api";

/** The api's user-code alphabet (no I/1, O/0) and length. */
const USER_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** Canonical form of a code ("wdjb mjht" -> "WDJB-MJHT"); null when it cannot be one. */
export function parseUserCode(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  return USER_CODE.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : null;
}

export type ApproveFailure = "expired" | "login" | "error";

/** The API answers an unknown, expired or already-used code with NOT_FOUND or INVALID_REQUEST. */
export function approveFailure(error: unknown): ApproveFailure {
  if (!(error instanceof ApiError)) return "error";
  if (error.code === "NOT_FOUND" || error.code === "INVALID_REQUEST") return "expired";
  if (error.code === "UNAUTHORIZED") return "login";
  return "error";
}
