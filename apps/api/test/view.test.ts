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
  /** One hand per card list, 1 USDC each, `active` the hand to play; `split` the hands born from
   *  a split, `splits` the splits played this round. */
  const table = (
    hands: number[][],
    dealer: number[],
    active = hands.length,
    doubled: number[] = [],
    split: number[] = [],
    splits = 0,
  ): Outcome => ({
    game: "blackjack",
    bet: "1000000",
    hands: hands.map((cards, i) => ({ cards, doubled: doubled.includes(i), split: split.includes(i) })),
    active,
    dealer,
    splits,
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
    expect(view.detail).toMatchObject({
      activeHand: 1,
      dealerTotal: 9,
      canHit: true,
      canDouble: true,
      canSplit: false,
    });
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

  it("offers a split on the active pair until the round's fourth split, never on split aces", () => {
    const turn = { kind: "player_turn" } as const;
    const detail = (outcome: Outcome) => buildRoundView(input(outcome, turn)).detail;
    expect(
      detail(
        table(
          [
            [10, 9],
            [13, 12],
          ],
          [9],
          1,
        ),
      ),
    ).toMatchObject({ activeHand: 1, canSplit: true });
    expect(
      detail(
        table(
          [
            [8, 8],
            [8, 3],
          ],
          [9],
          0,
          [],
          [0, 1],
          3,
        ),
      ),
    ).toMatchObject({ canSplit: true, canDouble: true });
    expect(
      detail(
        table(
          [
            [8, 8],
            [8, 3],
          ],
          [9],
          0,
          [],
          [0, 1],
          4,
        ),
      ),
    ).toMatchObject({ canSplit: false, canHit: true });
    expect(detail(table([[1, 1]], [9], 0))).toMatchObject({ canSplit: true });
    // Split aces never play on, even when the ace's card is another ace.
    expect(
      detail(
        table(
          [
            [1, 1],
            [1, 5],
          ],
          [9],
          0,
          [],
          [0, 1],
          1,
        ),
      ),
    ).toMatchObject({
      canHit: false,
      canDouble: false,
      canSplit: false,
    });
    expect(detail(table([[10, 9]], [9], 0))).toMatchObject({ canSplit: false });
  });

  it("allows no move and shows no active hand once the round is drawing or settled", () => {
    const hand = table([[8, 8]], [9], 0);
    for (const status of [idle, { kind: "awaiting", draw: "split" } as const]) {
      expect(buildRoundView(input(hand, status)).detail).toMatchObject({
        activeHand: null,
        canHit: false,
        canDouble: false,
        canSplit: false,
      });
    }
  });

  it("settles every hand against the dealer, a doubled one at twice the bet, a split 21 at even money", () => {
    const view = buildRoundView(
      input(
        table(
          [
            [1, 13],
            [5, 6, 10],
            [10, 6, 9],
            [10, 7],
            [1, 10],
            [1, 7],
          ],
          [10, 7],
          6,
          [1],
          [4, 5],
          1,
        ),
        idle,
        { stake: 7_000_000n },
      ),
    );
    if (view.detail.game !== "blackjack") throw new Error("unexpected detail");
    expect(view.detail.hands.map(({ doubled, split, stake, result }) => ({ doubled, split, stake, result }))).toEqual([
      { doubled: false, split: false, stake: "1000000", result: "blackjack" },
      { doubled: true, split: false, stake: "2000000", result: "win" },
      { doubled: false, split: false, stake: "1000000", result: "lose" },
      { doubled: false, split: false, stake: "1000000", result: "push" },
      { doubled: false, split: true, stake: "1000000", result: "win" },
      { doubled: false, split: true, stake: "1000000", result: "win" },
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

  describe("mines", () => {
    const board = (
      mines: number,
      order: number[],
      more: Partial<Extract<Outcome, { game: "mines" }>> = {},
    ): Outcome => ({
      game: "mines",
      mines,
      order,
      pending: null,
      busted: null,
      maxGain: "1000000000",
      ...more,
    });
    const turn: RoundStatus = { kind: "player_turn" };

    it("opens a board at 1x, revealable but not cashable yet", () => {
      expect(buildRoundView(input(board(1, []), turn)).detail).toEqual({
        game: "mines",
        mines: 1,
        revealed: [],
        pending: null,
        busted: null,
        multiplier: "1.0000",
        nextMultiplier: "1.0312",
        canCashOut: false,
        canReveal: true,
      });
    });

    it("shows the multipliers after safe tiles, rounded down to 4 decimals", () => {
      expect(buildRoundView(input(board(3, [7, 12]), turn)).detail).toMatchObject({
        revealed: [7, 12],
        multiplier: "1.2857",
        nextMultiplier: "1.4785",
        canCashOut: true,
        canReveal: true,
      });
    });

    it("shows the pending tile and allows nothing while its draw is awaited", () => {
      const view = buildRoundView(input(board(3, [7], { pending: 8 }), { kind: "awaiting", draw: "reveal" }));
      expect(view.phase).toBe("drawing");
      expect(view.detail).toMatchObject({ pending: 8, canCashOut: false, canReveal: false, nextMultiplier: "1.2857" });
    });

    it("offers no next tile once the round cap or the cleared board is reached", () => {
      // 1 USDC with a 2 USDC gain limit: 3x at most.
      const capped = board(12, [0, 1, 2, 3, 4], { maxGain: "2000000" });
      expect(buildRoundView(input(capped, turn)).detail).toMatchObject({
        multiplier: "3.0000",
        nextMultiplier: null,
        canReveal: false,
        canCashOut: true,
      });
      const cleared = board(24, [5], { maxGain: "23750000" });
      expect(buildRoundView(input(cleared, idle, { payout: 24_512_500n, fee: 237_500n })).detail).toMatchObject({
        multiplier: "24.7500",
        nextMultiplier: null,
        canReveal: false,
        canCashOut: false,
      });
    });

    it("shows the busting mine of a settled round, with no move left", () => {
      const view = buildRoundView(input(board(5, [1, 2], { busted: 3 }), idle));
      expect(view).toMatchObject({ phase: "idle", payout: "0", net: "-1000000" });
      expect(view.detail).toMatchObject({
        revealed: [1, 2],
        busted: 3,
        nextMultiplier: null,
        canCashOut: false,
        canReveal: false,
      });
    });
  });

  describe("one-draw games", () => {
    const spin: RoundStatus = { kind: "awaiting", draw: "spin" };

    it("hides the dice roll until it lands, and shows the payout multiplier", () => {
      const dice: Outcome = { game: "dice", target: 5_000, over: true, roll: 0 };
      expect(buildRoundView(input(dice, spin)).detail).toEqual({
        game: "dice",
        target: 5_000,
        over: true,
        roll: null,
        multiplier: "1.9600",
      });
      const settled = buildRoundView(input({ ...dice, roll: 7_342 }, idle, { payout: 1_950_400n, fee: 9_600n }));
      expect(settled).toMatchObject({ phase: "idle", payout: "1960000", net: "950400" });
      expect(settled.detail).toMatchObject({ roll: 7_342 });
    });

    it("shows limbo multipliers with 2 decimals", () => {
      const limbo: Outcome = { game: "limbo", target: 200, result: 153 };
      expect(buildRoundView(input(limbo, spin)).detail).toEqual({ game: "limbo", target: "2.00", result: null });
      expect(buildRoundView(input(limbo, idle)).detail).toEqual({ game: "limbo", target: "2.00", result: "1.53" });
      const huge: Outcome = { game: "limbo", target: 1_000_000, result: 100_000_000 };
      expect(buildRoundView(input(huge, idle)).detail).toMatchObject({ target: "10000.00", result: "1000000.00" });
    });

    it("shows every coin once flipped", () => {
      const flip: Outcome = { game: "flip", side: "tails", flips: 3, results: ["tails", "heads", "tails"] };
      expect(buildRoundView(input(flip, spin)).detail).toEqual({
        game: "flip",
        side: "tails",
        flips: 3,
        results: null,
        multiplier: "7.8400",
      });
      expect(buildRoundView(input(flip, idle)).detail).toMatchObject({ results: ["tails", "heads", "tails"] });
    });

    it("shows the keno pay table for the picks, then the draw and the hits", () => {
      const keno: Outcome = { game: "keno", picks: [3, 17, 40], drawn: [40, 1, 2, 4, 5, 6, 7, 8, 9, 3] };
      expect(buildRoundView(input(keno, spin)).detail).toEqual({
        game: "keno",
        picks: [3, 17, 40],
        drawn: null,
        hits: null,
        paytable: ["0.00", "0.80", "2.00", "26.70"],
      });
      expect(buildRoundView(input(keno, idle)).detail).toMatchObject({ drawn: keno.drawn, hits: 2 });
    });

    it("shows every wheel segment's multiplier, then the landed one", () => {
      const wheel: Outcome = { game: "wheel", segments: 10, risk: "high", segment: 9 };
      expect(buildRoundView(input(wheel, spin)).detail).toEqual({
        game: "wheel",
        segments: 10,
        risk: "high",
        multipliers: [...Array<string>(9).fill("0.00"), "9.80"],
        segment: null,
      });
      const low: Outcome = { game: "wheel", segments: 20, risk: "low", segment: 4 };
      const view = buildRoundView(input(low, idle));
      expect(view.detail).toMatchObject({ segment: 4 });
      expect(view.detail.game === "wheel" && view.detail.multipliers.slice(0, 5)).toEqual([
        "1.40",
        "1.20",
        "1.20",
        "1.20",
        "0.00",
      ]);
    });
  });

  describe("hilo", () => {
    // Cards: 6 = 7♠, 22 = 10♥, 0 = A♠, 12 = K♠.
    const board = (cards: number[], guesses: Extract<Outcome, { game: "hilo" }>["guesses"], more = {}): Outcome => ({
      game: "hilo",
      cards,
      guesses,
      pending: null,
      busted: false,
      maxGain: "1000000000",
      ...more,
    });
    const turn: RoundStatus = { kind: "player_turn" };

    it("shows no card and allows nothing while the first card is drawn", () => {
      expect(buildRoundView(input(board([], []), { kind: "awaiting", draw: "card" })).detail).toEqual({
        game: "hilo",
        cards: [],
        guesses: [],
        pending: null,
        multiplier: "0.9800",
        higherMultiplier: null,
        lowerMultiplier: null,
        skipsLeft: 10,
        canGuess: false,
        canCashOut: false,
        busted: false,
      });
    });

    it("offers both guesses on the first card, no cash-out yet", () => {
      expect(buildRoundView(input(board([6], []), turn)).detail).toMatchObject({
        cards: [{ rank: 7, suit: "♠" }],
        multiplier: "0.9800",
        higherMultiplier: "1.8199",
        lowerMultiplier: "1.8199",
        canGuess: true,
        canCashOut: false,
      });
    });

    it("multiplies after a right guess and counts skips", () => {
      expect(buildRoundView(input(board([6, 22], ["higher"]), turn)).detail).toMatchObject({
        cards: [
          { rank: 7, suit: "♠" },
          { rank: 10, suit: "♥" },
        ],
        multiplier: "1.8199",
        higherMultiplier: "5.9149",
        lowerMultiplier: "2.3659",
        canCashOut: true,
      });
      expect(buildRoundView(input(board([6, 22, 22], ["skip", "skip"]), turn)).detail).toMatchObject({
        multiplier: "0.9800",
        skipsLeft: 8,
        canCashOut: false,
      });
    });

    it("offers the strict bet on an ace or a king: 13 / 12", () => {
      expect(buildRoundView(input(board([0], []), turn)).detail).toMatchObject({
        higherMultiplier: "1.0616",
        lowerMultiplier: "12.7400",
      });
      expect(buildRoundView(input(board([12], []), turn)).detail).toMatchObject({
        higherMultiplier: "12.7400",
        lowerMultiplier: "1.0616",
      });
      // Lower from a king, right on a queen (card 11).
      expect(buildRoundView(input(board([12, 11], ["lower"]), turn)).detail).toMatchObject({
        multiplier: "1.0616",
        canCashOut: true,
      });
    });

    it("shows the pending guess and allows nothing while its card is drawn", () => {
      const pending = board([6, 22], ["higher"], { pending: "lower" });
      expect(buildRoundView(input(pending, { kind: "awaiting", draw: "card" })).detail).toMatchObject({
        pending: "lower",
        higherMultiplier: null,
        lowerMultiplier: null,
        canGuess: false,
        canCashOut: false,
      });
    });

    it("shows a bust and the round cap", () => {
      const busted = buildRoundView(input(board([6, 22, 0], ["higher", "higher"], { busted: true }), idle));
      expect(busted).toMatchObject({ payout: "0", net: "-1000000" });
      expect(busted.detail).toMatchObject({ busted: true, canGuess: false, canCashOut: false, multiplier: "1.8199" });
      // 1 USDC with a 2 USDC gain limit: 3x at most.
      const capped = board([6, 22, 25], ["higher", "higher"], { maxGain: "2000000" });
      expect(buildRoundView(input(capped, idle)).detail).toMatchObject({ multiplier: "3.0000" });
    });

    it("fails loudly on guesses the program would refuse", () => {
      // An 11th skip.
      expect(() =>
        buildRoundView(input(board(Array<number>(12).fill(5), Array<"skip">(11).fill("skip")), turn)),
      ).toThrow();
    });
  });

  describe("tower", () => {
    const board = (
      difficulty: Extract<Outcome, { game: "tower" }>["difficulty"],
      climbed: number[],
      more: Partial<Extract<Outcome, { game: "tower" }>> = {},
    ): Outcome => ({
      game: "tower",
      difficulty,
      climbed,
      pending: null,
      busted: null,
      maxGain: "1000000000",
      ...more,
    });
    const turn: RoundStatus = { kind: "player_turn" };

    it("opens a tower at 1x, climbable but not cashable yet", () => {
      expect(buildRoundView(input(board("easy", []), turn)).detail).toEqual({
        game: "tower",
        difficulty: "easy",
        tiles: 4,
        levels: 9,
        climbed: [],
        pending: null,
        busted: null,
        multiplier: "1.0000",
        nextMultiplier: "1.3066",
        canClimb: true,
        canCashOut: false,
      });
    });

    it("shows the multipliers after safe levels, and the pending climb", () => {
      expect(buildRoundView(input(board("medium", [0, 2]), turn)).detail).toMatchObject({
        tiles: 3,
        multiplier: "2.2050",
        nextMultiplier: "3.3075",
        canClimb: true,
        canCashOut: true,
      });
      const pending = board("medium", [0, 2], { pending: 1 });
      expect(buildRoundView(input(pending, { kind: "awaiting", draw: "climb" })).detail).toMatchObject({
        pending: 1,
        canClimb: false,
        canCashOut: false,
      });
    });

    it("offers nothing past the top, the cap or a bust", () => {
      const top = board("hard", Array<number>(9).fill(0), { maxGain: "500760000" });
      expect(buildRoundView(input(top, idle)).detail).toMatchObject({
        multiplier: "501.7600",
        nextMultiplier: null,
        canClimb: false,
      });
      const capped = board("master", [0, 1], { maxGain: "2000000" });
      expect(buildRoundView(input(capped, turn)).detail).toMatchObject({ multiplier: "3.0000", nextMultiplier: null });
      const busted = board("expert", [2], { busted: 0 });
      expect(buildRoundView(input(busted, idle)).detail).toMatchObject({
        busted: 0,
        nextMultiplier: null,
        canClimb: false,
        canCashOut: false,
      });
    });
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
