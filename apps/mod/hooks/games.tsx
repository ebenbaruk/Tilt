// Roulette, baccarat and slots tables, drawn still by the pane and the table surface module alike.
import type { RenderElement } from "claude-code";

import { type CardSize, handCards, handRow } from "./cards";
import { cleanText, pocketColor, rouletteBetLabel } from "./format";
import type { Prefs } from "./model";
import type { RoundView } from "./protocol";
import { FELT, FELT_INK, FELT_INK_DIM, FG1, FG4, FG6, GOLD, LINE3, LINE4, PINK, type Ui } from "./theme";

const WHEEL_POCKETS = 37;
/** A pocket on the strip: its number, padded, on its felt. */
const POCKET_COLUMNS = 4;
const REEL_COLUMNS = 7;
const IDLE_REEL = "░";

const pocketAt = (pocket: number, offset: number): number =>
  (((pocket + offset) % WHEEL_POCKETS) + WHEEL_POCKETS) % WHEEL_POCKETS;

/** The wheel unrolled around the ball's pocket, the ball marked `▲` under it, as the design system's RouletteStrip. */
function rouletteStrip(ui: Ui, pocket: number, reach: number): RenderElement {
  const { Box, Text } = ui;
  const offsets = Array.from({ length: reach * 2 + 1 }, (_, index) => index - reach);
  const marker = `${" ".repeat((POCKET_COLUMNS + 1) * reach)}${"  ▲".padEnd(POCKET_COLUMNS)}`;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {offsets.map((offset) => {
          const number = pocketAt(pocket, offset);
          const isBall = offset === 0;

          return (
            <Text backgroundColor={FELT[pocketColor(number)]} color={isBall ? FELT_INK : FELT_INK_DIM} bold={isBall}>
              {` ${String(number).padStart(2)} `}
            </Text>
          );
        })}
      </Box>
      <Text color={GOLD} bold>
        {marker}
      </Text>
    </Box>
  );
}

export function rouletteTable(ui: Ui, round: RoundView | null, prefs: Prefs, isWide: boolean): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "roulette" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const bet = isOpen && detail !== null ? detail.bet : prefs.roulette;
  const number = detail?.number ?? null;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={FG4}>
        bet{" "}
        <Text color={FG1} bold>
          {rouletteBetLabel(bet)}
        </Text>
      </Text>
      {number === null ? (
        <Text color={FG6}>Pick a bet, then spin with n.</Text>
      ) : (
        <Box flexDirection="column">
          {rouletteStrip(ui, number, isWide ? 6 : 3)}
          <Text color={FG1} bold>
            {`${number} ${pocketColor(number).toUpperCase()}`}
          </Text>
        </Box>
      )}
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

/** Sevens in Tilt's pink and stars in gold, as the design system's SlotReel; the rest in the text color. */
const slotColor = (symbol: string): string => (symbol === "7" ? PINK : symbol === "★" ? GOLD : FG1);

/** Three reels in a machine, the payline marked on both sides, as the design system's SlotMachine. */
export function slotsTable(ui: Ui, round: RoundView | null, size: CardSize): RenderElement {
  const { Box, Text } = ui;
  const reels = round?.detail.game === "slots" ? round.detail.reels : null;
  const symbols = reels ?? [IDLE_REEL, IDLE_REEL, IDLE_REEL];
  const isLarge = size === "large";

  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      {isLarge && (
        <Text color={GOLD} bold>
          ▸
        </Text>
      )}
      <Box
        flexDirection="row"
        columnGap={1}
        borderStyle={isLarge ? "round" : undefined}
        borderColor={LINE3}
        paddingX={isLarge ? 1 : 0}
      >
        {symbols.map((symbol) => (
          <Box
            borderStyle="round"
            borderColor={LINE4}
            width={isLarge ? REEL_COLUMNS : undefined}
            paddingX={1}
            paddingY={isLarge ? 1 : 0}
            justifyContent="center"
          >
            <Text bold color={reels === null ? LINE4 : slotColor(symbol)}>
              {cleanText(symbol)}
            </Text>
          </Box>
        ))}
      </Box>
      {isLarge && (
        <Text color={GOLD} bold>
          ◂
        </Text>
      )}
    </Box>
  );
}
