import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import type { TiltChain } from "../src/chain";
import type { Db } from "../src/db";
import { check, evaluate, type MonitorThresholds, type Snapshot } from "../src/monitor";

const { BN } = anchor;

const thresholds: MonitorThresholds = { minRelayerLamports: 100n, minEscrowLamports: 10n, minFreeBankroll: 1_000n };
const healthy: Snapshot = {
  vaultBalance: 5_000n,
  reserved: 4_000n,
  relayerLamports: 100n,
  escrowLamports: 10n,
  stuckIntents: 0,
  paused: { deposits: false, bets: false, payouts: false },
};
const codes = (s: Partial<Snapshot>) => evaluate({ ...healthy, ...s }, thresholds).map((a) => a.code);

describe("monitor", () => {
  it("stays quiet when everything is within limits", () => {
    expect(codes({})).toEqual([]);
  });

  it("flags insolvency as critical, distinct from a thin bankroll", () => {
    expect(evaluate({ ...healthy, reserved: 5_001n }, thresholds)).toEqual([expect.objectContaining({ code: "INSOLVENT", severity: "critical" })]);
    expect(codes({ reserved: 4_001n })).toEqual(["LOW_FREE_BANKROLL"]);
  });

  it("flags what would stall payments or play", () => {
    expect(codes({ relayerLamports: 99n, escrowLamports: 9n, stuckIntents: 2, paused: { deposits: false, bets: true, payouts: true } })).toEqual([
      "LOW_RELAYER_SOL",
      "LOW_ESCROW",
      "STUCK_INTENTS",
      "PAUSED",
    ]);
  });

  it("flags a faucet reserve below a day of claims, only when the faucet is enabled", () => {
    const faucet = { ...thresholds, minFaucetReserve: 1_000n };
    expect(evaluate({ ...healthy, faucetReserve: 999n }, faucet)).toEqual([expect.objectContaining({ code: "LOW_FAUCET_RESERVE", severity: "warning" })]);
    expect(evaluate({ ...healthy, faucetReserve: 1_000n }, faucet)).toEqual([]);
    expect(codes({ faucetReserve: 0n })).toEqual([]);
  });

  it("reads the faucet reserve only when the faucet is enabled", async () => {
    const fetchFaucetReserve = vi.fn(async () => 5n);
    const chain = {
      fetchVault: async () => ({ relayer: PublicKey.default, reserved: new BN(0), config: { depositsPaused: false, betsPaused: false, payoutsPaused: false } }),
      // No vault token account: each pass ends in MONITOR_FAILED, after all reads were started.
      base: { getAccountInfo: async () => null, getBalance: async () => 1_000 },
      fetchFaucetReserve,
    } as unknown as TiltChain;
    const db = { query: async () => ({ rows: [{ n: "0" }] }) } as unknown as Db;
    await check(db, chain, thresholds);
    expect(fetchFaucetReserve).not.toHaveBeenCalled();
    await check(db, chain, { ...thresholds, minFaucetReserve: 10n });
    expect(fetchFaucetReserve).toHaveBeenCalledOnce();
  });

  it("reports a failed check as a critical alert, not a silent error", async () => {
    const chain = { fetchVault: () => Promise.reject(new Error("fetch failed")) } as unknown as TiltChain;
    expect(await check({} as Db, chain, thresholds)).toEqual([expect.objectContaining({ code: "MONITOR_FAILED", severity: "critical" })]);
  });
});
