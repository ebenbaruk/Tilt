// Game rules and replay against the program's own Rust code: test/fixtures/rust-vectors.json was
// produced by compiling chain/programs/tilt/src/{rng,settlement,games/*}.rs (see rust-vectors.rs).
import type { FlipSide, HiloGuess, TowerDifficulty, WheelRisk } from "@tilt/mod/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as baccarat from "../src/games/baccarat";
import * as blackjack from "../src/games/blackjack";
import { formatFixed } from "../src/games/decimal";
import * as dice from "../src/games/dice";
import * as flip from "../src/games/flip";
import * as hilo from "../src/games/hilo";
import * as keno from "../src/games/keno";
import * as limbo from "../src/games/limbo";
import * as mines from "../src/games/mines";
import { replay, type ReplayInput } from "../src/games/replay";
import type { Outcome } from "../src/games/round";
import { Rng } from "../src/games/rng";
import * as roulette from "../src/games/roulette";
import { settle } from "../src/games/settlement";
import * as slots from "../src/games/slots";
import * as tower from "../src/games/tower";
import * as wheel from "../src/games/wheel";
import vectors from "./fixtures/rust-vectors.json";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const STAKE = 1_000_000n;

/** The JSON's strings as the protocol's literal types (fails on anything else). */
function literal<T extends string>(values: readonly T[], value: string): T {
  const found = values.find((v) => v === value);
  if (found === undefined) throw new Error(`unexpected ${value}`);
  return found;
}
const sideOf = (s: string) => literal<FlipSide>(flip.SIDES, s);
const riskOf = (s: string) => literal<WheelRisk>(wheel.RISKS, s);
const difficultyOf = (s: string) => literal<TowerDifficulty>(tower.DIFFICULTY_NAMES, s);
const guessesOf = (codes: number[]): HiloGuess[] => codes.map((c) => literal(hilo.GUESSES, hilo.GUESSES[c] ?? ""));
/** Flip coins as the program stores them: bit i set when coin i landed tails. */
const coinsOf = (results: FlipSide[]) => results.reduce((bits, r, i) => bits | ((r === "tails" ? 1 : 0) << i), 0);

describe("rng (port of rng.rs)", () => {
  it.each(vectors.rng)("replays the program's draws for seed $seed", (v) => {
    const rng = Rng.fromVrf(bytes(v.seed));
    expect(Array.from({ length: 6 }, () => rng.below(37))).toEqual(v.below37);
    expect(Array.from({ length: 6 }, () => rng.card())).toEqual(v.cards);
    expect(Array.from({ length: 6 }, () => rng.below(41))).toEqual(v.below41);
  });

  it("refuses randomness that is not 32 bytes and empty ranges", () => {
    expect(() => Rng.fromVrf(new Uint8Array(31))).toThrow();
    expect(() => Rng.fromVrf(new Uint8Array(32)).below(0)).toThrow();
  });

  it("is deterministic and stays in range", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const a = Rng.fromVrf(seed);
        const b = Rng.fromVrf(seed);
        for (let i = 0; i < 10; i++) {
          const x = a.below(n);
          expect(x).toBe(b.below(n));
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(n);
        }
      }),
    );
  });
});

describe("settlement", () => {
  it("takes 1% of the gain of a winning round only, rounded down", () => {
    expect(settle(1_000_000n, 2_000_000n)).toEqual({ payout: 1_990_000n, fee: 10_000n });
    expect(settle(1_000_000n, 1_000_000n)).toEqual({ payout: 1_000_000n, fee: 0n });
    expect(settle(1_000_000n, 0n)).toEqual({ payout: 0n, fee: 0n });
    expect(settle(1_000n, 1_199n).fee).toBe(1n);
    expect(settle(1_000n, 1_099n).fee).toBe(0n);
  });
});

describe("blackjack", () => {
  it("counts aces soft when possible", () => {
    expect(blackjack.total([1, 6])).toBe(17);
    expect(blackjack.isSoft([1, 6])).toBe(true);
    expect(blackjack.total([1, 6, 10])).toBe(17);
    expect(blackjack.isSoft([1, 6, 10])).toBe(false);
    expect(blackjack.total([1, 1, 9])).toBe(21);
    expect(blackjack.isSoft([1, 1, 9])).toBe(true);
    expect(blackjack.total([13, 12])).toBe(20);
    expect(blackjack.isSoft([13, 12])).toBe(false);
    expect(blackjack.total([])).toBe(0);
  });

  const hand = (cards: number[], doubled = false, split = false): blackjack.TableHand => ({ cards, doubled, split });
  /** A table waiting on its first hand, `splits` already played. */
  const playing = (hands: blackjack.TableHand[], splits = 0): blackjack.Table => ({
    hands,
    active: 0,
    dealer: [7],
    splits,
  });

  it("allows hit below 21 on an undoubled hand, and double only on the first two cards", () => {
    expect(blackjack.canHit(hand([10, 6]))).toBe(true);
    expect(blackjack.canHit(hand([10, 1]))).toBe(false);
    expect(blackjack.canHit(hand([5, 6, 2], true))).toBe(false);
    expect(blackjack.canDouble(hand([5, 6]))).toBe(true);
    expect(blackjack.canDouble(hand([5, 6], true))).toBe(false);
    expect(blackjack.canDouble(hand([2, 3, 4]))).toBe(false);
    expect(blackjack.canDouble(hand([1, 10]))).toBe(false);
  });

  it("splits two first cards of the same value, never split aces, within the round's cap", () => {
    const can = (h: blackjack.TableHand, splits = 0) => blackjack.canSplit(playing([h], splits));
    expect(can(hand([13, 12]))).toBe(true);
    expect(can(hand([10, 11]))).toBe(true);
    expect(can(hand([8, 8]))).toBe(true);
    expect(can(hand([1, 1]))).toBe(true);
    expect(can(hand([8, 8], false, true))).toBe(true);
    expect(can(hand([13, 9]))).toBe(false);
    expect(can(hand([1, 13]))).toBe(false);
    expect(can(hand([4, 4, 2]))).toBe(false);
    expect(can(hand([4, 4], true))).toBe(false);
    expect(can(hand([1, 1], false, true))).toBe(false);
    expect(can(hand([8, 8]), blackjack.MAX_SPLITS - 1)).toBe(true);
    expect(can(hand([8, 8]), blackjack.MAX_SPLITS)).toBe(false);
    expect(blackjack.canSplit({ ...playing([hand([8, 8])]), active: 1 })).toBe(false);
  });

  it("finishes split aces at one card each, but lets other split hands hit and double", () => {
    expect(blackjack.canHit(hand([1, 5], false, true))).toBe(false);
    expect(blackjack.canDouble(hand([1, 5], false, true))).toBe(false);
    expect(blackjack.canHit(hand([8, 3], false, true))).toBe(true);
    expect(blackjack.canDouble(hand([8, 3], false, true))).toBe(true);
  });

  it("puts the new hand right after the split one, one card each in order", () => {
    const seed = new Uint8Array(32);
    const expected = Rng.fromVrf(seed);
    const [toSplit, toNew] = [expected.card(), expected.card()];
    const t = playing([hand([8, 8]), hand([10, 9])]);
    blackjack.split(t, Rng.fromVrf(seed));
    expect(t.hands).toEqual([hand([8, toSplit], false, true), hand([8, toNew], false, true), hand([10, 9])]);
    expect(t.splits).toBe(1);
  });

  it("ends a lone split-aces round at once: one card each, then the dealer to 17", () => {
    const t = playing([hand([1, 1])]);
    expect(blackjack.split(t, Rng.fromVrf(new Uint8Array(32)))).toBe(true);
    expect(t.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(t.active).toBe(2);
    expect(blackjack.total(t.dealer)).toBeGreaterThanOrEqual(17);
  });

  it("does not split the hands past the table's ten slots", () => {
    const full = playing(
      [hand([8, 8]), ...Array.from({ length: blackjack.MAX_TABLE_HANDS - 1 }, () => hand([10, 9]))],
      0,
    );
    expect(blackjack.canSplit(full)).toBe(false);
  });

  it("pays each hand like the program", () => {
    const g = (cards: number[], dealer: number[], doubled = false, split = false) =>
      blackjack.handGross({ cards, doubled, split }, dealer, 1_000n);
    expect(g([1, 13], [9, 8])).toBe(2_500n);
    expect(g([1, 13], [1, 10])).toBe(1_000n);
    expect(g([10, 9], [1, 10])).toBe(0n);
    expect(g([10, 9], [10, 8])).toBe(2_000n);
    expect(g([10, 8], [10, 8])).toBe(1_000n);
    expect(g([10, 6, 9], [2])).toBe(0n);
    expect(g([10, 6], [10, 6, 9])).toBe(2_000n);
    expect(g([5, 6, 10], [9, 8], true)).toBe(4_000n);
    expect(g([5, 6, 10], [1, 13], true)).toBe(0n);
    // A split 21 is no blackjack: even money, loses to a dealer blackjack, pushes a 21.
    expect(g([1, 13], [9, 8], false, true)).toBe(2_000n);
    expect(g([1, 13], [1, 10], false, true)).toBe(0n);
    expect(g([1, 13], [10, 5, 6], false, true)).toBe(1_000n);
  });

  it("names each settled hand's result", () => {
    const r = (cards: number[], dealer: number[], doubled = false, split = false) =>
      blackjack.result({ cards, doubled, split }, dealer, 1_000n);
    expect(r([1, 13], [9, 8])).toBe("blackjack");
    expect(r([1, 13], [1, 10])).toBe("push");
    expect(r([1, 13], [9, 8], false, true)).toBe("win");
    expect(r([5, 6, 10], [9, 8], true)).toBe("win");
    expect(r([10, 8], [10, 8])).toBe("push");
    expect(r([10, 6, 9], [2])).toBe("lose");
  });

  it("dealer stands on soft 17, plays nothing against busts and one card against naturals only", () => {
    const rng = () => Rng.fromVrf(new Uint8Array(32));
    const table = (hands: number[][], dealer: number[]): blackjack.Table => ({
      hands: hands.map((cards) => hand(cards)),
      active: hands.length,
      dealer,
      splits: 0,
    });
    const soft17 = table([[10, 8]], [1, 6]);
    blackjack.playDealer(soft17, rng());
    expect(soft17.dealer).toEqual([1, 6]);
    const busts = table(
      [
        [10, 6, 9],
        [10, 5, 8],
      ],
      [4],
    );
    blackjack.playDealer(busts, rng());
    expect(busts.dealer).toEqual([4]);
    const naturals = table(
      [
        [1, 13],
        [10, 6, 9],
      ],
      [4],
    );
    blackjack.playDealer(naturals, rng());
    expect(naturals.dealer).toHaveLength(2);
  });

  it("has the dealer draw to 17 against a split 21, as against any standing hand", () => {
    const t: blackjack.Table = { hands: [hand([1, 13], false, true)], active: 1, dealer: [4], splits: 1 };
    blackjack.playDealer(t, Rng.fromVrf(new Uint8Array(32)));
    expect(blackjack.total(t.dealer)).toBeGreaterThanOrEqual(17);
  });

  it("moves to the next hand on a stand, skipping finished hands, without a card", () => {
    const t: blackjack.Table = {
      hands: [hand([10, 6]), hand([1, 13]), hand([9, 2])],
      active: 0,
      dealer: [7],
      splits: 0,
    };
    expect(blackjack.stand(t)).toBe(false);
    expect(t.active).toBe(2);
    expect(blackjack.stand(t)).toBe(true);
    expect(t.active).toBe(3);
    expect(t.dealer).toEqual([7]);
  });

  it.each(vectors.blackjack.map((v, i) => ({ ...v, i })))(
    "plays round $i ($hands.length hands) like the program",
    (v) => {
      const t = blackjack.newTable(v.hands.length - v.splits);
      let next = 0;
      const rng = () => Rng.fromVrf(bytes(v.draws[next++]));
      for (const action of v.actions) {
        if (action === "deal") blackjack.deal(t, rng());
        else if (action === "hit") blackjack.hit(t, rng());
        else if (action === "double") blackjack.double(t, rng());
        else if (action === "split") blackjack.split(t, rng());
        else if (action === "stand") blackjack.stand(t);
        else blackjack.playDealer(t, rng());
      }
      expect(next).toBe(v.draws.length);
      expect(t).toEqual({ hands: v.hands, active: v.active, dealer: v.dealer, splits: v.splits });
      expect(blackjack.tableStake(t, BigInt(v.bet)).toString()).toBe(v.stake);
      expect(blackjack.gross(t, BigInt(v.bet)).toString()).toBe(v.gross);
    },
  );
});

describe("baccarat", () => {
  it("applies the banker's third-card table", () => {
    expect(baccarat.bankerDraws(3, 7)).toBe(true);
    expect(baccarat.bankerDraws(3, 8)).toBe(false);
    expect(baccarat.bankerDraws(4, 2)).toBe(true);
    expect(baccarat.bankerDraws(4, 1)).toBe(false);
    expect(baccarat.bankerDraws(5, 4)).toBe(true);
    expect(baccarat.bankerDraws(5, 3)).toBe(false);
    expect(baccarat.bankerDraws(6, 6)).toBe(true);
    expect(baccarat.bankerDraws(6, null)).toBe(false);
    expect(baccarat.bankerDraws(5, null)).toBe(true);
    expect(baccarat.bankerDraws(7, 6)).toBe(false);
    expect(baccarat.bankerDraws(2, 9)).toBe(true);
  });

  it("pays player 1:1, banker 0.95:1, tie 8:1 and pushes on a tie", () => {
    const tie = { player: [3, 4], banker: [13, 7] };
    expect(baccarat.gross("player", tie, 100n)).toBe(100n);
    expect(baccarat.gross("banker", tie, 100n)).toBe(100n);
    expect(baccarat.gross("tie", tie, 100n)).toBe(900n);
    expect(baccarat.gross("banker", { player: [3, 3, 13], banker: [9, 13] }, 100n)).toBe(195n);
    expect(baccarat.points([9, 13, 5])).toBe(4);
  });

  it.each(vectors.baccarat)("deals coup $seed like the program", (v) => {
    const coup = baccarat.dealCoup(Rng.fromVrf(bytes(v.seed)));
    expect(coup.player).toEqual(v.player.filter((c) => c !== 0));
    expect(coup.banker).toEqual(v.banker.filter((c) => c !== 0));
    const bets = ["player", "banker", "tie"] as const;
    expect(bets.map((b) => baccarat.gross(b, coup, STAKE))).toEqual(v.gross.map(BigInt));
  });
});

describe("roulette", () => {
  it("returns 36 of 37 for every bet", () => {
    for (const bet of roulette.ALL_BETS) {
      const returned = Array.from({ length: 37 }, (_, n) => roulette.gross(bet, n, 1n)).reduce((a, b) => a + b, 0n);
      expect(returned).toBe(36n);
    }
  });

  it("loses outside bets on zero and maps dozens and columns", () => {
    expect(roulette.gross({ kind: "red" }, 0, 100n)).toBe(0n);
    expect(roulette.gross({ kind: "even" }, 0, 100n)).toBe(0n);
    expect(roulette.gross({ kind: "dozen", dozen: 2 }, 13, 100n)).toBe(300n);
    expect(roulette.gross({ kind: "dozen", dozen: 2 }, 25, 100n)).toBe(0n);
    expect(roulette.gross({ kind: "column", column: 1 }, 34, 100n)).toBe(300n);
    expect(roulette.gross({ kind: "column", column: 3 }, 36, 100n)).toBe(300n);
    expect(roulette.gross({ kind: "straight", number: 0 }, 0, 100n)).toBe(3_600n);
  });

  it.each(vectors.roulette)("spins $seed like the program", (v) => {
    const n = roulette.spin(Rng.fromVrf(bytes(v.seed)));
    expect(n).toBe(v.number);
    expect(roulette.gross({ kind: "red" }, n, STAKE).toString()).toBe(v.red);
    expect(roulette.gross({ kind: "straight", number: 17 }, n, STAKE).toString()).toBe(v.straight17);
  });
});

describe("slots", () => {
  it("maps every symbol to a distinct glyph", () => {
    expect(new Set(slots.SYMBOL_GLYPHS).size).toBe(7);
    expect(slots.glyphs([0, 1, 6])).toEqual(["7", "◆", "♥"]);
    expect(() => slots.glyphs([0, 7, 1])).toThrow();
  });

  it("pays the public table", () => {
    expect(slots.gross([0, 0, 0], 10n)).toBe(2_500n);
    expect(slots.gross([6, 6, 1], 10n)).toBe(40n);
    expect(slots.gross([6, 5, 1], 10n)).toBe(0n);
    expect(slots.gross([2, 2, 3], 10n)).toBe(0n);
  });

  it.each(vectors.slots.slice(0, 50))("spins $seed like the program", (v) => {
    const reels = slots.spinReels(Rng.fromVrf(bytes(v.seed)));
    expect(reels).toEqual(v.reels);
    expect(slots.gross(reels, STAKE).toString()).toBe(v.gross);
  });

  it("matches the program on 200 spins", () => {
    for (const v of vectors.slots) expect(slots.spinReels(Rng.fromVrf(bytes(v.seed)))).toEqual(v.reels);
  });
});

describe("mines", () => {
  it("pays the program's multiplier for every mine count and safe tile count", () => {
    vectors.minesGross.forEach((row, i) => {
      const count = i + 1;
      expect(row).toHaveLength(mines.safeTiles(count) + 1);
      row.forEach((g, k) => expect(mines.uncappedGross(STAKE, count, k).toString(), `${count} mines, ${k}`).toBe(g));
    });
  });

  it("follows the published table, rounded down", () => {
    expect(mines.uncappedGross(100_000n, 1, 1)).toBe(103_125n);
    expect(mines.uncappedGross(100_000n, 24, 1)).toBe(2_475_000n);
    expect(mines.uncappedGross(1_000_000n, 3, 2)).toBe(1_285_714n);
    expect(mines.uncappedGross(106n, 1, 1)).toBe(109n);
  });

  it("caps the gain at the cleared board, within the round limit", () => {
    expect(mines.maxGain(1_000n, 24, 1_000_000n)).toBe(23_750n);
    expect(mines.maxGain(1_000n, 24, 10_000n)).toBe(10_000n);
    expect(mines.maxGain(1_000n, 12, 50_000n)).toBe(50_000n);
    expect(mines.gross(1_000n, 12, 13, 2_000n)).toBe(3_000n);
    expect(mines.canRevealMore(1_000n, 24, 1, 23_750n)).toBe(false);
    expect(mines.canRevealMore(1_000n, 3, 1, 1_000_000n)).toBe(true);
  });

  it.each(vectors.mines.map((v, i) => ({ ...v, i })))("plays round $i like the program", (v) => {
    const gain = BigInt(v.maxGain);
    expect([mines.maxGain(STAKE, v.mines, 3_000_000n), mines.maxGain(STAKE, v.mines, 10n ** 12n)]).toContain(gain);
    let revealed = 0;
    let bust = false;
    for (const [i, draw] of v.draws.entries()) {
      expect(mines.canRevealMore(STAKE, v.mines, revealed, gain), `reveal ${i}`).toBe(true);
      if (mines.isMine(Rng.fromVrf(bytes(draw)), v.mines, revealed)) bust = true;
      else revealed++;
    }
    expect(revealed).toBe(v.order.length);
    expect(bust).toBe(v.busted !== null);
    // The round ended on its own (bust, cleared board, cap) unless it was cashed out.
    expect(bust || !mines.canRevealMore(STAKE, v.mines, revealed, gain)).toBe(!v.cashout);
    const gross = bust ? 0n : mines.gross(STAKE, v.mines, revealed, gain);
    expect(gross.toString()).toBe(v.gross);
    expect(settle(STAKE, gross)).toEqual({ payout: BigInt(v.payout), fee: BigInt(v.fee) });
  });

  it("covers busts, cash-outs and the cap", () => {
    expect(vectors.mines.some((v) => v.busted !== null)).toBe(true);
    expect(vectors.mines.some((v) => v.cashout)).toBe(true);
    expect(vectors.mines.some((v) => !v.cashout && v.busted === null && v.gross === "4000000")).toBe(true);
  });

  it("formats multipliers with 4 decimals, rounded down, 1 before any tile", () => {
    expect(mines.formatMultiplier(mines.scaledMultiplier(STAKE, 1, 0, 10n ** 12n))).toBe("1.0000");
    expect(mines.formatMultiplier(mines.scaledMultiplier(STAKE, 1, 1, 10n ** 12n))).toBe("1.0312");
    expect(mines.formatMultiplier(mines.scaledMultiplier(STAKE, 24, 1, 10n ** 12n))).toBe("24.7500");
    expect(mines.formatMultiplier(mines.scaledMultiplier(STAKE, 3, 2, 10n ** 12n))).toBe("1.2857");
    // The round cap: 1 USDC with a 2 USDC gain limit never shows more than 3x.
    expect(mines.formatMultiplier(mines.scaledMultiplier(STAKE, 12, 13, 2_000_000n))).toBe("3.0000");
    expect(mines.formatMultiplier(mines.scaledMultiplier(STAKE, 12, 13, 10n ** 15n))).toBe("5148297.0000");
  });
});

describe("dice", () => {
  it.each(vectors.dice.map((v, i) => ({ ...v, i })))("rolls $i like the program", (v) => {
    const roll = dice.roll(Rng.fromVrf(bytes(v.seed)));
    expect(roll).toBe(v.roll);
    expect(dice.gross(STAKE, v.target, v.over, roll).toString()).toBe(v.gross);
  });

  it("allows a 1% to 98% chance, under and over", () => {
    expect([100, 9_800].map((t) => dice.isValidTarget(t, false))).toEqual([true, true]);
    expect([99, 9_801, 0, 50.5].map((t) => dice.isValidTarget(t, false))).toEqual([false, false, false, false]);
    expect([200, 9_900].map((t) => dice.isValidTarget(t, true))).toEqual([true, true]);
    expect([199, 9_901, 10_001].map((t) => dice.isValidTarget(t, true))).toEqual([false, false, false]);
  });

  it("pays 98% / chance, rounded down, shown with 4 decimals", () => {
    expect(dice.gross(STAKE, 5_000, false, 4_999)).toBe(1_960_000n);
    expect(dice.gross(STAKE, 5_000, false, 5_000)).toBe(0n);
    expect(dice.gross(STAKE, 5_000, true, 5_000)).toBe(1_960_000n);
    expect(dice.gross(STAKE, 300, false, 0)).toBe(32_666_666n);
    expect(formatFixed(dice.scaledMultiplier(5_000, true), 4)).toBe("1.9600");
    expect(formatFixed(dice.scaledMultiplier(100, false), 4)).toBe("98.0000");
    expect(formatFixed(dice.scaledMultiplier(200, true), 4)).toBe("1.0000");
    expect(formatFixed(dice.scaledMultiplier(300, false), 4)).toBe("32.6666");
  });
});

describe("limbo", () => {
  it.each(vectors.limbo.map((v, i) => ({ ...v, i })))("draws result $i like the program", (v) => {
    const result = limbo.result(Rng.fromVrf(bytes(v.seed)));
    expect(result).toBe(v.result);
    expect(limbo.gross(STAKE, v.target, result).toString()).toBe(v.gross);
  });

  it("pays the target when the result reaches it", () => {
    expect(limbo.gross(STAKE, 200, 200)).toBe(2_000_000n);
    expect(limbo.gross(STAKE, 200, 199)).toBe(0n);
    expect(limbo.gross(STAKE, 1_000_000, 100_000_000)).toBe(10_000_000_000n);
    expect([100, 101, 1_000_000, 1_000_001, 150.5].map(limbo.isValidTarget)).toEqual([false, true, true, false, false]);
  });
});

describe("flip", () => {
  it.each(vectors.flip.map((v, i) => ({ ...v, i })))("tosses $i like the program", (v) => {
    const results = flip.toss(Rng.fromVrf(bytes(v.seed)), v.flips);
    expect(coinsOf(results)).toBe(v.coins);
    expect(flip.gross(STAKE, sideOf(v.side), results).toString()).toBe(v.gross);
  });

  it("pays 0.98 x 2^flips when every coin lands on the call", () => {
    expect(flip.gross(STAKE, "heads", ["heads"])).toBe(1_960_000n);
    expect(flip.gross(STAKE, "tails", ["tails", "heads"])).toBe(0n);
    expect(flip.gross(STAKE, "tails", Array<FlipSide>(10).fill("tails"))).toBe(1_003_520_000n);
    expect(formatFixed(flip.scaledMultiplier(1), 4)).toBe("1.9600");
    expect(formatFixed(flip.scaledMultiplier(10), 4)).toBe("1003.5200");
  });
});

describe("keno", () => {
  it("mirrors the program's pay tables", () => {
    expect(keno.PAYTABLES.map((t) => t.map(String))).toEqual(vectors.kenoPaytables);
  });

  const choose = (n: number, k: number): bigint => {
    let c = 1n;
    for (let i = 0; i < k; i++) c = (c * BigInt(n - i)) / BigInt(i + 1);
    return c;
  };

  it.each(Array.from({ length: keno.MAX_PICKS }, (_, i) => i + 1))(
    "returns 94.90% to 95.00% exactly with %i picks (hypergeometric)",
    (n) => {
      // RTP × C(40, 10) × 100 (pay tables are ×100), in integers.
      const total = choose(keno.NUMBERS, keno.DRAWN);
      const paid = keno
        .paytable(n)
        .reduce((sum, pay, hits) => sum + pay * choose(n, hits) * choose(keno.NUMBERS - n, keno.DRAWN - hits), 0n);
      // 94.90% ≤ paid / (100 × total) ≤ 95.00%, as 9490 × total ≤ paid × 100 ≤ 9500 × total.
      expect(paid * 100n).toBeGreaterThanOrEqual(9_490n * total);
      expect(paid * 100n).toBeLessThanOrEqual(9_500n * total);
    },
  );

  it.each(vectors.keno.map((v, i) => ({ ...v, i })))("draws $i like the program", (v) => {
    const drawn = keno.draw(Rng.fromVrf(bytes(v.seed)));
    expect(drawn).toEqual(v.drawn);
    expect(new Set(drawn).size).toBe(keno.DRAWN);
    const hits = keno.hits(v.picks, drawn);
    expect(hits).toBe(v.hits);
    expect(keno.gross(STAKE, v.picks.length, hits).toString()).toBe(v.gross);
  });

  it("takes 1 to 10 distinct numbers from 1 to 40", () => {
    expect(keno.isValid([1])).toBe(true);
    expect(keno.isValid([1, 2, 3, 4, 5, 6, 7, 8, 9, 40])).toBe(true);
    expect(keno.isValid([])).toBe(false);
    expect(keno.isValid([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(false);
    expect(keno.isValid([0])).toBe(false);
    expect(keno.isValid([41])).toBe(false);
    expect(keno.isValid([3, 3])).toBe(false);
    expect(() => keno.paytable(11)).toThrow();
  });
});

describe("wheel", () => {
  it.each(vectors.wheelTables)("mirrors the program's $risk wheel of $segments", (t) => {
    const multipliers = wheel.multipliers(riskOf(t.risk), t.segments);
    expect(multipliers.map(String)).toEqual(t.multipliers);
    expect(multipliers.reduce((a, b) => a + b, 0n)).toBe(98n * BigInt(t.segments));
  });

  it.each(vectors.wheel.map((v, i) => ({ ...v, i })))("spins $i like the program", (v) => {
    const segment = wheel.spin(Rng.fromVrf(bytes(v.seed)), v.segments);
    expect(segment).toBe(v.segment);
    expect(wheel.gross(STAKE, riskOf(v.risk), v.segments, segment).toString()).toBe(v.gross);
  });

  it("has 10 to 50 segments by tens", () => {
    expect([10, 20, 30, 40, 50].every(wheel.isValid)).toBe(true);
    expect([0, 15, 60, 10.5].some(wheel.isValid)).toBe(false);
  });
});

describe("hilo", () => {
  it("maps cards to ranks (ace low) and suits", () => {
    expect([0, 12, 13, 51].map(hilo.toCard)).toEqual([
      { rank: 1, suit: "♠" },
      { rank: 13, suit: "♠" },
      { rank: 1, suit: "♥" },
      { rank: 13, suit: "♣" },
    ]);
    expect(hilo.winningRanks("higher", 1)).toBe(13);
    expect(hilo.winningRanks("lower", 13)).toBe(13);
    expect(hilo.winningRanks("higher", 7)).toBe(7);
    expect(hilo.winningRanks("skip", 7)).toBeNull();
  });

  it.each(vectors.hilo.map((v, i) => ({ ...v, i })))("plays round $i like the program", (v) => {
    const cards = v.draws.map((d) => hilo.drawCard(Rng.fromVrf(bytes(d))));
    expect(cards).toEqual(v.cards);
    const gain = BigInt(v.maxGain);
    const played = hilo.play(STAKE, gain, cards, guessesOf(v.guesses));
    if (!played) throw new Error("the program's guesses must replay");
    expect(played.fair.toString()).toBe(v.fair);
    expect(played.busted).toBe(v.busted);
    // The round ended on its own (bust, cap, board) unless it was cashed out.
    expect(played.ended === null).toBe(v.cashout);
    const gross = played.ended ?? hilo.gross(STAKE, played.fair, gain);
    expect(gross.toString()).toBe(v.gross);
    expect(settle(STAKE, gross)).toEqual({ payout: BigInt(v.payout), fee: BigInt(v.fee) });
  });

  it("covers busts, cash-outs, skips and the cap", () => {
    expect(vectors.hilo.some((v) => v.busted)).toBe(true);
    expect(vectors.hilo.some((v) => v.cashout)).toBe(true);
    expect(vectors.hilo.some((v) => v.guesses.includes(2))).toBe(true);
    expect(vectors.hilo.some((v) => !v.cashout && !v.busted && v.gross === "4000000")).toBe(true);
  });

  it("refuses certain guesses, an 11th skip and guesses after the round ended", () => {
    const ace = 0;
    const king = 12;
    expect(hilo.play(STAKE, 10n ** 12n, [ace, 5], ["higher"])).toBeNull();
    expect(hilo.play(STAKE, 10n ** 12n, [king, 5], ["lower"])).toBeNull();
    const skips = Array<HiloGuess>(11).fill("skip");
    expect(hilo.play(STAKE, 10n ** 12n, Array<number>(11).fill(5), skips.slice(0, 10))).not.toBeNull();
    expect(hilo.play(STAKE, 10n ** 12n, Array<number>(12).fill(5), skips)).toBeNull();
    // A 6 then a 5 on "higher": bust; no guess after it.
    expect(hilo.play(STAKE, 10n ** 12n, [5, 4], ["higher"])).toMatchObject({ busted: true, ended: 0n });
    expect(hilo.play(STAKE, 10n ** 12n, [5, 4, 4], ["higher", "skip"])).toBeNull();
  });

  it("shows 0.98 x the fair multiplier, rounded down, capped", () => {
    expect(formatFixed(hilo.scaledMultiplier(STAKE, hilo.FAIR_ONE, 10n ** 12n), 4)).toBe("0.9800");
    // A 7 then "higher" right: 13 / 7.
    const fair = hilo.nextFair(hilo.FAIR_ONE, 7);
    expect(fair).toBe(1_857_142n);
    expect(formatFixed(hilo.scaledMultiplier(STAKE, fair, 10n ** 12n), 4)).toBe("1.8199");
    expect(formatFixed(hilo.scaledMultiplier(STAKE, 100n * hilo.FAIR_ONE, 2_000_000n), 4)).toBe("3.0000");
  });
});

describe("tower", () => {
  it.each(vectors.tower.map((v, i) => ({ ...v, i })))("climbs round $i like the program", (v) => {
    const difficulty = difficultyOf(v.difficulty);
    const gain = BigInt(v.maxGain);
    expect([tower.maxGain(STAKE, difficulty, 3_000_000n), tower.maxGain(STAKE, difficulty, 10n ** 12n)]).toContain(
      gain,
    );
    let levels = 0;
    let bust = false;
    for (const [i, draw] of v.draws.entries()) {
      expect(tower.canClimbMore(STAKE, difficulty, levels, gain), `climb ${i}`).toBe(true);
      if (tower.isSafe(Rng.fromVrf(bytes(draw)), difficulty)) levels++;
      else bust = true;
    }
    expect(levels).toBe(v.climbed.length);
    expect(bust).toBe(v.busted !== null);
    expect(bust || !tower.canClimbMore(STAKE, difficulty, levels, gain)).toBe(!v.cashout);
    const gross = bust ? 0n : tower.gross(STAKE, difficulty, levels, gain);
    expect(gross.toString()).toBe(v.gross);
    expect(settle(STAKE, gross)).toEqual({ payout: BigInt(v.payout), fee: BigInt(v.fee) });
  });

  it("covers busts, cash-outs and the cap", () => {
    expect(vectors.tower.some((v) => v.busted !== null)).toBe(true);
    expect(vectors.tower.some((v) => v.cashout)).toBe(true);
    expect(vectors.tower.some((v) => !v.cashout && v.busted === null && v.gross === "4000000")).toBe(true);
  });

  it("pays 0.98 x (tiles / safe)^levels, rounded down, up to the top", () => {
    expect(tower.uncappedGross(STAKE, "easy", 1)).toBe(1_306_666n);
    expect(tower.uncappedGross(STAKE, "hard", 9)).toBe(501_760_000n);
    expect(tower.uncappedGross(STAKE, "master", 9)).toBe(256_901_120_000n);
    expect(tower.maxGain(STAKE, "hard", 10n ** 12n)).toBe(500_760_000n);
    expect(tower.canClimbMore(STAKE, "easy", 9, 10n ** 12n)).toBe(false);
    expect(tower.canClimbMore(STAKE, "easy", 8, 10n ** 12n)).toBe(true);
    expect(formatFixed(tower.scaledMultiplier(STAKE, "easy", 0, 10n ** 12n), 4)).toBe("1.0000");
    expect(formatFixed(tower.scaledMultiplier(STAKE, "medium", 2, 10n ** 12n), 4)).toBe("2.2050");
    expect(formatFixed(tower.scaledMultiplier(STAKE, "master", 9, 2_000_000n), 4)).toBe("3.0000");
  });
});

describe("replay (GET /verify)", () => {
  const snapshotOf = (v: (typeof vectors.blackjack)[number]): Outcome => ({
    game: "blackjack",
    bet: v.bet,
    hands: v.hands,
    active: v.active,
    dealer: v.dealer,
    splits: v.splits,
  });
  const blackjackInput = (v: (typeof vectors.blackjack)[number]) => ({
    game: "blackjack" as const,
    stake: BigInt(v.stake),
    onChain: { payout: BigInt(v.payout), fee: BigInt(v.fee) },
    draws: v.draws.map(bytes),
  });

  it.each(vectors.blackjack.map((v, i) => ({ ...v, i })))("replays blackjack round $i from its draws", (v) => {
    const result = replay({ ...blackjackInput(v), snapshot: snapshotOf(v) });
    expect(result.matches).toBe(true);
    expect(result.outcome).toEqual(snapshotOf(v));
  });

  // 240 snapshot-less searches (each under 0.5 s, bounded by MAX_BLACKJACK_STATES): seconds in total.
  it(
    "finds the moves and the number of hands from the payout alone when no snapshot was taken",
    { timeout: 60_000 },
    () => {
      const unmatched = vectors.blackjack.filter((v) => !replay({ ...blackjackInput(v), snapshot: null }).matches);
      expect(unmatched).toEqual([]);
    },
  );

  it("replays a multi-hand round whose stand on a first hand took no draw", () => {
    const v = vectors.blackjack.find(
      (h) => h.hands.length > 1 && h.actions.indexOf("stand") > 0 && h.actions.indexOf("stand") < h.actions.length - 2,
    );
    if (!v) throw new Error("fixture needs a stand without draw before another move");
    // Compared with the snapshot: the exact hands, not just a sequence that pays the same.
    expect(replay({ ...blackjackInput(v), snapshot: snapshotOf(v) })).toMatchObject({
      matches: true,
      outcome: snapshotOf(v),
    });
    expect(replay({ ...blackjackInput(v), snapshot: null }).matches).toBe(true);
  });

  it("replays a round with a split and a re-split, with and without its snapshot", () => {
    const v = vectors.blackjack.find((h) => h.splits >= 2 && h.hands.some((x) => x.split && x.cards.length > 2));
    if (!v) throw new Error("fixture needs a re-split round whose split hands played on");
    expect(replay({ ...blackjackInput(v), snapshot: snapshotOf(v) })).toMatchObject({
      matches: true,
      outcome: snapshotOf(v),
    });
    expect(replay({ ...blackjackInput(v), snapshot: null }).matches).toBe(true);
  });

  it("does not match when a blackjack draw is missing, the payout differs or the snapshot is another round", () => {
    const v = vectors.blackjack.find((h) => h.draws.length > 2);
    if (!v) throw new Error("fixture needs a round with a hit");
    const input = { ...blackjackInput(v), snapshot: snapshotOf(v) };
    expect(replay({ ...input, draws: [v.draws[0], v.draws[v.draws.length - 1]].map(bytes) }).matches).toBe(false);
    expect(replay({ ...input, onChain: { payout: 1n, fee: 0n } }).matches).toBe(false);
    const other = vectors.blackjack.find((h) => h !== v && h.hands.length === v.hands.length);
    if (!other) throw new Error("fixture needs two rounds with as many hands");
    expect(replay({ ...input, snapshot: snapshotOf(other) }).matches).toBe(false);
  });

  it("does not take a natural followed by more draws as a match", () => {
    const natural = vectors.blackjack.find((h) => h.draws.length === 1 && h.hands.length === 1);
    if (!natural) throw new Error("fixture needs a natural");
    const draws = [natural.draws[0], vectors.blackjack[1].draws[0]].map(bytes);
    const r = replay({ game: "blackjack", stake: 1n, onChain: { payout: 0n, fee: 0n }, draws, snapshot: null });
    expect(r.matches).toBe(false);
  });

  it.each(vectors.slots.slice(0, 20))("replays slots $seed", (v) => {
    const { payout, fee } = settle(STAKE, BigInt(v.gross));
    const result = replay({
      game: "slots",
      stake: STAKE,
      onChain: { payout, fee },
      draws: [bytes(v.seed)],
      snapshot: null,
    });
    expect(result).toMatchObject({ matches: true, outcome: { game: "slots", reels: v.reels } });
  });

  it("replays roulette with the snapshot's bet, and checks the number", () => {
    const v = vectors.roulette[0];
    const { payout, fee } = settle(STAKE, BigInt(v.red));
    const red = { game: "roulette" as const, bet: { kind: "red" as const }, number: v.number };
    const ok = replay({
      game: "roulette",
      stake: STAKE,
      onChain: { payout, fee },
      draws: [bytes(v.seed)],
      snapshot: red,
    });
    expect(ok).toMatchObject({ matches: true, outcome: red });
    const wrongNumber = { ...red, number: (v.number + 1) % 37 };
    const forged = { game: "roulette" as const, stake: STAKE, onChain: { payout, fee }, draws: [bytes(v.seed)] };
    expect(replay({ ...forged, snapshot: wrongNumber }).matches).toBe(false);
  });

  it("compares snapshots by value, whatever their key order (Postgres jsonb reorders keys)", () => {
    const v = vectors.roulette[0];
    const { payout, fee } = settle(STAKE, BigInt(v.red));
    const snapshot = JSON.parse(`{"number":${v.number},"bet":{"kind":"red"},"game":"roulette"}`) as Outcome;
    const r = replay({ game: "roulette", stake: STAKE, onChain: { payout, fee }, draws: [bytes(v.seed)], snapshot });
    expect(r.matches).toBe(true);
  });

  it("replays baccarat and searches the bet without a snapshot", () => {
    const v = vectors.baccarat.find((c) => c.gross[1] > 0 && c.gross[0] === 0);
    if (!v) throw new Error("fixture needs a banker win");
    const { payout, fee } = settle(STAKE, BigInt(v.gross[1]));
    const r = replay({
      game: "baccarat",
      stake: STAKE,
      onChain: { payout, fee },
      draws: [bytes(v.seed)],
      snapshot: null,
    });
    expect(r).toMatchObject({ matches: true, outcome: { bet: "banker" } });
  });

  const minesSnapshot = (v: (typeof vectors.mines)[number]): Extract<Outcome, { game: "mines" }> => ({
    game: "mines",
    mines: v.mines,
    order: v.order,
    pending: null,
    busted: v.busted,
    maxGain: v.maxGain,
  });
  const minesInput = (v: (typeof vectors.mines)[number]) => ({
    game: "mines" as const,
    stake: STAKE,
    onChain: { payout: BigInt(v.payout), fee: BigInt(v.fee) },
    draws: v.draws.map(bytes),
  });

  it.each(vectors.mines.map((v, i) => ({ ...v, i })))("replays mines round $i from its reveals and board", (v) => {
    expect(replay({ ...minesInput(v), snapshot: minesSnapshot(v) })).toMatchObject({
      matches: true,
      outcome: minesSnapshot(v),
      gross: BigInt(v.gross),
    });
  });

  it("replays a cashed-out and a busted mines round without a board, tiles aside", () => {
    const cashedOut = vectors.mines.find((v) => v.cashout && v.draws.length > 2);
    const busted = vectors.mines.find((v) => v.busted !== null && v.draws.length > 2);
    if (!cashedOut || !busted) throw new Error("fixture needs a long cash-out and a late bust");
    const cash = replay({ ...minesInput(cashedOut), snapshot: null });
    expect(cash).toMatchObject({ matches: true, gross: BigInt(cashedOut.gross), outcome: { busted: null } });
    expect(cash.outcome.game === "mines" && cash.outcome.order.length).toBe(cashedOut.order.length);
    const bust = replay({ ...minesInput(busted), snapshot: null });
    expect(bust).toMatchObject({ matches: true, gross: 0n, outcome: { busted: busted.order.length } });
  });

  it("does not match a mines round with a draw missing or after the round ended, or another board", () => {
    const v = vectors.mines.find((m) => m.cashout && m.draws.length > 1);
    const bust = vectors.mines.find((m) => m.busted !== null);
    if (!v || !bust) throw new Error("fixture needs a cash-out and a bust");
    const input = { ...minesInput(v), snapshot: minesSnapshot(v) };
    expect(replay({ ...input, draws: input.draws.slice(1) }).matches).toBe(false);
    // Which tiles were clicked never changes a draw: only how many is checked.
    expect(replay({ ...input, snapshot: { ...minesSnapshot(v), order: v.order.slice(1) } }).matches).toBe(false);
    expect(replay({ ...input, snapshot: { ...minesSnapshot(v), mines: v.mines === 1 ? 2 : 1 } }).matches).toBe(false);
    const afterBust = { ...minesInput(bust), draws: [...bust.draws, ...v.draws].map(bytes) };
    expect(replay({ ...afterBust, snapshot: minesSnapshot(bust) }).matches).toBe(false);
    expect(replay({ ...afterBust, snapshot: null }).matches).toBe(false);
  });

  /** A one-draw round as the indexer stores it: the program's payout and fee from `gross`. */
  const oneDraw = (game: Outcome["game"], seed: string, gross: string): Omit<ReplayInput, "snapshot"> => {
    const { payout, fee } = settle(STAKE, BigInt(gross));
    return { game, stake: STAKE, onChain: { payout, fee }, draws: [bytes(seed)] };
  };

  it("replays every one-draw round from its draw and choice, with and without the snapshot", () => {
    const rounds: { input: Omit<ReplayInput, "snapshot">; snapshot: Outcome }[] = [
      ...vectors.dice.map((v) => ({
        input: oneDraw("dice", v.seed, v.gross),
        snapshot: { game: "dice", target: v.target, over: v.over, roll: v.roll } as const,
      })),
      ...vectors.limbo.map((v) => ({
        input: oneDraw("limbo", v.seed, v.gross),
        snapshot: { game: "limbo", target: v.target, result: v.result } as const,
      })),
      ...vectors.flip.map((v) => ({
        input: oneDraw("flip", v.seed, v.gross),
        snapshot: {
          game: "flip",
          side: sideOf(v.side),
          flips: v.flips,
          results: Array.from({ length: v.flips }, (_, i) => flip.SIDES[(v.coins >> i) & 1]),
        } as const,
      })),
      ...vectors.keno.map((v) => ({
        input: oneDraw("keno", v.seed, v.gross),
        snapshot: { game: "keno", picks: v.picks, drawn: v.drawn } as const,
      })),
      ...vectors.wheel.map((v) => ({
        input: oneDraw("wheel", v.seed, v.gross),
        snapshot: { game: "wheel", segments: v.segments, risk: riskOf(v.risk), segment: v.segment } as const,
      })),
    ];
    for (const { input, snapshot } of rounds) {
      const label = JSON.stringify(snapshot);
      expect(replay({ ...input, snapshot }), label).toMatchObject({ matches: true, outcome: snapshot });
      // Without the snapshot, a choice reproducing the payout is found from the same draw.
      const blind = replay({ ...input, snapshot: null });
      expect(blind.matches, label).toBe(true);
      expect(blind.settlement, label).toEqual(input.onChain);
    }
  });

  it("does not match a one-draw round with another draw, choice or payout", () => {
    const win = vectors.dice.find((v) => v.gross !== "0");
    const loss = vectors.dice.find((v) => v.gross === "0");
    if (!win || !loss) throw new Error("fixture needs a dice win and a loss");
    const snapshot = { game: "dice", target: win.target, over: win.over, roll: win.roll } as const;
    const input = oneDraw("dice", win.seed, win.gross);
    expect(replay({ ...input, draws: [bytes(loss.seed)], snapshot }).matches).toBe(false);
    expect(replay({ ...input, snapshot: { ...snapshot, over: !win.over } }).matches).toBe(false);
    expect(replay({ ...input, onChain: { payout: input.onChain.payout + 1n, fee: 0n }, snapshot }).matches).toBe(false);
    // A choice the program refuses never matches.
    expect(replay({ ...input, snapshot: { ...snapshot, target: 10_001, over: false } }).matches).toBe(false);
    const kenoWin = vectors.keno.find((v) => v.gross !== "0");
    if (!kenoWin) throw new Error("fixture needs a keno win");
    const keno: Outcome = { game: "keno", picks: [...kenoWin.picks, kenoWin.picks[0]], drawn: kenoWin.drawn };
    expect(replay({ ...oneDraw("keno", kenoWin.seed, kenoWin.gross), snapshot: keno }).matches).toBe(false);
  });

  const hiloSnapshot = (v: (typeof vectors.hilo)[number]): Extract<Outcome, { game: "hilo" }> => ({
    game: "hilo",
    cards: v.cards,
    guesses: guessesOf(v.guesses),
    pending: null,
    busted: v.busted,
    maxGain: v.maxGain,
  });
  const multiInput = (game: "hilo" | "tower", v: { draws: string[]; payout: string; fee: string }) => ({
    game,
    stake: STAKE,
    onChain: { payout: BigInt(v.payout), fee: BigInt(v.fee) },
    draws: v.draws.map(bytes),
  });

  it.each(vectors.hilo.map((v, i) => ({ ...v, i })))("replays hilo round $i from its cards and board", (v) => {
    expect(replay({ ...multiInput("hilo", v), snapshot: hiloSnapshot(v) })).toMatchObject({
      matches: true,
      outcome: hiloSnapshot(v),
      gross: BigInt(v.gross),
    });
  });

  it("replays cashed-out and busted hilo rounds without a board, guesses aside", () => {
    const uncapped = vectors.hilo.filter((v) => v.maxGain !== "3000000");
    const cashedOut = uncapped.find((v) => v.cashout && v.draws.length > 3);
    const busted = uncapped.find((v) => v.busted && v.draws.length > 3);
    if (!cashedOut || !busted) throw new Error("fixture needs a long cash-out and a late bust");
    const cash = replay({ ...multiInput("hilo", cashedOut), snapshot: null });
    expect(cash).toMatchObject({ matches: true, gross: BigInt(cashedOut.gross), outcome: { cards: cashedOut.cards } });
    const bust = replay({ ...multiInput("hilo", busted), snapshot: null });
    expect(bust).toMatchObject({ matches: true, gross: 0n, outcome: { busted: true, cards: busted.cards } });
  });

  it("does not match a hilo round with a draw missing or after the round ended, or other guesses", () => {
    const v = vectors.hilo.find((h) => h.cashout && h.draws.length > 2 && !h.guesses.includes(2));
    const bust = vectors.hilo.find((h) => h.busted);
    if (!v || !bust) throw new Error("fixture needs a cash-out and a bust");
    const input = { ...multiInput("hilo", v), snapshot: hiloSnapshot(v) };
    expect(replay({ ...input, draws: input.draws.slice(0, -1) }).matches).toBe(false);
    const flipped = guessesOf(v.guesses).map((g): HiloGuess => (g === "higher" ? "lower" : "higher"));
    expect(replay({ ...input, snapshot: { ...hiloSnapshot(v), guesses: flipped } }).matches).toBe(false);
    const afterBust = { ...multiInput("hilo", bust), draws: [...bust.draws, ...v.draws].map(bytes) };
    expect(replay({ ...afterBust, snapshot: hiloSnapshot(bust) }).matches).toBe(false);
    // A cash-out needs a right guess: the first card alone settles nothing.
    expect(replay({ ...input, draws: input.draws.slice(0, 1), snapshot: null }).matches).toBe(false);
  });

  const towerSnapshot = (v: (typeof vectors.tower)[number]): Extract<Outcome, { game: "tower" }> => ({
    game: "tower",
    difficulty: difficultyOf(v.difficulty),
    climbed: v.climbed,
    pending: null,
    busted: v.busted,
    maxGain: v.maxGain,
  });

  it.each(vectors.tower.map((v, i) => ({ ...v, i })))("replays tower round $i from its climbs and board", (v) => {
    expect(replay({ ...multiInput("tower", v), snapshot: towerSnapshot(v) })).toMatchObject({
      matches: true,
      outcome: towerSnapshot(v),
      gross: BigInt(v.gross),
    });
  });

  it("replays cashed-out and busted tower rounds without a board, tiles aside", () => {
    const uncapped = vectors.tower.filter((v) => v.maxGain !== "3000000");
    const cashedOut = uncapped.find((v) => v.cashout && v.draws.length > 1);
    const busted = uncapped.find((v) => v.busted !== null && v.draws.length > 1);
    if (!cashedOut || !busted) throw new Error("fixture needs a cash-out and a late bust");
    const cash = replay({ ...multiInput("tower", cashedOut), snapshot: null });
    expect(cash).toMatchObject({ matches: true, gross: BigInt(cashedOut.gross), outcome: { busted: null } });
    const bust = replay({ ...multiInput("tower", busted), snapshot: null });
    expect(bust).toMatchObject({ matches: true, gross: 0n });
    expect(bust.outcome.game === "tower" && bust.outcome.busted).toBe(0);
  });

  it("does not match a tower round with a draw missing or after the round ended, or another difficulty", () => {
    const v = vectors.tower.find((t) => t.cashout && t.draws.length > 1);
    const bust = vectors.tower.find((t) => t.busted !== null);
    if (!v || !bust) throw new Error("fixture needs a cash-out and a bust");
    const input = { ...multiInput("tower", v), snapshot: towerSnapshot(v) };
    expect(replay({ ...input, draws: input.draws.slice(1) }).matches).toBe(false);
    const other = v.difficulty === "easy" ? "master" : "easy";
    expect(replay({ ...input, snapshot: { ...towerSnapshot(v), difficulty: other } }).matches).toBe(false);
    const afterBust = { ...multiInput("tower", bust), draws: [...bust.draws, ...v.draws].map(bytes) };
    expect(replay({ ...afterBust, snapshot: towerSnapshot(bust) }).matches).toBe(false);
    expect(replay({ ...afterBust, snapshot: null }).matches).toBe(false);
  });

  it("never throws, whatever the draws and amounts", () => {
    const game = fc.constantFrom(
      "blackjack" as const,
      "roulette" as const,
      "baccarat" as const,
      "slots" as const,
      "mines" as const,
      "dice" as const,
      "limbo" as const,
      "flip" as const,
      "keno" as const,
      "wheel" as const,
      "hilo" as const,
      "tower" as const,
    );
    fc.assert(
      fc.property(
        game,
        fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 1, maxLength: 12 }),
        fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
        fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
        (g, draws, stake, payout) => {
          const r = replay({ game: g, stake, onChain: { payout, fee: 0n }, draws, snapshot: null });
          expect(r.outcome.game).toBe(g);
        },
      ),
    );
  });
});
