// Dice, Limbo, Flip, Keno and Wheel: one draw each, drawn still by the pane and the table surface
// module alike. A settled round stays on the table while the next one is set up with the same
// choices; once a choice changes, the table shows the next round's instead.
import type { RenderElement } from "claude-code";

import { diceMultiplier, flipMultiplier, scaledDecimal } from "./format";
import type { TileButton } from "./games";
import { diceTarget, DICE_ROLLS, KENO_NUMBERS, KENO_PICK_KEY } from "./keys";
import type { Prefs } from "./model";
import type { DiceView, FlipView, KenoView, LimboView, RoundView, WheelView } from "./protocol";
import { BLUE, FG1, FG4, FG6, GOLD, GREEN, INK, LINE3, LINE4, PINK, RED, TEAL, type Ui } from "./theme";

const isOpen = (round: RoundView | null): boolean => round !== null && round.phase !== "idle";

/** "1.53" (2 decimals, as the api sends them) in hundredths: 153n. */
const hundredths = (multiplier: string): bigint => BigInt(multiplier.replace(".", ""));

const isWin = (round: RoundView): boolean => BigInt(round.net) > 0n;

/** What a settled result shows in: gold for a win, red for a loss, as the nets. */
const resultColor = (round: RoundView): string => (isWin(round) ? GOLD : RED);

/** The dice track: 40 cells of 250 rolls each, 0 at the left, 99.99 at the right. */
const DICE_CELLS = 40;
const ROLLS_PER_CELL = DICE_ROLLS / DICE_CELLS;

/** The dice round to show: the open one, or the last one while the next is rolled the same way. */
function shownDice(round: RoundView | null, prefs: Prefs): DiceView | null {
  const detail = round?.detail.game === "dice" ? round.detail : null;
  const isSame =
    detail !== null && detail.over === prefs.diceOver && detail.target === diceTarget(prefs.diceChance, prefs.diceOver);

  return detail !== null && (isOpen(round) || isSame) ? detail : null;
}

/** "37.42": a roll of 0 to 9999 as the roll 00.00 to 99.99. */
export const rollText = (roll: number): string => scaledDecimal(BigInt(roll), 2);

/**
 * The roll's track, as Stake's slider: the winning side green, the losing side red, the target
 * between them and the roll marked `▼` over its cell once it lands.
 */
export function diceTable(ui: Ui, round: RoundView | null, prefs: Prefs): RenderElement {
  const { Box, Text } = ui;
  const detail = shownDice(round, prefs);
  const over = detail?.over ?? prefs.diceOver;
  const target = detail?.target ?? diceTarget(prefs.diceChance, prefs.diceOver);
  const chance = over ? DICE_ROLLS - target : target;
  const cells = Array.from({ length: DICE_CELLS }, (_, cell) => {
    const middle = cell * ROLLS_PER_CELL + ROLLS_PER_CELL / 2;

    return over ? middle >= target : middle < target;
  });
  const roll = detail?.roll ?? null;
  const marker = roll === null ? " " : `${" ".repeat(Math.floor(roll / ROLLS_PER_CELL))}▼`;
  const half = DICE_CELLS / 2;
  const scale = `0${" ".repeat(half - 1)}50${" ".repeat(half - 5)}100`;
  const result =
    round !== null && detail !== null && roll !== null ? (
      <Text color={resultColor(round)} bold>
        {`rolled ${rollText(roll)}`}
      </Text>
    ) : (
      <Text color={FG6}>{isOpen(round) && detail !== null ? "rolling…" : "No roll yet."}</Text>
    );

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      <Box flexDirection="column">
        <Text color={GOLD} bold>
          {marker}
        </Text>
        <Text>
          {cells.map((wins) => (
            <Text color={wins ? GREEN : RED}>━</Text>
          ))}
        </Text>
        <Text color={FG6}>{scale}</Text>
      </Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          {`roll ${over ? "over" : "under"} `}
          <Text color={FG1} bold>
            {rollText(target)}
          </Text>
        </Text>
        <Text color={FG4}>{`win chance ${scaledDecimal(BigInt(chance), 2)}%`}</Text>
        <Text color={FG4}>
          multiplier{" "}
          <Text color={FG1} bold>
            {`×${detail?.multiplier ?? diceMultiplier(chance)}`}
          </Text>
        </Text>
        {result}
      </Box>
    </Box>
  );
}

/** Limbo's win chance at a target × 100: 98 % / target, in hundredths of a percent. */
const limboChance = (target: bigint): string => scaledDecimal(980_000n / target, 2);

/** The result multiplier in a frame, gold when it reached the target, under the target and its chance. */
export function limboTable(ui: Ui, round: RoundView | null, prefs: Prefs): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "limbo" ? round.detail : null;
  const chosen = scaledDecimal(BigInt(prefs.limboTarget), 2);
  const shown: LimboView | null = detail !== null && (isOpen(round) || detail.target === chosen) ? detail : null;
  const target = shown?.target ?? chosen;
  const result = shown?.result ?? null;
  const reached = result !== null && hundredths(result) >= hundredths(target);

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3} alignItems="center">
      <Box borderStyle="round" borderColor={result === null ? LINE3 : reached ? GOLD : RED} paddingX={3}>
        {result === null ? (
          <Text color={FG6}>{shown !== null && isOpen(round) ? "×…" : "×—"}</Text>
        ) : (
          <Text color={reached ? GOLD : RED} bold>
            {`×${result}`}
          </Text>
        )}
      </Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          target{" "}
          <Text color={FG1} bold>
            {`×${target}`}
          </Text>
        </Text>
        <Text color={FG4}>{`win chance ${limboChance(hundredths(target))}%`}</Text>
        {result === null && <Text color={FG6}>The result has to reach the target.</Text>}
      </Box>
    </Box>
  );
}

const SIDE_LETTER: Record<FlipView["side"], string> = { heads: "H", tails: "T" };

/** The coins in a row: each lands H or T, gold on the side chosen, red off it. */
export function flipTable(ui: Ui, round: RoundView | null, prefs: Prefs): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "flip" ? round.detail : null;
  const isSame = detail !== null && detail.side === prefs.flipSide && detail.flips === prefs.flips;
  const shown = detail !== null && (isOpen(round) || isSame) ? detail : null;
  const side = shown?.side ?? prefs.flipSide;
  const flips = shown?.flips ?? prefs.flips;
  const results = shown?.results ?? null;
  const coins = Array.from({ length: flips }, (_, index) => {
    const landed = results?.[index];

    if (landed === undefined) {
      return (
        <Text color={LINE4} bold>
          {shown !== null && isOpen(round) ? "(·)" : "( )"}
        </Text>
      );
    }

    return (
      <Text color={landed === side ? GOLD : RED} bold>
        {`(${SIDE_LETTER[landed]})`}
      </Text>
    );
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {coins}
      </Box>
      <Text color={FG4}>
        {`${flips} × `}
        <Text color={FG1} bold>
          {side}
        </Text>
        {" pays "}
        <Text color={FG1} bold>
          {`×${shown?.multiplier ?? flipMultiplier(flips)}`}
        </Text>
        {results === null && <Text color={FG6}>{" · every coin has to land on it"}</Text>}
      </Text>
    </Box>
  );
}

const KENO_COLUMNS = 8;
const KENO_CELL = 4;

/** The Keno round to show: the open one, or the last one while its picks are still the ones chosen. */
function shownKeno(round: RoundView | null, prefs: Prefs): KenoView | null {
  const detail = round?.detail.game === "keno" ? round.detail : null;
  const isSame = detail !== null && detail.picks.join(",") === prefs.kenoPicks.join(",");

  return detail !== null && (isOpen(round) || isSame) ? detail : null;
}

/** What each hit count pays, the one landed in gold. */
function kenoPays(ui: Ui, detail: KenoView): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color={FG6}>HITS</Text>
      {detail.paytable.map((pays, hits) => {
        const isLanded = detail.hits === hits;

        return (
          <Text color={isLanded ? GOLD : hundredths(pays) > 0n ? FG4 : FG6} bold={isLanded}>
            {`${hits} ×${pays}`}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * The 40 numbers, eight a row: picks in brackets (gold once drawn), the other drawn numbers
 * bright. On the fullscreen table each number is a Button: a click picks or unpicks it.
 */
export function kenoTable(ui: Ui, round: RoundView | null, prefs: Prefs, numberButton: TileButton): RenderElement {
  const { Box, Text } = ui;
  const detail = shownKeno(round, prefs);
  const picks = new Set(detail?.picks ?? prefs.kenoPicks);
  const drawn = new Set(detail?.drawn ?? []);
  const cell = (number: number): RenderElement => {
    const isPick = picks.has(number);
    const isDrawn = drawn.has(number);
    const text = isPick ? `[${String(number).padStart(2)}]` : ` ${String(number).padStart(2)} `;
    const color = isPick ? (isDrawn ? GOLD : PINK) : isDrawn ? FG1 : FG6;
    const face = (
      <Text color={color} bold={isPick || isDrawn}>
        {text}
      </Text>
    );

    return detail !== null && isOpen(round) ? face : (numberButton(`${KENO_PICK_KEY}${number}`, face) ?? face);
  };
  const rows = Array.from({ length: KENO_NUMBERS / KENO_COLUMNS }, (_, row) => (
    <Box flexDirection="row">
      {Array.from({ length: KENO_COLUMNS }, (_, column) => (
        <Box width={KENO_CELL}>{cell(row * KENO_COLUMNS + column + 1)}</Box>
      ))}
    </Box>
  ));
  const count = picks.size;

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Box flexDirection="column">{rows}</Box>
        <Box flexDirection="column">
          <Text color={FG4}>
            <Text color={PINK} bold>
              {String(count)}
            </Text>
            {` ${count === 1 ? "pick" : "picks"}`}
          </Text>
          {detail?.hits !== null && detail?.hits !== undefined ? (
            <Text color={round !== null && isWin(round) ? GOLD : FG4} bold>
              {`${detail.hits} ${detail.hits === 1 ? "hit" : "hits"}`}
            </Text>
          ) : (
            <Text color={FG6}>{detail !== null && isOpen(round) ? "drawing…" : "Ten numbers are drawn."}</Text>
          )}
        </Box>
      </Box>
      {detail !== null && kenoPays(ui, detail)}
    </Box>
  );
}

/** How long the wheel takes to slow from full speed into the drawn segment. */
export const WHEEL_SPIN_MS = 2_500;
/** How far it turns meanwhile, in laps: the half lap keeps the drawn segment off the pointer when the slowing starts. */
const SPIN_LAPS = 3.5;

/**
 * Which segment the pointer is over, `elapsed` into a spin of a wheel of `segments` (a fraction is
 * part way to the next): turning clockwise at full speed while the chain draws; once it has,
 * slowing on a cubic ease-out over a few laps to rest exactly on the drawn `segment`. The count
 * falls as the wheel turns clockwise: the segment before comes under the pointer.
 */
export function wheelSegmentAt(
  segments: number,
  segment: number | null,
  elapsed: number | null,
  isDrawing: boolean,
): number {
  const rest = segment ?? 0;
  const turn = SPIN_LAPS * segments;

  if (isDrawing) {
    // The slowing's slope at its start, so landing changes the pace without a jolt.
    return rest - ((3 * turn) / WHEEL_SPIN_MS) * (elapsed ?? 0);
  }

  if (elapsed === null || elapsed >= WHEEL_SPIN_MS) {
    return rest;
  }

  return rest + turn * (1 - elapsed / WHEEL_SPIN_MS) ** 3;
}

/** Multipliers under ×2 count as small wins, in cool colors; the rest are the warm big ones. */
const BIG_WIN = 200n;

/**
 * One color per multiplier the wheel pays: nothing dim, the small wins cool (blue, teal, green as
 * they rise), the big ones warm, the biggest pink and the others gold.
 */
function segmentColors(pays: readonly string[]): Map<string, string> {
  const values = [...new Set(pays)].sort((a, b) => Number(hundredths(a) - hundredths(b)));
  const small = values.filter((value) => hundredths(value) > 0n && hundredths(value) < BIG_WIN);
  const big = values.filter((value) => hundredths(value) >= BIG_WIN);
  const cool = [BLUE, TEAL, GREEN];
  const colors = new Map<string, string>(values.map((value) => [value, LINE4]));

  small.forEach((value, rank) => colors.set(value, cool[Math.min(rank, cool.length - 1)] ?? GREEN));
  big.forEach((value, rank) => colors.set(value, rank === big.length - 1 ? PINK : GOLD));

  return colors;
}

/** A cell with its gap: a multiplier label (`×19.60` at most), or a dot where there are too many to label. */
const LABEL_CELL = 7;
const DOT_CELL = 2;

/** A ring's radii, in rows and columns from its centre, and the columns a cell takes. */
interface Ring {
  rows: number;
  columns: number;
  cell: number;
}

/** The ring for each wheel, sized to stay within 50 columns (the game column beside the sidebar) and 9 rows. */
const RINGS: Record<number, Ring> = {
  10: { rows: 3, columns: 12, cell: LABEL_CELL },
  20: { rows: 4, columns: 18, cell: LABEL_CELL },
  30: { rows: 4, columns: 16, cell: DOT_CELL },
  40: { rows: 4, columns: 20, cell: DOT_CELL },
  50: { rows: 4, columns: 24, cell: DOT_CELL },
};
const SAMPLES_PER_SLOT = 60;

interface Slot {
  row: number;
  column: number;
}

const slotsCache = new Map<number, Slot[]>();

/**
 * Where each slot of the ring sits, clockwise from the top: evenly spread around an ellipse on a
 * measure where a row down or a cell across is one step, so the cells stay apart both on the flat
 * top and bottom and on the steep sides.
 */
function ringSlots(segments: number, ring: Ring): Slot[] {
  const cached = slotsCache.get(segments);

  if (cached !== undefined) {
    return cached;
  }

  const samples = segments * SAMPLES_PER_SLOT;
  const points: (Slot & { length: number })[] = [];
  let length = 0;

  for (let sample = 0; sample <= samples; sample++) {
    const angle = (2 * Math.PI * sample) / samples;
    const point = { row: -ring.rows * Math.cos(angle), column: ring.columns * Math.sin(angle) };
    const before = points[sample - 1];

    if (before !== undefined) {
      length += Math.max(Math.abs(point.column - before.column) / ring.cell, Math.abs(point.row - before.row));
    }

    points.push({ ...point, length });
  }

  const slots: Slot[] = [];
  let index = 0;

  for (let slot = 0; slot < segments; slot++) {
    while ((points[index]?.length ?? length) < (length * slot) / segments) {
      index++;
    }

    const point = points[index] ?? { row: 0, column: 0 };

    slots.push({ row: Math.round(point.row + ring.rows), column: Math.round(point.column + ring.columns) });
  }

  slotsCache.set(segments, slots);

  return slots;
}

/** `text` centered in `width` columns, the odd space on the right. */
function centered(text: string, width: number): string {
  const left = Math.floor((width - text.length) / 2);

  return `${" ".repeat(Math.max(0, left))}${text}`.padEnd(width);
}

/** A piece of a ring's row: what it draws from `column` on, `width` columns wide. */
interface Piece {
  column: number;
  width: number;
  element: RenderElement;
}

/** The wheel's segments in the narrow pane's strip: this many each side of the pointer. */
const STRIP_REACH: Record<number, number> = { [LABEL_CELL]: 3, [DOT_CELL]: 12 };

/**
 * The wheel as a ring of segments around its centre, the fixed pointer `▼` at the top over the
 * segment it turned to (lit); a narrow pane gets a strip of the segments around the pointer
 * instead. Each segment shows its multiplier, or only its color with the legend under the ring;
 * the centre names the wheel until it lands, then the landed multiplier. `spinElapsed`: how far
 * into its spin the round on the table is; null draws it at rest.
 */
export function wheelTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  isWide: boolean,
  spinElapsed: number | null,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "wheel" ? round.detail : null;
  const isSame = detail !== null && detail.segments === prefs.wheelSegments && detail.risk === prefs.wheelRisk;
  const shown: WheelView | null = detail !== null && (isOpen(round) || isSame) ? detail : null;
  const segments = shown?.segments ?? prefs.wheelSegments;
  const risk = shown?.risk ?? prefs.wheelRisk;
  const pays = shown?.multipliers ?? [];
  const colors = segmentColors(pays);
  const isDrawing = shown !== null && round?.phase === "drawing";
  const isSpinning = shown !== null && (spinElapsed !== null || isDrawing);
  const landed = isSpinning ? null : (shown?.segment ?? null);
  const turn = Math.round(wheelSegmentAt(segments, shown?.segment ?? null, spinElapsed, isDrawing));
  const ring = RINGS[segments] ?? { rows: 0, columns: 0, cell: LABEL_CELL };
  const face = ring.cell - 1;
  // On a dim 0× chip the theme's text reads; on a colored one, the ink made for fills.
  const chipInk = (multiplier: string) => (hundredths(multiplier) === 0n ? FG1 : INK);
  const cell = (slot: number): RenderElement => {
    const multiplier = pays[(((turn + slot) % segments) + segments) % segments];
    const color = multiplier === undefined ? LINE4 : (colors.get(multiplier) ?? LINE4);
    const isUnder = slot === 0 && shown !== null;

    if (face === 1) {
      return (
        <Text color={color} bold={isUnder}>
          {isUnder ? "◉" : "●"}
        </Text>
      );
    }

    const label = centered(multiplier === undefined ? "·" : `×${multiplier}`, face);

    return isUnder ? (
      <Text backgroundColor={color} color={chipInk(multiplier ?? "0")} bold>
        {label}
      </Text>
    ) : (
      <Text color={color}>{label}</Text>
    );
  };
  const line = (pieces: Piece[]): RenderElement => {
    let at = 0;

    return (
      <Text>
        {[...pieces]
          .sort((a, b) => a.column - b.column)
          .flatMap((piece) => {
            const gap = " ".repeat(Math.max(0, piece.column - at));

            at = piece.column + piece.width;

            return [gap, piece.element];
          })}
      </Text>
    );
  };
  const landedPays = landed === null ? null : (pays[landed] ?? "0.00");
  const centreText = landedPays === null ? `${segments} segments · ${risk} risk` : ` ×${landedPays} `;
  const centre =
    landedPays === null ? (
      <Text color={FG4}>{centreText}</Text>
    ) : (
      <Text backgroundColor={colors.get(landedPays) ?? LINE4} color={chipInk(landedPays)} bold>
        {centreText}
      </Text>
    );
  // The pointer stands over the middle of a cell's face.
  const faceMiddle = Math.floor((face - 1) / 2);
  // The colors come in the order of what they pay.
  const legend = [...colors];
  const isRing = isWide && RINGS[segments] !== undefined;
  let wheel: RenderElement;

  if (isRing) {
    const slots = ringSlots(segments, ring);
    const middle = ring.columns + faceMiddle;
    const rows = Array.from({ length: ring.rows * 2 + 1 }, (_, row) =>
      slots.flatMap((slot, index) =>
        slot.row === row ? [{ column: slot.column, width: face, element: cell(index) }] : [],
      ),
    );

    rows[ring.rows]?.push({
      column: middle - Math.floor(centreText.length / 2),
      width: centreText.length,
      element: centre,
    });
    wheel = (
      <Box flexDirection="column">
        <Text color={GOLD} bold>{`${" ".repeat(middle)}▼`}</Text>
        {rows.map(line)}
      </Box>
    );
  } else {
    const reach = STRIP_REACH[ring.cell] ?? 0;
    const strip = Array.from({ length: reach * 2 + 1 }, (_, index) => ({
      column: index * ring.cell,
      width: face,
      element: cell(index - reach),
    }));

    wheel = (
      <Box flexDirection="column">
        <Text color={GOLD} bold>{`${" ".repeat(reach * ring.cell + faceMiddle)}▼`}</Text>
        {line(strip)}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      {wheel}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {!isRing && centre}
        {legend.map(([multiplier, color]) => (
          <Text color={FG6}>
            <Text color={color}>●</Text>
            {` ×${multiplier}`}
          </Text>
        ))}
        {landed === null && <Text color={FG6}>{isSpinning ? "spinning…" : "No spin yet."}</Text>}
      </Box>
    </Box>
  );
}

/** The rows `wheelTable` takes: the pointer and the ring (or the strip), a blank, the legend. */
export function wheelRows(segments: number, isWide: boolean): number {
  const ring = RINGS[segments];

  return 1 + (isWide && ring !== undefined ? ring.rows * 2 + 1 : 1) + 2;
}
