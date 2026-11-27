// The devnet test USDC faucet on /account: what it offers and how a claim ends. The API and the
// relay decide who gets what; this only picks what to show.
import type { AccountResponse, FaucetResponse } from "@tilt/api/public";
import { formatAmount } from "./amount";
import { ApiError } from "./api";
import type { SolanaCluster } from "./config";
import { describeError } from "./errors";

/** Before a claim: the button, or when the next claim opens. */
export type FaucetOffer = { kind: "ready"; label: string } | { kind: "wait"; until: Date };

/** Null: show nothing. Test USDC only exists on devnet, whatever the API says elsewhere. */
export function faucetOffer(cluster: SolanaCluster, faucet: AccountResponse["faucet"], now: Date): FaucetOffer | null {
  if (cluster !== "devnet" || !faucet) return null;
  const until = faucet.nextClaimAt === null ? null : new Date(faucet.nextClaimAt);
  if (until && until > now) return { kind: "wait", until };
  return { kind: "ready", label: `get ${formatAmount(faucet.amount).replace(/\.00$/, "")} test USDC` };
}

export type FaucetPhase =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; signature: string | null }
  /** Sent, not confirmed yet: the wallet balance catches up on a later refresh. */
  | { kind: "pending" }
  /** Already claimed in the last 24 h: the refreshed offer says when the next claim opens. */
  | { kind: "limit" }
  | { kind: "failed"; message: string };

export function claimPhase(response: FaucetResponse): FaucetPhase {
  if (response.status === "submitted") return { kind: "done", signature: response.signature };
  if (response.status === "pending") return { kind: "pending" };
  if (response.error?.code === "FAUCET_EMPTY")
    return { kind: "failed", message: "The faucet is empty for now. Retry later." };
  return { kind: "failed", message: "The claim failed. Retry in a moment." };
}

export function claimErrorPhase(error: unknown): FaucetPhase {
  if (error instanceof ApiError && error.code === "BLOCKED") return { kind: "limit" };
  return { kind: "failed", message: describeError(error) };
}
