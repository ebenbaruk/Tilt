// Port of `games/blackjack.rs`: 1 to 6 hands of the same bet against one dealer, no hole card,
// S17, 3:2, double on any first two cards, split pairs of the same value (up to 4 splits per
// round; split aces take one card each and are finished; a split hand's 21 is not a blackjack).
// Used both for display (totals, allowed moves, results) and to replay a round for /verify.
import type { BlackjackResult } from "@tilt/mod/protocol";
import type { Rng } from "./rng";
import { mulDiv } from "./settlement";

/** Enough for any hand: the player stops at 21, the dealer at 17. */
export const MAX_CARDS = 21;
/** Most hands one round deals against the dealer. */
export const MAX_HANDS = 6;
/** Most splits one round allows, all hands together. */
export const MAX_SPLITS = 4;
/** Most hands a round can hold: every dealt hand and every split. */
export const MAX_TABLE_HANDS = MAX_HANDS + MAX_SPLITS;
const ACE = 1;
const DEALER_STANDS_ON = 17;
const BLACKJACK = 21;

const hardTotal = (cards: readonly number[]) => cards.reduce((sum, c) => sum + Math.min(c, 10), 0);

/** Best total, counting one ace as 11 when it does not bust. */
export function total(cards: readonly number[]): number {
  const hard = hardTotal(cards);
  return cards.includes(1) && hard + 10 <= BLACKJACK ? hard + 10 : hard;
}

/** A total is soft while an ace still counts as 11. */
export const isSoft = (cards: readonly number[]) => cards.includes(1) && hardTotal(cards) + 10 <= BLACKJACK;

const isBlackjack = (cards: readonly number[]) => cards.length === 2 && total(cards) === BLACKJACK;

export interface TableHand {
  cards: number[];
  doubled: boolean;
  /** Born from a split: its 21 is not a blackjack; split aces take no card after the split one. */
  split: boolean;
}

/** The program's `BlackjackTable` without its bet: hands, the hand to play, the dealer. */
export interface Table {
  /** Every hand in playing order: a hand born from a split comes right after the one it left. */
  hands: TableHand[];
  /** Index of the hand waiting for the player; `hands.length` once every hand is finished. */
  active: number;
  dealer: number[];
  /** Splits played this round, all hands together. */
  splits: number;
}

/** Two-card 21, neither from a double nor from a split. */
const isNatural = (h: TableHand) => isBlackjack(h.cards) && !h.doubled && !h.split;
const isBust = (h: TableHand) => total(h.cards) > BLACKJACK;
/** A hand from split aces: finished once it has its card. */
const isSplitAces = (h: TableHand) => h.split && h.cards[0] === ACE;

export const canHit = (h: TableHand) =>
  total(h.cards) < BLACKJACK && h.cards.length < MAX_CARDS && !h.doubled && !isSplitAces(h);
export const canDouble = (h: TableHand) =>
  h.cards.length === 2 && !h.doubled && total(h.cards) < BLACKJACK && !isSplitAces(h);

/** The hand waiting for the player, if any. */
export const activeHand = (t: Table): TableHand | undefined => t.hands[t.active];

/** Whether the active hand may be split: two first cards of the same value (10, J, Q, K all
 *  count 10), never split aces again, and a split left this round. */
export function canSplit(t: Table): boolean {
  const h = activeHand(t);
  return (
    h !== undefined &&
    t.splits < MAX_SPLITS &&
    t.hands.length < MAX_TABLE_HANDS &&
    h.cards.length === 2 &&
    !h.doubled &&
    !isSplitAces(h) &&
    Math.min(h.cards[0], 10) === Math.min(h.cards[1], 10)
  );
}

/** A table of `hands` empty hands, before the deal. */
export const newTable = (hands: number): Table => ({
  hands: Array.from({ length: hands }, () => ({ cards: [], doubled: false, split: false })),
  active: 0,
  dealer: [],
  splits: 0,
});

export const cloneTable = (t: Table): Table => ({
  hands: t.hands.map((h) => ({ cards: [...h.cards], doubled: h.doubled, split: h.split })),
  active: t.active,
  dealer: [...t.dealer],
  splits: t.splits,
});

function skipDoneHands(t: Table): void {
  for (let hand = activeHand(t); hand && !canHit(hand); hand = activeHand(t)) t.active++;
}

/** The dealer's turn once no hand is left: draws to 17 if a hand still competes on total,
 *  else one card if a natural needs the push check, else nothing (all bust). */
export function playDealer(t: Table, rng: Rng): void {
  if (t.hands.some((h) => !isBust(h) && !isNatural(h))) {
    while (total(t.dealer) < DEALER_STANDS_ON && t.dealer.length < MAX_CARDS) t.dealer.push(rng.card());
  } else if (t.hands.some(isNatural)) {
    t.dealer.push(rng.card());
  }
}

/** Moves past finished hands; once none is left the dealer plays and this returns true. */
function nextHand(t: Table, rng: Rng): boolean {
  skipDoneHands(t);
  if (activeHand(t)) return false;
  playDealer(t, rng);
  return true;
}

/** Two cards to every hand, then one to the dealer. True when the round is over. */
export function deal(t: Table, rng: Rng): boolean {
  for (const hand of t.hands) hand.cards.push(rng.card(), rng.card());
  t.dealer.push(rng.card());
  t.active = 0;
  return nextHand(t, rng);
}

/** One card to the active hand. True when the round is over. */
export function hit(t: Table, rng: Rng): boolean {
  t.hands[t.active].cards.push(rng.card());
  return nextHand(t, rng);
}

/** The active hand doubles and takes exactly one card. True when the round is over. */
export function double(t: Table, rng: Rng): boolean {
  const hand = t.hands[t.active];
  hand.doubled = true;
  hand.cards.push(rng.card());
  return nextHand(t, rng);
}

/** Splits the active hand (one more base bet): its second card becomes a new hand right after
 *  it, then the split hand and the new hand take one card each, in that order. True when the
 *  round is over. */
export function split(t: Table, rng: Rng): boolean {
  const hand = t.hands[t.active];
  const second = hand.cards.splice(1);
  hand.split = true;
  hand.cards.push(rng.card());
  const born: TableHand = { cards: [...second, rng.card()], doubled: false, split: true };
  t.hands.splice(t.active + 1, 0, born);
  t.splits++;
  return nextHand(t, rng);
}

/** Finishes the active hand without a card. True when no hand is left, i.e. the dealer must
 *  now play (`playDealer`, after a draw). */
export function stand(t: Table): boolean {
  t.active++;
  skipDoneHands(t);
  return activeHand(t) === undefined;
}

/** A hand's stake for a base bet of `bet`: twice the bet once doubled. */
export const handStake = (h: TableHand, bet: bigint) => (h.doubled ? bet * 2n : bet);

/** Stake of the whole round, doubles included. */
export const tableStake = (t: Table, bet: bigint) => t.hands.reduce((sum, h) => sum + handStake(h, bet), 0n);

/** What a finished hand returns against `dealer`, before Tilt's fee. */
export function handGross(h: TableHand, dealer: readonly number[], bet: bigint): bigint {
  const stake = handStake(h, bet);
  const p = total(h.cards);
  const d = total(dealer);
  const dealerBj = isBlackjack(dealer);
  if (p > BLACKJACK) return 0n;
  if (isNatural(h) && dealerBj) return stake;
  if (isNatural(h)) return mulDiv(stake, 5n, 2n);
  if (dealerBj) return 0n;
  if (d > BLACKJACK || p > d) return stake * 2n;
  return p === d ? stake : 0n;
}

/** What the finished round returns: every hand settled against the dealer. */
export const gross = (t: Table, bet: bigint) => t.hands.reduce((sum, h) => sum + handGross(h, t.dealer, bet), 0n);

/** How a finished hand ended against the dealer. */
export function result(h: TableHand, dealer: readonly number[], bet: bigint): BlackjackResult {
  const back = handGross(h, dealer, bet);
  const stake = handStake(h, bet);
  if (back === 0n) return "lose";
  if (back === stake) return "push";
  return isNatural(h) ? "blackjack" : "win";
}
