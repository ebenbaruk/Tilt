import type { FaucetResponse } from "@tilt/api/public";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { claimErrorPhase, claimPhase, faucetOffer } from "@/lib/faucet";

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

  it("reads a BLOCKED refusal as the 24 h limit, and other errors as failures", () => {
    expect(claimErrorPhase(new ApiError("BLOCKED", "test USDC limit reached", 403))).toEqual({ kind: "limit" });
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
