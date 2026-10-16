// The table surface module: the game table drawn on the terminal's drawing thread (a `Client` in
// the fullscreen pane). It takes raw keys once a click gives it the focus, posts the plan key each
// one presses to the hooks module, and animates on its own frame clock: cards dealt one by one,
// the active hand pulsing, a win counted up, a loss shaken. The clock stops once nothing moves,
// and no animation ever holds a key back.
import type { ClientSurface, RenderElement } from "claude-code";

import { cardCount, DEAL_STEP_MS } from "./blackjack";
import { formatUsdc, SEPARATOR } from "./format";
import { activeGame } from "./keys";
import type { RoundView } from "./protocol";
import { pressFor, type TableKey, type TableProps } from "./table-input";
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
  /** The round last drawn, and its blackjack card count then. */
  round: number | null;
  cards: number;
  /** Cards turned over so far, in deal order. */
  revealed: number;
  /** Frame clock time a roulette or slots round started spinning; null when none is. */
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

const cardsOf = (round: RoundView | null): number =>
  round !== null && round.detail.game === "blackjack" ? cardCount(round.detail) : 0;

function firstState(props: TableProps): TableState {
  const round = props.state.round;
  const cards = cardsOf(round);

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
  const cards = cardsOf(round);
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
  const isDealing = state.revealed < state.cards || spinElapsed(state, props) !== null;
  const round = props.state.round;
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

function prompt(ui: Ui, keys: readonly TableKey[], view: PromptView): RenderElement | null {
  const { Text } = ui;
  const start = keys.find((key) => key.key === "start");
  const again = start !== undefined && view.isSettled ? "play again (same bet)" : "play";

  // Blocked, no account, a move settling: Space plays nothing, so the table does not invite it.
  if (start === undefined && !hasKey(keys, "bj-stand")) {
    return null;
  }

  if (!view.isFocused) {
    return (
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

  if (hasKey(keys, "hands-up")) {
    parts.push("↑/↓ hands");
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
  const fx = { revealed: state.revealed < state.cards ? state.revealed : null, isPulseOn, spinElapsed: spinning };

  return (
    <Box flexDirection="column" paddingLeft={shake}>
      {gameTable(ui, props.state, props.prefs, props.isWide, fx, props.cards)}
      {celebration(ui, round, effect?.kind === "win" ? sinceEffect : null, props.columns - 1)}
      <Box flexDirection="column" marginTop={1}>
        {summary(ui, state, round, spinning !== null)}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {prompt(ui, props.keys, {
            isFocused: state.isFocused && props.isPaneFocused,
            isSettled: round?.phase === "idle",
            isPulseOn,
          })}
          {state.streak >= STREAK_SHOWN_FROM && (
            <Text color={GOLD} bold>
              {`${state.streak} wins in a row`}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
