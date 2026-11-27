// The Tilt table for any harness that prints lines: the Claude Code mod's own pane
// (apps/mod/hooks/view.tsx renderPane) drawn by ./term, from a session's snapshot.
import { cleanText } from "../../../apps/mod/hooks/format";
import { frameAt } from "../../../apps/mod/hooks/motion";
import { applyTheme, FG4, FG6, GOLD, type Ui } from "../../../apps/mod/hooks/theme";
import {
  fitsRows,
  largeCardRows,
  type KeysHint,
  PANE_ROWS,
  type PaneLayout,
  renderPane,
  type Snapshot as TableSnapshot,
} from "../../../apps/mod/hooks/view";
import { MOD_LOGIN_HINT, type StatusOptions } from "./status";
import { h, renderLines, termUi, withJsx } from "./term/index";
import type { Snapshot } from "./types";

export interface PanelOptions extends StatusOptions {
  /** The rows the table may take; past them, the keys come first and the table runs on below. */
  rows?: number;
  /** The rows it may grow to (at least `rows`) where large cards need more than `rows`, as six
   *  settled blackjack hands do: the table then keeps its large cards instead of switching to
   *  small ones for that moment. By default it never grows. */
  maxRows?: number;
  /** The footer's key hints, longest first, each its gold lead then the rest; by default the
   *  focused pane's ("esc hands the keys back"). */
  keysHint?: readonly KeysHint[];
}

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
      frame: frameAt(snapshot.now, snapshot.isMoving),
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

/**
 * Large cards wherever they can be had, in the fewest rows: as they are within `rows`; else, up
 * to `maxRows`, either grown or with the sponsor and leaderboard on a line so the hands are not
 * wrapped under their column (six blackjack hands), whichever is shorter (the column when equal);
 * only then small cards, as the mod does.
 */
function paneLayout(
  table: TableSnapshot,
  width: number,
  rows: number,
  maxRows: number,
  keysHint: readonly KeysHint[] | undefined,
): PaneLayout {
  const base: PaneLayout = {
    bodyColumns: width,
    bodyRows: rows,
    isFocused: true,
    cards: "large",
    isClickable: false,
    isBand: false,
    keysHint,
  };
  const roomFor = (layout: PaneLayout): number | null => {
    const needed = largeCardRows(table, layout);
    return needed !== null && needed <= maxRows ? Math.max(rows, needed) : null;
  };

  const withSidebar = roomFor(base);
  if (withSidebar === rows) return base;
  const lined: PaneLayout = { ...base, isSidebarOff: true };
  const withLine = roomFor(lined);
  if (withLine !== null && (withSidebar === null || withLine < withSidebar)) return { ...lined, bodyRows: withLine };
  if (withSidebar !== null) return { ...base, bodyRows: withSidebar };
  return fitsRows(table, base, rows) ? base : { ...base, cards: "small" };
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
  {
    color,
    width,
    rows = PANE_ROWS.large,
    maxRows = rows,
    loginHint = MOD_LOGIN_HINT,
    light = false,
    keysHint,
  }: PanelOptions,
): string[] {
  const { Box } = termUi;
  const table = tableSnapshot(snapshot);

  applyTheme(light);

  return withJsx(() => {
    const layout = paneLayout(table, width, rows, Math.max(rows, maxRows), keysHint);
    const pane = renderPane(ui, table, layout, () => undefined, null);
    const line = engineLine(snapshot, loginHint);
    const shown = line === null ? pane : h(Box, { flexDirection: "column" }, pane, h(Box, { paddingX: 1 }, line));

    return renderLines(shown, { width, color });
  });
}
