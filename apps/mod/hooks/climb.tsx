// Hilo and Tower: a draw per move, a cash-out between moves, as Mines. Drawn still by the pane
// and the table surface module alike.
import type { RenderElement } from "claude-code";

import { type CardSize, handCards } from "./cards";
import { cardFace, cashOutPayout, formatUsdc, towerMultiplier } from "./format";
import { pendingGlyph, type TileButton } from "./games";
import { TOWER_LEVELS, TOWER_SHAPES, TOWER_TILE_KEY, tileLetter } from "./keys";
import type { Prefs } from "./model";
import type { HiloGuess, HiloView, RoundView, TowerView } from "./protocol";
import { FG1, FG4, FG6, GOLD, LINE4, PINK, RED, type Ui } from "./theme";

const isOpen = (round: RoundView): boolean => round.phase !== "idle";

/** Cards on the table: the last ones drawn, the trail under them says the guesses. */
const HILO_SHOWN = 8;
const GUESS_GLYPHS: Record<HiloGuess, string> = { higher: "▲", lower: "▼", skip: "⇥" };
/** The ranks the api sends for an ace and a king: there, higher and lower are strict bets. */
const ACE_RANK = 1;
const KING_RANK = 13;

/** Right guesses so far: every guess but the skips, and the wrong one that busted. */
export function hiloRight(detail: HiloView): number {
  return detail.guesses.filter((guess) => guess !== "skip").length - (detail.busted ? 1 : 0);
}

/** "K♠ ▼ 9♥ ▲ Q♦": the cards shown, each after the guess that drew it. */
function hiloTrail(detail: HiloView, from: number): string {
  const cards = detail.cards.slice(from).map((card, index) => {
    const guess = detail.guesses[from + index - 1];

    return guess === undefined ? cardFace(card) : `${GUESS_GLYPHS[guess]} ${cardFace(card)}`;
  });
  const pending = detail.pending === null ? "" : ` ${GUESS_GLYPHS[detail.pending]} …`;

  return `${cards.join(" ")}${pending}`;
}

/** The last cards drawn, the current one last, the multipliers the next guess would bring beside them. */
export function hiloTable(ui: Ui, round: RoundView | null, size: CardSize): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "hilo" ? round.detail : null;

  if (round === null || detail === null) {
    return (
      <Text color={FG6}>
        Guess whether the next card is higher or lower: each right guess raises the multiplier. Start with n.
      </Text>
    );
  }

  const open = isOpen(round);
  const from = Math.max(0, detail.cards.length - HILO_SHOWN);
  const right = hiloRight(detail);
  const rank = detail.cards.at(-1)?.rank;
  const odds = (label: string, multiplier: string | null) =>
    open &&
    multiplier !== null && (
      <Text color={FG4}>
        {`${label} `}
        <Text color={FG1}>{`×${multiplier}`}</Text>
      </Text>
    );

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      <Box flexDirection="column">
        {detail.cards.length === 0 ? (
          <Text color={FG6}>drawing the first card…</Text>
        ) : (
          handCards(ui, detail.cards.slice(from), size)
        )}
        <Text color={detail.busted ? RED : FG6}>{hiloTrail(detail, from)}</Text>
      </Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          multiplier{" "}
          <Text color={FG1} bold>
            {`×${detail.multiplier}`}
          </Text>
        </Text>
        {odds(rank === ACE_RANK ? "higher" : "higher or same", detail.higherMultiplier)}
        {odds(rank === KING_RANK ? "lower" : "lower or same", detail.lowerMultiplier)}
        {open && <Text color={FG6}>{`${detail.skipsLeft} ${detail.skipsLeft === 1 ? "skip" : "skips"} left`}</Text>}
        {open && detail.canCashOut && (
          <Text color={FG4}>
            cash out{" "}
            <Text color={GOLD} bold>
              {formatUsdc(cashOutPayout(round.stake, detail.multiplier))}
            </Text>
          </Text>
        )}
        {detail.busted && (
          <Text color={RED} bold>
            wrong guess
          </Text>
        )}
        <Text color={FG6}>{`${right} right`}</Text>
      </Box>
    </Box>
  );
}

/** A tile's cell on the tower: its glyph at the right of these columns, where a key's `a: ·` ends. */
const TOWER_CELL = 4;

/** The tower round to show: the open one, or the last one while the next is played at its difficulty. */
function shownTower(round: RoundView | null, prefs: Prefs): TowerView | null {
  const detail = round?.detail.game === "tower" ? round.detail : null;

  return round !== null && detail !== null && (isOpen(round) || detail.difficulty === prefs.towerDifficulty)
    ? detail
    : null;
}

/**
 * Nine levels, the top first, each with what reaching it pays. Climbed levels show the tile picked
 * ◆ in gold; the level being played offers its tiles (their keys, or the letters dim while none is
 * live), the one being drawn turning; a bust shows ✸ where it fell. Nothing else is known: each
 * climb draws on its own, no level is laid out ahead.
 */
export function towerTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  frame: number,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = shownTower(round, prefs);
  const difficulty = detail?.difficulty ?? prefs.towerDifficulty;
  const { tiles, safe } = TOWER_SHAPES[difficulty];
  const climbed = detail?.climbed ?? [];
  const isPlaying = round !== null && detail !== null && isOpen(round);
  const glyph = (text: string, color: string, bold = true) => (
    <Text color={color} bold={bold}>
      {text.padStart(TOWER_CELL)}
    </Text>
  );
  const tileCell = (level: number, tile: number): RenderElement => {
    if (level < climbed.length) {
      return climbed[level] === tile ? glyph("◆", GOLD) : glyph("·", LINE4, false);
    }

    if (level > climbed.length || detail === null) {
      return glyph("·", LINE4, false);
    }

    if (detail.busted === tile) {
      return glyph("✸", RED);
    }

    if (detail.pending === tile) {
      return glyph(pendingGlyph(frame), PINK);
    }

    const face = <Text dimColor>{tileLetter(tile)}</Text>;
    const button = isPlaying ? tileButton(`${TOWER_TILE_KEY}${tile}`, face) : null;

    return button === null ? (
      glyph(isPlaying ? tileLetter(tile) : "·", isPlaying ? FG4 : LINE4, false)
    ) : (
      <Box width={TOWER_CELL} justifyContent="flex-end">
        {button}
      </Box>
    );
  };
  const rows = Array.from({ length: TOWER_LEVELS }, (_, index) => {
    const level = TOWER_LEVELS - 1 - index;
    const isReached = level < climbed.length;
    const isCurrent = level === climbed.length && isPlaying;

    return (
      <Box flexDirection="row">
        <Text color={isCurrent ? PINK : FG6}>{isCurrent ? "▸" : " "}</Text>
        {Array.from({ length: tiles }, (_, tile) => tileCell(level, tile))}
        <Text color={isReached ? GOLD : FG6} bold={isReached}>
          {`  ×${towerMultiplier(tiles, safe, level + 1)}`}
        </Text>
      </Box>
    );
  });

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      <Box flexDirection="column">{rows}</Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          <Text color={PINK} bold>
            {difficulty}
          </Text>
          {` · ${safe} safe of ${tiles}`}
        </Text>
        {round !== null && detail !== null && (
          <Text color={FG4}>
            multiplier{" "}
            <Text color={FG1} bold>
              {`×${detail.multiplier}`}
            </Text>
          </Text>
        )}
        {isPlaying && detail.nextMultiplier !== null && (
          <Text color={FG4}>
            next level <Text color={FG1}>{`×${detail.nextMultiplier}`}</Text>
          </Text>
        )}
        {isPlaying && detail.canCashOut && (
          <Text color={FG4}>
            cash out{" "}
            <Text color={GOLD} bold>
              {formatUsdc(cashOutPayout(round.stake, detail.multiplier))}
            </Text>
          </Text>
        )}
        {detail === null ? (
          <Text color={FG6}>Pick the difficulty with j and k, then play with n.</Text>
        ) : (
          <Text color={FG6}>{`${climbed.length} ${climbed.length === 1 ? "level" : "levels"}`}</Text>
        )}
      </Box>
    </Box>
  );
}
