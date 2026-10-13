// Decoding of on-chain accounts into the api's plain round shape.
import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { associatedTokenAddress, decodeRound } from "../src/chain";

const { BN } = anchor;
type RoundData = Parameters<typeof decodeRound>[0];

const cards = (ranks: number[]) => [...ranks, ...Array<number>(21 - ranks.length).fill(0)];

const base: RoundData = {
  game: { blackjack: {} },
  status: { idle: {} },
  stake: new BN(2_000_000),
  lastAction: new BN(0),
  requestId: new BN(7),
  payout: new BN(3_980_000),
  fee: new BN(20_000),
  blackjack: { player: cards([5, 6, 10]), nPlayer: 3, dealer: cards([9, 8]), nDealer: 2, doubled: true },
  roulette: null,
  baccarat: null,
  slots: { reels: [0, 0, 0] },
};

describe("chain decoding", () => {
  it("derives the player's USDC token account like spl-token", () => {
    const owner = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    const mint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(associatedTokenAddress(owner, mint).toBase58()).toBe("C4PRXFV6Gf5mytVZb6RoeLsG8CjcFWzR2EJ3dvwPTUJH");
  });

  it("decodes a settled blackjack round, trimming empty card slots", () => {
    expect(decodeRound(base)).toEqual({
      status: { kind: "idle" },
      stake: 2_000_000n,
      payout: 3_980_000n,
      fee: 20_000n,
      requestId: 7n,
      outcome: { game: "blackjack", player: [5, 6, 10], dealer: [9, 8], doubled: true },
    });
  });

  it("decodes statuses and the other games", () => {
    expect(decodeRound({ ...base, status: { playerTurn: {} } }).status).toEqual({ kind: "player_turn" });
    expect(decodeRound({ ...base, status: { awaitingDraw: { 0: { double: {} } } } }).status).toEqual({
      kind: "awaiting",
      draw: "double",
    });
    const roulette = { ...base, game: { roulette: {} }, roulette: { bet: { dozen: { 0: 2 } }, number: 14 } };
    expect(decodeRound(roulette).outcome).toEqual({ game: "roulette", bet: { kind: "dozen", dozen: 2 }, number: 14 });
    const red = { ...roulette, roulette: { bet: { red: {} }, number: 3 } };
    expect(decodeRound(red).outcome).toMatchObject({ bet: { kind: "red" } });
    const baccarat = {
      ...base,
      game: { baccarat: {} },
      baccarat: { bet: { tie: {} }, player: [3, 4, 0], banker: [13, 7, 2] },
    };
    expect(decodeRound(baccarat).outcome).toEqual({ game: "baccarat", bet: "tie", player: [3, 4], banker: [13, 7, 2] });
    expect(decodeRound({ ...base, game: { slots: {} }, slots: { reels: [6, 6, 1] } }).outcome).toEqual({
      game: "slots",
      reels: [6, 6, 1],
    });
  });

  it("fails loudly on an inconsistent round", () => {
    expect(() => decodeRound({ ...base, game: { roulette: {} } })).toThrow();
  });
});
