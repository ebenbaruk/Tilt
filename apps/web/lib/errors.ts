import { ApiError } from "./api";

const MESSAGES: Partial<Record<ApiError["code"], string>> = {
  NETWORK_ERROR: "Could not reach Tilt. Check your connection and retry.",
  BAD_RESPONSE: "Tilt sent an unexpected response. Retry in a moment.",
  UNAUTHORIZED: "Your session expired. Log in again.",
  // The API only refuses with FORBIDDEN when the identity check behind a money move expired or mismatched.
  FORBIDDEN: "Tilt couldn't confirm it's you. Log out, log in again and retry.",
  INTENT_CONFLICT: "This request clashed with an earlier one. Reload the page and retry.",
  RATE_LIMITED: "Too many requests. Wait a few seconds and retry.",
  PLAYER_BUSY: "Another transaction is still in flight. Wait for it to finish.",
  GEO_BLOCKED: "Tilt isn't available in your region.",
  UPSTREAM_ERROR: "The Solana side is slow to answer. Retry in a moment.",
  INTERNAL_ERROR: "Something broke on Tilt's side. Retry in a moment.",
};

/** A short sentence safe to show. API messages are shown for codes whose message is meant for players. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Retry in a moment.";
  return MESSAGES[error.code] ?? error.message;
}
