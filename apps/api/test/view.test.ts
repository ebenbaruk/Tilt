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
  /** One hand per card list, 1 USDC each, `active` the hand to play. */
  const table = (hands: number[][], dealer: number[], active = hands.length, doubled: number[] = []): Outcome => ({
    game: "blackjack",
    bet: "1000000",
    hands: hands.map((cards, i) => ({ cards, doubled: doubled.includes(i) })),
    active,
    dealer,
  });

  it("shows a three-hand turn: every hand, the active one, its soft total and allowed moves", () => {
    const view = buildRoundView(
      input(
        table(
          [
            [10, 9],
            [1, 6],
            [5, 5],
          ],
          [9],
          1,
        ),
        { kind: "player_turn" },
        { stake: 3_000_000n },
      ),
    );
    expect(view).toMatchObject({ phase: "player_turn", stake: "3000000", payout: "0", fee: "0", net: "-3000000" });
    if (view.detail.game !== "blackjack") throw new Error("unexpected detail");
    expect(view.detail).toMatchObject({ activeHand: 1, dealerTotal: 9, canHit: true, canDouble: true });
    expect(
      view.detail.hands.map(({ total, soft, doubled, stake, result }) => ({ total, soft, doubled, stake, result })),
    ).toEqual([
      { total: 19, soft: false, doubled: false, stake: "1000000", result: null },
      { total: 17, soft: true, doubled: false, stake: "1000000", result: null },
      { total: 10, soft: false, doubled: false, stake: "1000000", result: null },
    ]);
    expect(view.detail.hands[1].cards.map((c) => c.rank)).toEqual([1, 6]);
    expect(view.detail.dealer.map((c) => c.rank)).toEqual([9]);
  });

  it("describes the active hand's moves, not the first hand's", () => {
    const view = buildRoundView(
      input(
        table(
          [
            [5, 6],
            [10, 6, 2],
          ],
          [9],
          1,
        ),
        { kind: "player_turn" },
      ),
    );
    expect(view.detail).toMatchObject({ activeHand: 1, canHit: true, canDouble: false });
  });

  it("allows no move and shows no active hand once the round is drawing or settled", () => {
    const hand = table([[5, 6]], [9], 0);
    for (const status of [idle, { kind: "awaiting", draw: "hit" } as const]) {
      expect(buildRoundView(input(hand, status)).detail).toMatchObject({
        activeHand: null,
        canHit: false,
        canDouble: false,
      });
    }
  });

  it("settles every hand against the dealer, a doubled one at twice the bet", () => {
    const view = buildRoundView(
      input(
        table(
          [
            [1, 13],
            [5, 6, 10],
            [10, 6, 9],
            [10, 7],
          ],
          [10, 7],
          4,
          [1],
        ),
        idle,
        { stake: 5_000_000n },
      ),
    );
    if (view.detail.game !== "blackjack") throw new Error("unexpected detail");
    expect(view.detail.hands.map(({ doubled, stake, result }) => ({ doubled, stake, result }))).toEqual([
      { doubled: false, stake: "1000000", result: "blackjack" },
      { doubled: true, stake: "2000000", result: "win" },
      { doubled: false, stake: "1000000", result: "lose" },
      { doubled: false, stake: "1000000", result: "push" },
    ]);
    expect(view.detail.dealerTotal).toBe(17);
  });

  it("deals cosmetic suits per hand: the same ranks look different in two hands, the same on every poll", () => {
    const outcome = table(
      [
        [2, 3, 4, 5, 6, 7, 8, 9],
        [2, 3, 4, 5, 6, 7, 8, 9],
      ],
      [9],
      0,
    );
    const suits = () => {
      const view = buildRoundView(input(outcome, { kind: "player_turn" }));
      if (view.detail.game !== "blackjack") throw new Error("unexpected detail");
      return view.detail.hands.map((h) => h.cards.map((c) => c.suit).join(""));
    };
    expect(suits()[0]).not.toBe(suits()[1]);
    expect(suits()).toEqual(suits());
  });

  it("reports a settled win gross of the fee, with the signed net", () => {
    // Program: stake 1.00, gross 2.00, fee 0.01 -> payout 1.99.
    const view = buildRoundView(
      input(table([[10, 9]], [10, 8]), idle, {
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
    const hand = table([[10, 6, 9]], [10]);
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
