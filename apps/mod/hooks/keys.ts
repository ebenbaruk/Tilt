// Which keys a drawing offers, as data: the panel and the band render the same plan, and the
// tests check it is conflict-free without drawing anything.
import { formatUsdc } from "./format";
import type { Prefs, SlotsSpeed } from "./model";
import type { BaccaratBet, Game, Limits, PlayAction, RouletteBet, StateResponse } from "./protocol";

export type Command =
  | { kind: "switch"; game: Game }
  /** Moves the bet one preset down (-1) or up (+1), held at the table's bounds. */
  | { kind: "bet"; step: -1 | 1 }
  /** One blackjack hand fewer (-1) or more (+1), held between one and six. */
  | { kind: "hands"; step: -1 | 1 }
  | { kind: "roulette-bet"; bet: RouletteBet }
  | { kind: "roulette-cycle"; target: "dozen" | "column" }
  | { kind: "baccarat-bet"; bet: BaccaratBet }
  | { kind: "slots-speed"; speed: SlotsSpeed }
  /** Starts a round of the active game with the current bet, both read when the key is pressed. */
  | { kind: "start" }
  | { kind: "play"; action: PlayAction }
  /** Copies a line about the last big win, to paste where the person likes. */
  | { kind: "share" };

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

/** The bets `v` and `b` step through: the table minimum, then the presets the limits allow. */
export function betOptions(limits: Limits): string[] {
  const min = BigInt(limits.minBet);
  const max = BigInt(limits.maxBet);
  const presets = BET_PRESETS.filter((amount) => amount > min && amount <= max);

  return [min, ...presets].map((amount) => amount.toString());
}

function clampBetIndex(limits: Limits, betIndex: number): number {
  return Math.max(0, Math.min(betIndex, betOptions(limits).length - 1));
}

export function currentBet(limits: Limits, betIndex: number): string {
  return betOptions(limits)[clampBetIndex(limits, betIndex)] ?? limits.minBet;
}

/** The bet index one step down or up, never past the lowest or highest bet the limits allow. */
export function stepBetIndex(limits: Limits, betIndex: number, step: -1 | 1): number {
  return clampBetIndex(limits, clampBetIndex(limits, betIndex) + step);
}

export const MIN_HANDS = 1;
export const MAX_HANDS = 6;
/** Splits per round, all hands together: each one adds a hand to the table. */
export const MAX_SPLITS = 4;
/** Hands a round can hold: the dealt ones plus every split. */
export const MAX_TABLE_HANDS = MAX_HANDS + MAX_SPLITS;

/** A hand count the table takes: whole, from one to six. */
export function clampHands(hands: number): number {
  return Number.isInteger(hands) ? Math.max(MIN_HANDS, Math.min(hands, MAX_HANDS)) : MIN_HANDS;
}

/** One blackjack hand fewer (-1) or more (+1), held between one and six. */
export function stepHands(hands: number, step: -1 | 1): number {
  return clampHands(clampHands(hands) + step);
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

/** Always drawn: mid-round a press explains why it does not switch (see runCommand). */
function switchKeys(state: StateResponse, prefs: Prefs): KeyAction[] {
  const shown = activeGame(state, prefs);

  return GAMES.map((game, index) => ({
    key: `game-${game}`,
    hotkey: String(index + 1),
    label: GAME_LABELS[game],
    isSelected: game === shown,
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
      return { type: "blackjack_bet", amount, hands: clampHands(prefs.hands) };
    case "roulette":
      return { type: "roulette_spin", amount, bet: prefs.roulette };
    case "baccarat":
      return { type: "baccarat_deal", amount, bet: prefs.baccarat };
    case "slots":
      return { type: "slots_spin", amount };
  }
}

/** "deal · 0.50", or "deal · 3 × 0.50" for three blackjack hands. */
function startLabel(game: Game, amount: string, prefs: Prefs): string {
  const hands = clampHands(prefs.hands);
  const stake = game === "blackjack" && hands > 1 ? `${hands} × ${formatUsdc(amount)}` : formatUsdc(amount);

  return `${START_VERB[game]} · ${stake}`;
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

  if (detail.canSplit) {
    add("p", "split", { type: "blackjack_split" });
  }

  return keys;
}

const SLOTS_SPEED_KEYS: readonly { hotkey: string; speed: SlotsSpeed }[] = [
  { hotkey: "x", speed: "normal" },
  { hotkey: "f", speed: "fast" },
  { hotkey: "t", speed: "turbo" },
];

function choiceKeys(game: Game, prefs: Prefs): KeyAction[] {
  switch (game) {
    case "blackjack":
      return [
        { key: "hands-down", hotkey: "j", label: "hands −", isSelected: false, command: { kind: "hands", step: -1 } },
        { key: "hands-up", hotkey: "k", label: "hands +", isSelected: false, command: { kind: "hands", step: 1 } },
      ];
    case "roulette":
      return rouletteKeys(prefs);
    case "baccarat":
      return baccaratKeys(prefs);
    case "slots":
      return SLOTS_SPEED_KEYS.map(({ hotkey, speed }) => ({
        key: `slots-${speed}`,
        hotkey,
        label: speed,
        isSelected: prefs.slotsSpeed === speed,
        command: { kind: "slots-speed", speed },
      }));
  }
}

function idleKeys(game: Game, state: StateResponse, prefs: Prefs): KeyAction[] {
  const amount = currentBet(state.limits, prefs.betIndex);

  return [
    ...choiceKeys(game, prefs),
    { key: "bet-down", hotkey: "v", label: "bet −", isSelected: false, command: { kind: "bet", step: -1 } },
    { key: "bet-up", hotkey: "b", label: "bet +", isSelected: false, command: { kind: "bet", step: 1 } },
    {
      key: "start",
      hotkey: "n",
      label: startLabel(game, amount, prefs),
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

/**
 * The play keys a move in flight or a draw holds back, drawn dim and inert in their place: a key
 * no Button of the focused pane takes goes to the prompt, where a mashed Enter would then send
 * "nnnn" to the agent. Empty while play is open, blocked, or the account is not open.
 */
export function heldKeys({ state, prefs, isBusy }: PlanInput): KeyAction[] {
  const round = state.round;
  const isHeld = isBusy || state.pendingIntentId !== null || round?.phase === "drawing";

  if (!state.accountOpen || state.blocked !== null || !isHeld) {
    return [];
  }

  const settled = round?.phase === "drawing" ? { ...state, round: { ...round, phase: "idle" as const } } : state;

  return planKeys({ state: { ...settled, pendingIntentId: null }, prefs, isBusy: false }).filter(
    (key) => key.command.kind !== "switch",
  );
}
