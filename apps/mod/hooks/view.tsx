// What the pane and the band draw, from the mod's state alone. No `$` here: the hooks module
// hands in the surface's elements and one callback for every key.
import type { RenderElement } from "claude-code";

import { blackjackOutcome, blackjackSummary, blackjackTable, handColumns, STILL, type TableFx } from "./blackjack";
import { type CardSize, faceDownCards, handCards, handRow, LARGE_CARD_ROWS } from "./cards";
import {
  cardFace,
  cardsInline,
  chipsTotal,
  cleanText,
  formatCountdown,
  formatDuration,
  formatSigned,
  formatUsdc,
  hundredths,
  rouletteBetLabel,
  rouletteWins,
  scaledDecimal,
  SEPARATOR,
} from "./format";
import { hiloRight, hiloTable, towerTable } from "./climb";
import {
  DICE_ROLL_MS,
  diceTable,
  flipMs,
  flipTable,
  isRoundShown,
  KENO_DRAW_MS,
  kenoTable,
  LIMBO_RISE_MS,
  limboTable,
  rollText,
  sentRound,
  WHEEL_SPIN_MS,
  wheelDisc,
  wheelRows,
  wheelTable,
} from "./quick";
import {
  baccaratOutcome,
  baccaratTable,
  minesBoardRows,
  minesTable,
  rouletteChip,
  rouletteRows,
  ROULETTE_SPIN_MS,
  rouletteTable,
  SLOTS_SPIN_MS,
  slotsOutcome,
  slotsTable,
  type TileButton,
} from "./games";
import {
  activeGame,
  clampHands,
  clampMines,
  type Command,
  currentBet,
  cursorBet,
  GAME_LABELS,
  heldKeys,
  type KeyAction,
  MINES_TILE_KEY,
  planKeys,
  type PlanInput,
  STEPPER_NAMES,
  stakeOn,
  tableKeys,
  tileLetter,
  TOWER_TILE_KEY,
} from "./keys";
import type { TiltKey, TiltSession } from "../types";
import type { AgentView, AuthView, IntentView, Prefs, RemoteView, SlotsSpeed } from "./model";
import type {
  DiceView,
  FlipView,
  Game,
  HiloView,
  KenoView,
  MinesView,
  RoundView,
  SponsorView,
  StateResponse,
  TowerView,
} from "./protocol";
import { FG1, FG4, FG6, GOLD, GREEN, INK, LINE3, LINE4, PINK, PINK_RULE, RED, toneOf, type Ui } from "./theme";

export interface Snapshot {
  auth: AuthView;
  remote: RemoteView;
  prefs: Prefs;
  intent: IntentView | null;
  echo: readonly TiltKey[];
  message: string | null;
  agent: AgentView;
  session: TiltSession;
  /** The person has made a first move: the first-hand guide stays hidden. */
  isOnboarded: boolean;
  /** Where to deposit, when the api named a page on its own site. */
  depositUrl: string | null;
  /** How far into its spin (a roll, a rise, a flip, a draw) the round on the table is; null once it landed. */
  spinElapsed: number | null;
  /** Blackjack or baccarat cards turned over so far, while new ones are being dealt; null when all show. */
  revealed: number | null;
  /** The balance before that round or those cards, shown while they play out; null otherwise. */
  heldBalance: string | null;
  /** How far into a win's celebration the table is, once its result shows; null when none plays. */
  celebrating: number | null;
}

/** How many times faster the reels turn at each slots speed; turbo shows the draw at once. */
const SLOTS_SPEEDUP: Record<SlotsSpeed, number> = { normal: 1, fast: 3, turbo: Infinity };

/**
 * How long a round spins on the table before it lands: the wheels and the reels, and the one-draw
 * games' roll, rise, coins or numbers. 0 for the games drawn still and turbo slots.
 */
export function spinMs(detail: RoundView["detail"], speed: SlotsSpeed): number {
  switch (detail.game) {
    case "roulette":
      return ROULETTE_SPIN_MS;
    case "wheel":
      return WHEEL_SPIN_MS;
    case "slots":
      return SLOTS_SPIN_MS / SLOTS_SPEEDUP[speed];
    case "dice":
      return DICE_ROLL_MS;
    case "limbo":
      return LIMBO_RISE_MS;
    case "flip":
      return flipMs(detail);
    case "keno":
      return KENO_DRAW_MS;
    default:
      return 0;
  }
}

/** While the chain draws, the reels keep turning: the first part of their spin, looped. */
const DRAWING_LOOP_MS = 500;

/**
 * How far into its spin the round is, `elapsed` after it showed (or landed) on the table, on the
 * spin's own clock (a fast spin runs it quicker); null once it rests. A round still drawing spins on
 * and on; the landing starts the spin's end afresh.
 */
export function spinProgress(round: RoundView, elapsed: number, speed: SlotsSpeed): number | null {
  if (round.phase === "drawing") {
    // A wheel turns on at full speed, around and around: it has no stop to loop back from.
    return round.detail.game === "slots" ? elapsed % DRAWING_LOOP_MS : elapsed;
  }

  if (elapsed >= spinMs(round.detail, speed)) {
    return null;
  }

  return round.detail.game === "slots" ? elapsed * SLOTS_SPEEDUP[speed] : elapsed;
}

export type OnCommand = (command: Command) => void;

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** Under this many body columns the sidebar (design: 260px, dropped under ~720px) goes below the game. */
const WIDE_MIN_COLUMNS = 90;
const SIDEBAR_COLUMNS = 32;
/** The sponsor and leaderboard column with its frame, under the header and over the footer. */
const SIDEBAR_MIN_ROWS = 22;
const LEADERBOARD_TOP = 3;
/** A win paying at least this many times the stake gets the banner and the share key. */
const BIG_WIN_MULTIPLE = 2n;
const HANDS_MAX = 6;
/** A roulette chip, beside the chip size and the cursor's cell. */
const CHIP_GLYPH = "●";
/** The roulette cursor's keys across the felt, drawn `«` and `»` outside its stepper's arrows. */
const ACROSS_KEYS = ["cursor-left", "cursor-right"] as const;
/** The steppers' keys: drawn as `◂ value ▸` rather than as two words on the key line. */
const STEP_KEYS = new Set([
  ...["bet", ...Object.keys(STEPPER_NAMES)].flatMap((address) => [`${address}-down`, `${address}-up`]),
  ...ACROSS_KEYS,
]);
/** Games whose paytables return up to the rtp the api sends, not exactly it (chain/…/games/keno.rs, limbo.rs). */
const RTP_AT_MOST: ReadonlySet<Game> = new Set(["keno", "limbo"]);
/** Where playButtons draws the echo of a settled move's key. */
const ECHO_PREFIX = "echo-";

export const spinnerGlyph = (frame: number): string => SPINNER[frame % SPINNER.length] ?? "⠋";

/** The round of `game` to show: the current or last one, if it was of that game. */
export function roundOf(state: StateResponse, game: Game): RoundView | null {
  return state.round?.detail.game === game ? state.round : null;
}

/**
 * The round the game in play's table shows: as `roundOf`, less a settled one-draw round whose
 * choices have changed since (`isRoundShown`), so nothing describes a result the table dropped.
 */
export function tableRound(state: StateResponse, prefs: Prefs): RoundView | null {
  const round = roundOf(state, activeGame(state, prefs));

  return round !== null && isRoundShown(round, prefs) ? round : null;
}

function keyButtons(ui: Ui, keys: readonly KeyAction[], onCommand: OnCommand): RenderElement[] {
  const { Button, Text } = ui;

  return keys.map((action) => (
    <Button key={action.key} plain hotkey={action.hotkey} onPress={() => onCommand(action.command)}>
      {action.key.startsWith(ROULETTE_KEY_PREFIX) ? (
        rouletteChip(ui, action.key.slice(ROULETTE_KEY_PREFIX.length), action.label, action.isSelected)
      ) : (
        <Text color={action.isSelected ? GOLD : undefined} bold={action.isSelected}>
          {action.label}
        </Text>
      )}
    </Button>
  ));
}

const ROULETTE_KEY_PREFIX = "roulette-";

/** Keys a press must not reach the prompt through: dim, at their own addresses, and inert. */
function inertButtons(ui: Ui, keys: readonly TiltKey[], scope: "held" | "echo"): RenderElement[] {
  const { Button, Text } = ui;

  return keys.map((action) => (
    <Button key={`${scope}-${action.key}`} plain dimColor hotkey={action.hotkey} onPress={() => undefined}>
      <Text dimColor>{action.label}</Text>
    </Button>
  ));
}

/** A play key drawn, live or inert, and whether it is a move (dealing, hitting), drawn as a keycap. */
interface PlayButton {
  key: string;
  element: RenderElement;
  isMove: boolean;
}

/** Moves: the round's own keys (deal or spin, hit, stand, double, split, guess, cash out); the rest set up the next one. */
const isMoveKey = (key: string): boolean =>
  key === "start" || key.startsWith("bj-") || key.startsWith("hilo-") || key.endsWith("-cashout");

/** The Mines or tower tile a play key presses, live, held or echoed; null for any other key. */
function tileOf(key: string): number | null {
  const address = key.startsWith(ECHO_PREFIX) ? key.slice(ECHO_PREFIX.length) : key;
  const prefix = [MINES_TILE_KEY, TOWER_TILE_KEY].find((start) => address.startsWith(start));

  return prefix === undefined ? null : Number(address.slice(prefix.length));
}

/**
 * The play keys (no game switches) to draw: the live ones, or else the ones a move in flight
 * holds; then the settled move's echo, on every letter nothing else takes.
 */
function playButtons(
  ui: Ui,
  input: PlanInput,
  keys: readonly KeyAction[],
  echo: readonly TiltKey[],
  onCommand: OnCommand,
): PlayButton[] {
  const live = keys.filter((action) => action.command.kind !== "switch");
  const held = live.length > 0 ? [] : heldKeys(input);
  const taken = new Set([...keys, ...held].map((action) => action.hotkey));
  const faded = echo.filter((action) => !taken.has(action.hotkey));
  const drawn = live.length > 0 ? keyButtons(ui, live, onCommand) : inertButtons(ui, held, "held");
  const drawnKeys = live.length > 0 ? live : held;

  return [
    ...drawn.map((element, index) => {
      const key = drawnKeys[index]?.key ?? "";

      return { key, element, isMove: isMoveKey(key) };
    }),
    ...inertButtons(ui, faded, "echo").map((element, index) => {
      const key = faded[index]?.key ?? "";

      return { key: `${ECHO_PREFIX}${key}`, element, isMove: isMoveKey(key) };
    }),
  ];
}

/** A move's key in a frame, as the design system's KeyButton. */
function keycap(ui: Ui, button: RenderElement): RenderElement {
  const { Box } = ui;

  return (
    <Box borderStyle="round" borderColor={LINE4} paddingX={1}>
      {button}
    </Box>
  );
}

/** The game tabs: the shown game on a pink chip, as the design system's GameTabs. */
function tabs(ui: Ui, keys: readonly KeyAction[], onCommand: OnCommand): RenderElement[] {
  const { Button, Text } = ui;

  return keys
    .filter((action) => action.command.kind === "switch")
    .map((action) => (
      <Button key={action.key} plain hotkey={action.hotkey} onPress={() => onCommand(action.command)}>
        {action.isSelected ? (
          <Text backgroundColor={PINK} color={INK} bold>
            {` ${action.label} `}
          </Text>
        ) : (
          <Text color={FG4}>{action.label}</Text>
        )}
      </Button>
    ));
}

/** A pink rule across the pane: where Tilt's header ends. */
export function pinkRule(ui: Ui, columns: number): RenderElement {
  const { Text } = ui;

  return <Text color={PINK_RULE}>{"─".repeat(Math.max(0, columns))}</Text>;
}

/** The header: the wordmark, the tabs, then the money, over a pink rule. */
function header(
  ui: Ui,
  snap: Snapshot,
  keys: readonly KeyAction[],
  onCommand: OnCommand,
  columns: number,
): RenderElement {
  const { Box, Text } = ui;
  const state = snap.remote.state;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingX={1}>
        <Text color={PINK} bold>
          TILT
        </Text>
        {state !== null && tabs(ui, keys, onCommand)}
        <Box flexGrow={1} />
        {state !== null && (
          <Text color={FG4}>
            balance{" "}
            <Text color={GOLD} bold>
              {formatUsdc(snap.heldBalance ?? state.balance)} USDC
            </Text>
            {state.rank !== null && (
              <Text>
                {"  rank "}
                <Text color={FG1} bold>{`#${state.rank}`}</Text>
              </Text>
            )}
          </Text>
        )}
      </Box>
      {pinkRule(ui, columns)}
    </Box>
  );
}

function agentLine(ui: Ui, agent: AgentView): RenderElement | null {
  const { Text } = ui;

  if (agent.notice !== null) {
    return <Text color={agent.notice.tone === "success" ? GREEN : FG4}>{agent.notice.text}</Text>;
  }

  if (agent.isWorking) {
    return (
      <Text color={FG4}>
        <Text color={GOLD}>{spinnerGlyph(agent.frame)}</Text> agent is working · your move
      </Text>
    );
  }

  return null;
}

/** A settled round in a sentence; "" where the drawing says it all. */
function outcomeText(round: RoundView): string {
  switch (round.detail.game) {
    case "blackjack":
      return blackjackOutcome(round.detail, round.net);
    case "roulette": {
      // The pocket is on the table already: the sentence says what it did to the chips.
      const { chips, number } = round.detail;
      const [only] = chips;

      if (chips.length === 1 && only !== undefined) {
        const bet = rouletteBetLabel(only.bet);

        return `${bet.charAt(0).toUpperCase()}${bet.slice(1)} ${BigInt(round.net) > 0n ? "wins" : "loses"}.`;
      }

      const won = number === null ? 0 : chips.filter((chip) => rouletteWins(chip.bet, number)).length;

      return won === 0 ? "No chip wins." : `${won} of ${chips.length} chips win.`;
    }
    case "baccarat":
      return baccaratOutcome(round.detail);
    case "slots":
      return round.detail.reels === null ? "" : slotsOutcome(round.detail.reels);
    case "mines":
      return minesOutcome(round.detail);
    case "dice":
      return diceOutcome(round.detail, round.net);
    case "limbo": {
      const { result, target } = round.detail;

      if (result === null) {
        return "";
      }

      return `×${result} ${hundredths(result) >= hundredths(target) ? "reaches" : "falls short of"} ×${target}.`;
    }
    case "flip":
      return flipOutcome(round.detail);
    case "keno":
      return kenoOutcome(round.detail);
    case "wheel": {
      const { segment, multipliers } = round.detail;

      return segment === null ? "" : `Landed on ×${multipliers[segment] ?? "0.00"}.`;
    }
    case "hilo":
      return hiloOutcome(round.detail);
    case "tower":
      return towerOutcome(round.detail);
  }
}

/** "Mine on c after 2 safe tiles.", or "Cashed out at ×1.2375 after 2 safe tiles." */
function minesOutcome(detail: MinesView): string {
  const safe = detail.revealed.length;
  const after = safe === 0 ? "" : ` after ${safe} safe ${safe === 1 ? "tile" : "tiles"}`;

  return detail.busted === null
    ? `Cashed out at ×${detail.multiplier}${after}.`
    : `Mine on ${tileLetter(detail.busted)}${after}.`;
}

/**
 * "Rolled 37.42: under 49.00 wins." A winning roll at ×1 (98% to win) gives the stake back: a
 * push, never a loss. Over wins from the target up, under below it (chain/…/games/dice.rs).
 */
function diceOutcome(detail: DiceView, net: string): string {
  const { roll, target, over } = detail;

  if (roll === null) {
    return "";
  }

  const isWon = over ? roll >= target : roll < target;
  const result = !isWon ? "loses" : BigInt(net) > 0n ? "wins" : `wins ×${detail.multiplier}, a push`;

  return `Rolled ${rollText(roll)}: ${over ? "over" : "under"} ${rollText(target)} ${result}.`;
}

/** "3 heads in a row.", or "Tails on coin 2 of 3." */
function flipOutcome(detail: FlipView): string {
  const results = detail.results ?? [];
  const miss = results.findIndex((side) => side !== detail.side);
  const side = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

  if (results.length === 0) {
    return "";
  }

  if (miss >= 0) {
    return `${side(results[miss] ?? "")} on coin ${miss + 1} of ${results.length}.`;
  }

  return results.length === 1 ? `${side(detail.side)}.` : `${results.length} ${detail.side} in a row.`;
}

/** "4 hits of 5 picks." */
function kenoOutcome(detail: KenoView): string {
  const picks = detail.picks.length;

  return detail.hits === null
    ? ""
    : `${detail.hits} ${detail.hits === 1 ? "hit" : "hits"} of ${picks} ${picks === 1 ? "pick" : "picks"}.`;
}

/** "Wrong guess after 3 right.", or "Cashed out at ×2.1123 after 3 right guesses." */
function hiloOutcome(detail: HiloView): string {
  const right = hiloRight(detail);

  return detail.busted
    ? `Wrong guess after ${right} right.`
    : `Cashed out at ×${detail.multiplier} after ${right} right ${right === 1 ? "guess" : "guesses"}.`;
}

/** "Fell on level 4.", "Cashed out at ×1.7422 on level 2.", or "Reached the top at ×12.9933." */
function towerOutcome(detail: TowerView): string {
  const level = detail.climbed.length;

  if (detail.busted !== null) {
    return `Fell on level ${level + 1}.`;
  }

  return level === detail.levels
    ? `Reached the top at ×${detail.multiplier}.`
    : `Cashed out at ×${detail.multiplier} on level ${level}.`;
}

/** A settled round's sentence and net; `shownNet` is what a count-up has reached so far. */
export function outcomeLine(ui: Ui, round: RoundView | null, shownNet?: string): RenderElement | null {
  const { Text } = ui;

  if (round === null || round.phase !== "idle") {
    return null;
  }

  const text = outcomeText(round);

  return (
    <Text color={FG4}>
      {text === "" ? "" : `${text} `}
      <Text color={toneOf(round.net)} bold>
        {formatSigned(shownNet ?? round.net)}
      </Text>
      {BigInt(round.fee) > 0n && <Text color={FG6}>{`${SEPARATOR}fee ${formatUsdc(round.fee)}`}</Text>}
    </Text>
  );
}

/**
 * The active game's table, `columns` wide; `fx` moves the blackjack cards and hands, `STILL` draws
 * them at rest. `wheel`: the Wheel's disc for the room the table has (`wheelDisc`). `tileButton`
 * is the Button a Mines or tower tile (or, where the terminal reports clicks, a Keno number or a
 * roulette cell) is pressed with, where this drawing has one.
 */
export function gameTable(
  ui: Ui,
  state: StateResponse,
  prefs: Prefs,
  columns: number,
  fx: TableFx,
  size: CardSize,
  wheel: number | null,
  tileButton: TileButton,
): RenderElement {
  const game = activeGame(state, prefs);
  const round = roundOf(state, game);

  switch (game) {
    case "blackjack":
      return blackjackTable(ui, round, fx, size);
    case "roulette":
      return rouletteTable(ui, round, prefs, columns, size, fx.spinElapsed, tileButton);
    case "baccarat":
      return baccaratTable(ui, round, prefs, size, fx.revealed);
    case "slots":
      return slotsTable(ui, round, size, fx.spinElapsed);
    case "mines":
      return minesTable(ui, round, prefs, fx.frame, size, tileButton);
    case "dice":
      return diceTable(ui, round, prefs, fx.spinElapsed);
    case "limbo":
      return limboTable(ui, round, prefs, fx.spinElapsed);
    case "flip":
      return flipTable(ui, round, prefs, fx.spinElapsed);
    case "keno":
      return kenoTable(ui, round, prefs, fx.spinElapsed, tileButton);
    case "wheel":
      return wheelTable(ui, round, prefs, wheel, fx.spinElapsed);
    case "hilo":
      return hiloTable(ui, round, fx, size);
    case "tower":
      return towerTable(ui, round, prefs, fx.frame, size, tileButton);
  }
}

/** What a deal in flight draws face down until the chain's cards come in: two cards a hand. */
const FACE_DOWN = faceDownCards(2);

/**
 * A blackjack deal sent and not on the table yet: the dealer and each hand get their two cards
 * face down. Nothing about them is known; the cards turn over as the chain's state shows them.
 */
export function dealingTable(ui: Ui, hands: number, size: CardSize): RenderElement {
  const { Box, Text } = ui;
  const faceDown = { faceDown: FACE_DOWN.length };

  return (
    <Box flexDirection="column" gap={1}>
      {handRow(ui, { label: "DEALER", total: "", tag: null }, handCards(ui, FACE_DOWN, size, faceDown), size)}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {Array.from({ length: hands }, (_, index) => (
          <Box flexDirection="column" minWidth={20}>
            <Text color={FG4}>{hands === 1 ? "YOU" : `#${index + 1}`}</Text>
            {handCards(ui, FACE_DOWN, size, faceDown)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** The one-draw round a start in flight opens (`sentRound`), drawn until the chain's shows; null when none is in flight. */
export function sendingRound(snap: Pick<Snapshot, "intent" | "remote">): RoundView | null {
  const action = snap.intent?.action;

  return action === undefined ? null : sentRound(action, snap.remote.state?.round ?? null);
}

/** The hands a blackjack deal in flight asked for; null when no deal is in flight. */
export function dealingHands(snap: Pick<Snapshot, "intent">): number | null {
  const action = snap.intent?.action;

  return action?.type === "blackjack_bet" ? clampHands(action.hands) : null;
}

/** The last round, when it was a win of at least twice the stake. */
export function bigWinOf(state: StateResponse): { net: string; game: Game } | null {
  const round = state.round;

  if (round === null || round.phase !== "idle") {
    return null;
  }

  const net = BigInt(round.net);

  return net > 0n && net >= BigInt(round.stake) * BIG_WIN_MULTIPLE ? { net: round.net, game: round.detail.game } : null;
}

/** A win sparkles this long once its result shows; a big win sets off fireworks for longer. */
const SPARKLES_MS = 1_600;
const FIREWORKS_MS = 2_800;
const SPARKLE_FRAME_MS = 100;
const SPARKLE_GLYPHS = ["✦", "✧", "⋆", "·", "*"];
/** Per thousand cells lit when a celebration starts; it thins out to none. */
const SPARKLE_DENSITY = 180;
const FIREWORK_ROWS = 3;
const BURSTS = 3;
const BURST_STAGGER_MS = 450;
const BURST_LIFE_MS = 900;
/** A burst's ring grows one cell this often. */
const BURST_CELL_MS = 70;
/** A burst's glyph as it ages: bright, then fading. */
const BURST_GLYPHS = ["✺", "✹", "*", "·"];

/** How long a settled round celebrates: none for a loss or a push. */
export function celebrationMs(round: RoundView): number {
  const net = BigInt(round.net);

  if (net <= 0n) {
    return 0;
  }

  return net >= BigInt(round.stake) * BIG_WIN_MULTIPLE ? FIREWORKS_MS : SPARKLES_MS;
}

/** A cheap, stable scramble of three small integers: the same frame draws the same sparkles. */
function scramble(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374_761_393) ^ Math.imul(b, 668_265_263) ^ Math.imul(c, 2_246_822_519);

  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);

  return (h ^ (h >>> 16)) >>> 0;
}

type Spark = { glyph: string; color: string } | null;

/** The cells of a celebration `elapsed` into it: sparkles thinning out, and on a big win bursts opening one after another. */
function celebrationCells(round: RoundView, elapsed: number, columns: number): Spark[][] {
  const total = celebrationMs(round);
  const isBig = total === FIREWORKS_MS;
  const rows = isBig ? FIREWORK_ROWS : 1;
  const colors = [GOLD, PINK, GREEN, FG1];
  const frame = Math.floor(elapsed / SPARKLE_FRAME_MS);
  const density = Math.round(SPARKLE_DENSITY * (1 - elapsed / total));
  const cells: Spark[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const roll = scramble(frame, row, column);

      return roll % 1000 < density
        ? {
            glyph: SPARKLE_GLYPHS[roll % SPARKLE_GLYPHS.length] ?? "·",
            color: colors[(roll >>> 10) % colors.length] ?? GOLD,
          }
        : null;
    }),
  );

  if (!isBig) {
    return cells;
  }

  for (let burst = 0; burst < BURSTS; burst += 1) {
    const age = elapsed - burst * BURST_STAGGER_MS;

    if (age < 0 || age >= BURST_LIFE_MS) {
      continue;
    }

    const center = Math.floor(((burst * 2 + 1) * columns) / (BURSTS * 2));
    const reach = Math.floor(age / BURST_CELL_MS);
    const spark = {
      glyph: BURST_GLYPHS[Math.floor((age / BURST_LIFE_MS) * BURST_GLYPHS.length)] ?? "·",
      color: colors[burst % colors.length] ?? GOLD,
    };
    // A cell is twice as tall as it is wide: the rows above and below take a ring narrower by half a row's height.
    const ring: [number, number][] = [
      [1, reach],
      [0, Math.floor(reach * 0.85)],
      [2, Math.floor(reach * 0.85)],
    ];

    for (const [row, offset] of ring) {
      for (const column of [center - offset, center + offset]) {
        const line = cells[row];

        if (line !== undefined && column >= 0 && column < columns && (row === 1 || reach >= 2)) {
          line[column] = spark;
        }
      }
    }
  }

  return cells;
}

/** A win's sparkles, or a big win's fireworks, across `columns`; null when no celebration plays. */
export function celebration(
  ui: Ui,
  round: RoundView | null,
  elapsed: number | null,
  columns: number,
): RenderElement | null {
  const { Box, Text } = ui;

  if (round === null || elapsed === null || elapsed < 0 || elapsed >= celebrationMs(round) || columns < 1) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {celebrationCells(round, elapsed, columns).map((line, row) => (
        <Text key={`sparkles-${row}`} wrap="truncate">
          {line.map((cell, column) =>
            cell === null ? (
              " "
            ) : (
              <Text key={`spark-${column}`} color={cell.color} bold>
                {cell.glyph}
              </Text>
            ),
          )}
        </Text>
      ))}
    </Box>
  );
}

/** The big-win banner, as the design system's WinCard: the win, its sponsor, and a key to share it. */
function winBanner(ui: Ui, state: StateResponse, onCommand: OnCommand): RenderElement | null {
  const { Box, Button, Text } = ui;
  const win = bigWinOf(state);

  if (win === null) {
    return null;
  }

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} borderStyle="round" borderColor={GOLD} paddingX={1}>
      <Text color={GOLD} bold>
        {`★ BIG WIN +${formatUsdc(win.net)} USDC`}
      </Text>
      <Text color={FG4}>
        {`on ${GAME_LABELS[win.game].toLowerCase()}`}
        {state.sponsor !== null && (
          <Text>
            {`${SEPARATOR}presented by `}
            <Text color={FG1} bold>
              {cleanText(state.sponsor.name)}
            </Text>
          </Text>
        )}
      </Text>
      <Box flexGrow={1} />
      <Button key="share" plain hotkey="w" onPress={() => onCommand({ kind: "share" })}>
        <Text color={FG1}>copy to share</Text>
      </Button>
    </Box>
  );
}

/** The first-hand guide: how to give Tilt the keys and deal, until the person makes a first move. */
function firstHandGuide(ui: Ui, isFocused: boolean): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box borderStyle="round" borderColor={GOLD} paddingX={1} marginBottom={1}>
      <Text color={FG4}>
        <Text color={GOLD} bold>
          First hand?{" "}
        </Text>
        {isFocused ? (
          <Text>
            Tilt has the keys: press{" "}
            <Text color={GOLD} bold>
              n
            </Text>{" "}
            to deal,{" "}
            <Text color={GOLD} bold>
              esc
            </Text>{" "}
            to hand them back.
          </Text>
        ) : (
          <Text>
            Press{" "}
            <Text color={GOLD} bold>
              ctrl+x tab
            </Text>{" "}
            to give Tilt the keys, then{" "}
            <Text color={GOLD} bold>
              n
            </Text>{" "}
            to deal.
          </Text>
        )}{" "}
        Your agent keeps working meanwhile.
      </Text>
    </Box>
  );
}

/** The bet a press of n stakes in all: the bet per hand, times the hands at blackjack; the chips on the table at roulette. */
function totalStake(state: StateResponse, prefs: Prefs): bigint {
  const bet = BigInt(currentBet(state.limits, prefs.betIndex));

  switch (activeGame(state, prefs)) {
    case "blackjack":
      return bet * BigInt(clampHands(prefs.hands));
    case "roulette":
      return chipsTotal(prefs.rouletteChips);
    default:
      return bet;
  }
}

/** Said before n is pressed: the balance does not cover the bet. Points to a lower bet or a deposit. */
function lowBalanceLine(ui: Ui, snap: Snapshot, state: StateResponse): RenderElement | null {
  const { Box, Link, Text } = ui;
  const isIdle = state.round === null || state.round.phase === "idle";

  if (!state.accountOpen || !isIdle || BigInt(state.balance) >= totalStake(state, snap.prefs)) {
    return null;
  }

  const lower =
    activeGame(state, snap.prefs) === "roulette"
      ? "Balance too low for these chips · take some off with u or q"
      : "Balance too low for this bet · lower it with v";

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text color={RED}>{lower}</Text>
      {snap.depositUrl !== null && <Text color={FG6}>or</Text>}
      {snap.depositUrl !== null && <Link href={snap.depositUrl} label="deposit on the web" />}
    </Box>
  );
}

/** One line on what is in flight or went wrong; null when there is nothing to say. */
function statusLine(ui: Ui, snap: Snapshot, state: StateResponse): RenderElement | null {
  const { Text } = ui;
  const spinner = spinnerGlyph(snap.agent.frame);

  if (snap.intent?.status === "retrying") {
    return <Text color={FG4}>{`${spinner} reconnecting · your move is kept and will be resent`}</Text>;
  }

  if (snap.intent !== null) {
    return <Text color={FG4}>{`${spinner} sending your move`}</Text>;
  }

  if (state.round?.phase === "drawing") {
    return <Text color={FG4}>{`${spinner} drawing`}</Text>;
  }

  // A move sent before a restart, or from another session: the keys stay off until it settles.
  if (state.pendingIntentId !== null) {
    return <Text color={FG4}>{`${spinner} previous move still settling`}</Text>;
  }

  if (snap.message !== null) {
    return <Text color={RED}>{snap.message}</Text>;
  }

  if (snap.remote.error !== null) {
    return <Text color={FG6}>{snap.remote.error}</Text>;
  }

  return null;
}

function sponsorBlock(ui: Ui, sponsor: SponsorView, now: number): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column">
      <Text color={FG6}>
        PRESENTED BY <Text dimColor>· sponsored</Text>
      </Text>
      <Text color={FG1} bold>
        {cleanText(sponsor.name)}
      </Text>
      {sponsor.tagline !== null && <Text color={FG4}>{cleanText(sponsor.tagline)}</Text>}
      <Text color={FG4}>
        pool{" "}
        <Text color={GOLD} bold>
          {formatUsdc(sponsor.pool)} USDC
        </Text>
      </Text>
      <Text color={FG6}>ends in {formatCountdown(Date.parse(sponsor.endsAt) - now)}</Text>
    </Box>
  );
}

function sponsorLine(ui: Ui, sponsor: SponsorView, now: number): RenderElement {
  const { Text } = ui;

  return (
    <Text color={FG6} wrap="truncate-end">
      PRESENTED BY{" "}
      <Text color={FG1} bold>
        {cleanText(sponsor.name)}
      </Text>
      {`${SEPARATOR}sponsored${SEPARATOR}pool `}
      <Text color={GOLD}>{formatUsdc(sponsor.pool)} USDC</Text>
      {`${SEPARATOR}ends in ${formatCountdown(Date.parse(sponsor.endsAt) - now)}`}
    </Text>
  );
}

function leaderboard(ui: Ui, state: StateResponse): RenderElement {
  const { Box, Text } = ui;
  const ranked = [...state.leaderboard].sort((a, b) => a.rank - b.rank);
  const top = ranked.slice(0, LEADERBOARD_TOP);
  const you = ranked.find((entry) => entry.isYou && !top.includes(entry));
  const row = (entry: (typeof ranked)[number], handle: string) => (
    <Box flexDirection="row" columnGap={1}>
      <Box width={5}>
        <Text color={entry.isYou ? PINK : FG6}>{String(entry.rank)}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={entry.isYou ? PINK : FG4} wrap="truncate-end">
          {handle}
        </Text>
      </Box>
      <Text color={entry.isYou ? GOLD : FG4}>{formatSigned(entry.net)}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column">
      <Text color={FG6}>LEADERBOARD</Text>
      {top.length === 0 && <Text color={FG6}>no one yet</Text>}
      {top.map((entry) => row(entry, cleanText(entry.handle)))}
      {you !== undefined && <Text color={LINE4}> ⋮</Text>}
      {you !== undefined && row(you, "you")}
      {aheadLine(ui, state)}
    </Box>
  );
}

const BASE_UNITS_PER_CENT = 10_000n;

const roundUpToCent = (units: bigint): bigint =>
  ((units + BASE_UNITS_PER_CENT - 1n) / BASE_UNITS_PER_CENT) * BASE_UNITS_PER_CENT;

/** How far the player is from the next rank up: a reason to play one more hand, no countdown pressure. */
function aheadLine(ui: Ui, state: StateResponse): RenderElement | null {
  const { Text } = ui;
  const you = state.leaderboard.find((entry) => entry.isYou);
  const ahead = state.ahead;

  if (you === undefined || ahead === undefined || ahead === null) {
    return null;
  }

  // One base unit more than the gap passes them; shown in cents, rounded up so the amount shown does.
  const gap = roundUpToCent(BigInt(ahead.net) - BigInt(you.net) + 1n);

  return (
    <Text color={FG6} wrap="truncate-end">
      <Text color={GOLD}>{`+${formatUsdc(gap.toString())}`}</Text>
      {` to pass ${cleanText(ahead.handle)} (#${ahead.rank})`}
    </Text>
  );
}

/** This session's play as the mod saw it settle: "session +2.30 · 14 rounds · 22m". */
function sessionText(ui: Ui, session: TiltSession, now: number): RenderElement | null {
  const { Text } = ui;

  if (session.rounds === 0 || session.startedAt === null) {
    return null;
  }

  const rounds = `${session.rounds} ${session.rounds === 1 ? "round" : "rounds"}`;

  return (
    <Text color={FG6}>
      {"session "}
      <Text color={toneOf(session.net)} bold>
        {formatSigned(session.net)}
      </Text>
      {`${SEPARATOR}${rounds}${SEPARATOR}${formatDuration(Math.max(0, now - session.startedAt))}`}
    </Text>
  );
}

/** The session and the odds on the left; on the right, how to give the pane the keys while it does not hold them. */
function footer(ui: Ui, snap: Snapshot, state: StateResponse, game: Game, isFocused: boolean): RenderElement {
  const { Box, Text } = ui;
  const rtp = `${RTP_AT_MOST.has(game) ? "≤ " : ""}${cleanText(state.rtp[game])}`;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingX={1}>
      {/* The session's net counts the round in play: it waits for the wheel, the reels or the last card too. */}
      {snap.spinElapsed === null && snap.revealed === null && sessionText(ui, snap.session, snap.remote.fetchedAt)}
      <Text color={FG6}>{`rtp ${rtp}% · 1% fee on wins`}</Text>
      <Box flexGrow={1} />
      {isFocused ? (
        <Text color={FG6}>esc hands the keys back</Text>
      ) : (
        <Text color={FG6}>
          <Text color={GOLD} bold>
            ctrl+x tab
          </Text>{" "}
          to use keys
        </Text>
      )}
    </Box>
  );
}

/** One stepper: `v ◂ bet 0.50 ▸ b`, its two keys from the plan around the value; `far`, two
 *  more keys outside them (`f « s ◂ on number 17 ▸ d » h`). */
function stepper(
  ui: Ui,
  [down, up]: readonly [KeyAction, KeyAction],
  far: readonly [KeyAction, KeyAction] | null,
  value: RenderElement,
  onCommand: OnCommand,
): RenderElement {
  const { Box, Button, Text } = ui;
  const arrow = (action: KeyAction, glyph: string) => (
    <Button key={action.key} plain hotkey={action.hotkey} onPress={() => onCommand(action.command)}>
      <Text color={FG1}>{glyph}</Text>
    </Button>
  );

  return (
    <Box flexDirection="row" columnGap={1}>
      {far !== null && arrow(far[0], "«")}
      {arrow(down, "◂")}
      {value}
      {arrow(up, "▸")}
      {far !== null && arrow(far[1], "»")}
    </Box>
  );
}

/** What each stepper shows between its arrows, by its keys' address; the game's choices read from `prefs`. */
function stepperValue(ui: Ui, address: string, state: StateResponse, prefs: Prefs): RenderElement | null {
  const { Text } = ui;
  const chosen = (value: string, after = "", before = "") => (
    <Text color={FG4}>
      {before}
      <Text color={PINK} bold>
        {value}
      </Text>
      {after}
    </Text>
  );
  const hands = clampHands(prefs.hands);
  const mines = clampMines(prefs.mines);

  switch (address) {
    case "bet":
      return (
        <Text color={FG4}>
          {activeGame(state, prefs) === "roulette" ? `chip ${CHIP_GLYPH}` : "bet"}{" "}
          <Text color={GOLD} bold>
            {formatUsdc(currentBet(state.limits, prefs.betIndex))}
          </Text>
        </Text>
      );
    case "cursor": {
      const cell = cursorBet(prefs.rouletteCursor);
      const stake = stakeOn(prefs.rouletteChips, cell);

      return chosen(rouletteBetLabel(cell), stake > 0n ? ` ${CHIP_GLYPH}${formatUsdc(stake.toString())}` : "", "on ");
    }
    case "hands":
      return (
        <Text color={FG4}>
          <Text color={PINK}>{"●".repeat(hands)}</Text>
          <Text color={LINE4}>{"○".repeat(HANDS_MAX - hands)}</Text>
          {` ${hands} ${hands === 1 ? "hand" : "hands"}`}
        </Text>
      );
    case "mines":
      return chosen(String(mines), ` ${mines === 1 ? "mine" : "mines"}`);
    case "dice":
      return chosen(`${scaledDecimal(BigInt(prefs.diceChance), 2)}%`, "", "win chance ");
    case "limbo":
      return chosen(`×${scaledDecimal(BigInt(prefs.limboTarget), 2)}`, "", "target ");
    case "flips":
      return chosen(String(prefs.flips), ` ${prefs.flips === 1 ? "coin" : "coins"}`);
    case "keno":
      return chosen(String(prefs.kenoPicks.length), ` ${prefs.kenoPicks.length === 1 ? "pick" : "picks"}`);
    case "wheel":
      return chosen(String(prefs.wheelSegments), " segments");
    case "tower":
      return chosen(prefs.towerDifficulty);
    default:
      return null;
  }
}

/** The bet and the game's own choice (hands, mines, dice chance…) as steppers; none when their keys are not live. */
function steppers(ui: Ui, state: StateResponse, prefs: Prefs, keys: readonly KeyAction[], onCommand: OnCommand) {
  const find = (key: string) => keys.find((action) => action.key === key);
  const [left, right] = ACROSS_KEYS.map(find);
  const across = left !== undefined && right !== undefined ? ([left, right] as const) : null;

  return ["bet", ...Object.keys(STEPPER_NAMES)].flatMap((address) => {
    const down = find(`${address}-down`);
    const up = find(`${address}-up`);
    const value = stepperValue(ui, address, state, prefs);

    return down === undefined || up === undefined || value === null
      ? []
      : [stepper(ui, [down, up], address === "cursor" ? across : null, value, onCommand)];
  });
}

/**
 * The play keys: the moves as keycaps, the steppers, then the rest (roulette and baccarat picks) on
 * a line; a row above them, unless they come `isFirst`, where every row counts.
 */
function keyArea(
  ui: Ui,
  buttons: readonly PlayButton[],
  hasCaps: boolean,
  steps: readonly RenderElement[],
  isFirst = false,
): RenderElement {
  const { Box } = ui;
  const gap = isFirst ? 0 : 1;
  const isStepDrawn = steps.length > 0;
  const shown = buttons.filter((button) => !(isStepDrawn && STEP_KEYS.has(button.key)));
  const moves = shown.filter((button) => button.isMove).map((button) => button.element);
  const setup = [...steps, ...shown.filter((button) => !button.isMove).map((button) => button.element)];

  if (!hasCaps) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={3} marginTop={gap}>
        {[...moves, ...setup]}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={gap}>
      {setup.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {setup}
        </Box>
      )}
      {moves.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {moves.map((move) => keycap(ui, move))}
        </Box>
      )}
    </Box>
  );
}

/** Everything the pane or band says before there is a game to show. */
function preamble(ui: Ui, snap: Snapshot): RenderElement | null {
  const { Box, Link, Text } = ui;
  const { auth, remote } = snap;

  if (auth.status === "out") {
    return (
      <Box flexDirection="column">
        <Text color={FG4}>
          Run <Text color={GOLD}>/tilt login</Text> to play while your agent works.
        </Text>
        {auth.message !== null && <Text color={FG6}>{auth.message}</Text>}
      </Box>
    );
  }

  if (auth.status === "pending") {
    return (
      <Box flexDirection="column">
        <Text color={FG4}>
          Confirm code <Text color={GOLD}>{cleanText(auth.userCode)}</Text> in your browser · waiting
        </Text>
        <Link href={auth.verifyUrl} label="open the login page" />
      </Box>
    );
  }

  if (remote.state === null) {
    return <Text color={FG6}>{remote.error ?? "loading"}</Text>;
  }

  if (!remote.state.accountOpen) {
    return (
      <Box flexDirection="column">
        <Text color={FG4}>No Tilt account yet · make a first deposit on the web to open one.</Text>
        {snap.depositUrl !== null && <Link href={snap.depositUrl} label="deposit on the web" />}
      </Box>
    );
  }

  return null;
}

export interface PaneLayout {
  bodyColumns: number;
  /** The rows the pane (or the band, drawing the table) has: past them, the table scrolls. */
  bodyRows: number;
  isFocused: boolean;
  /** The cards the person asked for: large ones give way to small ones where they would not fit. */
  cards: CardSize;
  /** The surface reports clicks (not the terminal's main screen): the still table's roulette cells
   *  and Keno numbers are Buttons. */
  isClickable: boolean;
}

/** Everything around the table: header, agent line, outcome, status, keys and footer. */
const CHROME_ROWS = 16;
/** The first-hand guide in its frame, and its margin. */
const GUIDE_ROWS = 4;
/** The big-win banner in its frame. */
const BANNER_ROWS = 3;
const NARROW_EXTRA_ROWS = 2;

/** The rows a blackjack table takes: the dealer over hands of these card counts, wrapped to `columns`. */
function blackjackRows(handCards: readonly number[], size: CardSize, columns: number): number {
  const cardRows = size === "large" ? LARGE_CARD_ROWS : 1;
  const widest = Math.max(...handCards.map((count) => handColumns(count, size)));
  const perRow = Math.max(1, Math.floor((columns + 2) / (widest + 2)));
  const handRows = Math.ceil(handCards.length / perRow);
  const dealerRows = size === "large" ? 1 + cardRows : 1;

  return dealerRows + 1 + handRows * (cardRows + 2) + (handRows - 1);
}

/**
 * The rows the active game's table takes with cards at `size`, in `columns`, the Wheel drawn as
 * `wheel`; a deal in flight is its face-down hands.
 */
function tableRows(
  state: StateResponse,
  prefs: Prefs,
  dealing: number | null,
  size: CardSize,
  columns: number,
  wheel: number | null,
): number {
  const game = activeGame(state, prefs);
  const detail = roundOf(state, game)?.detail;
  const cardRows = size === "large" ? LARGE_CARD_ROWS : 1;

  if (dealing !== null) {
    return blackjackRows(
      Array.from({ length: dealing }, () => FACE_DOWN.length),
      size,
      columns,
    );
  }

  // Every table is drawn before its game's first round too: the board, the layout, the reels.
  switch (game) {
    case "blackjack":
      return detail?.game === "blackjack"
        ? blackjackRows(
            detail.hands.map((hand) => hand.cards.length),
            size,
            columns,
          )
        : 1;
    case "baccarat":
      return detail?.game === "baccarat" ? 2 + (size === "large" ? 1 + cardRows : 2) : 3;
    case "roulette":
      // And the line under it: the table's prompt, or how to bet with keys.
      return rouletteRows(size) + 1;
    case "slots":
      return size === "large" ? 5 : 3;
    case "mines":
      return minesBoardRows(size);
    case "dice":
      return 4;
    case "limbo":
      return 3;
    case "flip":
      return 3;
    case "keno":
      // Five rows of numbers, a line of what each hit count pays.
      return 7;
    case "wheel":
      return wheelRows(wheel);
    case "hilo":
      // The cards and their history beside the multiplier, whose turn, the guesses, the cash-out and the
      // right guesses; before any, a line on how to play.
      return detail?.game === "hilo" ? Math.max((size === "large" ? cardRows : 1) + 1, 7) : 2;
    case "tower":
      return 9;
  }
}

/** The sponsor and leaderboard get their own column where the pane is wide and tall enough; else a line. */
const sidebarFits = (layout: PaneLayout): boolean =>
  layout.bodyColumns >= WIDE_MIN_COLUMNS && layout.bodyRows >= SIDEBAR_MIN_ROWS;

/** The cells the game column has: the pane less its padding, and less the sidebar where it fits. */
function gameColumns(layout: PaneLayout): number {
  return sidebarFits(layout) ? layout.bodyColumns - SIDEBAR_COLUMNS - 3 : layout.bodyColumns - 2;
}

/** The rows the pane takes around its table: chrome, and what shows only now (guide, banner, warnings). */
function aroundRows(snap: Snapshot, state: StateResponse, layout: PaneLayout): number {
  const isIdle = state.round === null || state.round.phase === "idle";
  const isLow = state.accountOpen && isIdle && BigInt(state.balance) < totalStake(state, snap.prefs);
  const now =
    (snap.isOnboarded ? 0 : GUIDE_ROWS) +
    (bigWinOf(state) === null ? 0 : BANNER_ROWS) +
    (isLow ? 1 : 0) +
    (state.blocked === null ? 0 : 1);

  return CHROME_ROWS + (sidebarFits(layout) ? 0 : NARROW_EXTRA_ROWS) + now;
}

/** The Wheel's disc: the biggest that fits the columns and rows the pane leaves its table. */
const wheelIn = (snap: Snapshot, state: StateResponse, layout: PaneLayout): number | null =>
  wheelDisc(gameColumns(layout), layout.bodyRows - aroundRows(snap, state, layout));

/** The rows the whole pane takes with cards at `size`: what is around the table, then the table. */
function paneRows(snap: Snapshot, state: StateResponse, layout: PaneLayout, size: CardSize): number {
  return (
    aroundRows(snap, state, layout) +
    tableRows(state, snap.prefs, dealingHands(snap), size, gameColumns(layout), wheelIn(snap, state, layout))
  );
}

/** The card size the pane draws: the one asked for, or small where large ones would not fit. */
function cardSizeFor(snap: Snapshot, state: StateResponse, layout: PaneLayout): CardSize {
  return layout.cards === "large" && paneRows(snap, state, layout, "large") <= layout.bodyRows ? "large" : "small";
}

/** A still table's roulette cell or Keno number Button: its key's address under this prefix, as on the table surface module. */
const TABLE_CELL_PREFIX = "table-";

/**
 * Under the still roulette layout, while chips can be placed: click it, where clicks land; else
 * the keys that place them (the main screen reports no clicks).
 */
function layoutHint(ui: Ui, keys: readonly KeyAction[], isClickable: boolean): RenderElement | null {
  const { Text } = ui;

  if (!keys.some((key) => key.key === "chip-add")) {
    return null;
  }

  return isClickable ? (
    <Text color={GOLD} bold>
      click the layout to add a chip
    </Text>
  ) : (
    <Text color={FG6}>
      <Text color={GOLD} bold>
        a
      </Text>
      {": chip under the cursor · s d step it, f h across · r k o e l g outside bets"}
    </Text>
  );
}

/** The rows a pane asks for when it opens, at the card size the person chose. */
export const PANE_ROWS: Record<CardSize, number> = { large: 30, small: 20 };

/**
 * `table` is the table surface module's region (fullscreen terminal), drawn in place of the still
 * table at a card size, `columns` wide, the Wheel drawn as `wheel`.
 */
export function renderPane(
  ui: Ui,
  snap: Snapshot,
  layout: PaneLayout,
  onCommand: OnCommand,
  table: ((size: CardSize, columns: number, wheel: number | null) => RenderElement) | null,
): RenderElement {
  const { Box, Button, Text } = ui;
  const state = snap.remote.state;
  const keys = state === null ? [] : planKeys({ state, prefs: snap.prefs, isBusy: snap.intent !== null });
  const intro = preamble(ui, snap);
  // The engine frames the pane: the brand sits on the header bar, not on a second border. `gap`:
  // the row under the header, left out where the keys come first.
  const frame = (body: RenderElement | null, foot: RenderElement | null = null, gap = 1) => (
    <Box flexDirection="column">
      {header(ui, snap, keys, onCommand, layout.bodyColumns)}
      <Box flexDirection="column" paddingX={1} marginTop={gap}>
        {agentLine(ui, snap.agent)}
        {body}
      </Box>
      {foot}
    </Box>
  );

  if (intro !== null || state === null) {
    return frame(intro);
  }

  const game = activeGame(state, snap.prefs);
  const size = cardSizeFor(snap, state, layout);
  const wheel = wheelIn(snap, state, layout);
  // Where even small cards overflow (the band at the bottom of a short terminal), the keys come
  // first, so the ones to press are always in view and the table scrolls instead.
  const isKeysFirst = paneRows(snap, state, layout, size) > layout.bodyRows;
  const input = { state, prefs: snap.prefs, isBusy: snap.intent !== null };
  const plays = playButtons(ui, input, keys, snap.echo, onCommand);
  const dealing = dealingHands(snap);
  const sending = sendingRound(snap);
  // Drawn here, the Mines board and the tower are their own keys: each hidden tile is the Button of
  // its key, live or held, and the key line leaves those out. A key of a tile shown since stays on the line.
  const board = roundOf(state, game)?.detail;
  const shownTiles = new Set(
    board?.game === "mines"
      ? [...board.revealed, board.pending, board.busted]
      : board?.game === "tower"
        ? [board.pending, board.busted]
        : [],
  );
  const tileElements = new Map<number, RenderElement>();
  const hasBoard = game === "mines" || game === "tower";
  const linePlays = plays.filter((button) => {
    const tile = tileOf(button.key);

    if (table !== null || dealing !== null || !hasBoard || tile === null || shownTiles.has(tile)) {
      return true;
    }

    tileElements.set(tile, button.element);

    return false;
  });
  // Where clicks land, the still table's roulette cells and Keno numbers are Buttons too: each runs
  // the command of the key the plan offers at its address now, so a click does what that key does.
  const clickable = layout.isClickable && table === null ? tableKeys(input) : [];
  const cellButton = (address: string, face: RenderElement): RenderElement | null => {
    const tile = tileOf(address);

    if (tile !== null) {
      return tileElements.get(tile) ?? null;
    }

    const action = clickable.find((key) => key.key === address);

    return action === undefined ? null : (
      <Button key={`${TABLE_CELL_PREFIX}${address}`} plain onPress={() => onCommand(action.command)}>
        {face}
      </Button>
    );
  };
  const steps = steppers(ui, state, snap.prefs, keys, onCommand);
  const side = state.sponsor !== null || state.leaderboard.length > 0;
  const canPlay = state.accountOpen && state.blocked === null;
  // The table surface module draws a deal in flight itself: swapped out, it would lose the keys a
  // click gave it, and deal the hands all at once when they show.
  const shownTable =
    table !== null
      ? table(size, gameColumns(layout), wheel)
      : dealing !== null
        ? dealingTable(ui, dealing, size)
        : gameTable(
            ui,
            sending === null ? state : { ...state, round: sending },
            snap.prefs,
            gameColumns(layout),
            { ...STILL, spinElapsed: snap.spinElapsed, revealed: snap.revealed, frame: snap.agent.frame },
            size,
            wheel,
            cellButton,
          );
  const gameColumn = (
    <Box flexDirection="column" flexGrow={1} marginTop={snap.agent.notice !== null || snap.agent.isWorking ? 1 : 0}>
      {/* Short of room, the keys come before the guide too: a band of a few rows still shows them. */}
      {isKeysFirst && linePlays.length > 0 && <Box marginBottom={1}>{keyArea(ui, linePlays, false, steps, true)}</Box>}
      {!snap.isOnboarded && canPlay && firstHandGuide(ui, layout.isFocused)}
      {state.blocked !== null && <Text color={RED}>{`Play paused · ${cleanText(state.blocked)}`}</Text>}
      {shownTable}
      {/* The table surface module invites clicks; where none land, the keys are recalled here. */}
      {(table === null || !layout.isClickable) && layoutHint(ui, keys, layout.isClickable)}
      {table === null &&
        sending === null &&
        celebration(ui, tableRound(state, snap.prefs), snap.celebrating, gameColumns(layout) - 1)}
      {/* The result waits for the wheel, the reels or the last card: the text must not tell it first. */}
      {dealing === null &&
        sending === null &&
        table === null &&
        snap.spinElapsed === null &&
        snap.revealed === null &&
        outcomeLine(ui, tableRound(state, snap.prefs))}
      {dealing === null &&
        sending === null &&
        snap.spinElapsed === null &&
        snap.revealed === null &&
        winBanner(ui, state, onCommand)}
      {statusLine(ui, snap, state)}
      {lowBalanceLine(ui, snap, state)}
      {!isKeysFirst && linePlays.length > 0 && keyArea(ui, linePlays, size === "large", steps)}
    </Box>
  );
  const foot = (
    <Box flexDirection="column" marginTop={1}>
      <Text color={LINE3}>{"─".repeat(Math.max(0, layout.bodyColumns))}</Text>
      {footer(ui, snap, state, game, layout.isFocused)}
    </Box>
  );

  if (side && sidebarFits(layout)) {
    return frame(
      <Box flexDirection="row" columnGap={2}>
        {gameColumn}
        <Box
          flexDirection="column"
          width={SIDEBAR_COLUMNS}
          flexShrink={0}
          gap={1}
          borderStyle="round"
          borderColor={LINE3}
          paddingX={1}
        >
          {state.sponsor !== null && sponsorBlock(ui, state.sponsor, snap.remote.fetchedAt)}
          {leaderboard(ui, state)}
        </Box>
      </Box>,
      foot,
      isKeysFirst ? 0 : 1,
    );
  }

  return frame(
    <Box flexDirection="column" gap={1}>
      {gameColumn}
      {state.sponsor !== null && sponsorLine(ui, state.sponsor, snap.remote.fetchedAt)}
    </Box>,
    foot,
    isKeysFirst ? 0 : 1,
  );
}

/**
 * The current hand in a few words, for the band. `isLanded`: the spin or the cards have played
 * out; until then the draw (the ball, the reels, the roll…) and the net are left out, as the table
 * holds them back.
 */
export function handSummary(state: StateResponse, prefs: Prefs, isLanded: boolean): string {
  const game = activeGame(state, prefs);
  const round = roundOf(state, game);
  const label = GAME_LABELS[game].toLowerCase();

  if (round === null) {
    return `${label} · no hand yet`;
  }

  const net = round.phase === "idle" && isLanded ? `${SEPARATOR}${formatSigned(round.net)}` : "";
  const detail = isLanded ? round.detail : undrawn(round.detail);

  switch (detail.game) {
    case "blackjack":
      return `${label} · ${blackjackSummary(detail)}${net}`;
    case "roulette": {
      const [only] = detail.chips;
      const bets =
        detail.chips.length === 1 && only !== undefined ? rouletteBetLabel(only.bet) : `${detail.chips.length} chips`;

      return `${label} · ${bets}${detail.number === null ? "" : ` · ball ${detail.number}`}${net}`;
    }
    case "baccarat":
      return `${label} · ${detail.bet} · ${cardsInline(detail.player)} vs ${cardsInline(detail.banker)}${net}`;
    case "slots":
      return `${label}${detail.reels === null ? "" : ` · ${detail.reels.map(cleanText).join(" ")}`}${net}`;
    case "mines":
      return `${label} · ${detail.mines} ${detail.mines === 1 ? "mine" : "mines"} · ${detail.revealed.length} safe · ×${detail.multiplier}${net}`;
    case "dice": {
      const roll = detail.roll === null ? "" : ` · roll ${rollText(detail.roll)}`;

      return `${label} · ${detail.over ? "over" : "under"} ${rollText(detail.target)}${roll}${net}`;
    }
    case "limbo":
      return `${label} · target ×${detail.target}${detail.result === null ? "" : ` · ×${detail.result}`}${net}`;
    case "flip": {
      const coins =
        detail.results === null ? "" : ` · ${detail.results.map((side) => (side === "heads" ? "H" : "T")).join(" ")}`;

      return `${label} · ${detail.flips} × ${detail.side}${coins}${net}`;
    }
    case "keno":
      return `${label} · ${detail.picks.length} picks${detail.hits === null ? "" : ` · ${detail.hits} hits`}${net}`;
    case "wheel": {
      const landed = detail.segment === null ? "" : ` · ×${detail.multipliers[detail.segment] ?? "0.00"}`;

      return `${label} · ${detail.segments} ${detail.risk}${landed}${net}`;
    }
    case "hilo": {
      const current = detail.cards[detail.cards.length - 1];

      return `${label}${current === undefined ? "" : ` · ${cardFace(current)}`} · ×${detail.multiplier}${net}`;
    }
    case "tower":
      return `${label} · ${detail.difficulty} · level ${detail.climbed.length} · ×${detail.multiplier}${net}`;
  }
}

/** A round's detail as before its draw shows: no ball, reels, roll, result, coins, hits or segment yet. */
function undrawn(detail: RoundView["detail"]): RoundView["detail"] {
  switch (detail.game) {
    case "roulette":
      return { ...detail, number: null };
    case "slots":
      return { ...detail, reels: null };
    case "dice":
      return { ...detail, roll: null };
    case "limbo":
      return { ...detail, result: null };
    case "flip":
      return { ...detail, results: null };
    case "keno":
      return { ...detail, hits: null };
    case "wheel":
      return { ...detail, segment: null };
    default:
      return detail;
  }
}

export interface BandLayout {
  bodyColumns: number;
}

export function renderBand(ui: Ui, snap: Snapshot, layout: BandLayout, onCommand: OnCommand): RenderElement {
  const { Box, Text } = ui;
  const state = snap.remote.state;
  const intro = preamble(ui, snap);
  const agent = agentLine(ui, snap.agent);

  if (intro !== null || state === null) {
    return (
      <Box flexDirection="row" columnGap={2} width={layout.bodyColumns}>
        <Text color={PINK} bold>
          TILT
        </Text>
        {intro}
      </Box>
    );
  }

  const input = { state, prefs: snap.prefs, isBusy: snap.intent !== null };
  const keys = planKeys(input);
  const status = statusLine(ui, snap, state);

  return (
    <Box flexDirection="column" width={layout.bodyColumns}>
      <Box flexDirection="row" columnGap={2}>
        <Text color={PINK} bold>
          TILT
        </Text>
        <Text color={GOLD}>{formatUsdc(snap.heldBalance ?? state.balance)} USDC</Text>
        <Text color={FG4} wrap="truncate-end">
          {state.blocked !== null
            ? `play paused · ${cleanText(state.blocked)}`
            : handSummary(state, snap.prefs, snap.spinElapsed === null && snap.revealed === null)}
        </Text>
        {agent}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {keyButtons(
          ui,
          keys.filter((action) => action.command.kind === "switch"),
          onCommand,
        )}
        {playButtons(ui, input, keys, snap.echo, onCommand).map((button) => button.element)}
        {status}
      </Box>
      {state.sponsor !== null && sponsorLine(ui, state.sponsor, snap.remote.fetchedAt)}
    </Box>
  );
}
