// Money intents (deposit, withdraw): idempotent by intentId, `pending` means "in flight or unknown" (spec §7).
import type { MoneyIntentResponse } from "@tilt/api/public";
import { ApiError, type ClientErrorCode } from "./api";
import { describeError } from "./errors";

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

export type MoneyKind = "deposit" | "withdraw";

export type MoneyPhase =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  /** The outcome is unknown (no answer, or polling timed out): only checked again, never resent with a new id. */
  | { kind: "stillPending"; message: string }
  | { kind: "done"; signature: string | null }
  /** Nothing was moved. */
  | { kind: "failed"; message: string };

/** Failures after which the request may still have reached Tilt and be moving money. */
const OUTCOME_UNKNOWN: Partial<Record<ClientErrorCode, true>> = {
  NETWORK_ERROR: true,
  BAD_RESPONSE: true,
  UPSTREAM_ERROR: true,
  INTERNAL_ERROR: true,
};

const STILL_PROCESSING = "Still processing. Nothing is lost: the same request is tracked until it lands.";

export interface MoneyFlowDeps {
  kind: MoneyKind;
  /** Sends the intent with fresh consent credentials. */
  send: (intentId: string, amount: string) => Promise<MoneyIntentResponse>;
  fetchIntent: (intentId: string) => Promise<MoneyIntentResponse>;
  onPhase: (phase: MoneyPhase) => void;
  onSettled: () => void;
  newId: () => string;
  poll?: PollOptions;
}

/**
 * Runs a deposit or withdrawal as an idempotent intent: one id per request, reused on every retry, then polls
 * until the relay settles it. One action at a time: a double click, or a new amount while the last one's fate
 * is unknown, never sends a second intent.
 */
export function createMoneyFlow({ kind, send, fetchIntent, onPhase, onSettled, newId, poll }: MoneyFlowDeps) {
  let phase: MoneyPhase = { kind: "idle" };
  let pending: PendingIntent | null = null;

  const set = (next: MoneyPhase) => {
    phase = next;
    onPhase(next);
  };
  const unconfirmed = (): MoneyPhase => ({
    kind: "stillPending",
    message: `Tilt hasn't confirmed this ${kind} yet. It may still go through: check again before sending another.`,
  });

  /** A failed status check: only a missing intent proves nothing moved. */
  function lost(error: unknown): MoneyPhase {
    if (error instanceof ApiError && error.code === "NOT_FOUND") {
      return {
        kind: "failed",
        message: `Tilt has no record of this ${kind}: nothing was moved. You can send it again.`,
      };
    }
    return unconfirmed();
  }

  async function follow(first: MoneyIntentResponse) {
    set({ kind: "working", label: "waiting for Solana" });
    let final: MoneyIntentResponse;
    try {
      final = await pollIntent(() => fetchIntent(first.intentId), first, poll);
    } catch (error) {
      set(lost(error));
      return;
    }
    if (final.status === "pending") {
      set({ kind: "stillPending", message: STILL_PROCESSING });
      return;
    }
    pending = null;
    if (final.status === "submitted") set({ kind: "done", signature: final.signature });
    else set({ kind: "failed", message: final.error?.message ?? "The transaction failed. Nothing was moved." });
    onSettled();
  }

  /** `prepare` runs first, e.g. adding the relay signer before a deposit. */
  async function submit(amount: string, prepare?: () => Promise<void>) {
    if (phase.kind === "working" || phase.kind === "stillPending") return;
    const intent = intentFor(pending, `${kind}:${amount}`, newId);
    pending = intent;
    try {
      if (prepare) {
        set({ kind: "working", label: "authorizing Tilt on your wallet" });
        await prepare();
      }
      set({ kind: "working", label: "confirming" });
      await follow(await send(intent.intentId, amount));
    } catch (error) {
      // The intent stays pending: retrying the same amount resends the same id.
      const unknown = error instanceof ApiError && OUTCOME_UNKNOWN[error.code];
      set(unknown ? unconfirmed() : { kind: "failed", message: describeError(error) });
    }
  }

  async function checkAgain() {
    if (!pending || phase.kind === "working") return;
    const { intentId } = pending;
    set({ kind: "working", label: "checking" });
    let latest: MoneyIntentResponse;
    try {
      latest = await fetchIntent(intentId);
    } catch (error) {
      set(lost(error));
      return;
    }
    await follow(latest);
  }

  return { submit, checkAgain };
}
