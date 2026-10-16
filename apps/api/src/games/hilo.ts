// Port of `games/hilo.rs`: cards from an infinite deck (`below(52)`: rank `card % 13 + 1`, suit
// `card / 13`), one draw each. A right higher (≥) or lower (≤) guess multiplies the fair
// multiplier by 13 / winning ranks (fixed point ×1e6, rounded down each step); a cash-out pays
// 0.98 × fair, capped at the round's gain. Skips draw a new card and change nothing.
import type { Card, HiloGuess } from "@tilt/mod/protocol";
import { MULTIPLIER_SCALE } from "./decimal";
import type { Rng } from "./rng";

export const RANKS = 13;
export const CARDS = 52;
/** Cards a round keeps; the card that fills the board cashes out. */
export const MAX_CARDS = 64;
export const MAX_SKIPS = 10;
/** The fair multiplier is fixed point: FAIR_ONE = 1×. */
export const FAIR_ONE = 1_000_000n;
/** The board's guess codes (`HiloGuess` order on-chain), and its `pending` when none. */
export const GUESSES: readonly HiloGuess[] = ["higher", "lower", "skip"];
export const NO_GUESS = 255;
const RTP_PERCENT = 98n;
const HUNDRED = 100n;
const SUITS: readonly Card["suit"][] = ["♠", "♥", "♦", "♣"];

export const rank = (card: number) => (card % RANKS) + 1;

export const toCard = (card: number): Card => ({ rank: rank(card), suit: SUITS[Math.floor(card / RANKS)] });

export const drawCard = (rng: Rng) => rng.below(CARDS);

/** Ranks winning `guess` from `rank`, null for a skip. 13 means certain: refused. */
export function winningRanks(guess: HiloGuess, rank: number): number | null {
  if (guess === "higher") return RANKS + 1 - rank;
  if (guess === "lower") return rank;
  return null;
}

export function isRight(guess: HiloGuess, current: number, next: number): boolean {
  if (guess === "higher") return next >= current;
  if (guess === "lower") return next <= current;
  return true;
}

export const nextFair = (fair: bigint, winning: number) => (fair * BigInt(RANKS)) / BigInt(winning);

/** `stake × 0.98 × fair`, rounded down, before any cap. */
export const uncappedGross = (stake: bigint, fair: bigint) => (stake * RTP_PERCENT * fair) / (HUNDRED * FAIR_ONE);

export const gross = (stake: bigint, fair: bigint, gain: bigint) => {
  const g = uncappedGross(stake, fair);
  return g < stake + gain ? g : stake + gain;
};

/** What a round's cards and guesses lead to, as the board would hold it. */
export interface HiloPlay {
  fair: bigint;
  right: number;
  skips: number;
  busted: boolean;
  /** The round settled by itself (bust, cap or full board), with this gross return. */
  ended: bigint | null;
}

/** Replays a board: `guesses[i]` led to `cards[i + 1]`. A guess the program would have refused
 *  (certain, too many skips, after the round ended) makes the sequence impossible: `null`. */
export function play(
  stake: bigint,
  gain: bigint,
  cards: readonly number[],
  guesses: readonly HiloGuess[],
): HiloPlay | null {
  const state: HiloPlay = { fair: FAIR_ONE, right: 0, skips: 0, busted: false, ended: null };
  for (const [i, guess] of guesses.entries()) {
    const next = cards[i + 1];
    if (next === undefined || state.ended !== null) return null;
    const current = rank(cards[i]);
    const winning = winningRanks(guess, current);
    if (winning === null) {
      if (state.skips >= MAX_SKIPS) return null;
      state.skips++;
    } else if (winning >= RANKS) {
      return null;
    } else if (!isRight(guess, current, rank(next))) {
      state.busted = true;
      state.ended = 0n;
      continue;
    } else {
      state.fair = nextFair(state.fair, winning);
      state.right++;
    }
    if (i + 2 === MAX_CARDS || uncappedGross(stake, state.fair) >= stake + gain) {
      state.ended = gross(stake, state.fair, gain);
    }
  }
  return state;
}

/** The multiplier a cash-out at `fair` pays, in units of 1/10 000 (round cap included). */
export function scaledMultiplier(stake: bigint, fair: bigint, gain: bigint): bigint {
  const formula = uncappedGross(MULTIPLIER_SCALE, fair);
  if (stake <= 0n) return formula;
  const capped = ((stake + gain) * MULTIPLIER_SCALE) / stake;
  return formula < capped ? formula : capped;
}
