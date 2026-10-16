// Roulette, baccarat, slots and Mines tables, drawn still by the pane and the table surface module alike.
import type { RenderElement } from "claude-code";

import { type CardSize, faceDownOf, handCards, handRow } from "./cards";
import { cashOutPayout, cleanText, formatUsdc, pocketColor, rouletteBetLabel } from "./format";
import {
  MINES_COLUMNS,
  MINES_TILE_KEY,
  ROULETTE_COLUMN_KEY,
  ROULETTE_DOZEN_KEY,
  ROULETTE_STRAIGHT_KEY,
  tileLetter,
} from "./keys";
import type { Prefs } from "./model";
import type { BaccaratView, RouletteBet, RoundView } from "./protocol";
import {
  FELT,
  FELT_INK,
  FELT_INK_DIM,
  FG1,
  FG4,
  FG6,
  GOLD,
  GREEN,
  INK,
  LINE3,
  LINE4,
  PINK,
  RED,
  type Ui,
} from "./theme";

/** The European wheel's pockets in their order around it, from 0. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
];
/** A pocket's tile: its number centered on its felt, three rows tall; the next one starts a column after. */
const POCKET_COLUMNS = 4;
const TILE_STEP = POCKET_COLUMNS + 1;
/** How long the wheel takes to slow from full speed into the drawn pocket, and how many pockets it turns by meanwhile. */
export const ROULETTE_SPIN_MS = 2_000;
const SPIN_POCKETS = 28;
/** Full speed, in pockets a ms: the slope of the slowing's cubic ease-out at its start, so a wheel
 *  turning at it while the chain draws slows down on landing without a change of pace. */
const FULL_SPEED = (3 * SPIN_POCKETS) / ROULETTE_SPIN_MS;

const wheelAt = (index: number): number => WHEEL[((index % WHEEL.length) + WHEEL.length) % WHEEL.length] ?? 0;

/**
 * Where the wheel stands under the marker, in pockets around it from 0 (a fraction is part way to
 * the next), `elapsed` into a spin: at full speed, steadily, while the chain draws; once it has,
 * slowing on a cubic ease-out, fast then creeping, to rest exactly on the drawn pocket.
 */
export function wheelPosition(pocket: number | null, elapsed: number | null, isDrawing: boolean): number {
  const rest = pocket === null ? 0 : WHEEL.indexOf(pocket);

  if (isDrawing) {
    return rest + FULL_SPEED * (elapsed ?? 0);
  }

  if (elapsed === null || elapsed >= ROULETTE_SPIN_MS) {
    return rest;
  }

  const left = 1 - elapsed / ROULETTE_SPIN_MS;

  return rest - SPIN_POCKETS * left ** 3;
}

/**
 * The wheel unrolled around `position`, as the design system's RouletteStrip: tiles on their felt,
 * the marker `▼` over the pocket under it and the ball `●` in it once `hasBall`. `isIdle` dims the
 * wheel: at rest before any spin, or turning while the pocket is not drawn yet.
 */
function rouletteWheel(
  ui: Ui,
  position: number,
  reach: number,
  look: { hasBall: boolean; isIdle: boolean },
): RenderElement {
  const { Box, Text } = ui;
  // The strip moves a column at a time, not a pocket: the wheel creeps into its pocket at the end
  // instead of jumping there.
  const column = Math.round(position * TILE_STEP);
  const shift = ((column % TILE_STEP) + TILE_STEP) % TILE_STEP;
  const first = (column - shift) / TILE_STEP - reach;
  // The marker stands over a tile's second column.
  const center = Math.floor((column + 1) / TILE_STEP);
  const width = TILE_STEP * (reach * 2 + 1) - 1;
  const slots = Array.from({ length: reach * 2 + 2 }, (_, slot) => slot);
  const row = (line: 0 | 1 | 2) =>
    slots.flatMap((slot) => {
      const index = first + slot;
      const number = wheelAt(index);
      const isCenter = index === center;
      const start = slot * TILE_STEP - shift;
      const label =
        line !== 1 ? (isCenter && look.hasBall && line === 0 ? " ●  " : "    ") : ` ${String(number).padStart(2)} `;
      const shown = label.slice(Math.max(0, -start), Math.max(0, width - start));
      const gap = start + POCKET_COLUMNS;

      return [
        shown.length > 0 && (
          <Text
            backgroundColor={FELT[pocketColor(number)]}
            color={isCenter ? FELT_INK : FELT_INK_DIM}
            bold={isCenter}
            dimColor={look.isIdle && !isCenter}
          >
            {shown}
          </Text>
        ),
        gap >= 0 && gap < width && <Text> </Text>,
      ];
    });
  const marker = `${" ".repeat(TILE_STEP * reach + 2)}▼`;
  const under = marker.replace("▼", "▲");

  return (
    <Box flexDirection="column">
      <Text color={GOLD} bold>
        {marker}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={LINE3} alignSelf="flex-start">
        {([0, 1, 2] as const).map((line) => (
          <Box flexDirection="row">{row(line)}</Box>
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

/** The layout's number grid as on the felt, top row first: 3 6 … 36, 2 5 … 35, 1 4 … 34; each
 *  row's `2:1` at its end bets on its column, numbered by its first number. */
const LAYOUT_ROWS = ([3, 2, 1] as const).map((column) => ({
  column,
  numbers: Array.from({ length: 12 }, (_, index) => index * 3 + column),
}));
const DOZENS = [
  { dozen: 1, label: "1st 12" },
  { dozen: 2, label: "2nd 12" },
  { dozen: 3, label: "3rd 12" },
] as const;
const OUTSIDE_BETS: readonly RouletteBet[] = [
  { kind: "low" },
  { kind: "even" },
  { kind: "red" },
  { kind: "black" },
  { kind: "odd" },
  { kind: "high" },
];
/** A number's cell; a `2:1` cell is one column wider, for its chip. */
const NUMBER_CELL: Record<"wide" | "narrow", number> = { wide: 4, narrow: 3 };
const COLUMN_CELL = 4;
/** The chip on the cell of the bet in play. */
const CHIP = "●";

const centered = (text: string, width: number): string =>
  text.padStart(Math.floor((width + text.length) / 2)).padEnd(width);

/**
 * The betting layout, as on a casino table: 0 on the left, the numbers in three rows of twelve,
 * each row's `2:1`, then the dozens and the outside bets. The bet in play carries the chip `●` in
 * gold; the pocket the ball landed in is lit gold. A cell the drawing has a Button for (a click on
 * the fullscreen table) bets on it.
 */
function rouletteLayout(
  ui: Ui,
  bet: RouletteBet,
  winner: number | null,
  isWide: boolean,
  cellButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const width = NUMBER_CELL[isWide ? "wide" : "narrow"];
  const betLabel = rouletteBetLabel(bet);
  const cell = (address: string, cellBet: RouletteBet, lines: readonly string[], felt: string, cellWidth: number) => {
    const isBet = rouletteBetLabel(cellBet) === betLabel;
    const isWinner = cellBet.kind === "straight" && cellBet.number === winner;
    // One Text, its lines joined: a Button holds only text, and the 0 is three rows tall.
    const text = lines
      .map(
        (line, index) =>
          `${isBet && index === Math.floor(lines.length / 2) ? CHIP : " "}${centered(line, cellWidth - 1)}`,
      )
      .join("\n");
    const face = (
      <Text backgroundColor={isWinner ? GOLD : felt} color={isWinner ? INK : isBet ? GOLD : FELT_INK} bold>
        {text}
      </Text>
    );

    return cellButton(address, face) ?? face;
  };
  const numberCell = (number: number, lines: readonly string[]) =>
    cell(`${ROULETTE_STRAIGHT_KEY}${number}`, { kind: "straight", number }, lines, FELT[pocketColor(number)], width);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {numberCell(0, ["", "0", ""])}
        <Box flexDirection="column">
          {LAYOUT_ROWS.map(({ column, numbers }) => (
            <Box flexDirection="row">
              {numbers.map((number) => numberCell(number, [String(number)]))}
              {cell(`${ROULETTE_COLUMN_KEY}${column}`, { kind: "column", column }, ["2:1"], FELT.green, COLUMN_CELL)}
            </Box>
          ))}
        </Box>
      </Box>
      <Box flexDirection="row" marginLeft={width}>
        {DOZENS.map(({ dozen, label }) =>
          cell(`${ROULETTE_DOZEN_KEY}${dozen}`, { kind: "dozen", dozen }, [label], FELT.green, width * 4),
        )}
      </Box>
      <Box flexDirection="row" marginLeft={width}>
        {OUTSIDE_BETS.map((outside) =>
          cell(
            `roulette-${outside.kind}`,
            outside,
            [(BET_NAMES[outside.kind] ?? outside.kind).toUpperCase()],
            outside.kind === "red" ? FELT.red : outside.kind === "black" ? FELT.black : FELT.green,
            width * 2,
          ),
        )}
      </Box>
    </Box>
  );
}

/**
 * `spinElapsed`: how far into its spin the round on the table is; null draws it at rest.
 * `cellButton`: the Button a cell of the layout is bet on with, where the drawing has one.
 */
export function rouletteTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  isWide: boolean,
  spinElapsed: number | null,
  cellButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "roulette" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const bet = isOpen && detail !== null ? detail.bet : prefs.roulette;
  const pocket = detail?.number ?? null;
  const isDrawing = round?.phase === "drawing";
  const isSpinning = spinElapsed !== null || isDrawing;
  const landed = isSpinning ? null : pocket;
  const position = wheelPosition(pocket, spinElapsed, isDrawing);

  return (
    <Box flexDirection="column" gap={1}>
      {rouletteWheel(ui, position, isWide ? 6 : 3, { hasBall: landed !== null, isIdle: pocket === null })}
      <Box flexDirection="row" columnGap={2}>
        {landed !== null ? (
          pocketChip(ui, landed)
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
      {rouletteLayout(ui, bet, landed, isWide, cellButton)}
    </Box>
  );
}

/** The two cards each side gets before either may draw a third. */
const BACCARAT_FIRST_CARDS = 2;

/** Where each baccarat card falls in the deal: player, banker, player, banker, then the player's
 *  third card and the banker's, the order the rules draw them in. */
function baccaratDealOrder(detail: BaccaratView): { player: number[]; banker: number[] } {
  const thirds = BACCARAT_FIRST_CARDS * 2;
  const bankerThird = thirds + (detail.player.length > BACCARAT_FIRST_CARDS ? 1 : 0);

  return {
    player: detail.player.map((_, card) => (card < BACCARAT_FIRST_CARDS ? card * 2 : thirds)),
    banker: detail.banker.map((_, card) => (card < BACCARAT_FIRST_CARDS ? card * 2 + 1 : bankerThird)),
  };
}

/** `revealed`: cards turned over so far, in deal order (baccaratDealOrder); null when all are. */
export function baccaratTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  size: CardSize,
  revealed: number | null,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "baccarat" ? round.detail : null;
  const bet = round !== null && round.phase !== "idle" && detail !== null ? detail.bet : prefs.baccarat;
  const order = detail === null ? null : baccaratDealOrder(detail);
  const playerFaceDown = order === null ? 0 : faceDownOf(order.player, revealed);
  const bankerFaceDown = order === null ? 0 : faceDownOf(order.banker, revealed);

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
            { label: "PLAYER", total: playerFaceDown > 0 ? "" : String(detail.playerPoints), tag: null },
            handCards(ui, detail.player, size, { faceDown: playerFaceDown }),
            size,
          )}
          {handRow(
            ui,
            { label: "BANKER", total: bankerFaceDown > 0 ? "" : String(detail.bankerPoints), tag: null },
            handCards(ui, detail.banker, size, { faceDown: bankerFaceDown }),
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

/** A tile's glyphs: a gem found, the mine that ended the round, a tile awaiting its draw turning through these. */
export const SAFE_GLYPH = "◆";
export const MINE_GLYPH = "✸";
const PENDING_GLYPHS = ["◐", "◓", "◑", "◒"];
/** Spinner frames a tile awaiting its draw keeps each shade of its pulse. */
const PULSE_FRAMES = 2;

/**
 * The tiles' fills, as Stake's: they stay dark on any ground, as the roulette felt does. A hidden
 * tile on slate (lit on the tower's level in play, dark where a climbed level was passed by), a gem
 * on a lighter fill, the mine on red, the tile being drawn pulsing between two shades. All found as
 * is in the 256-color palette, so a terminal (or tmux) without true color draws them the same.
 */
export const TILE_FILL = {
  hidden: "#444444",
  /** The second shade of compact hidden tiles: their rows touch, alternate rows tell them apart. */
  hiddenAlt: "#3a3a3a",
  lit: "#5f8787",
  /** A shade over the fullscreen pane's own ground (#262626), so a passed tile still shows. */
  dark: "#303030",
  safe: "#626262",
  pending: ["#4e4e4e", "#767676"],
  mine: "#af0000",
} as const;
export const TILE_INK = { letter: "#767676", gem: "#00ff87", mine: FELT_INK, pending: FELT_INK } as const;

/**
 * A tile's size: cells across, and whether the upper half of a row under it (`▀` in its fill) ends
 * it, half a row above the next row of tiles. Compact tiles have none: their rows touch.
 */
export interface TileSize {
  columns: number;
  hasEdge: boolean;
}

/** A row and a half under 5 cells; compact, a row of 4, still wide enough for the main screen's `a: ` key. */
const MINES_TILE: Record<CardSize, TileSize> = {
  large: { columns: 5, hasEdge: true },
  small: { columns: 4, hasEdge: false },
};

/** The rows a Mines board takes at a card size. */
export const minesBoardRows = (size: CardSize): number => MINES_COLUMNS * (MINES_TILE[size].hasEdge ? 2 : 1);

/** What a tile shows: its fill and, centred on it, a glyph in its ink. */
export interface TileLook {
  fill: string;
  glyph: string | null;
  ink: string;
}

/** A tile awaiting its draw at this frame: the spinner on a pulsing fill. */
export const pendingLook = (frame: number): TileLook => ({
  fill: TILE_FILL.pending[Math.floor(frame / PULSE_FRAMES) % TILE_FILL.pending.length] ?? TILE_FILL.hidden,
  glyph: PENDING_GLYPHS[frame % PENDING_GLYPHS.length] ?? null,
  ink: TILE_INK.pending,
});

/**
 * A Stake tile: a block of its fill with its glyph. Where `key` (`mines-tile-3`) has a Button, the
 * tile is it: on the main screen the Button of its hotkey in the corner (`a:`, the engine's own
 * drawing of a key), on the fullscreen table the whole tile, its letter dim in the corner, a click
 * anywhere on it pressing.
 */
export function stakeTile(
  ui: Ui,
  size: TileSize,
  look: TileLook,
  key: { address: string; letter: string } | null,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const button =
    key === null
      ? null
      : tileButton(key.address, <Text color={TILE_INK.letter}>{key.letter.padEnd(size.columns)}</Text>);

  return (
    <Box flexDirection="column">
      <Box backgroundColor={look.fill} width={size.columns}>
        {button ?? (
          <Text color={look.ink} bold>
            {look.glyph === null ? " ".repeat(size.columns) : centered(look.glyph, size.columns)}
          </Text>
        )}
      </Box>
      {size.hasEdge && <Text color={look.fill}>{"▀".repeat(size.columns)}</Text>}
    </Box>
  );
}

/**
 * The Button a tile, a Keno number or a roulette cell is pressed with where the drawing has one for
 * the key at `address` (`mines-tile-3`, `keno-pick-12`, `roulette-red`), live or held; null draws it
 * still. `face` is what the drawing shows there: a Button made for it wraps it.
 */
export type TileButton = (address: string, face: RenderElement) => RenderElement | null;

/**
 * The 5 × 5 Mines board as Stake's, centred, its multipliers beside it. In play a hidden tile is a
 * slate block and its key, a safe tile a gem on a lighter fill, the tile being drawn pulsing; a
 * settled board shows the safe tiles and the mine that ended it, if one did (no other mine exists:
 * each reveal draws). Every state takes the same rows: nothing jumps on a reveal.
 */
export function minesTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  frame: number,
  size: CardSize,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "mines" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const safe = new Set(detail?.revealed ?? []);
  const tileSize = MINES_TILE[size];
  const tileCell = (tile: number): RenderElement => {
    if (safe.has(tile)) {
      return stakeTile(ui, tileSize, { fill: TILE_FILL.safe, glyph: SAFE_GLYPH, ink: TILE_INK.gem }, null, tileButton);
    }

    if (detail?.busted === tile) {
      return stakeTile(ui, tileSize, { fill: TILE_FILL.mine, glyph: MINE_GLYPH, ink: TILE_INK.mine }, null, tileButton);
    }

    if (detail?.pending === tile) {
      return stakeTile(ui, tileSize, pendingLook(frame), null, tileButton);
    }

    const isAltRow = !tileSize.hasEdge && Math.floor(tile / MINES_COLUMNS) % 2 === 1;
    const look = { fill: isAltRow ? TILE_FILL.hiddenAlt : TILE_FILL.hidden, glyph: null, ink: TILE_INK.letter };
    const key = isOpen ? { address: `${MINES_TILE_KEY}${tile}`, letter: tileLetter(tile) } : null;

    return stakeTile(ui, tileSize, look, key, tileButton);
  };
  const board = (
    <Box flexDirection="column">
      {Array.from({ length: MINES_COLUMNS }, (_, row) => (
        <Box flexDirection="row" columnGap={1}>
          {Array.from({ length: MINES_COLUMNS }, (_, column) => tileCell(row * MINES_COLUMNS + column))}
        </Box>
      ))}
    </Box>
  );
  // As the roulette bet: the round's own while it plays, else the one the next round is played with.
  const mines = isOpen && detail !== null ? detail.mines : prefs.mines;
  const count = (
    <Text color={FG4}>
      <Text color={PINK} bold>
        {String(mines)}
      </Text>
      {` ${mines === 1 ? "mine" : "mines"}`}
    </Text>
  );
  const table = (side: RenderElement) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap={4} justifyContent="center">
      {board}
      {side}
    </Box>
  );

  if (detail === null || round === null) {
    return table(
      <Box flexDirection="column">
        {count}
        <Text color={FG6}>Pick the mines with j and k, then play with n.</Text>
      </Box>,
    );
  }

  return table(
    <Box flexDirection="column">
      {count}
      <Text color={FG4}>
        multiplier{" "}
        <Text color={FG1} bold>
          {`×${detail.multiplier}`}
        </Text>
      </Text>
      {isOpen && detail.nextMultiplier !== null && (
        <Text color={FG4}>
          next tile <Text color={FG1}>{`×${detail.nextMultiplier}`}</Text>
        </Text>
      )}
      {isOpen && detail.canCashOut && (
        <Text color={FG4}>
          cash out{" "}
          <Text color={GOLD} bold>
            {formatUsdc(cashOutPayout(round.stake, detail.multiplier))}
          </Text>
        </Text>
      )}
      <Text color={FG6}>{`${detail.revealed.length} safe`}</Text>
    </Box>,
  );
}
