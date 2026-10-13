// Typed views over the mod's `$.state` (types/index.d.ts). The contract holds api-shaped values
// as `unknown`; these readers check them again with the protocol guards.
import type { TiltAgent, TiltAuth, TiltIntent, TiltLayout, TiltPrefs, TiltRemote } from "../types";
import { isPlayAction, isRouletteBet, isStateResponse } from "./guards";
import type { BaccaratBet, Game, PlayAction, RouletteBet, StateResponse } from "./protocol";

export type AuthView = TiltAuth;
export type AgentView = TiltAgent;
export type LayoutView = TiltLayout;

export interface RemoteView {
  state: StateResponse | null;
  error: string | null;
  fetchedAt: number;
}

export interface Prefs {
  game: Game;
  betIndex: number;
  roulette: RouletteBet;
  baccarat: BaccaratBet;
}

export interface IntentView {
  id: string;
  action: PlayAction;
  status: TiltIntent["status"];
}

export const DEFAULT_ROULETTE_BET: RouletteBet = { kind: "red" };

export const remoteView = (held: TiltRemote): RemoteView => ({
  ...held,
  state: isStateResponse(held.state) ? held.state : null,
});

export const prefsView = (held: TiltPrefs): Prefs => ({
  ...held,
  roulette: isRouletteBet(held.roulette) ? held.roulette : DEFAULT_ROULETTE_BET,
});

export const intentView = (held: TiltIntent | null): IntentView | null =>
  held !== null && isPlayAction(held.action) ? { ...held, action: held.action } : null;
