// Port of `games/blackjack.rs` (no hole card, S17, 3:2, double on two cards, no split).
// Used both for display (totals, allowed moves) and to replay a round for /verify.
import type { Rng } from "./rng";
import { mulDiv } from "./settlement";

/** Enough for any hand: the player stops at 21, the dealer at 17. */
export const MAX_CARDS = 21;
const DEALER_STANDS_ON = 17;

const hardTotal = (cards: readonly number[]) => cards.reduce((sum, c) => sum + Math.min(c, 10), 0);

/** Best total, counting one ace as 11 when it does not bust. */
export function total(cards: readonly number[]): number {
  const hard = hardTotal(cards);
  return cards.includes(1) && hard + 10 <= 21 ? hard + 10 : hard;
}

/** A total is soft while an ace still counts as 11. */
export const isSoft = (cards: readonly number[]) => cards.includes(1) && hardTotal(cards) + 10 <= 21;

export const isBlackjack = (cards: readonly number[]) => cards.length === 2 && total(cards) === 21;

export interface Hand {
  player: number[];
  dealer: number[];
  doubled: boolean;
}

export const canHit = (hand: Hand) => total(hand.player) < 21 && hand.player.length < MAX_CARDS;
export const canDouble = (hand: Hand) => hand.player.length === 2 && !hand.doubled && total(hand.player) < 21;

function dealerPlay(hand: Hand, rng: Rng): void {
  while (total(hand.dealer) < DEALER_STANDS_ON && hand.dealer.length < MAX_CARDS) hand.dealer.push(rng.card());
}

/** Two cards to the player, one to the dealer. True when the round is over (natural). */
export function deal(hand: Hand, rng: Rng): boolean {
  hand.player = [rng.card(), rng.card()];
  hand.dealer = [rng.card()];
  hand.doubled = false;
  if (!isBlackjack(hand.player)) return false;
  hand.dealer.push(rng.card());
  return true;
}

/** One card. True when the round is over (bust, 21, or a full hand). */
export function hit(hand: Hand, rng: Rng): boolean {
  hand.player.push(rng.card());
  const t = total(hand.player);
  if (t > 21) return true;
  if (t === 21 || hand.player.length === MAX_CARDS) {
    dealerPlay(hand, rng);
    return true;
  }
  return false;
}

export function double(hand: Hand, rng: Rng): void {
  hand.doubled = true;
  hand.player.push(rng.card());
  if (total(hand.player) <= 21) dealerPlay(hand, rng);
}

export const stand = (hand: Hand, rng: Rng): void => dealerPlay(hand, rng);

/** What the finished hand returns for the whole stake (doubled or not), before Tilt's fee. */
export function gross(hand: Hand, stake: bigint): bigint {
  const p = total(hand.player);
  const d = total(hand.dealer);
  const playerBj = isBlackjack(hand.player) && !hand.doubled;
  const dealerBj = isBlackjack(hand.dealer);
  if (p > 21) return 0n;
  if (playerBj && dealerBj) return stake;
  if (playerBj) return mulDiv(stake, 5n, 2n);
  if (dealerBj) return 0n;
  if (d > 21 || p > d) return stake * 2n;
  return p === d ? stake : 0n;
}
