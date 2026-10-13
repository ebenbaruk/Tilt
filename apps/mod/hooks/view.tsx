// What the pane and the band draw, from the mod's state alone. No `$` here: the hooks module
// hands in the surface's elements and one callback for every key.
import type { Elements, RenderElement } from "claude-code";

import {
  cardArt,
  cardsInline,
  cleanText,
  formatCountdown,
  formatSigned,
  formatUsdc,
  HIDDEN_CARD_ART,
  isRedSuit,
  pocketColor,
  rouletteBetLabel,
  SEPARATOR,
} from "./format";
import { activeGame, type Command, GAME_LABELS, GAMES, type KeyAction, planKeys } from "./keys";
import type { AgentView, AuthView, IntentView, Prefs, RemoteView } from "./model";
import type { Card, Game, RoundView, SponsorView, StateResponse } from "./protocol";

export type Ui = Pick<Elements["terminal"], "Box" | "Text" | "Button" | "Link">;

export interface Snapshot {
  auth: AuthView;
  remote: RemoteView;
  prefs: Prefs;
  intent: IntentView | null;
  message: string | null;
  agent: AgentView;
}

export type OnCommand = (command: Command) => void;

// The design system's oklch tokens, approximated in hex for the terminal.
const PINK = "#f779ba";
const GOLD = "#f1c45e";
const GREEN = "#7ccd8e";
const RED = "#f66d67";
const FG1 = "#f0eee9";
const FG4 = "#9a9aa0";
const FG6 = "#6f7076";
const LINE3 = "#3a3b40";
const LINE4 = "#4a4b50";
const FELT: Record<"red" | "black" | "green", string> = { red: "#b63132", black: "#2a2b2f", green: "#21763c" };

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
/** Under this many body columns the sidebar (design: 260px, dropped under ~720px) goes below the game. */
export const WIDE_MIN_COLUMNS = 90;
const SIDEBAR_COLUMNS = 30;
const LEADERBOARD_TOP = 3;
const SLOT_COLORS: Record<string, string> = { "7": PINK, "★": GOLD };

export const spinnerGlyph = (frame: number): string => SPINNER[frame % SPINNER.length] ?? "⠋";

const toneOf = (net: string): string => {
  const value = BigInt(net);

  return value > 0n ? GOLD : value < 0n ? RED : FG4;
};

/** The round of `game` to show: the current or last one, if it was of that game. */
function roundOf(state: StateResponse, game: Game): RoundView | null {
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

function cardRow(ui: Ui, cards: readonly Card[], hiddenAfter = false): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {cards.map((card) => (
        <Text color={isRedSuit(card.suit) ? RED : FG1}>{cardArt(card)}</Text>
      ))}
      {hiddenAfter && <Text color={LINE4}>{HIDDEN_CARD_ART}</Text>}
    </Box>
  );
}

function handLabel(ui: Ui, label: string, total: string, meta: string | null): RenderElement {
  const { Text } = ui;

  return (
    <Text color={FG4}>
      {label} <Text color={FG1}>{total}</Text>
      {meta !== null && <Text color={FG6}>{`${SEPARATOR}${meta}`}</Text>}
    </Text>
  );
}

function blackjackOutcome(round: RoundView): string {
  if (round.detail.game !== "blackjack") {
    return "";
  }

  const { playerTotal: you, dealerTotal: dealer } = round.detail;
  const net = BigInt(round.net);

  if (you > 21) {
    return `Bust at ${you}.`;
  }

  if (dealer > 21) {
    return `Dealer busts at ${dealer}.`;
  }

  if (net === 0n) {
    return `Push at ${you}.`;
  }

  return net > 0n ? `${you} beats ${dealer}.` : `Dealer ${dealer} beats ${you}.`;
}

function outcomeText(round: RoundView): string {
  switch (round.detail.game) {
    case "blackjack":
      return blackjackOutcome(round);
    case "roulette":
      return round.detail.number === null ? "" : `Ball on ${round.detail.number} ${pocketColor(round.detail.number)}.`;
    case "baccarat":
      return `Player ${round.detail.playerPoints} · banker ${round.detail.bankerPoints}.`;
    case "slots":
      return "";
  }
}

function outcomeLine(ui: Ui, round: RoundView | null): RenderElement | null {
  const { Text } = ui;

  if (round === null || round.phase !== "idle") {
    return null;
  }

  const text = outcomeText(round);

  return (
    <Text color={FG4}>
      {text === "" ? "" : `${text} `}
      <Text color={toneOf(round.net)} bold>
        {formatSigned(round.net)}
      </Text>
      {BigInt(round.fee) > 0n && <Text color={FG6}>{`${SEPARATOR}fee ${formatUsdc(round.fee)}`}</Text>}
    </Text>
  );
}

function blackjackTable(ui: Ui, round: RoundView | null): RenderElement {
  const { Box, Text } = ui;

  if (round === null || round.detail.game !== "blackjack") {
    return <Text color={FG4}>No hand yet. Deal one with n.</Text>;
  }

  const hand = round.detail;
  const isPlayerTurn = round.phase === "player_turn";
  const dealerHidden = isPlayerTurn && hand.dealer.length === 1;
  const meta = [hand.playerSoft ? "soft" : null, hand.doubled ? "doubled" : null, `bet ${formatUsdc(round.stake)}`]
    .filter((part) => part !== null)
    .join(SEPARATOR);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {handLabel(ui, "DEALER", dealerHidden ? `${hand.dealerTotal} + ?` : String(hand.dealerTotal), null)}
        {cardRow(ui, hand.dealer, dealerHidden)}
      </Box>
      <Box flexDirection="column">
        {handLabel(ui, "YOU", String(hand.playerTotal), meta)}
        {cardRow(ui, hand.player)}
      </Box>
    </Box>
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
    <Box flexDirection="column" gap={1}>
      <Text color={FG4}>
        bet <Text color={FG1}>{bet}</Text>
      </Text>
      {detail === null ? (
        <Text color={FG6}>Pick player, banker or tie, then deal with n.</Text>
      ) : (
        <Box flexDirection="column">
          {handLabel(ui, "PLAYER", String(detail.playerPoints), null)}
          {cardRow(ui, detail.player)}
          {handLabel(ui, "BANKER", String(detail.bankerPoints), null)}
          {cardRow(ui, detail.banker)}
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

function gameTable(ui: Ui, state: StateResponse, prefs: Prefs, isWide: boolean): RenderElement {
  const game = activeGame(state, prefs);
  const round = roundOf(state, game);

  switch (game) {
    case "blackjack":
      return blackjackTable(ui, round);
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

function footer(ui: Ui, state: StateResponse, game: Game, isFocused: boolean): RenderElement {
  const { Text } = ui;
  const hint = isFocused ? "" : `${SEPARATOR}ctrl+x tab to play`;

  return <Text color={FG6}>{`rtp ${cleanText(state.rtp[game])}% · 1% fee on wins${hint}`}</Text>;
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

export function renderPane(ui: Ui, snap: Snapshot, layout: PaneLayout, onCommand: OnCommand): RenderElement {
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
  const playKeys = keys.filter((action) => action.command.kind !== "switch");
  const side = state.sponsor !== null || state.leaderboard.length > 0;
  const gameColumn = (
    <Box flexDirection="column" flexGrow={1} gap={1}>
      {state.blocked !== null && <Text color={RED}>{`Play paused · ${cleanText(state.blocked)}`}</Text>}
      {gameTable(ui, state, snap.prefs, isWide)}
      {outcomeLine(ui, roundOf(state, game))}
      {statusLine(ui, snap, state)}
      {playKeys.length > 0 && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {keyButtons(ui, playKeys, onCommand)}
        </Box>
      )}
      {footer(ui, state, game, layout.isFocused)}
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
      return `${label} · you ${detail.playerTotal} · dealer ${detail.dealerTotal}${net}`;
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

  const keys = planKeys({ state, prefs: snap.prefs, isBusy: snap.intent !== null });
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
        {keyButtons(ui, keys, onCommand)}
        {status}
      </Box>
      {state.sponsor !== null && sponsorLine(ui, state.sponsor, snap.remote.fetchedAt)}
    </Box>
  );
}
