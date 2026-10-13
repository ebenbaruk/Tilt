// Money intents (deposit, withdraw): idempotent by intentId, `pending` means "in flight or unknown" (spec §7).
import type { MoneyIntentResponse } from "@tilt/api/public";
import { ApiError } from "./api";

export interface PendingIntent {
  /** What the intent does, e.g. "deposit:12400000". */
  key: string;
  intentId: string;
}

/**
 * Keeps the same intentId while the player retries the same request, so a retry can never move money twice.
 * Any other request gets a fresh id.
 */
export function intentFor(current: PendingIntent | null, key: string, newId: () => string): PendingIntent {
  return current?.key === key ? current : { key, intentId: newId() };
}

/** Errors worth another poll: the intent's fate is still unknown, not failed. */
function isTransient(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "NETWORK_ERROR" || error.code === "UPSTREAM_ERROR" || error.code === "RATE_LIMITED")
  );
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_INTERVAL_MS = 1_500;
const DEFAULT_TIMEOUT_MS = 90_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls until the intent leaves `pending`. On timeout it returns the last pending answer: the caller shows
 * "still processing" and may poll again later with the same id; it never starts a new intent.
 */
export async function pollIntent(
  fetchIntent: () => Promise<MoneyIntentResponse>,
  initial: MoneyIntentResponse,
  { intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, sleep = wait, now = Date.now }: PollOptions = {},
): Promise<MoneyIntentResponse> {
  let latest = initial;
  const deadline = now() + timeoutMs;
  while (latest.status === "pending" && now() < deadline) {
    await sleep(intervalMs);
    try {
      latest = await fetchIntent();
    } catch (error) {
      if (!isTransient(error)) throw error;
    }
  }
  return latest;
}
