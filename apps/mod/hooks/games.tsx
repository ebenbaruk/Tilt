// Roulette, baccarat and slots tables, drawn still by the pane and the table surface module alike.
import type { RenderElement } from "claude-code";

import { type CardSize, handCards, handRow } from "./cards";
import { cleanText, pocketColor, rouletteBetLabel } from "./format";
import type { Prefs } from "./model";
import type { RoundView } from "./protocol";
import { FELT, FELT_INK, FELT_INK_DIM, FG1, FG4, FG6, GOLD, GREEN, LINE3, LINE4, PINK, RED, type Ui } from "./theme";

/** The European wheel's pockets in their order around it, from 0. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
];
/** A pocket's tile: its number centered on its felt, three rows tall. */
const POCKET_COLUMNS = 4;
/** How long a spin runs on the table, and how many pockets the wheel turns by before it lands. */
export const ROULETTE_SPIN_MS = 1_400;
const SPIN_POCKETS = 28;

const wheelAt = (index: number): number => WHEEL[((index % WHEEL.length) + WHEEL.length) % WHEEL.length] ?? 0;

/** The pockets the wheel still has to turn by, `elapsed` into a spin: fast at first, easing into the pocket. */
function pocketsToGo(elapsed: number | null): number {
  if (elapsed === null || elapsed >= ROULETTE_SPIN_MS) {
    return 0;
  }

  const left = 1 - elapsed / ROULETTE_SPIN_MS;

  return Math.round(SPIN_POCKETS * left * left);
}

/**
 * The wheel unrolled around the pocket under the marker, as the design system's RouletteStrip:
 * tiles on their felt, the marker `▼` over the middle one and the ball `●` in it once it lands.
 * `pocket` null is the wheel at rest before any spin, dimmed, on 0.
 */
function rouletteWheel(ui: Ui, pocket: number | null, reach: number, elapsed: number | null): RenderElement {
  const { Box, Text } = ui;
  const toGo = pocketsToGo(elapsed);
  const center = (pocket === null ? 0 : WHEEL.indexOf(pocket)) - toGo;
  const offsets = Array.from({ length: reach * 2 + 1 }, (_, index) => index - reach);
  const hasBall = pocket !== null && toGo === 0;
  const tile = (number: number, row: 0 | 1 | 2, isCenter: boolean) => {
    const label = row !== 1 ? (isCenter && hasBall && row === 0 ? " ●  " : "    ") : ` ${String(number).padStart(2)} `;

    return (
      <Text
        backgroundColor={FELT[pocketColor(number)]}
        color={isCenter ? FELT_INK : FELT_INK_DIM}
        bold={isCenter}
        dimColor={pocket === null && !isCenter}
      >
        {label}
      </Text>
    );
  };
  const marker = `${" ".repeat((POCKET_COLUMNS + 1) * reach + 2)}▼`;
  const under = marker.replace("▼", "▲");

  return (
    <Box flexDirection="column">
      <Text color={GOLD} bold>
        {marker}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={LINE3} alignSelf="flex-start">
        {([0, 1, 2] as const).map((row) => (
          <Box flexDirection="row" columnGap={1}>
            {offsets.map((offset) => tile(wheelAt(center + offset), row, offset === 0))}
          </Box>
        ))}
      </Box>
      <Text color={GOLD} bold>
        {under}
      </Text>
    </Box>
  );
}

/** What each roulette bet pays, by the kind in its key (`roulette-<kind>`). */
const BET_PAYS: Record<string, string> = {
  red: "1:1",
  black: "1:1",
  odd: "1:1",
  even: "1:1",
  low: "1:1",
  high: "1:1",
  dozen: "2:1",
  column: "2:1",
};
const BET_NAMES: Record<string, string> = { low: "1–18", high: "19–36" };

/**
 * A bet on the layout, as a chip on its felt: red and black on their own colors, the rest on the
 * green of the table; the bet in play marked `●` in gold. "RED 1:1", "DOZEN 2 2:1".
 */
export function rouletteChip(ui: Ui, kind: string, label: string, isSelected: boolean): RenderElement {
  const { Text } = ui;
  const felt = kind === "red" ? FELT.red : kind === "black" ? FELT.black : FELT.green;
  const name = (BET_NAMES[kind] ?? label).toUpperCase();

  return (
    <Text backgroundColor={felt} color={isSelected ? GOLD : FELT_INK} bold>
      {` ${isSelected ? "● " : ""}${name} `}
      <Text color={FELT_INK_DIM} bold={false}>{`${BET_PAYS[kind] ?? ""} `}</Text>
    </Text>
  );
}

/** The landed pocket on its own felt: "17 BLACK". */
function pocketChip(ui: Ui, pocket: number): RenderElement {
  const { Text } = ui;
  const color = pocketColor(pocket);

  return (
    <Text backgroundColor={FELT[color]} color={FELT_INK} bold>
      {` ${pocket} ${color.toUpperCase()} `}
    </Text>
  );
}

/** `spinElapsed`: how far into its spin the round on the table is; null draws it at rest. */
export function rouletteTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  isWide: boolean,
  spinElapsed: number | null,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "roulette" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const bet = isOpen && detail !== null ? detail.bet : prefs.roulette;
  const pocket = detail?.number ?? null;
  const isSpinning = pocketsToGo(spinElapsed) > 0 || round?.phase === "drawing";

  return (
    <Box flexDirection="column" gap={1}>
      {rouletteWheel(ui, pocket, isWide ? 6 : 3, spinElapsed)}
      <Box flexDirection="row" columnGap={2}>
        {pocket !== null && !isSpinning ? (
          pocketChip(ui, pocket)
        ) : (
          <Text color={FG6}>{isSpinning ? "spinning…" : "No spin yet."}</Text>
        )}
        <Text color={FG4}>
          bet{" "}
          <Text color={FG1} bold>
            {rouletteBetLabel(bet)}
          </Text>
        </Text>
      </Box>
    </Box>
  );
}

export function baccaratTable(ui: Ui, round: RoundView | null, prefs: Prefs, size: CardSize): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "baccarat" ? round.detail : null;
  const bet = round !== null && round.phase !== "idle" && detail !== null ? detail.bet : prefs.baccarat;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG4}>
        bet{" "}
        <Text color={FG1} bold>
          {bet}
        </Text>
      </Text>
      {detail === null ? (
        <Text color={FG6}>Pick player, banker or tie, then deal with n.</Text>
      ) : (
        <Box flexDirection={size === "large" ? "row" : "column"} columnGap={6}>
          {handRow(
            ui,
            { label: "PLAYER", total: String(detail.playerPoints), tag: null },
            handCards(ui, detail.player, size),
            size,
          )}
          {handRow(
            ui,
            { label: "BANKER", total: String(detail.bankerPoints), tag: null },
            handCards(ui, detail.banker, size),
            size,
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * The slot symbols drawn large, three rows of blocks each, in the glyphs the api sends (apps/api
 * src/games/slots.ts: 7, bar, bell, plum, orange, lemon, cherry), each in its own color.
 */
const SYMBOL_ART: Record<string, { rows: readonly [string, string, string]; color: () => string }> = {
  "7": { rows: ["▀▀▀▀█", "  ▄▀ ", " █   "], color: () => PINK },
  "◆": { rows: [" ▗█▖ ", "▐███▌", " ▝█▘ "], color: () => FG1 },
  "★": { rows: ["  ▄  ", "▀███▀", "▄▀ ▀▄"], color: () => GOLD },
  "♣": { rows: [" ▄█▄ ", "█▀█▀█", "  █  "], color: () => GREEN },
  "¤": { rows: ["▄▀▀▀▄", "█ ¤ █", "▀▄▄▄▀"], color: () => GOLD },
  "◎": { rows: [" ▄▄▄ ", "█ ◎ █", " ▀▀▀ "], color: () => FG4 },
  "♥": { rows: ["▄█▄█▄", "▀███▀", "  ▀  "], color: () => RED },
};
const SYMBOLS = Object.keys(SYMBOL_ART);
/** The reels at rest before any spin: the jackpot line, dimmed. */
const IDLE_REELS = ["7", "7", "7"] as const;

/** The pay table, gross times the bet per spin, as `games/slots.rs` pays it. Mirrored here to show; the program pays. */
const PAYS: readonly { line: string; times: number; symbol: string; pair?: true }[] = [
  { line: "7 7 7", times: 250, symbol: "7" },
  { line: "◆ ◆ ◆", times: 100, symbol: "◆" },
  { line: "★ ★ ★", times: 40, symbol: "★" },
  { line: "♣ ♣ ♣", times: 20, symbol: "♣" },
  { line: "¤ ¤ ¤", times: 12, symbol: "¤" },
  { line: "♥ ♥ ♥", times: 10, symbol: "♥" },
  { line: "◎ ◎ ◎", times: 5, symbol: "◎" },
  { line: "♥ ♥ ·", times: 4, symbol: "♥", pair: true },
];

/** When each reel stops, from the start of the spin. */
const REEL_STOPS_MS = [600, 900, 1_200] as const;
export const SLOTS_SPIN_MS = REEL_STOPS_MS[REEL_STOPS_MS.length - 1] ?? 0;
const REEL_FRAME_MS = 80;

/** What a reel shows `elapsed` into a spin: a passing symbol until it stops, then its own. */
function reelSymbol(symbol: string, reel: number, elapsed: number | null): { symbol: string; isMoving: boolean } {
  const stopsAt = REEL_STOPS_MS[reel] ?? 0;

  if (elapsed === null || elapsed >= stopsAt) {
    return { symbol, isMoving: false };
  }

  const passing = SYMBOLS[(Math.floor(elapsed / REEL_FRAME_MS) + reel * 3) % SYMBOLS.length] ?? symbol;

  return { symbol: passing, isMoving: true };
}

/** The pay line the reels landed on, if they pay: three of a kind, or two cherries. */
function paidLine(reels: readonly string[]): string | null {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    return PAYS.find((pay) => !pay.pair && pay.symbol === a)?.line ?? null;
  }

  return reels.filter((symbol) => symbol === "♥").length === 2 ? "♥ ♥ ·" : null;
}

function reelWindow(ui: Ui, symbol: string, isLit: boolean, isMoving: boolean, isIdle: boolean): RenderElement {
  const { Box, Text } = ui;
  const art = SYMBOL_ART[symbol];
  const rows = art?.rows ?? ["     ", `  ${cleanText(symbol)}  `, "     "];
  const color = isIdle || isMoving ? LINE4 : (art?.color() ?? FG1);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isLit ? GOLD : LINE4} paddingX={1}>
      {rows.map((row) => (
        <Text color={color} bold={!isIdle && !isMoving}>
          {row}
        </Text>
      ))}
    </Box>
  );
}

function payTable(ui: Ui, lit: string | null): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column">
      <Text color={FG6}>PAYS × BET</Text>
      {PAYS.map((pay) => (
        <Box flexDirection="row" columnGap={2}>
          <Text color={pay.line === lit ? GOLD : FG4} bold={pay.line === lit}>
            {pay.line}
          </Text>
          <Text color={pay.line === lit ? GOLD : FG6} bold={pay.line === lit}>
            {String(pay.times).padStart(3)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** Three reels in a machine, the payline marked on both sides, the pay table beside it, as the design system's SlotMachine. */
export function slotsTable(ui: Ui, round: RoundView | null, size: CardSize, spinElapsed: number | null): RenderElement {
  const { Box, Text } = ui;
  const reels = round?.detail.game === "slots" ? round.detail.reels : null;
  const isIdle = reels === null;
  const shown = (reels ?? IDLE_REELS).map((symbol, reel) => reelSymbol(symbol, reel, spinElapsed));
  const isSpinning = shown.some((reel) => reel.isMoving);
  const lit = isIdle || isSpinning ? null : paidLine(reels);

  if (size === "small") {
    return (
      <Box flexDirection="row" columnGap={1}>
        {shown.map((reel) => (
          <Box borderStyle="round" borderColor={lit === null ? LINE4 : GOLD} paddingX={1}>
            <Text bold color={isIdle || reel.isMoving ? LINE4 : (SYMBOL_ART[reel.symbol]?.color() ?? FG1)}>
              {cleanText(reel.symbol)}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="row" columnGap={3}>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={GOLD} bold>
          ▸
        </Text>
        <Box
          flexDirection="row"
          columnGap={1}
          borderStyle="round"
          borderColor={lit === null ? LINE3 : GOLD}
          paddingX={1}
        >
          {shown.map((reel) => reelWindow(ui, reel.symbol, lit !== null, reel.isMoving, isIdle))}
        </Box>
        <Text color={GOLD} bold>
          ◂
        </Text>
      </Box>
      {payTable(ui, lit)}
    </Box>
  );
}
