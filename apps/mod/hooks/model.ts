// Typed views over the mod's `$.state` (types/index.d.ts). The contract holds api-shaped values
// as `unknown`; these readers check them again with the protocol guards.
import type { TiltAgent, TiltAuth, TiltIntent, TiltLayout, TiltPrefs, TiltRemote } from "../types";
import { isKenoPicks, isPlayAction, isRouletteBet, isStateResponse } from "./guards";
import {
  clampFlips,
  clampHands,
  clampMines,
  DEFAULT_DICE_CHANCE,
  DEFAULT_KENO_PICKS,
  DEFAULT_LIMBO_TARGET,
  DEFAULT_MINES,
  DEFAULT_WHEEL_SEGMENTS,
  DICE_CHANCES,
  FLIP_SIDES,
  LIMBO_TARGETS,
  optionOr,
  TOWER_DIFFICULTIES,
  WHEEL_RISKS,
  WHEEL_SEGMENTS,
} from "./keys";
import type {
  BaccaratBet,
  FlipSide,
  Game,
  PlayAction,
  RouletteBet,
  StateResponse,
  TowerDifficulty,
  WheelRisk,
} from "./protocol";

export type AuthView = TiltAuth;
export type AgentView = TiltAgent;
export type LayoutView = TiltLayout;

export interface RemoteView {
  state: StateResponse | null;
  error: string | null;
  fetchedAt: number;
}

/** How fast the slots reels turn: turbo shows the draw as soon as the chain has it. */
export type SlotsSpeed = "normal" | "fast" | "turbo";

export interface Prefs {
  game: Game;
  betIndex: number;
  /** Blackjack hands per round, 1 to 6. */
  hands: number;
  roulette: RouletteBet;
  baccarat: BaccaratBet;
  slotsSpeed: SlotsSpeed;
  /** Mines per board, 1 to 24. */
  mines: number;
  /** Dice winning rolls in 10 000, one of DICE_CHANCES. */
  diceChance: number;
  diceOver: boolean;
  /** Limbo target × 100, one of LIMBO_TARGETS. */
  limboTarget: number;
  flipSide: FlipSide;
  /** Coins per flip, 1 to 10. */
  flips: number;
  /** 1 to 10 distinct numbers from 1 to 40, in order. */
  kenoPicks: number[];
  wheelSegments: number;
  wheelRisk: WheelRisk;
  towerDifficulty: TowerDifficulty;
}

export interface IntentView extends Omit<TiltIntent, "action"> {
  action: PlayAction;
}

export const DEFAULT_ROULETTE_BET: RouletteBet = { kind: "red" };

export const remoteView = (held: TiltRemote): RemoteView => ({
  ...held,
  state: isStateResponse(held.state) ? held.state : null,
});

export const prefsView = (held: TiltPrefs): Prefs => ({
  ...held,
  hands: clampHands(held.hands),
  mines: clampMines(held.mines ?? DEFAULT_MINES),
  roulette: isRouletteBet(held.roulette) ? held.roulette : DEFAULT_ROULETTE_BET,
  diceChance: optionOr(DICE_CHANCES, held.diceChance, DEFAULT_DICE_CHANCE),
  diceOver: held.diceOver === true,
  limboTarget: optionOr(LIMBO_TARGETS, held.limboTarget, DEFAULT_LIMBO_TARGET),
  flipSide: optionOr(FLIP_SIDES, held.flipSide, "heads"),
  flips: clampFlips(held.flips ?? 1),
  kenoPicks: isKenoPicks(held.kenoPicks) ? [...held.kenoPicks].sort((a, b) => a - b) : [...DEFAULT_KENO_PICKS],
  wheelSegments: optionOr(WHEEL_SEGMENTS, held.wheelSegments, DEFAULT_WHEEL_SEGMENTS),
  wheelRisk: optionOr(WHEEL_RISKS, held.wheelRisk, "low"),
  towerDifficulty: optionOr(TOWER_DIFFICULTIES, held.towerDifficulty, "easy"),
});

export const intentView = (held: TiltIntent | null): IntentView | null =>
  held !== null && isPlayAction(held.action) ? { ...held, action: held.action } : null;
