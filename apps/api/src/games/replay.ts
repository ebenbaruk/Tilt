// Recomputes a settled round from its VRF outputs with the public game rules (GET /verify).
//
// What the indexer can see: every `consume_randomness` callback (randomness per request) and
// the RoundSettled event, plus, when caught in time, the account's round right after it
// settled (the "snapshot": bet, cards, reels). The player's moves are not in the callbacks, so:
// - blackjack: the first draw is the deal; then each draw is a hit, a double or a split of the
//   active hand, or the dealer's turn after the last stand. A stand that leaves a hand to play
//   takes no draw, so every sequence of moves the draws allow is tried, for every number of
//   dealt hands (the snapshot, when there is one, fixes them and prunes everything else);
// - roulette: the chips come from the snapshot; without one, every single bet is tried with the
//   whole stake (a spin of several chips cannot be found without its snapshot);
// - baccarat: the bet comes from the snapshot; without one, every bet is tried;
// - mines: each draw is one reveal, in order; whether a tile is a mine depends only on how many
//   tiles were revealed before it, never on which one. The snapshot (the board) gives the mine
//   count, the tiles and the round's cap; without one, every mine count is tried with the
//   board's own cap (the vault's max_round_gain is unknown here), on tiles 0, 1, 2… A cash-out
//   takes no draw: the last draw is then the last safe reveal. A board left 6 h without a move
//   is cashed out for the player by the relay, possibly before any reveal: no draw at all;
// - dice / limbo / flip / keno / wheel: one draw; the choice comes from the snapshot. Without
//   one, every choice that can reproduce the payout is tried (keno: the picks are unknown, only
//   how many and how many hit matter, so drawn numbers stand for the hits and others for the misses);
// - hilo: the first draw is the first card, then one per guess, in order. The snapshot (the
//   board) gives the guesses and the cap; without one, guesses are searched for a sequence the
//   cards allow that settles at the program's gross return (payout + fee), with the board's own
//   cap of 10 000× the stake (the vault's max_round_gain is unknown here);
// - tower: like mines, one draw per climb; the snapshot gives the difficulty, tiles and cap.
//   Cash-outs of hilo and tower take no draw either, and an abandoned board may be cashed out
//   before any right guess or level (0.98× the stake).
// A round "matches" when a replay reproduces the program's payout and fee (and the snapshot,
// when there is one).
import type { BaccaratBet, FlipSide, Game, HiloGuess, RouletteChip, TowerDifficulty } from "@tilt/mod/protocol";
import { isDeepStrictEqual } from "node:util";
import * as baccarat from "./baccarat";
import * as blackjack from "./blackjack";
import * as dice from "./dice";
import * as flip from "./flip";
import * as hilo from "./hilo";
import * as keno from "./keno";
import * as limbo from "./limbo";
import * as mines from "./mines";
import * as roulette from "./roulette";
import type { Outcome } from "./round";
import { Rng } from "./rng";
import { settle, type Settlement } from "./settlement";
import * as slots from "./slots";
import * as tower from "./tower";
import * as wheel from "./wheel";

export interface ReplayInput {
  game: Game;
  /** Total stake from RoundSettled (every blackjack hand and double included). */
  stake: bigint;
  onChain: { payout: bigint; fee: bigint };
  /** VRF outputs of the round in request order; the last one settled it. */
  draws: Uint8Array[];
  snapshot: Outcome | null;
}

export interface ReplayResult {
  outcome: Outcome;
  gross: bigint;
  settlement: Settlement;
  matches: boolean;
}

interface Candidate {
  outcome: Outcome;
  gross: bigint;
  /** False when the draws cannot be this game's sequence (shown, never a match). */
  possible: boolean;
}

const BACCARAT_BETS: readonly BaccaratBet[] = ["player", "banker", "tie"];

/** Picks the first candidate that reproduces the program (and the snapshot); else the first one. */
function choose(candidates: Candidate[], input: ReplayInput): ReplayResult {
  const results = candidates.map((c) => ({ ...c, settlement: settle(input.stake, c.gross) }));
  const matching = results.find(
    (r) =>
      r.possible &&
      r.settlement.payout === input.onChain.payout &&
      r.settlement.fee === input.onChain.fee &&
      (input.snapshot === null || isDeepStrictEqual(r.outcome, input.snapshot)),
  );
  if (matching) return { ...matching, matches: true };
  return { ...results[0], matches: false };
}

/** Bounds the search of a round without snapshot (a few hundred states for real rounds). */
const MAX_BLACKJACK_STATES = 100_000;

type BlackjackOutcome = Extract<Outcome, { game: "blackjack" }>;

const isPrefix = (cards: readonly number[], of: readonly number[]) => cards.every((c, i) => of[i] === c);

/** Whether `t` can still become the snapshot's table (always, without one). A split inserts a
 *  hand right after the active one and moves the active hand's second card: until every split
 *  is played, only the hands before the active one and its first card are where they end up. */
function fitsSnapshot(t: blackjack.Table, snapshot: BlackjackOutcome | null): boolean {
  if (!snapshot) return true;
  if (t.splits > snapshot.splits || !isPrefix(t.dealer, snapshot.dealer)) return false;
  if (t.splits === snapshot.splits) return t.hands.every((h, i) => isPrefix(h.cards, snapshot.hands[i].cards));
  return t.hands.every((h, i) => {
    if (i > t.active) return true;
    const final = snapshot.hands[i].cards;
    return i < t.active ? isPrefix(h.cards, final) : h.cards[0] === final[0];
  });
}

/** A finished table as a candidate: its base bet is the stake over the bets placed (one per
 *  hand, split ones included, one per double), which must divide it exactly. */
function finishedCandidate(t: blackjack.Table, stake: bigint): Candidate | undefined {
  const bets = BigInt(t.hands.length + t.hands.filter((h) => h.doubled).length);
  if (stake % bets !== 0n) return undefined;
  const bet = stake / bets;
  return { outcome: { game: "blackjack", bet: bet.toString(), ...t }, gross: blackjack.gross(t, bet), possible: true };
}

function blackjackCandidates(draws: Uint8Array[], stake: bigint, snapshot: Outcome | null): Candidate[] {
  const snap = snapshot?.game === "blackjack" && snapshot.hands.length > 0 ? snapshot : null;
  const handCounts = snap
    ? [snap.hands.length - snap.splits]
    : Array.from({ length: blackjack.MAX_HANDS }, (_, i) => i + 1);
  const candidates: Candidate[] = [];
  let states = 0;

  /** Plays on from `t` with draws[next..]; `over` once the dealer has played. */
  const explore = (t: blackjack.Table, over: boolean, next: number): void => {
    if (++states > MAX_BLACKJACK_STATES || !fitsSnapshot(t, snap)) return;
    if (over) {
      // Every draw must be used: leftovers mean the sequence is not this one.
      const candidate = next === draws.length ? finishedCandidate(t, stake) : undefined;
      if (candidate) candidates.push(candidate);
      return;
    }
    const stood = blackjack.cloneTable(t);
    if (!blackjack.stand(stood)) explore(stood, false, next);
    else if (next === draws.length - 1) {
      blackjack.playDealer(stood, Rng.fromVrf(draws[next]));
      explore(stood, true, next + 1);
    }
    const hand = blackjack.activeHand(t);
    if (next >= draws.length || !hand) return;
    if (blackjack.canHit(hand)) {
      const hit = blackjack.cloneTable(t);
      explore(hit, blackjack.hit(hit, Rng.fromVrf(draws[next])), next + 1);
    }
    if (blackjack.canDouble(hand)) {
      const doubled = blackjack.cloneTable(t);
      explore(doubled, blackjack.double(doubled, Rng.fromVrf(draws[next])), next + 1);
    }
    if (blackjack.canSplit(t)) {
      const split = blackjack.cloneTable(t);
      explore(split, blackjack.split(split, Rng.fromVrf(draws[next])), next + 1);
    }
  };

  for (const hands of handCounts) {
    const t = blackjack.newTable(hands);
    explore(t, blackjack.deal(t, Rng.fromVrf(draws[0])), 1);
  }
  if (candidates.length > 0) return candidates;
  // No sequence of moves fits the draws: show the deal, never a match.
  const t = blackjack.newTable(handCounts[0]);
  blackjack.deal(t, Rng.fromVrf(draws[0]));
  const bet = stake / BigInt(t.hands.length);
  return [
    { outcome: { game: "blackjack", bet: bet.toString(), ...t }, gross: blackjack.gross(t, bet), possible: false },
  ];
}

function rouletteCandidates(randomness: Uint8Array, stake: bigint, snapshot: Outcome | null): Candidate[] {
  const number = roulette.spin(Rng.fromVrf(randomness));
  const layouts: readonly RouletteChip[][] =
    snapshot?.game === "roulette"
      ? [snapshot.chips]
      : roulette.ALL_BETS.map((bet) => [{ bet, amount: stake.toString() }]);
  return layouts.map((chips) => ({
    outcome: { game: "roulette", chips, number },
    gross: roulette.chipsGross(chips, number),
    possible: chips.reduce((sum, chip) => sum + BigInt(chip.amount), 0n) === stake,
  }));
}

function baccaratCandidates(randomness: Uint8Array, stake: bigint, snapshot: Outcome | null): Candidate[] {
  const coup = baccarat.dealCoup(Rng.fromVrf(randomness));
  const bets = snapshot?.game === "baccarat" ? [snapshot.bet] : BACCARAT_BETS;
  return bets.map((bet) => ({
    outcome: { game: "baccarat", bet, ...coup },
    gross: baccarat.gross(bet, coup, stake),
    possible: true,
  }));
}

function slotsCandidates(randomness: Uint8Array, stake: bigint): Candidate[] {
  const reels = slots.spinReels(Rng.fromVrf(randomness));
  return [{ outcome: { game: "slots", reels }, gross: slots.gross(reels, stake), possible: true }];
}

type MinesOutcome = Extract<Outcome, { game: "mines" }>;

/** Plays the reveals of a board with `count` mines; impossible when a draw comes after the
 *  round ended (bust, cleared board or cap reached). */
function minesCandidate(draws: Uint8Array[], stake: bigint, count: number, snapshot: MinesOutcome | null): Candidate {
  const gain = snapshot ? BigInt(snapshot.maxGain) : mines.maxGain(stake, count, UNCAPPED);
  let revealed = 0;
  let busted = false;
  let possible = true;
  for (const randomness of draws) {
    if (busted || !mines.canRevealMore(stake, count, revealed, gain)) possible = false;
    if (mines.isMine(Rng.fromVrf(randomness), count, revealed)) busted = true;
    else revealed++;
  }
  // Tiles never change the outcome: the snapshot's when it has as many, else 0, 1, 2…
  const tiles = snapshot?.order.length === revealed ? snapshot.order : Array.from({ length: revealed }, (_, i) => i);
  const outcome: MinesOutcome = {
    game: "mines",
    mines: count,
    order: tiles,
    pending: null,
    busted: busted ? (snapshot?.busted ?? revealed) : null,
    maxGain: gain.toString(),
  };
  return { outcome, gross: busted ? 0n : mines.gross(stake, count, revealed, gain), possible };
}

function minesCandidates(draws: Uint8Array[], stake: bigint, snapshot: Outcome | null): Candidate[] {
  const snap = snapshot?.game === "mines" ? snapshot : null;
  if (snap) return [minesCandidate(draws, stake, snap.mines, snap)];
  return Array.from({ length: mines.MAX_MINES }, (_, i) => minesCandidate(draws, stake, i + mines.MIN_MINES, null));
}

function diceCandidates(randomness: Uint8Array, stake: bigint, snapshot: Outcome | null): Candidate[] {
  const roll = dice.roll(Rng.fromVrf(randomness));
  const choices =
    snapshot?.game === "dice"
      ? [{ target: snapshot.target, over: snapshot.over }]
      : [false, true].flatMap((over) =>
          Array.from({ length: dice.ROLLS }, (_, target) => ({ target, over })).filter((c) =>
            dice.isValidTarget(c.target, c.over),
          ),
        );
  return choices.map(({ target, over }) => {
    const possible = dice.isValidTarget(target, over);
    return {
      outcome: { game: "dice", target, over, roll },
      gross: possible ? dice.gross(stake, target, over, roll) : 0n,
      possible,
    };
  });
}

/** Without a snapshot: a target just above the result (a loss), or the one whose payout is the
 *  program's (a win). */
function limboCandidates(randomness: Uint8Array, input: ReplayInput): Candidate[] {
  const result = limbo.result(Rng.fromVrf(randomness));
  const { stake, snapshot } = input;
  const gross = input.onChain.payout + input.onChain.fee;
  // The smallest target whose win pays `gross`.
  const won = stake > 0n ? Number((gross * 100n + stake - 1n) / stake) : limbo.MIN_TARGET;
  const targets = snapshot?.game === "limbo" ? [snapshot.target] : [result + 1, won, limbo.MIN_TARGET];
  return targets.map((target) => {
    const possible = limbo.isValidTarget(target);
    return {
      outcome: { game: "limbo", target, result },
      gross: possible ? limbo.gross(stake, target, result) : 0n,
      possible,
    };
  });
}

function flipCandidates(randomness: Uint8Array, stake: bigint, snapshot: Outcome | null): Candidate[] {
  const choices =
    snapshot?.game === "flip"
      ? [{ side: snapshot.side, flips: snapshot.flips }]
      : flip.SIDES.flatMap((side: FlipSide) =>
          Array.from({ length: flip.MAX_FLIPS }, (_, i) => ({ side, flips: i + flip.MIN_FLIPS })),
        );
  return choices.map(({ side, flips }) => {
    const possible = Number.isInteger(flips) && flips >= flip.MIN_FLIPS && flips <= flip.MAX_FLIPS;
    const results = possible ? flip.toss(Rng.fromVrf(randomness), flips) : [];
    return { outcome: { game: "flip", side, flips, results }, gross: flip.gross(stake, side, results), possible };
  });
}

function kenoCandidates(randomness: Uint8Array, stake: bigint, snapshot: Outcome | null): Candidate[] {
  const drawn = keno.draw(Rng.fromVrf(randomness));
  if (snapshot?.game === "keno") {
    const { picks } = snapshot;
    const possible = keno.isValid(picks);
    const gross = possible ? keno.gross(stake, picks.length, keno.hits(picks, drawn)) : 0n;
    return [{ outcome: { game: "keno", picks, drawn }, gross, possible }];
  }
  const missed = Array.from({ length: keno.NUMBERS }, (_, i) => i + 1).filter((n) => !drawn.includes(n));
  return Array.from({ length: keno.MAX_PICKS }, (_, i) => i + 1).flatMap((n) =>
    Array.from({ length: n + 1 }, (_, hits) => {
      const picks = [...drawn.slice(0, hits), ...missed.slice(0, n - hits)];
      return { outcome: { game: "keno", picks, drawn }, gross: keno.gross(stake, n, hits), possible: true };
    }),
  );
}

function wheelCandidates(randomness: Uint8Array, stake: bigint, snapshot: Outcome | null): Candidate[] {
  const choices =
    snapshot?.game === "wheel"
      ? [{ risk: snapshot.risk, segments: snapshot.segments }]
      : wheel.RISKS.flatMap((risk) => wheel.SEGMENTS.map((segments) => ({ risk, segments })));
  return choices.map(({ risk, segments }) => {
    const possible = wheel.isValid(segments);
    const segment = possible ? wheel.spin(Rng.fromVrf(randomness), segments) : 0;
    return {
      outcome: { game: "wheel", segments, risk, segment },
      gross: possible ? wheel.gross(stake, risk, segments, segment) : 0n,
      possible,
    };
  });
}

type HiloOutcome = Extract<Outcome, { game: "hilo" }>;

/** Bounds the search of a hilo round without snapshot: one step per state, a few ms at most. */
const MAX_HILO_STATES = 10_000;
/** No cap known without a snapshot: the largest gain a u64 can hold. */
const UNCAPPED = (1n << 64n) - 1n;

/** Plays `guesses` on the cards the draws give. A cash-out (the round did not end by itself)
 *  may come before any right guess when the relay closes a board the player left. An
 *  impossible candidate is still shown, so it keeps only guesses these cards can play. */
function hiloCandidate(cards: number[], guesses: HiloGuess[], stake: bigint, gain: bigint): Candidate {
  const played = guesses.length === cards.length - 1 ? hilo.play(stake, gain, cards, guesses) : null;
  const gross = played ? (played.ended ?? hilo.gross(stake, played.fair, gain)) : 0n;
  const prefix = guesses.slice(0, cards.length - 1);
  const outcome: HiloOutcome = {
    game: "hilo",
    cards,
    guesses: played || hilo.play(stake, gain, cards, prefix) ? prefix : [],
    pending: null,
    busted: played?.busted ?? false,
    maxGain: gain.toString(),
  };
  return { outcome, gross, possible: played !== null };
}

/** Guesses on `cards` that settle the round at `target` (its gross return), searched depth first
 *  with the board carried along, so each state costs one step. A multiplier never goes down: a
 *  board already past a target below the cap cannot reach it. Null when none is found within
 *  the budget. */
function hiloGuessesFor(cards: number[], stake: bigint, gain: bigint, target: bigint): HiloGuess[] | null {
  const cap = stake + gain;
  const last = cards.length - 1;
  const guesses: HiloGuess[] = [];
  /** Fewest skips each board (card, multiplier) was seen with: more skips can only do less. */
  const seen = new Map<string, number>();
  /** The board showing card `i` after a guess: the cap or a full board ends the round there. */
  const reached = (i: number, fair: bigint, skips: number): boolean => {
    if (i + 1 === hilo.MAX_CARDS || hilo.uncappedGross(stake, fair) >= cap) {
      return i === last && hilo.gross(stake, fair, gain) === target;
    }
    return inPlay(i, fair, skips);
  };
  /** The board showing card `i`, waiting for the player: a cash-out on the last card (by the
   *  player, or by the relay once the board was left 6 h). */
  const inPlay = (i: number, fair: bigint, skips: number): boolean => {
    if (i === last) return hilo.gross(stake, fair, gain) === target;
    if (target > 0n && target < cap && hilo.uncappedGross(stake, fair) > target) return false;
    const key = `${i}:${fair}`;
    if ((seen.get(key) ?? Infinity) <= skips || seen.size >= MAX_HILO_STATES) return false;
    seen.set(key, skips);
    const current = hilo.rank(cards[i]);
    for (const guess of hilo.GUESSES) {
      const winning = hilo.winningRanks(guess, current);
      guesses.push(guess);
      if (winning === null) {
        if (skips < hilo.MAX_SKIPS && reached(i + 1, fair, skips + 1)) return true;
      } else if (!hilo.isRight(guess, current, hilo.rank(cards[i + 1]))) {
        if (i + 1 === last && target === 0n) return true;
      } else if (reached(i + 1, hilo.nextFair(fair, winning), skips)) {
        return true;
      }
      guesses.pop();
    }
    return false;
  };
  return cards.length > 0 && inPlay(0, hilo.FAIR_ONE, 0) ? guesses : null;
}

function hiloCandidates(draws: Uint8Array[], stake: bigint, snapshot: Outcome | null, target: bigint): Candidate[] {
  const cards = draws.map((d) => hilo.drawCard(Rng.fromVrf(d)));
  if (snapshot?.game === "hilo") return [hiloCandidate(cards, snapshot.guesses, stake, BigInt(snapshot.maxGain))];
  const gain = hilo.maxGain(stake, UNCAPPED);
  return [hiloCandidate(cards, hiloGuessesFor(cards, stake, gain, target) ?? [], stake, gain)];
}

type TowerOutcome = Extract<Outcome, { game: "tower" }>;

/** Plays the climbs of a `difficulty` tower; impossible when a draw comes after the round
 *  ended (bust, top or cap reached). A cash-out may come before any level: a board the player
 *  left, closed by the relay. */
function towerCandidate(
  draws: Uint8Array[],
  stake: bigint,
  difficulty: TowerDifficulty,
  snapshot: TowerOutcome | null,
): Candidate {
  const gain = snapshot ? BigInt(snapshot.maxGain) : tower.maxGain(stake, difficulty, UNCAPPED);
  let levels = 0;
  let busted = false;
  let possible = true;
  for (const randomness of draws) {
    if (busted || !tower.canClimbMore(stake, difficulty, levels, gain)) possible = false;
    if (tower.isSafe(Rng.fromVrf(randomness), difficulty)) levels++;
    else busted = true;
  }
  // Tiles never change the outcome: the snapshot's when it has as many, else tile 0.
  const climbed = snapshot?.climbed.length === levels ? snapshot.climbed : Array<number>(levels).fill(0);
  const outcome: TowerOutcome = {
    game: "tower",
    difficulty,
    climbed,
    pending: null,
    busted: busted ? (snapshot?.busted ?? 0) : null,
    maxGain: gain.toString(),
  };
  return { outcome, gross: busted ? 0n : tower.gross(stake, difficulty, levels, gain), possible };
}

function towerCandidates(draws: Uint8Array[], stake: bigint, snapshot: Outcome | null): Candidate[] {
  if (snapshot?.game === "tower") return [towerCandidate(draws, stake, snapshot.difficulty, snapshot)];
  return tower.DIFFICULTY_NAMES.map((difficulty) => towerCandidate(draws, stake, difficulty, null));
}

export function replay(input: ReplayInput): ReplayResult {
  // A board abandoned before any reveal or climb settles with no draw at all.
  if (input.game === "mines") return choose(minesCandidates(input.draws, input.stake, input.snapshot), input);
  if (input.game === "tower") return choose(towerCandidates(input.draws, input.stake, input.snapshot), input);
  const last = input.draws.at(-1);
  if (!last) throw new Error("a settled round has at least one draw");
  switch (input.game) {
    case "blackjack":
      return choose(blackjackCandidates(input.draws, input.stake, input.snapshot), input);
    case "roulette":
      return choose(rouletteCandidates(last, input.stake, input.snapshot), input);
    case "baccarat":
      return choose(baccaratCandidates(last, input.stake, input.snapshot), input);
    case "slots":
      return choose(slotsCandidates(last, input.stake), input);
    case "dice":
      return choose(diceCandidates(last, input.stake, input.snapshot), input);
    case "limbo":
      return choose(limboCandidates(last, input), input);
    case "flip":
      return choose(flipCandidates(last, input.stake, input.snapshot), input);
    case "keno":
      return choose(kenoCandidates(last, input.stake, input.snapshot), input);
    case "wheel":
      return choose(wheelCandidates(last, input.stake, input.snapshot), input);
    case "hilo":
      return choose(
        hiloCandidates(input.draws, input.stake, input.snapshot, input.onChain.payout + input.onChain.fee),
        input,
      );
  }
}
