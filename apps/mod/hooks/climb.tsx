// Hilo and Tower: a draw per move, a cash-out between moves, as Mines. Drawn still by the pane
// and the table surface module alike.
import type { RenderElement } from "claude-code";

import { type CardSize, handCards } from "./cards";
import { cardFace, cashOutPayout, formatUsdc, towerMultiplier } from "./format";
import {
  MINE_GLYPH,
  pendingLook,
  SAFE_GLYPH,
  stakeTile,
  TILE_FILL,
  TILE_INK,
  type TileButton,
  type TileLook,
  type TileSize,
} from "./games";
import { TOWER_LEVELS, TOWER_SHAPES, TOWER_TILE_KEY, tileLetter } from "./keys";
import type { Prefs } from "./model";
import type { HiloGuess, HiloView, RoundView, TowerView } from "./protocol";
import { FG1, FG4, FG6, GOLD, PINK, RED, type Ui } from "./theme";

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

/**
 * A tower tile: a row, wider than tall, as Stake's; narrower compact. The nine levels touch, to fit
 * any pane: alternate hidden levels take the second shade, the multipliers on the left part them too.
 */
const TOWER_TILE: Record<CardSize, TileSize> = {
  large: { columns: 7, hasEdge: false },
  small: { columns: 5, hasEdge: false },
};

/** The tower round to show: the open one, or the last one while the next is played at its difficulty. */
function shownTower(round: RoundView | null, prefs: Prefs): TowerView | null {
  const detail = round?.detail.game === "tower" ? round.detail : null;

  return round !== null && detail !== null && (isOpen(round) || detail.difficulty === prefs.towerDifficulty)
    ? detail
    : null;
}

/**
 * Nine levels, the top first, each with what reaching it pays on its left. Climbed levels show the
 * tile picked as a gem, the others dark; the level being played is lit and offers its tiles, the
 * one being drawn pulsing; a bust shows the mine where it fell. Nothing else is known: each climb
 * draws on its own, no level is laid out ahead. Every state takes the same rows.
 */
export function towerTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  frame: number,
  size: CardSize,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = shownTower(round, prefs);
  const difficulty = detail?.difficulty ?? prefs.towerDifficulty;
  const { tiles, safe } = TOWER_SHAPES[difficulty];
  const climbed = detail?.climbed ?? [];
  const isPlaying = round !== null && detail !== null && isOpen(round);
  const tileSize = TOWER_TILE[size];
  const plain = (fill: string): TileLook => ({ fill, glyph: null, ink: TILE_INK.letter });
  const tileCell = (level: number, tile: number): RenderElement => {
    if (level < climbed.length) {
      return climbed[level] === tile
        ? stakeTile(ui, tileSize, { fill: TILE_FILL.safe, glyph: SAFE_GLYPH, ink: TILE_INK.gem }, null, tileButton)
        : stakeTile(ui, tileSize, plain(TILE_FILL.dark), null, tileButton);
    }

    if (level > climbed.length || detail === null) {
      return stakeTile(ui, tileSize, plain(level % 2 === 1 ? TILE_FILL.hiddenAlt : TILE_FILL.hidden), null, tileButton);
    }

    if (detail.busted === tile) {
      return stakeTile(ui, tileSize, { fill: TILE_FILL.mine, glyph: MINE_GLYPH, ink: TILE_INK.mine }, null, tileButton);
    }

    if (detail.pending === tile) {
      return stakeTile(ui, tileSize, pendingLook(frame), null, tileButton);
    }

    const key = isPlaying ? { address: `${TOWER_TILE_KEY}${tile}`, letter: tileLetter(tile) } : null;

    return stakeTile(ui, tileSize, plain(isPlaying ? TILE_FILL.lit : TILE_FILL.hidden), key, tileButton);
  };
  const pays = Array.from({ length: TOWER_LEVELS }, (_, level) => `×${towerMultiplier(tiles, safe, level + 1)}`);
  const paysWidth = Math.max(...pays.map((pay) => pay.length));
  const rows = Array.from({ length: TOWER_LEVELS }, (_, index) => {
    const level = TOWER_LEVELS - 1 - index;
    const isReached = level < climbed.length;
    const isCurrent = level === climbed.length && isPlaying;

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={isCurrent ? PINK : isReached ? GOLD : FG6} bold={isCurrent || isReached}>
          {(pays[level] ?? "").padStart(paysWidth)}
        </Text>
        {Array.from({ length: tiles }, (_, tile) => tileCell(level, tile))}
      </Box>
    );
  });

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={4} justifyContent="center">
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
