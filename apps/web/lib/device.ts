// Device-code login (`/tilt login` opens /connect?code=XXXX-XXXX).
import { ApiError } from "./api";

const USER_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Normalizes the code from the URL; null when it isn't a well-formed code. */
export function parseUserCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return USER_CODE.test(code) ? code : null;
}

export type ApproveFailure = "expired" | "login" | "error";

/** The API answers an unknown, expired or already-used code with NOT_FOUND or INVALID_REQUEST. */
export function approveFailure(error: unknown): ApproveFailure {
  if (!(error instanceof ApiError)) return "error";
  if (error.code === "NOT_FOUND" || error.code === "INVALID_REQUEST") return "expired";
  if (error.code === "UNAUTHORIZED") return "login";
  return "error";
}
