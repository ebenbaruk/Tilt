// Small helpers the demo rounds are scripted with: every frame is a pure function of the time
// into the loop, so a demo can be drawn at any moment (and frozen on one for reduced motion).

/** A card as the api sends it: rank 1 (ace) to 13 (king). */
export interface Card {
  rank: number;
  suit: "♠" | "♥" | "♦" | "♣";
}

const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const rankLabel = (rank: number): string => RANK_LABELS[rank - 1] ?? "?";
export const isRed = (card: Card): boolean => card.suit === "♥" || card.suit === "♦";
export const cardText = (card: Card): string => `${rankLabel(card.rank)}${card.suit}`;

/** "K♠" → { rank: 13, suit: "♠" }. Scripts are written with card names, not numbers. */
export function card(name: string): Card {
  const suit = name.slice(-1) as Card["suit"];
  return { rank: RANK_LABELS.indexOf(name.slice(0, -1)) + 1, suit };
}

/** One card turned over every step, as the mod deals. */
export const DEAL_STEP_MS = 150;
/** How long a pressed key stays lit. */
const PRESS_MS = 320;
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const SPINNER_FRAME_MS = 200;

/** The value of the last step that started at or before `t`; steps are in time order, the first at 0. */
export function stepAt<T>(t: number, steps: readonly [readonly [0, T], ...(readonly [number, T])[]]): T {
  let value = steps[0][1];
  for (const [at, next] of steps) {
    if (at > t) break;
    value = next;
  }
  return value;
}

/** The key pressed at `t`, if one was pressed a moment ago. */
export function pressedAt(t: number, presses: readonly (readonly [number, string])[]): string | null {
  return presses.find(([at]) => t >= at && t < at + PRESS_MS)?.[1] ?? null;
}

export const spinnerAt = (t: number): string => SPINNER[Math.floor(t / SPINNER_FRAME_MS) % SPINNER.length] ?? "⠋";

/** 0 → 1 over [from, from + span]: the cubic ease-out the mod's wheels and counters slow down on. */
export function easeOut(t: number, from: number, span: number): number {
  const progress = Math.min(1, Math.max(0, (t - from) / span));
  return 1 - (1 - progress) ** 3;
}

/** A blackjack total: aces count 11 while that stays at 21 or under. */
export function blackjackTotal(cards: readonly Card[]): { total: number; soft: boolean } {
  const hard = cards.reduce((sum, c) => sum + Math.min(10, c.rank), 0);
  const soft = cards.some((c) => c.rank === 1) && hard + 10 <= 21;
  return { total: soft ? hard + 10 : hard, soft };
}

/** Baccarat points: the last digit of the sum, picture cards and tens at 0. */
export const baccaratPoints = (cards: readonly Card[]): number =>
  cards.reduce((sum, c) => sum + (c.rank >= 10 ? 0 : c.rank), 0) % 10;
