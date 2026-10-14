// What the pane and the band draw, from the mod's state alone. No `$` here: the hooks module
// hands in the surface's elements and one callback for every key.
import type { RenderElement } from "claude-code";

import { blackjackOutcome, blackjackSummary, blackjackTable, STILL, type TableFx } from "./blackjack";
import { cardRow, handRow } from "./cards";
import {
  cardsInline,
  cleanText,
  formatCountdown,
  formatSigned,
  formatUsdc,
  pocketColor,
  rouletteBetLabel,
  SEPARATOR,
} from "./format";
import {
  activeGame,
  type Command,
  GAME_LABELS,
  GAMES,
  heldKeys,
  type KeyAction,
  planKeys,
  type PlanInput,
} from "./keys";
import type { TiltKey } from "../types";
import type { AgentView, AuthView, IntentView, Prefs, RemoteView } from "./model";
import type { Game, RoundView, SponsorView, StateResponse } from "./protocol";
import { FELT, FG1, FG4, FG6, GOLD, GREEN, LINE3, LINE4, PINK, RED, toneOf, type Ui } from "./theme";

export interface Snapshot {
  auth: AuthView;
  remote: RemoteView;
  prefs: Prefs;
  intent: IntentView | null;
  echo: readonly TiltKey[];
  message: string | null;
  agent: AgentView;
}

export type OnCommand = (command: Command) => void;

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** Under this many body columns the sidebar (design: 260px, dropped under ~720px) goes below the game. */
export const WIDE_MIN_COLUMNS = 90;
const SIDEBAR_COLUMNS = 30;
const LEADERBOARD_TOP = 3;
const SLOT_COLORS: Record<string, string> = { "7": PINK, "★": GOLD };

export const spinnerGlyph = (frame: number): string => SPINNER[frame % SPINNER.length] ?? "⠋";

/** The round of `game` to show: the current or last one, if it was of that game. */
export function roundOf(state: StateResponse, game: Game): RoundView | null {
  return state.round?.detail.game === game ? state.round : null;
}

function keyButtons(ui: Ui, keys: readonly KeyAction[], onCommand: OnCommand): RenderElement[] {
  const { Button, Text } = ui;

  return keys.map((action) => (
    <Button key={action.key} plain hotkey={action.hotkey} onPress={() => onCommand(action.command)}>
      <Text color={action.isSelected ? GOLD : undefined} bold={action.isSelected}>
        {action.label}
      </Text>
    </Button>
  ));
}

/** Keys a press must not reach the prompt through: dim, at their own addresses, and inert. */
function inertButtons(ui: Ui, keys: readonly TiltKey[], scope: "held" | "echo"): RenderElement[] {
  const { Button, Text } = ui;

  return keys.map((action) => (
    <Button key={`${scope}-${action.key}`} plain dimColor hotkey={action.hotkey} onPress={() => undefined}>
      <Text dimColor>{action.label}</Text>
    </Button>
  ));
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
): RenderElement[] {
  const live = keys.filter((action) => action.command.kind !== "switch");
  const held = live.length > 0 ? [] : heldKeys(input);
  const taken = new Set([...keys, ...held].map((action) => action.hotkey));
  const faded = echo.filter((action) => !taken.has(action.hotkey));
  const drawn = live.length > 0 ? keyButtons(ui, live, onCommand) : inertButtons(ui, held, "held");

  return [...drawn, ...inertButtons(ui, faded, "echo")];
}

function tabs(ui: Ui, keys: readonly KeyAction[], game: Game, onCommand: OnCommand): RenderElement[] {
  const { Text } = ui;
  const switches = keys.filter((action) => action.command.kind === "switch");

  if (switches.length > 0) {
    return keyButtons(ui, switches, onCommand);
  }

  // A round in flight pins its game: the tabs are drawn, not pressable.
  return GAMES.map((each, index) => (
    <Text color={each === game ? PINK : FG6}>
      [{String(index + 1)}] {GAME_LABELS[each]}
    </Text>
  ));
}

function header(ui: Ui, snap: Snapshot, keys: readonly KeyAction[], onCommand: OnCommand): RenderElement {
  const { Box, Text } = ui;
  const state = snap.remote.state;
  const game = activeGame(state, snap.prefs);

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color={PINK} bold>
        TILT
      </Text>
      {state !== null && tabs(ui, keys, game, onCommand)}
      <Box flexGrow={1} />
      {state !== null && (
        <Text color={FG4}>
          balance <Text color={GOLD}>{formatUsdc(state.balance)} USDC</Text>
          {state.rank !== null && `  rank #${state.rank}`}
        </Text>
      )}
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
    case "roulette":
      return round.detail.number === null ? "" : `Ball on ${round.detail.number} ${pocketColor(round.detail.number)}.`;
    case "baccarat":
      return `Player ${round.detail.playerPoints} · banker ${round.detail.bankerPoints}.`;
    case "slots":
      return "";
  }
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

function rouletteStrip(ui: Ui, pocket: number, reach: number): RenderElement {
  const { Box, Text } = ui;
  const cells: RenderElement[] = [];

  for (let offset = -reach; offset <= reach; offset++) {
    const number = (((pocket + offset) % 37) + 37) % 37;
    const isBall = offset === 0;

    cells.push(
      <Text backgroundColor={FELT[pocketColor(number)]} color={isBall ? GOLD : FG4} bold={isBall}>
        {` ${String(number).padStart(2)} `}
      </Text>,
    );
  }

  return (
    <Box flexDirection="row" columnGap={1}>
      {cells}
    </Box>
  );
}

function rouletteTable(ui: Ui, round: RoundView | null, prefs: Prefs, isWide: boolean): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "roulette" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const bet = isOpen && detail !== null ? detail.bet : prefs.roulette;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG4}>
        bet <Text color={FG1}>{rouletteBetLabel(bet)}</Text>
      </Text>
      {detail?.number != null ? (
        rouletteStrip(ui, detail.number, isWide ? 4 : 2)
      ) : (
        <Text color={FG6}>Pick a bet, then spin with n.</Text>
      )}
    </Box>
  );
}

function baccaratTable(ui: Ui, round: RoundView | null, prefs: Prefs): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "baccarat" ? round.detail : null;
  const bet = round !== null && round.phase !== "idle" && detail !== null ? detail.bet : prefs.baccarat;

  return (
    <Box flexDirection="column">
      <Text color={FG4}>
        bet <Text color={FG1}>{bet}</Text>
      </Text>
      {detail === null ? (
        <Text color={FG6}>Pick player, banker or tie, then deal with n.</Text>
      ) : (
        <Box flexDirection="column">
          {handRow(ui, { label: "PLAYER", total: String(detail.playerPoints), tag: null }, cardRow(ui, detail.player))}
          {handRow(ui, { label: "BANKER", total: String(detail.bankerPoints), tag: null }, cardRow(ui, detail.banker))}
        </Box>
      )}
    </Box>
  );
}

function slotsTable(ui: Ui, round: RoundView | null): RenderElement {
  const { Box, Text } = ui;
  const reels = round?.detail.game === "slots" ? round.detail.reels : null;
  const symbols = reels ?? ["░", "░", "░"];

  return (
    <Box flexDirection="row" columnGap={1}>
      {symbols.map((symbol) => (
        <Box borderStyle="round" borderColor={LINE3} paddingX={1}>
          <Text bold color={SLOT_COLORS[symbol] ?? (reels === null ? LINE4 : FG1)}>
            {cleanText(symbol)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** The active game's table; `fx` moves the blackjack cards and hands, `STILL` draws them at rest. */
export function gameTable(ui: Ui, state: StateResponse, prefs: Prefs, isWide: boolean, fx: TableFx): RenderElement {
  const game = activeGame(state, prefs);
  const round = roundOf(state, game);

  switch (game) {
    case "blackjack":
      return blackjackTable(ui, round, fx);
    case "roulette":
      return rouletteTable(ui, round, prefs, isWide);
    case "baccarat":
      return baccaratTable(ui, round, prefs);
    case "slots":
      return slotsTable(ui, round);
  }
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
        pool <Text color={GOLD}>{formatUsdc(sponsor.pool)} USDC</Text>
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
    </Box>
  );
}

function footer(ui: Ui, state: StateResponse, game: Game): RenderElement {
  const { Text } = ui;

  return <Text color={FG6}>{`rtp ${cleanText(state.rtp[game])}% · 1% fee on wins`}</Text>;
}

/** The play keys on one row, led by how to arm them while the pane does not hold the keyboard. */
function keyBar(ui: Ui, buttons: readonly RenderElement[], isFocused: boolean): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {!isFocused && (
        <Text color={FG4}>
          <Text color={GOLD} bold>
            ctrl+x tab
          </Text>{" "}
          to use keys:
        </Text>
      )}
      {buttons}
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
    return <Text color={FG4}>No Tilt account yet · make a first deposit on the web to open one.</Text>;
  }

  return null;
}

export interface PaneLayout {
  bodyColumns: number;
  isFocused: boolean;
}

/** `table` is the table surface module's region (fullscreen terminal), drawn in place of the still table. */
export function renderPane(
  ui: Ui,
  snap: Snapshot,
  layout: PaneLayout,
  onCommand: OnCommand,
  table: RenderElement | null,
): RenderElement {
  const { Box, Text } = ui;
  const state = snap.remote.state;
  const keys = state === null ? [] : planKeys({ state, prefs: snap.prefs, isBusy: snap.intent !== null });
  const intro = preamble(ui, snap);
  const isWide = layout.bodyColumns >= WIDE_MIN_COLUMNS;
  const frame = (body: RenderElement | null) => (
    <Box flexDirection="column" borderStyle="round" borderColor={PINK} paddingX={1} gap={1}>
      {header(ui, snap, keys, onCommand)}
      {agentLine(ui, snap.agent)}
      {body}
    </Box>
  );

  if (intro !== null || state === null) {
    return frame(intro);
  }

  const game = activeGame(state, snap.prefs);
  const plays = playButtons(ui, { state, prefs: snap.prefs, isBusy: snap.intent !== null }, keys, snap.echo, onCommand);
  const side = state.sponsor !== null || state.leaderboard.length > 0;
  const gameColumn = (
    <Box flexDirection="column" flexGrow={1}>
      {state.blocked !== null && <Text color={RED}>{`Play paused · ${cleanText(state.blocked)}`}</Text>}
      {table ?? gameTable(ui, state, snap.prefs, isWide, STILL)}
      {table === null && outcomeLine(ui, roundOf(state, game))}
      {statusLine(ui, snap, state)}
      {plays.length > 0 && keyBar(ui, plays, layout.isFocused)}
      {footer(ui, state, game)}
    </Box>
  );

  if (isWide && side) {
    return frame(
      <Box flexDirection="row" columnGap={2}>
        {gameColumn}
        <Box flexDirection="column" width={SIDEBAR_COLUMNS} gap={1}>
          {state.sponsor !== null && sponsorBlock(ui, state.sponsor, snap.remote.fetchedAt)}
          {leaderboard(ui, state)}
        </Box>
      </Box>,
    );
  }

  return frame(
    <Box flexDirection="column" gap={1}>
      {gameColumn}
      {state.sponsor !== null && sponsorLine(ui, state.sponsor, snap.remote.fetchedAt)}
    </Box>,
  );
}

/** The current hand in a few words, for the band. */
export function handSummary(state: StateResponse, prefs: Prefs): string {
  const game = activeGame(state, prefs);
  const round = roundOf(state, game);
  const label = GAME_LABELS[game].toLowerCase();

  if (round === null) {
    return `${label} · no hand yet`;
  }

  const net = round.phase === "idle" ? `${SEPARATOR}${formatSigned(round.net)}` : "";
  const detail = round.detail;

  switch (detail.game) {
    case "blackjack":
      return `${label} · ${blackjackSummary(detail)}${net}`;
    case "roulette":
      return `${label} · ${rouletteBetLabel(detail.bet)}${detail.number === null ? "" : ` · ball ${detail.number}`}${net}`;
    case "baccarat":
      return `${label} · ${detail.bet} · ${cardsInline(detail.player)} vs ${cardsInline(detail.banker)}${net}`;
    case "slots":
      return `${label}${detail.reels === null ? "" : ` · ${detail.reels.map(cleanText).join(" ")}`}${net}`;
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
        <Text color={GOLD}>{formatUsdc(state.balance)} USDC</Text>
        <Text color={FG4} wrap="truncate-end">
          {state.blocked !== null ? `play paused · ${cleanText(state.blocked)}` : handSummary(state, snap.prefs)}
        </Text>
        {agent}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {keyButtons(
          ui,
          keys.filter((action) => action.command.kind === "switch"),
          onCommand,
        )}
        {playButtons(ui, input, keys, snap.echo, onCommand)}
        {status}
      </Box>
      {state.sponsor !== null && sponsorLine(ui, state.sponsor, snap.remote.fetchedAt)}
    </Box>
  );
}
