// Game rules and replay against the program's own Rust code: test/fixtures/rust-vectors.json was
// produced by compiling chain/programs/tilt/src/{rng,settlement,games/*}.rs (see rust-vectors.rs).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as baccarat from "../src/games/baccarat";
import * as blackjack from "../src/games/blackjack";
import { replay } from "../src/games/replay";
import type { Outcome } from "../src/games/round";
import { Rng } from "../src/games/rng";
import * as roulette from "../src/games/roulette";
import { settle } from "../src/games/settlement";
import * as slots from "../src/games/slots";
import vectors from "./fixtures/rust-vectors.json";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const STAKE = 1_000_000n;

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

  it("finds the moves and the number of hands from the payout alone when no snapshot was taken", () => {
    const unmatched = vectors.blackjack.filter((v) => !replay({ ...blackjackInput(v), snapshot: null }).matches);
    expect(unmatched).toEqual([]);
  });

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

  it("never throws, whatever the draws and amounts", () => {
    const game = fc.constantFrom("blackjack" as const, "roulette" as const, "baccarat" as const, "slots" as const);
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
