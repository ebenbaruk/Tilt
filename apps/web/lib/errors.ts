import { ApiError } from "./api";

const MESSAGES: Partial<Record<ApiError["code"], string>> = {
  NETWORK_ERROR: "Could not reach Tilt. Check your connection and retry.",
  BAD_RESPONSE: "Tilt sent an unexpected response. Retry in a moment.",
  UNAUTHORIZED: "Your session expired. Log in again.",
  FORBIDDEN: "This account can't do that.",
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
