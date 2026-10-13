// Types derived from the public RoundView, and display helpers for replayed rounds.
import type { Game, RoundView } from "@tilt/api/public";

type Detail = RoundView["detail"];
export type BlackjackDetail = Extract<Detail, { game: "blackjack" }>;
export type RouletteDetail = Extract<Detail, { game: "roulette" }>;
export type BaccaratDetail = Extract<Detail, { game: "baccarat" }>;
export type SlotsDetail = Extract<Detail, { game: "slots" }>;
export type Card = BlackjackDetail["player"][number];
export type RouletteBet = RouletteDetail["bet"];

export const GAME_NAMES: Record<Game, string> = {
  blackjack: "Blackjack",
  roulette: "Roulette",
  baccarat: "Baccarat",
  slots: "Slots",
};

export function describeRouletteBet(bet: RouletteBet): string {
  switch (bet.kind) {
    case "straight":
      return `straight ${bet.number}`;
    case "dozen":
      return `dozen ${bet.dozen}`;
    case "column":
      return `column ${bet.column}`;
    default:
      return bet.kind;
  }
}

const RED_POCKETS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function pocketColor(n: number): "green" | "red" | "black" {
  if (n === 0) return "green";
  return RED_POCKETS.has(n) ? "red" : "black";
}
