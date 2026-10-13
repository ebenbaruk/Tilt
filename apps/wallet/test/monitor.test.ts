import { describe, expect, it } from "vitest";
import type { TiltChain } from "../src/chain";
import type { Db } from "../src/db";
import { check, evaluate, type MonitorThresholds, type Snapshot } from "../src/monitor";

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

  it("reports a failed check as a critical alert, not a silent error", async () => {
    const chain = { fetchVault: () => Promise.reject(new Error("fetch failed")) } as unknown as TiltChain;
    expect(await check({} as Db, chain, thresholds)).toEqual([expect.objectContaining({ code: "MONITOR_FAILED", severity: "critical" })]);
  });
});
