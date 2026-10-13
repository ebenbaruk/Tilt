"use client";

import type { MoneyIntentResponse } from "@tilt/api/public";
import { useState } from "react";
import { useTiltAuth } from "@/components/privy/useTiltAuth";
import { getApi } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { intentFor, pollIntent, type PendingIntent } from "@/lib/intent";

export type MoneyKind = "deposit" | "withdraw";

export type MoneyPhase =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  /** Polling timed out: the outcome is unknown, never retried with a new id. */
  | { kind: "stillPending" }
  | { kind: "done"; signature: string | null }
  | { kind: "failed"; message: string };

/**
 * Runs a deposit or withdrawal as an idempotent intent: one id per request, reused on every retry,
 * then polls until the relay settles it.
 */
export function useMoneyIntent(kind: MoneyKind, onSettled: () => void) {
  const { auth, moneyAuth } = useTiltAuth();
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [phase, setPhase] = useState<MoneyPhase>({ kind: "idle" });

  async function follow(first: MoneyIntentResponse) {
    setPhase({ kind: "working", label: "waiting for Solana" });
    const final = await pollIntent(async () => getApi().moneyIntent(await auth(), first.intentId), first);
    if (final.status === "pending") {
      setPhase({ kind: "stillPending" });
      return;
    }
    setPending(null);
    if (final.status === "submitted") setPhase({ kind: "done", signature: final.signature });
    else setPhase({ kind: "failed", message: final.error?.message ?? "The transaction failed. Nothing was moved." });
    onSettled();
  }

  /** `prepare` runs first, e.g. adding the relay signer before a deposit. */
  async function submit(amount: string, prepare?: () => Promise<void>) {
    const intent = intentFor(pending, `${kind}:${amount}`, () => crypto.randomUUID());
    setPending(intent);
    try {
      if (prepare) {
        setPhase({ kind: "working", label: "authorizing Tilt on your wallet" });
        await prepare();
      }
      setPhase({ kind: "working", label: "confirming" });
      const credentials = await moneyAuth();
      const body = { intentId: intent.intentId, amount };
      const first =
        kind === "deposit" ? await getApi().deposit(credentials, body) : await getApi().withdraw(credentials, body);
      await follow(first);
    } catch (error) {
      // The intent stays pending: retrying the same amount resends the same id.
      setPhase({ kind: "failed", message: describeError(error) });
    }
  }

  async function checkAgain() {
    if (!pending) return;
    try {
      await follow(await getApi().moneyIntent(await auth(), pending.intentId));
    } catch (error) {
      setPhase({ kind: "failed", message: describeError(error) });
    }
  }

  return { phase, submit, checkAgain, busy: phase.kind === "working" };
}
