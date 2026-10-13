// Recomputes a settled round from its VRF outputs with the public game rules (GET /verify).
//
// What the indexer can see: every `consume_randomness` callback (randomness per request) and
// the RoundSettled event, plus, when caught in time, the account's round right after it
// settled (the "snapshot": bet, cards, reels). The player's moves are not in the callbacks, so:
// - blackjack: the first draw is the deal and every middle draw a hit (only a hit hands the
//   turn back); the last one may be a hit, a stand or a double, and each is tried;
// - roulette / baccarat: the bet comes from the snapshot; without one, every bet is tried.
// A round "matches" when a replay reproduces the program's payout and fee (and the snapshot,
// when there is one).
import type { BaccaratBet, Game, RouletteBet } from "@tilt/mod/protocol";
import { isDeepStrictEqual } from "node:util";
import * as baccarat from "./baccarat";
import * as blackjack from "./blackjack";
import * as roulette from "./roulette";
import type { Outcome } from "./round";
import { Rng } from "./rng";
import { settle, type Settlement } from "./settlement";
import * as slots from "./slots";

export interface ReplayInput {
  game: Game;
  /** Total stake from RoundSettled (doubled blackjack included). */
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

function blackjackCandidates(draws: Uint8Array[], stake: bigint): Candidate[] {
  const hand: blackjack.Hand = { player: [], dealer: [], doubled: false };
  const toCandidate = (h: blackjack.Hand, possible = true): Candidate => ({
    outcome: { game: "blackjack", player: h.player, dealer: h.dealer, doubled: h.doubled },
    gross: blackjack.gross(h, stake),
    possible,
  });
  const natural = blackjack.deal(hand, Rng.fromVrf(draws[0]));
  if (draws.length === 1) return [toCandidate(hand)];
  // A natural ends the round at once; later draws mean the sequence is not this round's.
  if (natural) return [toCandidate(hand, false)];
  for (const draw of draws.slice(1, -1)) {
    if (!blackjack.canHit(hand) || blackjack.hit(hand, Rng.fromVrf(draw))) return [toCandidate(hand, false)];
  }
  const last = draws[draws.length - 1];
  const clone = (): blackjack.Hand => ({ player: [...hand.player], dealer: [...hand.dealer], doubled: hand.doubled });
  const candidates: Candidate[] = [];
  const stood = clone();
  blackjack.stand(stood, Rng.fromVrf(last));
  candidates.push(toCandidate(stood));
  if (blackjack.canHit(hand)) {
    const hit = clone();
    if (blackjack.hit(hit, Rng.fromVrf(last))) candidates.push(toCandidate(hit));
  }
  if (blackjack.canDouble(hand) && stake % 2n === 0n) {
    const doubled = clone();
    blackjack.double(doubled, Rng.fromVrf(last));
    candidates.push(toCandidate(doubled));
  }
  return candidates;
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

export function replay(input: ReplayInput): ReplayResult {
  const last = input.draws.at(-1);
  if (!last) throw new Error("a settled round has at least one draw");
  switch (input.game) {
    case "blackjack":
      return choose(blackjackCandidates(input.draws, input.stake), input);
    case "roulette":
      return choose(rouletteCandidates(last, input.stake, input.snapshot), input);
    case "baccarat":
      return choose(baccaratCandidates(last, input.stake, input.snapshot), input);
    case "slots":
      return choose(slotsCandidates(last, input.stake), input);
  }
}
