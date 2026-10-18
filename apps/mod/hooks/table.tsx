// The table surface module: the game table drawn on the terminal's drawing thread (a `Client` in
// the fullscreen pane). It takes raw keys once a click gives it the focus, posts the plan key each
// one presses to the hooks module, and animates on its own frame clock: cards dealt one by one,
// the active hand pulsing, a win counted up, a loss shaken. The clock stops once nothing moves,
// and no animation ever holds a key back.
import type { ClientSurface, RenderElement } from "claude-code";

import { DEAL_STEP_MS, dealtCards } from "./cards";
import { formatUsdc, SEPARATOR } from "./format";
import {
  activeGame,
  KENO_PICK_KEY,
  MINES_TILE_KEY,
  ROULETTE_STRAIGHT_KEY,
  STEPPER_NAMES,
  TOWER_TILE_KEY,
} from "./keys";
import type { RoundView } from "./protocol";
import { pressFor, stepperOf, type TableKey, type TableProps } from "./table-input";
import { applyTheme, FG4, FG6, GOLD, PINK, type Ui } from "./theme";
import { celebration, celebrationMs, gameTable, outcomeLine, roundOf, spinMs, spinProgress } from "./view";

const FRAME_MS = 33;
const COUNT_UP_MS = 700;
const BALANCE_MS = 600;
const FLASH_MS = 600;
const FLASH_BEAT_MS = 150;
const SHAKE_STEP_MS = 60;
const SHAKE_OFFSETS = [2, 0, 2, 0, 1, 0];
const PULSE_BEAT_MS = 450;
/** The active hand and the play-again prompt pulse this long after the last change, then rest. */
const PULSE_WINDOW_MS = 12_000;
const WIN_FLASH = "#4a3b12";
const LOSS_FLASH = "#4a1c1c";
const PROGRESS_STEPS = 1000n;
const STREAK_SHOWN_FROM = 2;
/** A Mines tile awaiting its draw turns one step this often. */
const PENDING_FRAME_MS = 120;

type Outcome = "win" | "loss" | "push";

interface Effect {
  kind: Outcome;
  /** Frame clock time it starts: once the round's last card is turned over. */
  at: number;
  net: string;
  balance: string;
}

interface TableState {
  /** Frame clock time, advanced by the ticker only while something moves. */
  now: number;
  /** The round last drawn, and its blackjack or baccarat card count then. */
  round: number | null;
  cards: number;
  /** Cards turned over so far, in deal order. */
  revealed: number;
  /** Frame clock time a roulette, wheel or slots round started spinning; null when none is. */
  spinAt: number | null;
  /** The round on the table was drawing at the last props. */
  wasDrawing: boolean;
  lastDealAt: number;
  /** The last round counted as settled, so a redraw never counts it twice. */
  settled: number | null;
  effect: Effect | null;
  /** Rounds won in a row, kept while the instance lives. */
  streak: number;
  /** The last change or key: the pulses run for a while after it. */
  wokeAt: number;
  /** Clicked or keyed since the pane last took the keyboard: the raw keys are the table's. */
  isFocused: boolean;
  /** The pane's focus at the last props, to notice it leave. */
  wasPaneFocused: boolean;
}

interface Runtime {
  props: TableProps;
  stopClock: (() => void) | null;
}

const runtimes = new WeakMap<object, Runtime>();

const outcomeOf = (net: string): Outcome => {
  const value = BigInt(net);

  return value > 0n ? "win" : value < 0n ? "loss" : "push";
};

function firstState(props: TableProps): TableState {
  const round = props.state.round;
  const cards = dealtCards(round);

  return {
    now: 0,
    round: round?.number ?? null,
    cards,
    revealed: cards,
    spinAt: null,
    wasDrawing: round?.phase === "drawing",
    lastDealAt: 0,
    settled: round?.phase === "idle" ? round.number : null,
    effect: null,
    streak: 0,
    wokeAt: 0,
    isFocused: false,
    wasPaneFocused: props.isPaneFocused,
  };
}

/** The state after new props: a new round deals from the first card, a new card is dealt, a
 * settled round starts its effect and counts in the streak. The same object when nothing changed. */
function observe(props: TableProps, state: TableState): TableState {
  const round = props.state.round;
  const cards = dealtCards(round);
  const speed = props.prefs.slotsSpeed;
  let next = state;

  // The keyboard left the pane (the prompt, another pane, the agents view): the table has to be
  // clicked again before Space and the arrows are its own.
  if (state.wasPaneFocused !== props.isPaneFocused) {
    next = { ...next, wasPaneFocused: props.isPaneFocused, isFocused: next.isFocused && props.isPaneFocused };
  }

  // A round that lands after drawing restarts its spin, so the reels stop one by one on the result.
  if (round !== null && round.number === state.round && round.phase === "idle" && state.wasDrawing) {
    next = { ...next, spinAt: spinMs(round.detail.game, speed) > 0 ? next.now : null, wokeAt: next.now };
  }

  if ((round?.number ?? null) !== state.round) {
    const spinAt = round !== null && spinMs(round.detail.game, speed) > 0 ? next.now : null;

    next = {
      ...next,
      round: round?.number ?? null,
      cards,
      revealed: 0,
      spinAt,
      lastDealAt: -DEAL_STEP_MS,
      effect: null,
    };
    next.wokeAt = next.now;
  } else if (cards !== state.cards) {
    next = { ...next, cards, revealed: Math.min(next.revealed, cards), wokeAt: next.now };
  }

  if (round !== null && round.phase === "idle" && round.number !== state.settled) {
    const kind = outcomeOf(round.net);
    // The effect waits for the last card, or for the wheel or the reels to land.
    const spinLeft = next.spinAt === null ? 0 : Math.max(0, next.spinAt + spinMs(round.detail.game, speed) - next.now);
    const dealLeft = Math.max(0, next.cards - next.revealed) * DEAL_STEP_MS + spinLeft;
    const streak = kind === "win" ? next.streak + 1 : kind === "loss" ? 0 : next.streak;

    next = {
      ...next,
      settled: round.number,
      streak,
      effect: { kind, at: next.now + dealLeft, net: round.net, balance: props.state.balance },
      wokeAt: next.now + dealLeft,
    };
  }

  const isDrawing = round?.phase === "drawing";

  return next.wasDrawing === isDrawing ? next : { ...next, wasDrawing: isDrawing };
}

const hasKey = (keys: readonly TableKey[], address: string): boolean => keys.some((key) => key.key === address);

/** How far into its spin the round on the table is; null once it landed. */
function spinElapsed(state: TableState, props: TableProps): number | null {
  const round = props.state.round;

  if (state.spinAt === null || round === null) {
    return null;
  }

  return spinProgress(round, state.now - state.spinAt, props.prefs.slotsSpeed);
}

function isAnimating(state: TableState, props: TableProps): boolean {
  const round = props.state.round;
  // A Mines or tower tile being drawn turns until its draw lands.
  const detail = round?.detail;
  const isTileDrawing = (detail?.game === "mines" || detail?.game === "tower") && detail.pending !== null;
  const isDealing = state.revealed < state.cards || spinElapsed(state, props) !== null || isTileDrawing;
  const effectMs = Math.max(COUNT_UP_MS + BALANCE_MS, round === null ? 0 : celebrationMs(round));
  const hasEffect = state.effect !== null && state.now < state.effect.at + effectMs;
  const canPulse = hasKey(props.keys, "bj-stand") || hasKey(props.keys, "start");

  return isDealing || hasEffect || (canPulse && state.now < state.wokeAt + PULSE_WINDOW_MS);
}

function tick(surface: ClientSurface<TableState>, rt: Runtime): void {
  const state = surface.state;

  if (state === undefined) {
    return;
  }

  const now = state.now + FRAME_MS;
  const isDealDue = state.revealed < state.cards && now - state.lastDealAt >= DEAL_STEP_MS;
  const next: TableState = isDealDue
    ? { ...state, now, revealed: state.revealed + 1, lastDealAt: now }
    : { ...state, now };

  if (!isAnimating(next, rt.props)) {
    rt.stopClock?.();
    rt.stopClock = null;
  }

  surface.setState(next);
}

function startClock(surface: ClientSurface<TableState>, rt: Runtime): void {
  if (rt.stopClock === null) {
    rt.stopClock = surface.every(FRAME_MS, () => tick(surface, rt));
  }
}

/** A click or a key: the table holds the raw keys while the pane keeps the keyboard. */
function focus(surface: ClientSurface<TableState>, rt: Runtime): void {
  const state = surface.state;

  if (state !== undefined) {
    surface.setState({ ...state, isFocused: true, wokeAt: state.now });
    startClock(surface, rt);
  }
}

function listen(surface: ClientSurface<TableState>, rt: Runtime): void {
  surface.onPointer((event) => {
    if (event.type === "down") {
      focus(surface, rt);
    }
  });
  surface.onKey((event) => {
    const press = pressFor(event, rt.props.keys);

    focus(surface, rt);

    if (press !== null) {
      surface.post({ press });
    }
  });
}

/** `value` scaled by how far `elapsed` is into `span`, from 0 to all of it. */
function partOf(value: bigint, elapsed: number, span: number): bigint {
  const progress = Math.max(0, Math.min(1, elapsed / span));

  return (value * BigInt(Math.round(progress * Number(PROGRESS_STEPS)))) / PROGRESS_STEPS;
}

function summary(ui: Ui, state: TableState, round: RoundView | null, isSpinning: boolean): RenderElement | null {
  const { Box, Text } = ui;
  const effect = state.effect;

  if (round === null || round.phase !== "idle" || state.revealed < state.cards || isSpinning) {
    return null;
  }

  if (effect === null || effect.net !== round.net || state.now < effect.at) {
    return outcomeLine(ui, round);
  }

  const elapsed = state.now - effect.at;
  const net = BigInt(effect.net);
  const isWin = effect.kind === "win";
  const shownNet = isWin ? partOf(net, elapsed, COUNT_UP_MS) : net;
  const balanceFrom = BigInt(effect.balance) - net;
  const shownBalance = isWin ? balanceFrom + partOf(net, elapsed - COUNT_UP_MS, BALANCE_MS) : BigInt(effect.balance);
  const isFlashBeat = elapsed < FLASH_MS && Math.floor(elapsed / FLASH_BEAT_MS) % 2 === 0;
  const flash = effect.kind === "push" || !isFlashBeat ? undefined : isWin ? WIN_FLASH : LOSS_FLASH;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} backgroundColor={flash}>
      {outcomeLine(ui, round, shownNet.toString())}
      <Text color={FG4}>
        balance <Text color={isWin ? GOLD : FG4}>{formatUsdc(shownBalance.toString())}</Text>
      </Text>
    </Box>
  );
}

interface PromptView {
  isFocused: boolean;
  /** The shown game's last round is settled: Space plays it again. */
  isSettled: boolean;
  isPulseOn: boolean;
}

function prompt(
  ui: Ui,
  keys: readonly TableKey[],
  view: PromptView,
  post: (press: string) => void,
): RenderElement | null {
  const { Text } = ui;
  const start = keys.find((key) => key.key === "start");
  const again = start !== undefined && view.isSettled ? "play again (same bet)" : "play";
  const turn = turnPrompt(ui, keys, view.isFocused, post);

  if (turn !== null) {
    return turn;
  }

  const hasLayout = keys.some((key) => key.key.startsWith(ROULETTE_STRAIGHT_KEY));

  // Blocked, no account, a move settling: Space plays nothing, so the table does not invite it.
  // An empty roulette table invites chips instead.
  if (start === undefined && !hasKey(keys, "bj-stand") && !hasLayout) {
    return null;
  }

  if (!view.isFocused) {
    return start === undefined && hasLayout ? (
      <Text color={GOLD} bold>
        click the layout to add a chip
      </Text>
    ) : (
      <Text color={FG4}>
        <Text color={GOLD} bold>
          click the table
        </Text>
        {`, then Space to ${again}`}
      </Text>
    );
  }

  const parts: string[] = [];

  if (hasKey(keys, "bj-hit")) {
    parts.push("Space hit");
  }

  if (hasKey(keys, "bj-stand")) {
    parts.push("Enter stand");
  }

  if (hasKey(keys, "bj-double")) {
    parts.push("d double");
  }

  if (hasKey(keys, "bj-split")) {
    parts.push("p split");
  }

  if (hasKey(keys, "bet-up")) {
    parts.push("←/→ bet");
  }

  const stepper = stepperOf(keys);

  if (stepper !== null) {
    parts.push(`↑/↓ ${STEPPER_NAMES[stepper] ?? stepper}`);
  }

  if (keys.some((key) => key.key.startsWith(KENO_PICK_KEY))) {
    parts.push("click a number to pick it");
  }

  if (hasLayout) {
    parts.push("click the layout to add a chip");
  }

  if (start === undefined) {
    return parts.length === 0 ? null : <Text color={FG6}>{parts.join(SEPARATOR)}</Text>;
  }

  return (
    <Text color={FG6}>
      <Text color={view.isSettled && view.isPulseOn ? PINK : GOLD} bold>
        {`Space · ${again}`}
      </Text>
      {`${SEPARATOR}${start.label}`}
      {parts.length > 0 && `${SEPARATOR}${parts.join(SEPARATOR)}`}
    </Text>
  );
}

/**
 * A board waiting for the player (Mines, Tower, Hilo): a click on a tile reveals it or climbs onto
 * it, a click on a guess or the cash-out plays it; once the table holds the keys, the letters do
 * the same. Null when no such move is offered.
 */
function turnPrompt(
  ui: Ui,
  keys: readonly TableKey[],
  isFocused: boolean,
  post: (press: string) => void,
): RenderElement | null {
  const { Box, Button, Text } = ui;
  const tiles = keys.filter((key) => key.key.startsWith(MINES_TILE_KEY) || key.key.startsWith(TOWER_TILE_KEY));
  const moves = keys.filter((key) => key.key.startsWith("hilo-") || key.key.endsWith("-cashout"));

  if (tiles.length === 0 && moves.length === 0) {
    return null;
  }

  const verb = tiles.some((key) => key.key.startsWith(TOWER_TILE_KEY)) ? "climb" : "reveal";
  const letters = `${tiles[0]?.hotkey ?? ""}–${tiles[tiles.length - 1]?.hotkey ?? ""}`;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {tiles.length > 0 && (
        <Text color={GOLD} bold>
          {isFocused ? `${letters} ${verb}` : verb === "climb" ? "click a tile to climb" : "click a tile to reveal it"}
        </Text>
      )}
      {moves.map((move) => (
        <Button key={`table-${move.key}`} plain onPress={() => post(move.key)}>
          <Text color={GOLD} bold>
            {isFocused ? `${move.hotkey} ${move.label}` : move.label}
          </Text>
        </Button>
      ))}
    </Box>
  );
}

const ROULETTE_BUTTONS: readonly string[] = ["chip-undo", "chip-clear", "start"];

/** Roulette's buttons under the layout: the last chip back, the table cleared, the spin; none without chips. */
function rouletteButtons(
  ui: Ui,
  keys: readonly TableKey[],
  isFocused: boolean,
  post: (press: string) => void,
): RenderElement | null {
  const { Box, Button, Text } = ui;

  if (!keys.some((key) => key.key === "chip-undo")) {
    return null;
  }

  const buttons = ROULETTE_BUTTONS.flatMap((address) => keys.filter((key) => key.key === address));

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {buttons.map((button) => (
        <Button key={`table-${button.key}`} plain onPress={() => post(button.key)}>
          <Text color={button.key === "start" ? GOLD : FG4} bold={button.key === "start"}>
            {isFocused ? `${button.hotkey} ${button.label}` : button.label}
          </Text>
        </Button>
      ))}
    </Box>
  );
}

/** A key the plan offers right now at `address` (a tile, a Keno number, a roulette cell), as a Button around its face: a click posts it. */
function tileButton(
  ui: Ui,
  keys: readonly TableKey[],
  address: string,
  face: RenderElement,
  post: (press: string) => void,
) {
  const { Button } = ui;

  return keys.some((key) => key.key === address) ? (
    <Button key={`table-${address}`} plain onPress={() => post(address)}>
      {face}
    </Button>
  ) : null;
}

export default function Table(props: TableProps, surface: ClientSurface<TableState>): RenderElement {
  applyTheme(props.isLight);
  const ui: Ui = surface.elements;
  const { Box, Text } = ui;
  let rt = runtimes.get(surface);

  if (rt === undefined) {
    rt = { props, stopClock: null };
    runtimes.set(surface, rt);
    listen(surface, rt);
  }

  rt.props = props;

  const held = surface.state ?? firstState(props);
  const state = observe(props, held);

  if (state !== surface.state) {
    surface.setState(state);
  }

  if (isAnimating(state, props)) {
    startClock(surface, rt);
  }

  const isPulsing = state.now < state.wokeAt + PULSE_WINDOW_MS;
  const isPulseOn = !isPulsing || Math.floor(state.now / PULSE_BEAT_MS) % 2 === 0;
  const effect = state.effect;
  const sinceEffect = effect === null ? -1 : state.now - effect.at;
  const shake =
    effect?.kind === "loss" && sinceEffect >= 0 ? (SHAKE_OFFSETS[Math.floor(sinceEffect / SHAKE_STEP_MS)] ?? 0) : 0;
  const round = roundOf(props.state, activeGame(props.state, props.prefs));
  const spinning = spinElapsed(state, props);
  const fx = {
    revealed: state.revealed < state.cards ? state.revealed : null,
    isPulseOn,
    spinElapsed: spinning,
    frame: Math.floor(state.now / PENDING_FRAME_MS),
  };
  const post = (press: string) => surface.post({ press });

  return (
    <Box flexDirection="column" paddingLeft={shake}>
      {gameTable(ui, props.state, props.prefs, props.columns, fx, props.cards, props.wheel, (address, face) =>
        tileButton(ui, props.keys, address, face, post),
      )}
      {celebration(ui, round, effect?.kind === "win" ? sinceEffect : null, props.columns - 1)}
      <Box flexDirection="column" marginTop={1}>
        {summary(ui, state, round, spinning !== null)}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {prompt(
            ui,
            props.keys,
            {
              isFocused: state.isFocused && props.isPaneFocused,
              isSettled: round?.phase === "idle",
              isPulseOn,
            },
            post,
          )}
          {state.streak >= STREAK_SHOWN_FROM && (
            <Text color={GOLD} bold>
              {`${state.streak} wins in a row`}
            </Text>
          )}
        </Box>
        {rouletteButtons(ui, props.keys, state.isFocused && props.isPaneFocused, post)}
      </Box>
    </Box>
  );
}
