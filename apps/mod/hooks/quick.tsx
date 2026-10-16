// Dice, Limbo, Flip, Keno and Wheel: one draw each, drawn still by the pane and the table surface
// module alike. A settled round stays on the table while the next one is set up with the same
// choices; once a choice changes, the table shows the next round's instead.
import type { RenderElement } from "claude-code";

import { diceMultiplier, flipMultiplier, scaledDecimal } from "./format";
import type { TileButton } from "./games";
import { diceTarget, DICE_ROLLS, KENO_NUMBERS, KENO_PICK_KEY } from "./keys";
import type { Prefs } from "./model";
import type { DiceView, FlipView, KenoView, LimboView, RoundView, WheelView } from "./protocol";
import { FG1, FG4, FG6, GOLD, GREEN, LINE3, LINE4, PINK, RED, type Ui } from "./theme";

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

/** A segment's color by what it pays: nothing dim, then brighter and warmer as it pays more. */
function segmentColor(pays: string): string {
  const value = hundredths(pays);

  if (value === 0n) {
    return LINE4;
  }

  return value < 200n ? FG4 : value < 500n ? GREEN : value < 2_000n ? GOLD : PINK;
}

/** The wheel unrolled into a strip, a cell per segment, the landed one under `▼`, then what each color pays. */
export function wheelTable(ui: Ui, round: RoundView | null, prefs: Prefs): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "wheel" ? round.detail : null;
  const isSame = detail !== null && detail.segments === prefs.wheelSegments && detail.risk === prefs.wheelRisk;
  const shown: WheelView | null = detail !== null && (isOpen(round) || isSame) ? detail : null;
  const segments = shown?.segments ?? prefs.wheelSegments;
  const width = segments <= 20 ? 2 : 1;
  const landed = shown?.segment ?? null;
  const pays = shown?.multipliers ?? [];
  const legend = [...new Set(pays)].sort((a, b) => Number(hundredths(a) - hundredths(b)));

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text color={GOLD} bold>
          {landed === null ? " " : `${" ".repeat(landed * width)}▼`}
        </Text>
        <Text>
          {Array.from({ length: segments }, (_, segment) => {
            const multiplier = pays[segment];

            return multiplier === undefined ? (
              <Text color={LINE4}>{"░".repeat(width)}</Text>
            ) : (
              <Text color={segmentColor(multiplier)}>{"█".repeat(width)}</Text>
            );
          })}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text color={FG4}>
          {`${segments} segments · `}
          <Text color={FG1} bold>
            {shown?.risk ?? prefs.wheelRisk}
          </Text>
          {" risk"}
        </Text>
        {legend.map((multiplier) => (
          <Text color={FG6}>
            <Text color={segmentColor(multiplier)}>█</Text>
            {` ×${multiplier}`}
          </Text>
        ))}
      </Box>
      {round !== null && shown !== null && landed !== null ? (
        <Text color={resultColor(round)} bold>
          {`landed on ×${pays[landed] ?? "0.00"}`}
        </Text>
      ) : (
        <Text color={FG6}>{shown !== null && isOpen(round) ? "spinning…" : "No spin yet."}</Text>
      )}
    </Box>
  );
}
