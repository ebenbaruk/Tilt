import type { FaucetResponse } from "@tilt/api/public";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { claimErrorPhase, claimPhase, faucetClaims, faucetOffer } from "@/lib/faucet";

const now = new Date("2026-11-24T12:00:00.000Z");
const faucet = { amount: "100000000", nextClaimAt: null };

describe("faucetOffer", () => {
  it("offers the button on devnet when the API has a faucet", () => {
    expect(faucetOffer("devnet", faucet, now)).toEqual({ kind: "ready", label: "get 100 test USDC" });
    expect(faucetOffer("devnet", { ...faucet, amount: "2500000" }, now)).toEqual({
      kind: "ready",
      label: "get 2.50 test USDC",
    });
  });

  it("shows nothing on mainnet or localnet, whatever the API says, nor without a faucet", () => {
    expect(faucetOffer("mainnet", faucet, now)).toBeNull();
    expect(faucetOffer("localnet", faucet, now)).toBeNull();
    expect(faucetOffer("devnet", null, now)).toBeNull();
  });

  it("says when the next claim opens, and offers it again once it has", () => {
    const nextClaimAt = "2026-11-25T08:30:00.000Z";
    expect(faucetOffer("devnet", { ...faucet, nextClaimAt }, now)).toEqual({
      kind: "wait",
      until: new Date(nextClaimAt),
    });
    expect(faucetOffer("devnet", { ...faucet, nextClaimAt }, new Date(nextClaimAt))).toMatchObject({ kind: "ready" });
  });
});

describe("claim outcome", () => {
  const response = (over: Partial<FaucetResponse>): FaucetResponse => ({
    claimId: "c",
    amount: "100000000",
    status: "submitted",
    signature: "5ig",
    error: null,
    ...over,
  });

  it("is done once landed, pending while unconfirmed", () => {
    expect(claimPhase(response({}))).toEqual({ kind: "done", signature: "5ig" });
    expect(claimPhase(response({ status: "pending", signature: null }))).toEqual({ kind: "pending" });
  });

  it("tells an empty faucet from other failures", () => {
    const empty = response({ status: "failed", error: { code: "FAUCET_EMPTY", message: "empty" } });
    expect(claimPhase(empty)).toEqual({ kind: "failed", message: "The faucet is empty for now. Retry later." });
    const other = response({ status: "failed", error: { code: "NETWORK_ERROR", message: "x" } });
    expect(claimPhase(other)).toEqual({ kind: "failed", message: "The claim failed. Retry in a moment." });
  });

  it("reads a BLOCKED refusal as a cap, without claiming which one, and other errors as failures", () => {
    // The player's 24 h and the faucet's daily total both answer BLOCKED: the player may not have claimed yet.
    const limit = claimErrorPhase(new ApiError("BLOCKED", "test USDC limit reached", 403));
    expect(limit).toEqual({ kind: "limit", message: "The test USDC limit is reached for now." });
    expect(claimErrorPhase(new ApiError("RATE_LIMITED", "slow down", 429))).toEqual({
      kind: "failed",
      message: "Too many requests. Wait a few seconds and retry.",
    });
    expect(claimErrorPhase(new ApiError("NOT_FOUND", "no test USDC faucet here", 404))).toEqual({
      kind: "failed",
      message: "no test USDC faucet here",
    });
  });
});

describe("faucetClaims", () => {
  const answer =
    (status: FaucetResponse["status"]) =>
    async (claimId: string): Promise<FaucetResponse> => ({
      claimId,
      amount: "100000000",
      status,
      signature: status === "submitted" ? "5ig" : null,
      error: null,
    });
  const fails = (error: ApiError) => async (): Promise<FaucetResponse> => {
    throw error;
  };
  const ids = () => {
    let n = 0;
    return () => `claim-${++n}`;
  };
  const sentIds =
    (log: string[]) => (send: (claimId: string) => Promise<FaucetResponse>) => async (claimId: string) => {
      log.push(claimId);
      return send(claimId);
    };

  it("resends the same claim after an unknown outcome until the relay is done with it", async () => {
    const claim = faucetClaims(ids());
    const sent: string[] = [];
    const via = sentIds(sent);
    expect(await claim(via(fails(new ApiError("UPSTREAM_ERROR", "relay unavailable", 502))))).toMatchObject({
      kind: "failed",
    });
    await claim(via(fails(new ApiError("NETWORK_ERROR", "offline", null))));
    expect(await claim(via(answer("pending")))).toEqual({ kind: "pending" });
    expect(await claim(via(answer("submitted")))).toEqual({ kind: "done", signature: "5ig" });
    await claim(via(answer("submitted")));
    expect(sent).toEqual(["claim-1", "claim-1", "claim-1", "claim-1", "claim-2"]);
  });

  it("starts a new claim after a failed or refused one", async () => {
    const claim = faucetClaims(ids());
    const sent: string[] = [];
    const via = sentIds(sent);
    await claim(via(answer("failed")));
    expect(await claim(via(fails(new ApiError("BLOCKED", "test USDC limit reached", 403))))).toMatchObject({
      kind: "limit",
    });
    await claim(via(answer("submitted")));
    expect(sent).toEqual(["claim-1", "claim-2", "claim-3"]);
  });
});
