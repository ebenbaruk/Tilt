// RoundView: what the mod displays for a round in each phase.
import { describe, expect, it } from "vitest";
import { suitFor } from "../src/games/cards";
import type { Outcome, RoundStatus } from "../src/games/round";
import { buildRoundView, type RoundViewInput } from "../src/games/view";

const PLAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const input = (outcome: Outcome, status: RoundStatus, overrides: Partial<RoundViewInput> = {}): RoundViewInput => ({
  player: PLAYER,
  number: 4,
  status,
  stake: 1_000_000n,
  payout: 0n,
  fee: 0n,
  outcome,
  settledSignature: null,
  ...overrides,
});

const idle: RoundStatus = { kind: "idle" };

describe("buildRoundView", () => {
  it("shows a blackjack hand waiting for the player, soft total and allowed moves", () => {
    const view = buildRoundView(
      input({ game: "blackjack", player: [1, 6], dealer: [9], doubled: false }, { kind: "player_turn" }),
    );
    expect(view).toMatchObject({ phase: "player_turn", stake: "1000000", payout: "0", fee: "0", net: "-1000000" });
    expect(view.detail).toMatchObject({
      game: "blackjack",
      playerTotal: 17,
      playerSoft: true,
      dealerTotal: 9,
      canHit: true,
      canDouble: true,
      doubled: false,
    });
    if (view.detail.game !== "blackjack") throw new Error("unexpected detail");
    expect(view.detail.player.map((c) => c.rank)).toEqual([1, 6]);
  });

  it("allows no move once the round is drawing or settled", () => {
    const hand: Outcome = { game: "blackjack", player: [5, 6], dealer: [9], doubled: false };
    for (const status of [idle, { kind: "awaiting", draw: "hit" } as const]) {
      expect(buildRoundView(input(hand, status)).detail).toMatchObject({ canHit: false, canDouble: false });
    }
  });

  it("reports a settled win gross of the fee, with the signed net", () => {
    // Program: stake 1.00, gross 2.00, fee 0.01 -> payout 1.99.
    const view = buildRoundView(
      input({ game: "blackjack", player: [10, 9], dealer: [10, 8], doubled: false }, idle, {
        payout: 1_990_000n,
        fee: 10_000n,
        settledSignature: "sig",
      }),
    );
    expect(view).toMatchObject({
      phase: "idle",
      payout: "2000000",
      fee: "10000",
      net: "990000",
      settledSignature: "sig",
    });
  });

  it("reports a loss with a negative net and a push with zero", () => {
    const hand: Outcome = { game: "blackjack", player: [10, 6, 9], dealer: [10], doubled: false };
    expect(buildRoundView(input(hand, idle)).net).toBe("-1000000");
    expect(buildRoundView(input(hand, idle, { payout: 1_000_000n })).net).toBe("0");
  });

  it("hides the roulette number and the slot reels until the round settles", () => {
    const spin: Outcome = { game: "roulette", bet: { kind: "red" }, number: 0 };
    expect(buildRoundView(input(spin, { kind: "awaiting", draw: "spin" })).detail).toEqual({
      game: "roulette",
      bet: { kind: "red" },
      number: null,
    });
    expect(buildRoundView(input({ ...spin, number: 32 }, idle)).detail).toMatchObject({ number: 32 });
    const reels: Outcome = { game: "slots", reels: [0, 1, 6] };
    expect(buildRoundView(input(reels, { kind: "awaiting", draw: "spin" })).detail).toEqual({
      game: "slots",
      reels: null,
    });
    expect(buildRoundView(input(reels, idle)).detail).toEqual({ game: "slots", reels: ["7", "◆", "♥"] });
  });

  it("computes baccarat points", () => {
    const view = buildRoundView(input({ game: "baccarat", bet: "tie", player: [9, 13, 5], banker: [3, 4] }, idle));
    expect(view.detail).toMatchObject({ game: "baccarat", bet: "tie", playerPoints: 4, bankerPoints: 7 });
  });

  it("drops the settled signature while a round is in progress", () => {
    const view = buildRoundView(
      input({ game: "slots", reels: [0, 0, 0] }, { kind: "awaiting", draw: "spin" }, { settledSignature: "old" }),
    );
    expect(view.settledSignature).toBeNull();
  });
});

describe("cosmetic suits", () => {
  it("are stable for a card and vary across cards", () => {
    expect(suitFor(PLAYER, 4, "player", 0)).toBe(suitFor(PLAYER, 4, "player", 0));
    const suits = new Set(Array.from({ length: 40 }, (_, i) => suitFor(PLAYER, 4, "player", i)));
    expect(suits.size).toBe(4);
  });
});
