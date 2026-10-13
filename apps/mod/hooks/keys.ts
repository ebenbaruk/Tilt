// Which keys a drawing offers, as data: the panel and the band render the same plan, and the
// tests check it is conflict-free without drawing anything.
import { formatUsdc } from "./format";
import type { Prefs } from "./model";
import type { BaccaratBet, Game, Limits, PlayAction, RouletteBet, StateResponse } from "./protocol";

export type Command =
  | { kind: "switch"; game: Game }
  | { kind: "cycle-bet" }
  | { kind: "roulette-bet"; bet: RouletteBet }
  | { kind: "roulette-cycle"; target: "dozen" | "column" }
  | { kind: "baccarat-bet"; bet: BaccaratBet }
  /** Starts a round of the active game with the current bet, both read when the key is pressed. */
  | { kind: "start" }
  | { kind: "play"; action: PlayAction };

export interface KeyAction {
  /** The Button's address: stable across draws. */
  key: string;
  hotkey: string;
  label: string;
  isSelected: boolean;
  command: Command;
}

export const GAMES: readonly Game[] = ["blackjack", "roulette", "baccarat", "slots"];

export const GAME_LABELS: Record<Game, string> = {
  blackjack: "Blackjack",
  roulette: "Roulette",
  baccarat: "Baccarat",
  slots: "Slots",
};

const BASE_UNITS_PER_USDC = 1_000_000n;
const BET_PRESETS = [1n, 2n, 5n, 10n, 25n].map((usdc) => usdc * BASE_UNITS_PER_USDC);

/** The bets `b` cycles through: the table minimum, then the presets the limits allow. */
export function betOptions(limits: Limits): string[] {
  const min = BigInt(limits.minBet);
  const max = BigInt(limits.maxBet);
  const presets = BET_PRESETS.filter((amount) => amount > min && amount <= max);

  return [min, ...presets].map((amount) => amount.toString());
}

export function currentBet(limits: Limits, betIndex: number): string {
  const options = betOptions(limits);

  return options[betIndex % options.length] ?? limits.minBet;
}

/** A round in flight pins the game it was started in. */
export function isRoundOpen(state: StateResponse | null): boolean {
  return state?.round != null && state.round.phase !== "idle";
}

export function activeGame(state: StateResponse | null, prefs: Prefs): Game {
  return isRoundOpen(state) && state?.round ? state.round.detail.game : prefs.game;
}

export function nextRouletteBet(current: RouletteBet, kind: "dozen" | "column"): RouletteBet {
  const step = (third: 1 | 2 | 3): 1 | 2 | 3 => (third === 3 ? 1 : ((third + 1) as 2 | 3));

  if (kind === "dozen") {
    return { kind: "dozen", dozen: current.kind === "dozen" ? step(current.dozen) : 1 };
  }

  return { kind: "column", column: current.kind === "column" ? step(current.column) : 1 };
}

const ROULETTE_SIMPLE: readonly { hotkey: string; bet: RouletteBet }[] = [
  { hotkey: "r", bet: { kind: "red" } },
  { hotkey: "k", bet: { kind: "black" } },
  { hotkey: "o", bet: { kind: "odd" } },
  { hotkey: "e", bet: { kind: "even" } },
  { hotkey: "l", bet: { kind: "low" } },
  { hotkey: "g", bet: { kind: "high" } },
];

const BACCARAT_KEYS: readonly { hotkey: string; bet: BaccaratBet }[] = [
  { hotkey: "p", bet: "player" },
  { hotkey: "y", bet: "banker" },
  { hotkey: "t", bet: "tie" },
];

export interface PlanInput {
  state: StateResponse;
  prefs: Prefs;
  /** A move is in flight: no new one until it settles. */
  isBusy: boolean;
}

function switchKeys(state: StateResponse, prefs: Prefs): KeyAction[] {
  if (isRoundOpen(state)) {
    return [];
  }

  return GAMES.map((game, index) => ({
    key: `game-${game}`,
    hotkey: String(index + 1),
    label: GAME_LABELS[game],
    isSelected: game === prefs.game,
    command: { kind: "switch", game },
  }));
}

function rouletteKeys(prefs: Prefs): KeyAction[] {
  const chosen = prefs.roulette;
  const simple = ROULETTE_SIMPLE.map(({ hotkey, bet }) => ({
    key: `roulette-${bet.kind}`,
    hotkey,
    label: bet.kind,
    isSelected: chosen.kind === bet.kind,
    command: { kind: "roulette-bet", bet } as const,
  }));
  const dozen = chosen.kind === "dozen" ? chosen : nextRouletteBet(chosen, "dozen");
  const column = chosen.kind === "column" ? chosen : nextRouletteBet(chosen, "column");

  return [
    ...simple,
    {
      key: "roulette-dozen",
      hotkey: "z",
      label: dozen.kind === "dozen" ? `dozen ${dozen.dozen}` : "dozen",
      isSelected: chosen.kind === "dozen",
      command: { kind: "roulette-cycle", target: "dozen" },
    },
    {
      key: "roulette-column",
      hotkey: "c",
      label: column.kind === "column" ? `column ${column.column}` : "column",
      isSelected: chosen.kind === "column",
      command: { kind: "roulette-cycle", target: "column" },
    },
  ];
}

function baccaratKeys(prefs: Prefs): KeyAction[] {
  return BACCARAT_KEYS.map(({ hotkey, bet }) => ({
    key: `baccarat-${bet}`,
    hotkey,
    label: bet,
    isSelected: prefs.baccarat === bet,
    command: { kind: "baccarat-bet", bet },
  }));
}

export function startAction(game: Game, amount: string, prefs: Prefs): PlayAction {
  switch (game) {
    case "blackjack":
      return { type: "blackjack_bet", amount };
    case "roulette":
      return { type: "roulette_spin", amount, bet: prefs.roulette };
    case "baccarat":
      return { type: "baccarat_deal", amount, bet: prefs.baccarat };
    case "slots":
      return { type: "slots_spin", amount };
  }
}

const START_VERB: Record<Game, string> = { blackjack: "deal", roulette: "spin", baccarat: "deal", slots: "spin" };

function playerTurnKeys(state: StateResponse): KeyAction[] {
  const detail = state.round?.detail;

  if (detail?.game !== "blackjack") {
    return [];
  }

  const keys: KeyAction[] = [];
  const add = (hotkey: string, label: string, action: PlayAction) =>
    keys.push({ key: `bj-${label}`, hotkey, label, isSelected: false, command: { kind: "play", action } });

  if (detail.canHit) {
    add("h", "hit", { type: "blackjack_hit" });
  }

  add("s", "stand", { type: "blackjack_stand" });

  if (detail.canDouble) {
    add("d", "double", { type: "blackjack_double" });
  }

  return keys;
}

function idleKeys(game: Game, state: StateResponse, prefs: Prefs): KeyAction[] {
  const amount = currentBet(state.limits, prefs.betIndex);
  const choices = game === "roulette" ? rouletteKeys(prefs) : game === "baccarat" ? baccaratKeys(prefs) : [];

  return [
    ...choices,
    { key: "bet", hotkey: "b", label: "bet", isSelected: false, command: { kind: "cycle-bet" } },
    {
      key: "start",
      hotkey: "n",
      label: `${START_VERB[game]} · ${formatUsdc(amount)}`,
      isSelected: false,
      command: { kind: "start" },
    },
  ];
}

/** Every key the drawing offers right now; empty play keys while blocked, busy or drawing. */
export function planKeys({ state, prefs, isBusy }: PlanInput): KeyAction[] {
  const switches = switchKeys(state, prefs);
  const canPlay = state.accountOpen && state.blocked === null && !isBusy && state.pendingIntentId === null;

  if (!canPlay) {
    return switches;
  }

  switch (state.round?.phase ?? "idle") {
    case "player_turn":
      return [...switches, ...playerTurnKeys(state)];
    case "drawing":
      return switches;
    case "idle":
      return [...switches, ...idleKeys(activeGame(state, prefs), state, prefs)];
  }
}
