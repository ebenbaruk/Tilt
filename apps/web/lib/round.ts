// Types derived from the public RoundView, and display helpers for replayed rounds.
import type { Game, RoundView } from "@tilt/api/public";

type Detail = RoundView["detail"];
export type BlackjackDetail = Extract<Detail, { game: "blackjack" }>;
export type RouletteDetail = Extract<Detail, { game: "roulette" }>;
export type BaccaratDetail = Extract<Detail, { game: "baccarat" }>;
export type SlotsDetail = Extract<Detail, { game: "slots" }>;
export type MinesDetail = Extract<Detail, { game: "mines" }>;
export type DiceDetail = Extract<Detail, { game: "dice" }>;
export type LimboDetail = Extract<Detail, { game: "limbo" }>;
export type FlipDetail = Extract<Detail, { game: "flip" }>;
export type KenoDetail = Extract<Detail, { game: "keno" }>;
export type WheelDetail = Extract<Detail, { game: "wheel" }>;
export type HiloDetail = Extract<Detail, { game: "hilo" }>;
export type TowerDetail = Extract<Detail, { game: "tower" }>;
export type Card = BlackjackDetail["dealer"][number];
export type BlackjackHand = BlackjackDetail["hands"][number];
export type RouletteBet = RouletteDetail["bet"];

export const GAME_NAMES: Record<Game, string> = {
  blackjack: "Blackjack",
  roulette: "Roulette",
  baccarat: "Baccarat",
  slots: "Slots",
  mines: "Mines",
  dice: "Dice",
  limbo: "Limbo",
  flip: "Flip",
  keno: "Keno",
  wheel: "Wheel",
  hilo: "Hilo",
  tower: "Tower",
};

/** An on-chain count of hundredths (dice roll 0–9999, target, chance) as "7.25". Integer math, no floats. */
export function hundredths(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

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
