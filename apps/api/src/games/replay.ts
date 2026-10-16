// Recomputes a settled round from its VRF outputs with the public game rules (GET /verify).
//
// What the indexer can see: every `consume_randomness` callback (randomness per request) and
// the RoundSettled event, plus, when caught in time, the account's round right after it
// settled (the "snapshot": bet, cards, reels). The player's moves are not in the callbacks, so:
// - blackjack: the first draw is the deal; then each draw is a hit, a double or a split of the
//   active hand, or the dealer's turn after the last stand. A stand that leaves a hand to play
//   takes no draw, so every sequence of moves the draws allow is tried, for every number of
//   dealt hands (the snapshot, when there is one, fixes them and prunes everything else);
// - roulette / baccarat: the bet comes from the snapshot; without one, every bet is tried;
// - mines: each draw is one reveal, in order; whether a tile is a mine depends only on how many
//   tiles were revealed before it, never on which one. The snapshot (the board) gives the mine
//   count, the tiles and the round's cap; without one, every mine count is tried with the
//   board's own cap (the vault's max_round_gain is unknown here), on tiles 0, 1, 2… A cash-out
//   takes no draw: the last draw is then the last safe reveal.
// A round "matches" when a replay reproduces the program's payout and fee (and the snapshot,
// when there is one).
import type { BaccaratBet, Game, RouletteBet } from "@tilt/mod/protocol";
import { isDeepStrictEqual } from "node:util";
import * as baccarat from "./baccarat";
import * as blackjack from "./blackjack";
import * as mines from "./mines";
import * as roulette from "./roulette";
import type { Outcome } from "./round";
import { Rng } from "./rng";
import { settle, type Settlement } from "./settlement";
import * as slots from "./slots";

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
  const bets: readonly RouletteBet[] = snapshot?.game === "roulette" ? [snapshot.bet] : roulette.ALL_BETS;
  return bets.map((bet) => ({
    outcome: { game: "roulette", bet, number },
    gross: roulette.gross(bet, number, stake),
    possible: true,
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
  const gain = snapshot ? BigInt(snapshot.maxGain) : mines.boardGain(stake, count);
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

export function replay(input: ReplayInput): ReplayResult {
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
    case "mines":
      return choose(minesCandidates(input.draws, input.stake, input.snapshot), input);
  }
}
