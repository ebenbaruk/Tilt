// One line of Tilt for a harness's status bar, drawn by ./term from the mod's plain TypeScript
// modules only (no view file), so it loads where the table cannot: under plain Node.
import { activeGame, GAME_LABELS } from "../../../apps/mod/hooks/keys";
import { formatSigned, formatUsdc, SEPARATOR, cleanText } from "../../../apps/mod/hooks/format";
import { applyTheme, FG6, GOLD, GREEN, PINK, RED } from "../../../apps/mod/hooks/theme";
import { h, renderLines, termUi } from "./term/index";
import type { Snapshot } from "./types";

export interface StatusOptions {
  color: boolean;
  width: number;
  /** How this harness logs in, shown to a logged-out player: "/tilt login", "ctrl+l"… */
  loginHint?: string;
  /** The terminal's ground is light: the accents switch to their light set. */
  light?: boolean;
}

/** The mod's own words to a logged-out player: a harness that logs in otherwise says how under them. */
export const MOD_LOGIN_HINT = "/tilt login";

/** One line for a harness's status bar: "TILT 12.40 · Blackjack · +1.00 · agent working". */
export function renderStatusLine(
  snapshot: Snapshot,
  { color, width, loginHint = MOD_LOGIN_HINT, light = false }: StatusOptions,
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
