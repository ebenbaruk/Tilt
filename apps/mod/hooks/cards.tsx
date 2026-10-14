// Cards and hand rows, shared by blackjack and baccarat.
import type { RenderElement } from "claude-code";

import { cardFace, isRedSuit } from "./format";
import type { Card } from "./protocol";
import { CARD_FACE, CARD_INK, FG1, FG4, FG6, GOLD, LINE4, RED, type Ui } from "./theme";

export const BLACKJACK = 21;
const NATURAL_CARDS = 2;

export interface CardRowOptions {
  /** The last this many cards are drawn face down: dealt, not turned over yet. */
  faceDown?: number;
  /** A "?" after the cards: the dealer's second card, not drawn yet. */
  isMoreToCome?: boolean;
}

export function cardRow(ui: Ui, cards: readonly Card[], options: CardRowOptions = {}): RenderElement {
  const { Box, Text } = ui;
  const firstHidden = cards.length - (options.faceDown ?? 0);

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {cards.map((card, index) =>
        index >= firstHidden ? (
          <Text backgroundColor={LINE4} color={FG6}>
            {" ▒▒ "}
          </Text>
        ) : (
          <Text backgroundColor={CARD_FACE} color={CARD_INK[isRedSuit(card.suit) ? "red" : "black"]} bold>
            {` ${cardFace(card)} `}
          </Text>
        ),
      )}
      {options.isMoreToCome === true && (
        <Text backgroundColor={LINE4} color={FG4}>
          {" ? "}
        </Text>
      )}
    </Box>
  );
}

/** A total's verdict, drawn beside it: over 21 busts, 21 on the first two cards is a blackjack. */
export function handTag(ui: Ui, total: number, cardCount: number): RenderElement | null {
  const { Text } = ui;

  if (total > BLACKJACK) {
    return (
      <Text color={RED} bold>
        {" BUST"}
      </Text>
    );
  }

  if (total === BLACKJACK && cardCount === NATURAL_CARDS) {
    return (
      <Text color={GOLD} bold>
        {" BLACKJACK"}
      </Text>
    );
  }

  return null;
}

/** One row: who, the total and its verdict, then the cards. */
export function handRow(
  ui: Ui,
  hand: { label: string; total: string; tag: RenderElement | null },
  cards: RenderElement,
): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color={FG4}>
        {hand.label} <Text color={FG1}>{hand.total}</Text>
        {hand.tag}
      </Text>
      {cards}
    </Box>
  );
}
