// The Tilt table for any harness that prints lines: the Claude Code mod's own pane
// (apps/mod/hooks/view.tsx renderPane) drawn by ./term, from a session's snapshot.
import { activeGame, GAME_LABELS } from "../../../apps/mod/hooks/keys";
import { formatSigned, formatUsdc, SEPARATOR, cleanText } from "../../../apps/mod/hooks/format";
import { applyTheme, FG4, FG6, GOLD, GREEN, PINK, RED, type Ui } from "../../../apps/mod/hooks/theme";
import {
  fitsRows,
  type KeysHint,
  PANE_ROWS,
  type PaneLayout,
  renderPane,
  type Snapshot as TableSnapshot,
} from "../../../apps/mod/hooks/view";
import { h, installJsx, renderLines, termUi } from "./term";
import type { Snapshot } from "./types";

export interface PanelOptions {
  color: boolean;
  width: number;
  /** The rows the table may take; past them, the keys come first and the table runs on below. */
  rows?: number;
  /** How this harness logs in, shown to a logged-out player: "/tilt login", "ctrl+l"… */
  loginHint?: string;
  /** The terminal's ground is light: the accents switch to their light set. */
  light?: boolean;
  /** The footer's key hints, longest first, each its gold lead then the rest; by default the
   *  focused pane's ("esc hands the keys back"). */
  keysHint?: readonly KeysHint[];
}

/** The mod's own words to a logged-out player: a harness that logs in otherwise says how under them. */
const MOD_LOGIN_HINT = "/tilt login";
/** The agent spinner turns a step this often, and every frame while the table moves (register.tsx). */
const SPINNER_FRAME_MS = 200;
const SPIN_FRAME_MS = 100;

// The mod's view files call the global `h` and `Fragment` (their JSX pragmas).
installJsx();

/** The elements the view draws with: ./term lays out the same four the Claude Code terminal has. */
const ui = termUi as unknown as Ui;

/** The play snapshot as the mod's pane reads it. */
function tableSnapshot(snapshot: Snapshot): TableSnapshot {
  const { agent } = snapshot;

  return {
    auth: snapshot.auth,
    remote: { state: snapshot.state, error: snapshot.error, fetchedAt: snapshot.fetchedAt },
    prefs: snapshot.prefs,
    intent: snapshot.intent,
    message: snapshot.message?.text ?? null,
    agent: {
      isWorking: agent.isWorking,
      frame: Math.floor(snapshot.now / (snapshot.isMoving ? SPIN_FRAME_MS : SPINNER_FRAME_MS)),
      // The session's only notice is the "✓ agent finished" one.
      notice: agent.notice === null ? null : { text: agent.notice, tone: "success" },
    },
    session: snapshot.tally,
    isOnboarded: true,
    depositUrl: snapshot.depositUrl,
    spinElapsed: snapshot.spinElapsed,
    revealed: snapshot.revealed,
    heldBalance: snapshot.heldBalance,
    resultElapsed: snapshot.resultElapsed,
  };
}

function paneLayout(
  table: TableSnapshot,
  width: number,
  rows: number,
  keysHint: readonly KeysHint[] | undefined,
): PaneLayout {
  const layout: PaneLayout = {
    bodyColumns: width,
    bodyRows: rows,
    isFocused: true,
    cards: "large",
    isClickable: false,
    isBand: false,
    keysHint,
  };

  return fitsRows(table, layout, rows) ? layout : { ...layout, cards: "small" };
}

/**
 * What the pane leaves to the engine, said under it: how this harness logs in, and the login or
 * deposit page in full (the pane names them as links only a mouse can follow).
 */
function engineLine(snapshot: Snapshot, loginHint: string): object | null {
  const { Text } = termUi;
  const { auth, state, depositUrl } = snapshot;

  if (auth.status === "out" && loginHint !== MOD_LOGIN_HINT) {
    return h(Text, { color: FG4 }, "Here, log in with ", h(Text, { color: GOLD }, loginHint), ".");
  }

  if (auth.status === "pending") {
    return h(Text, { color: FG6 }, cleanText(auth.verifyUrl));
  }

  if (auth.status === "in" && state?.accountOpen === false && depositUrl !== null) {
    return h(Text, { color: FG6 }, cleanText(depositUrl));
  }

  return null;
}

/** The whole table, every line exactly `width` columns. */
export function renderPanel(
  snapshot: Snapshot,
  { color, width, rows = PANE_ROWS.large, loginHint = MOD_LOGIN_HINT, light = false, keysHint }: PanelOptions,
): string[] {
  const { Box } = termUi;
  const table = tableSnapshot(snapshot);

  applyTheme(light);
  const pane = renderPane(ui, table, paneLayout(table, width, rows, keysHint), () => undefined, null);
  const line = engineLine(snapshot, loginHint);
  const shown = line === null ? pane : h(Box, { flexDirection: "column" }, pane, h(Box, { paddingX: 1 }, line));

  return renderLines(shown, { width, color });
}

/** One line for a harness's status bar: "TILT 12.40 · Blackjack · +1.00 · agent working". */
export function renderStatusLine(
  snapshot: Snapshot,
  { color, width, loginHint = MOD_LOGIN_HINT, light = false }: PanelOptions,
): string {
  const { Box, Text } = termUi;
  const { auth, state } = snapshot;

  applyTheme(light);
  const parts: object[] = [h(Text, { color: PINK, bold: true }, "TILT")];

  if (auth.status === "out") {
    parts.push(h(Text, { color: GOLD }, loginHint));
  } else if (auth.status === "pending") {
    parts.push(h(Text, {}, "confirm code ", h(Text, { color: GOLD }, cleanText(auth.userCode))));
  } else if (state === null) {
    parts.push(h(Text, { color: FG6 }, "connecting…"));
  } else {
    const round = state.round;
    const net = round === null ? 0n : BigInt(round.net);

    parts[0] = h(Text, {}, parts[0], " ", h(Text, { color: GOLD }, formatUsdc(state.balance)));
    parts.push(h(Text, {}, GAME_LABELS[activeGame(state, snapshot.prefs)]));

    if (round !== null) {
      parts.push(
        round.phase === "idle"
          ? h(Text, { color: net > 0n ? GREEN : net < 0n ? RED : FG6 }, formatSigned(round.net))
          : h(Text, {}, "in play"),
      );
    }

    parts.push(
      snapshot.agent.isWorking ? h(Text, { color: GREEN }, "agent working") : h(Text, { color: FG6 }, "agent idle"),
    );
  }

  const line = h(
    Text,
    { wrap: "truncate-end" },
    ...parts.flatMap((part, index) => (index === 0 ? [part] : [SEPARATOR, part])),
  );

  return renderLines(h(Box, {}, line), { width, color })[0] ?? " ".repeat(width);
}
