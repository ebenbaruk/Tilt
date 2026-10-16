// Which keys a drawing offers, as data: the panel and the band render the same plan, and the
// tests check it is conflict-free without drawing anything.
import { cashOutPayout, formatUsdc, scaledDecimal } from "./format";
import type { Prefs, SlotsSpeed } from "./model";
import type {
  BaccaratBet,
  BlackjackView,
  FlipSide,
  Game,
  HiloGuess,
  HiloView,
  Limits,
  MinesView,
  PlayAction,
  RouletteBet,
  RoundView,
  StateResponse,
  TowerDifficulty,
  TowerView,
  WheelRisk,
} from "./protocol";

export type Command =
  | { kind: "switch"; game: Game }
  /** Moves the bet one preset down (-1) or up (+1), held at the table's bounds. */
  | { kind: "bet"; step: -1 | 1 }
  /** One blackjack hand fewer (-1) or more (+1), held between one and six. */
  | { kind: "hands"; step: -1 | 1 }
  /** One Mines mine fewer (-1) or more (+1), held between 1 and 24. */
  | { kind: "mines"; step: -1 | 1 }
  /** A choice of the new games one preset down (-1) or up (+1), held at both ends. */
  | { kind: "step"; setting: Setting; step: -1 | 1 }
  /** Dice: rolls over the target instead of under it, or back. */
  | { kind: "dice-over" }
  | { kind: "flip-side"; side: FlipSide }
  /** Wheel: the next risk, low after high. */
  | { kind: "wheel-risk" }
  /** Keno: as many new picks, chosen at random on the player's side (a choice, not an outcome). */
  | { kind: "keno-random" }
  /** Keno: picks or unpicks one number, held between 1 and 10 picks. */
  | { kind: "keno-pick"; number: number }
  | { kind: "roulette-bet"; bet: RouletteBet }
  | { kind: "roulette-cycle"; target: "dozen" | "column" }
  /** Roulette: a bet on one number, the one before (-1) or after (+1) the current one. */
  | { kind: "roulette-number"; step: -1 | 1 }
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
  /** One digit or one lowercase letter; "" for a key only a click presses (see tableKeys). */
  hotkey: string;
  label: string;
  isSelected: boolean;
  command: Command;
}

/** The game switcher's order: digits 1 to 9 pick a game of the page shown, 0 turns the page. */
export const GAMES: readonly Game[] = [
  "blackjack",
  "roulette",
  "baccarat",
  "slots",
  "mines",
  "dice",
  "limbo",
  "flip",
  "keno",
  "wheel",
  "hilo",
  "tower",
];
const GAMES_PER_PAGE = 9;
const GAME_PAGES = Math.ceil(GAMES.length / GAMES_PER_PAGE);

export const GAME_LABELS: Record<Game, string> = {
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

/** The switcher page a game is on, from 0. */
export const gamePage = (game: Game): number => Math.floor(GAMES.indexOf(game) / GAMES_PER_PAGE);

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

/** A Mines board: 5 × 5 tiles, numbered row × 5 + column. */
export const MINES_COLUMNS = 5;
export const MINES_TILES = MINES_COLUMNS * MINES_COLUMNS;
export const MIN_MINES = 1;
export const MAX_MINES = MINES_TILES - 1;
export const DEFAULT_MINES = 3;

/** A mine count the board takes: whole, from 1 to 24. */
export function clampMines(mines: number): number {
  return Number.isInteger(mines) ? Math.max(MIN_MINES, Math.min(mines, MAX_MINES)) : DEFAULT_MINES;
}

/** One mine fewer (-1) or more (+1), held between 1 and 24. */
export function stepMines(mines: number, step: -1 | 1): number {
  return clampMines(clampMines(mines) + step);
}

/** Dice rolls 0 to 9999 (00.00 to 99.99); the winning count is 1 % to 98 % of them. */
export const DICE_ROLLS = 10_000;
export const MIN_DICE_CHANCE = 100;
export const MAX_DICE_CHANCE = 9_800;
/** Limbo targets are multipliers × 100: 1.01× to 10 000×. */
export const MIN_LIMBO_TARGET = 101;
export const MAX_LIMBO_TARGET = 1_000_000;
export const MIN_FLIPS = 1;
export const MAX_FLIPS = 10;
/** Keno: numbers 1 to 40, 1 to 10 picks, ten drawn. */
export const KENO_NUMBERS = 40;
export const MIN_KENO_PICKS = 1;
export const MAX_KENO_PICKS = 10;
export const KENO_DRAWN = 10;
export const WHEEL_SEGMENTS: readonly number[] = [10, 20, 30, 40, 50];
export const WHEEL_RISKS: readonly WheelRisk[] = ["low", "medium", "high"];
export const FLIP_SIDES: readonly FlipSide[] = ["heads", "tails"];
export const HILO_GUESSES: readonly HiloGuess[] = ["higher", "lower", "skip"];
export const MAX_HILO_SKIPS = 10;
/** Cards a Hilo board keeps: the first, then one per guess. */
export const MAX_HILO_CARDS = 64;
export const TOWER_LEVELS = 9;
export const TOWER_DIFFICULTIES: readonly TowerDifficulty[] = ["easy", "medium", "hard", "expert", "master"];
/** Tiles per level and safe tiles among them. */
export const TOWER_SHAPES: Record<TowerDifficulty, { tiles: number; safe: number }> = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
  master: { tiles: 4, safe: 1 },
};
export const MAX_TOWER_TILES = 4;

/** Dice win chances j and k step through, as winning rolls in 10 000: 49 % pays ×2. */
export const DICE_CHANCES: readonly number[] = [100, 500, 1_000, 2_500, 4_900, 6_600, 7_500, 9_000, 9_800];
export const DEFAULT_DICE_CHANCE = 4_900;
/** Limbo targets j and k step through, × 100. */
export const LIMBO_TARGETS: readonly number[] = [150, 200, 300, 500, 1_000, 2_500, 10_000, 100_000];
export const DEFAULT_LIMBO_TARGET = 200;
export const DEFAULT_KENO_PICKS: readonly number[] = [4, 12, 19, 27, 35];
export const DEFAULT_WHEEL_SEGMENTS = 10;

/** The choices `step` moves, by the address of their j and k keys (`dice-down`, `dice-up`). */
export type Setting = "dice" | "limbo" | "flips" | "keno" | "wheel" | "tower";

/** What each pair of j and k keys steps, as the table's prompt names it: `↑/↓ chance`. */
export const STEPPER_NAMES: Record<string, string> = {
  hands: "hands",
  mines: "mines",
  dice: "chance",
  limbo: "target",
  flips: "coins",
  keno: "picks",
  wheel: "segments",
  tower: "difficulty",
};

/** `value` when it is one of `options`, else `fallback`: a stored pref another plugin could have broken. */
export function optionOr<T>(options: readonly T[], value: T | undefined, fallback: T): T {
  return value !== undefined && options.includes(value) ? value : fallback;
}

/** The option one step down or up from `value`, held at both ends. */
function stepThrough<T>(options: readonly T[], value: T, step: -1 | 1): T {
  const index = Math.max(0, options.indexOf(value));

  return options[Math.max(0, Math.min(index + step, options.length - 1))] ?? value;
}

/** The option after `value`, the first after the last. */
export function cycle<T>(options: readonly T[], value: T): T {
  return options[(options.indexOf(value) + 1) % options.length] ?? value;
}

/** A coin count a flip takes: whole, from 1 to 10. */
export function clampFlips(flips: number): number {
  return Number.isInteger(flips) ? Math.max(MIN_FLIPS, Math.min(flips, MAX_FLIPS)) : MIN_FLIPS;
}

/** `random(bound)` is a whole number from 0 to bound − 1. */
export type RandomBelow = (bound: number) => number;

const byValue = (a: number, b: number): number => a - b;

/** `count` distinct Keno numbers chosen with `random`, in order. */
export function randomPicks(count: number, random: RandomBelow): number[] {
  const pool = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1);

  for (let index = 0; index < count; index++) {
    const other = index + random(KENO_NUMBERS - index);
    const picked = pool[other] ?? 0;

    pool[other] = pool[index] ?? 0;
    pool[index] = picked;
  }

  return pool.slice(0, count).sort(byValue);
}

/** Picks `number` or drops it, never below 1 pick or past 10. */
export function toggleKenoPick(picks: readonly number[], number: number): number[] {
  if (picks.includes(number)) {
    return picks.length > MIN_KENO_PICKS ? picks.filter((pick) => pick !== number) : [...picks];
  }

  return picks.length < MAX_KENO_PICKS ? [...picks, number].sort(byValue) : [...picks];
}

/** One pick fewer (the highest goes) or one more (a random free number), held between 1 and 10. */
function stepKenoPicks(picks: readonly number[], step: -1 | 1, random: RandomBelow): number[] {
  if (step < 0) {
    return picks.length > MIN_KENO_PICKS ? picks.slice(0, -1) : [...picks];
  }

  const free = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1).filter((n) => !picks.includes(n));
  const added = free[random(free.length)];

  return picks.length < MAX_KENO_PICKS && added !== undefined ? [...picks, added].sort(byValue) : [...picks];
}

/** The prefs after j (-1) or k (+1) on one of the new games' choices. */
export function stepSetting(prefs: Prefs, setting: Setting, step: -1 | 1, random: RandomBelow): Prefs {
  switch (setting) {
    case "dice":
      return { ...prefs, diceChance: stepThrough(DICE_CHANCES, prefs.diceChance, step) };
    case "limbo":
      return { ...prefs, limboTarget: stepThrough(LIMBO_TARGETS, prefs.limboTarget, step) };
    case "flips":
      return { ...prefs, flips: clampFlips(clampFlips(prefs.flips) + step) };
    case "keno":
      return { ...prefs, kenoPicks: stepKenoPicks(prefs.kenoPicks, step, random) };
    case "wheel":
      return { ...prefs, wheelSegments: stepThrough(WHEEL_SEGMENTS, prefs.wheelSegments, step) };
    case "tower":
      return { ...prefs, towerDifficulty: stepThrough(TOWER_DIFFICULTIES, prefs.towerDifficulty, step) };
  }
}

/** The roll a dice bet targets: the chance itself under, the rolls above the rest over. */
export const diceTarget = (chance: number, over: boolean): number => (over ? DICE_ROLLS - chance : chance);

/** The address of the key revealing a tile: `mines-tile-0` to `mines-tile-24`. */
export const MINES_TILE_KEY = "mines-tile-";
/** The address of the key climbing onto a tile of the next tower level: `tower-tile-0` to `tower-tile-3`. */
export const TOWER_TILE_KEY = "tower-tile-";
/** The address of a Keno number's click on the fullscreen table: `keno-pick-1` to `keno-pick-40`. */
export const KENO_PICK_KEY = "keno-pick-";
/** The addresses of the roulette layout's cells only a click on the fullscreen table bets on:
 *  `roulette-straight-0` to `roulette-straight-36`, `roulette-dozen-1`, `roulette-column-3`. */
export const ROULETTE_STRAIGHT_KEY = "roulette-straight-";
export const ROULETTE_DOZEN_KEY = "roulette-dozen-";
export const ROULETTE_COLUMN_KEY = "roulette-column-";
/** The wheel's pockets, 0 to 36. */
export const ROULETTE_POCKETS = 37;
const LETTER_A = "a".charCodeAt(0);
/** A hidden tile's key drawn on its own: a tile of the board, its letter beside it. */
const TILE_LABEL = "·";

/** A tile's hotkey: tile 0 is `a`, tile 24 is `y` (`z` cashes out). */
export function tileLetter(tile: number): string {
  return String.fromCharCode(LETTER_A + tile);
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

/** A bet on the number one before or after the current one, around 0 to 36; a bet on no number starts at 0. */
export function stepRouletteNumber(current: RouletteBet, step: -1 | 1): RouletteBet {
  if (current.kind !== "straight") {
    return { kind: "straight", number: 0 };
  }

  return { kind: "straight", number: (current.number + step + ROULETTE_POCKETS) % ROULETTE_POCKETS };
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

/**
 * Always drawn: mid-round a press explains why it does not switch (see runCommand). Digits 1 to 9
 * pick the games of the shown game's page; 0 turns to the next page, on its first game.
 */
function switchKeys(state: StateResponse, prefs: Prefs): KeyAction[] {
  const shown = activeGame(state, prefs);
  const page = gamePage(shown);
  const nextPage = (page + 1) % GAME_PAGES;
  const games = GAMES.slice(page * GAMES_PER_PAGE, (page + 1) * GAMES_PER_PAGE);
  const turn: KeyAction = {
    key: "game-page",
    hotkey: "0",
    label: `more ${page + 1}/${GAME_PAGES}`,
    isSelected: false,
    command: { kind: "switch", game: GAMES[nextPage * GAMES_PER_PAGE] ?? shown },
  };

  return [
    ...games.map((game, index) => ({
      key: `game-${game}`,
      hotkey: String(index + 1),
      label: GAME_LABELS[game],
      isSelected: game === shown,
      command: { kind: "switch", game } as const,
    })),
    turn,
  ];
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
    {
      key: "roulette-number-down",
      hotkey: "s",
      label: "number −",
      isSelected: false,
      command: { kind: "roulette-number", step: -1 },
    },
    {
      key: "roulette-number-up",
      hotkey: "d",
      label: "number +",
      isSelected: false,
      command: { kind: "roulette-number", step: 1 },
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
    case "mines":
      return { type: "mines_bet", amount, mines: clampMines(prefs.mines) };
    case "dice":
      return {
        type: "dice_roll",
        amount,
        target: diceTarget(prefs.diceChance, prefs.diceOver),
        over: prefs.diceOver,
      };
    case "limbo":
      return { type: "limbo_play", amount, target: prefs.limboTarget };
    case "flip":
      return { type: "flip_play", amount, side: prefs.flipSide, flips: clampFlips(prefs.flips) };
    case "keno":
      return { type: "keno_play", amount, picks: [...prefs.kenoPicks] };
    case "wheel":
      return { type: "wheel_spin", amount, segments: prefs.wheelSegments, risk: prefs.wheelRisk };
    case "hilo":
      return { type: "hilo_bet", amount };
    case "tower":
      return { type: "tower_bet", amount, difficulty: prefs.towerDifficulty };
  }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** What the start key adds after the bet: the choices the round is played with. */
function startDetail(game: Game, prefs: Prefs): string {
  switch (game) {
    case "mines":
      return ` · ${plural(clampMines(prefs.mines), "mine", "mines")}`;
    case "dice":
      return ` · ${prefs.diceOver ? "over" : "under"} ${scaledDecimal(BigInt(diceTarget(prefs.diceChance, prefs.diceOver)), 2)}`;
    case "limbo":
      return ` · ×${scaledDecimal(BigInt(prefs.limboTarget), 2)}`;
    case "flip":
      return ` · ${clampFlips(prefs.flips)} × ${prefs.flipSide}`;
    case "keno":
      return ` · ${plural(prefs.kenoPicks.length, "pick", "picks")}`;
    case "wheel":
      return ` · ${prefs.wheelSegments} segments · ${prefs.wheelRisk}`;
    case "tower":
      return ` · ${prefs.towerDifficulty}`;
    default:
      return "";
  }
}

/** "deal · 0.50", "deal · 3 × 0.50" for three blackjack hands, "play · 0.50 · 3 mines", "roll · 0.50 · under 49.00". */
function startLabel(game: Game, amount: string, prefs: Prefs): string {
  const hands = clampHands(prefs.hands);
  const stake = game === "blackjack" && hands > 1 ? `${hands} × ${formatUsdc(amount)}` : formatUsdc(amount);

  return `${START_VERB[game]} · ${stake}${startDetail(game, prefs)}`;
}

const START_VERB: Record<Game, string> = {
  blackjack: "deal",
  roulette: "spin",
  baccarat: "deal",
  slots: "spin",
  mines: "play",
  dice: "roll",
  limbo: "play",
  flip: "flip",
  keno: "play",
  wheel: "spin",
  hilo: "play",
  tower: "play",
};

/** A cash-out key on `z` at the current multiplier: what it returns before Tilt's fee. */
function cashOutKey(game: "mines" | "hilo" | "tower", stake: string, multiplier: string): KeyAction {
  const action: PlayAction = { type: `${game}_cashout` };

  return {
    key: `${game}-cashout`,
    hotkey: "z",
    label: `cash out · ${formatUsdc(cashOutPayout(stake, multiplier))}`,
    isSelected: false,
    command: { kind: "play", action },
  };
}

/** A tile key for every tile still hidden while the board takes a reveal, then `z` to cash out. */
function minesTurnKeys(detail: MinesView, stake: string): KeyAction[] {
  const shown = new Set<number | null>([...detail.revealed, detail.pending, detail.busted]);
  const tiles = detail.canReveal ? Array.from({ length: MINES_TILES }, (_, tile) => tile) : [];
  const keys: KeyAction[] = tiles
    .filter((tile) => !shown.has(tile))
    .map((tile) => ({
      key: `${MINES_TILE_KEY}${tile}`,
      hotkey: tileLetter(tile),
      label: TILE_LABEL,
      isSelected: false,
      command: { kind: "play", action: { type: "mines_reveal", tile } },
    }));

  if (detail.canCashOut) {
    keys.push(cashOutKey("mines", stake, detail.multiplier));
  }

  return keys;
}

/** A key per tile of the next level while the tower takes a climb (`a` to `d`), then `z` to cash out. */
function towerTurnKeys(detail: TowerView, stake: string): KeyAction[] {
  const tiles = detail.canClimb ? Array.from({ length: detail.tiles }, (_, tile) => tile) : [];
  const keys: KeyAction[] = tiles
    .filter((tile) => tile !== detail.pending)
    .map((tile) => ({
      key: `${TOWER_TILE_KEY}${tile}`,
      hotkey: tileLetter(tile),
      label: TILE_LABEL,
      isSelected: false,
      command: { kind: "play", action: { type: "tower_climb", tile } },
    }));

  if (detail.canCashOut) {
    keys.push(cashOutKey("tower", stake, detail.multiplier));
  }

  return keys;
}

const HILO_KEYS: Record<HiloGuess, string> = { higher: "h", lower: "l", skip: "s" };

/** Higher and lower at what a right guess brings, unless refused; skip while skips are left; `z` cashes out. */
function hiloTurnKeys(detail: HiloView, stake: string): KeyAction[] {
  const offers: { guess: HiloGuess; label: string | null }[] = [
    { guess: "higher", label: detail.higherMultiplier === null ? null : `higher ×${detail.higherMultiplier}` },
    { guess: "lower", label: detail.lowerMultiplier === null ? null : `lower ×${detail.lowerMultiplier}` },
    { guess: "skip", label: detail.skipsLeft > 0 ? `skip · ${detail.skipsLeft} left` : null },
  ];
  const keys: KeyAction[] = detail.canGuess
    ? offers.flatMap(({ guess, label }) =>
        label === null
          ? []
          : [
              {
                key: `hilo-${guess}`,
                hotkey: HILO_KEYS[guess],
                label,
                isSelected: false,
                command: { kind: "play", action: { type: "hilo_guess", guess } } as const,
              },
            ],
      )
    : [];

  if (detail.canCashOut) {
    keys.push(cashOutKey("hilo", stake, detail.multiplier));
  }

  return keys;
}

function blackjackTurnKeys(detail: BlackjackView): KeyAction[] {
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

function playerTurnKeys(state: StateResponse): KeyAction[] {
  const round = state.round;

  switch (round?.detail.game) {
    case "blackjack":
      return blackjackTurnKeys(round.detail);
    case "mines":
      return minesTurnKeys(round.detail, round.stake);
    case "hilo":
      return hiloTurnKeys(round.detail, round.stake);
    case "tower":
      return towerTurnKeys(round.detail, round.stake);
    default:
      return [];
  }
}

const SLOTS_SPEED_KEYS: readonly { hotkey: string; speed: SlotsSpeed }[] = [
  { hotkey: "x", speed: "normal" },
  { hotkey: "f", speed: "fast" },
  { hotkey: "t", speed: "turbo" },
];

/** `j` and `k` around a choice: `<address>-down` and `<address>-up`, labelled "mines −" and "mines +". */
function stepKeys(address: string, command: (step: -1 | 1) => Command): KeyAction[] {
  const name = STEPPER_NAMES[address] ?? address;

  return [
    { key: `${address}-down`, hotkey: "j", label: `${name} −`, isSelected: false, command: command(-1) },
    { key: `${address}-up`, hotkey: "k", label: `${name} +`, isSelected: false, command: command(1) },
  ];
}

const settingKeys = (setting: Setting): KeyAction[] => stepKeys(setting, (step) => ({ kind: "step", setting, step }));

function choiceKeys(game: Game, prefs: Prefs): KeyAction[] {
  switch (game) {
    case "blackjack":
      return stepKeys("hands", (step) => ({ kind: "hands", step }));
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
    case "mines":
      return stepKeys("mines", (step) => ({ kind: "mines", step }));
    case "dice":
      return [
        ...settingKeys("dice"),
        {
          key: "dice-over",
          hotkey: "o",
          label: prefs.diceOver ? "roll over" : "roll under",
          isSelected: false,
          command: { kind: "dice-over" },
        },
      ];
    case "limbo":
      return settingKeys("limbo");
    case "flip":
      return [
        ...FLIP_SIDES.map((side) => ({
          key: `flip-${side}`,
          hotkey: side === "heads" ? "h" : "t",
          label: side,
          isSelected: prefs.flipSide === side,
          command: { kind: "flip-side", side } as const,
        })),
        ...settingKeys("flips"),
      ];
    case "keno":
      return [
        ...settingKeys("keno"),
        { key: "keno-random", hotkey: "r", label: "random picks", isSelected: false, command: { kind: "keno-random" } },
      ];
    case "wheel":
      return [
        ...settingKeys("wheel"),
        {
          key: "wheel-risk",
          hotkey: "r",
          label: `${prefs.wheelRisk} risk`,
          isSelected: false,
          command: { kind: "wheel-risk" },
        },
      ];
    case "hilo":
      return [];
    case "tower":
      return settingKeys("tower");
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

/** A click-only key: no hotkey, so no letter ever presses it. */
const clickKey = (key: string, label: string, isSelected: boolean, command: Command): KeyAction => ({
  key,
  hotkey: "",
  label,
  isSelected,
  command,
});

const THIRDS = [1, 2, 3] as const;

/** The roulette layout's cells a click bets on: every number, each dozen and each column. */
function rouletteLayoutKeys(chosen: RouletteBet): KeyAction[] {
  const pockets = Array.from({ length: ROULETTE_POCKETS }, (_, number) => number);

  return [
    ...pockets.map((number) =>
      clickKey(
        `${ROULETTE_STRAIGHT_KEY}${number}`,
        String(number),
        chosen.kind === "straight" && chosen.number === number,
        {
          kind: "roulette-bet",
          bet: { kind: "straight", number },
        },
      ),
    ),
    ...THIRDS.map((dozen) =>
      clickKey(`${ROULETTE_DOZEN_KEY}${dozen}`, `dozen ${dozen}`, chosen.kind === "dozen" && chosen.dozen === dozen, {
        kind: "roulette-bet",
        bet: { kind: "dozen", dozen },
      }),
    ),
    ...THIRDS.map((column) =>
      clickKey(
        `${ROULETTE_COLUMN_KEY}${column}`,
        `column ${column}`,
        chosen.kind === "column" && chosen.column === column,
        {
          kind: "roulette-bet",
          bet: { kind: "column", column },
        },
      ),
    ),
  ];
}

/**
 * The plan, and the keys only a click on the fullscreen table presses, while the next round's
 * choices can change: the forty Keno numbers, the roulette layout's numbers, dozens and columns.
 */
export function tableKeys(input: PlanInput): KeyAction[] {
  const keys = planKeys(input);

  if (keys.some((key) => key.key === "roulette-red")) {
    return [...keys, ...rouletteLayoutKeys(input.prefs.roulette)];
  }

  if (!keys.some((key) => key.key === "keno-random")) {
    return keys;
  }

  const picks = input.prefs.kenoPicks;
  const numbers = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1);

  return [
    ...keys,
    ...numbers.map((number) =>
      clickKey(`${KENO_PICK_KEY}${number}`, String(number), picks.includes(number), { kind: "keno-pick", number }),
    ),
  ];
}

/**
 * The round as it will be once the draw in flight lands, for the keys it will offer: a Mines
 * reveal, a tower climb or a Hilo card lands back on the player's turn (unless it busts), any
 * other draw settles the round.
 */
function afterDraw(round: RoundView): RoundView {
  const detail = round.detail;
  const turn = { ...round, phase: "player_turn" as const };

  switch (detail.game) {
    case "mines":
      return {
        ...turn,
        detail: { ...detail, canReveal: detail.nextMultiplier !== null, canCashOut: detail.revealed.length > 0 },
      };
    case "tower":
      return {
        ...turn,
        detail: { ...detail, canClimb: detail.nextMultiplier !== null, canCashOut: detail.climbed.length > 0 },
      };
    case "hilo":
      return { ...turn, detail: { ...detail, canGuess: true } };
    default:
      return { ...round, phase: "idle" };
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

  // A reveal, a climb or a card being drawn holds the board's keys, the ones mashed meanwhile
  // included: the keys the board offers once the draw lands, unless it busts.
  const settled = round?.phase !== "drawing" ? state : { ...state, round: afterDraw(round) };

  return planKeys({ state: { ...settled, pendingIntentId: null }, prefs, isBusy: false }).filter(
    (key) => key.command.kind !== "switch",
  );
}
