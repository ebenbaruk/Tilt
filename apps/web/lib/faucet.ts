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
  /** Refused at a cap, the player's 24 h or all players' daily total: the refreshed offer says when
   *  the next claim opens. */
  | { kind: "limit"; message: string }
  | { kind: "failed"; message: string };

export function claimPhase(response: FaucetResponse): FaucetPhase {
  if (response.status === "submitted") return { kind: "done", signature: response.signature };
  if (response.status === "pending") return { kind: "pending" };
  if (response.error?.code === "FAUCET_EMPTY")
    return { kind: "failed", message: "The faucet is empty for now. Retry later." };
  return { kind: "failed", message: "The claim failed. Retry in a moment." };
}

/** The API doesn't say which cap refused the claim, so neither does this. */
const LIMIT_MESSAGE = "The test USDC limit is reached for now.";

export function claimErrorPhase(error: unknown): FaucetPhase {
  if (error instanceof ApiError && error.code === "BLOCKED") return { kind: "limit", message: LIMIT_MESSAGE };
  return { kind: "failed", message: describeError(error) };
}

/**
 * Claims under one id until the relay is done with that claim, like money intents: a retry after a
 * timeout or a lost answer resends the same claim, which never pays twice, rather than a second one
 * the relay would refuse while the first may still land.
 */
export function faucetClaims(newId: () => string) {
  let claimId: string | null = null;
  return async function claim(send: (claimId: string) => Promise<FaucetResponse>): Promise<FaucetPhase> {
    claimId ??= newId();
    try {
      const response = await send(claimId);
      // Landed or failed: the next claim is a new one. Pending: it is still this one.
      if (response.status !== "pending") claimId = null;
      return claimPhase(response);
    } catch (error) {
      const phase = claimErrorPhase(error);
      // Refused at a cap, so never recorded. Any other error may hide a claim in flight.
      if (phase.kind === "limit") claimId = null;
      return phase;
    }
  };
}
