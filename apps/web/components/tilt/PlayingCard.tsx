import type { Card } from "@/lib/round";
import styles from "./PlayingCard.module.css";

type Suit = Card["suit"];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_NAMES: Record<Suit, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };

/** On-chain rank 1 (ace) to 13 (king) as printed on the card. */
export function rankLabel(rank: number): string {
  return RANKS[rank - 1] ?? "?";
}

export type CardFace = { rank: string; suit: Suit } | { hidden: true };

/** A card drawn with CSS borders, not box-drawing glyphs: web fonts subset to Latin don't carry
 *  `┌─│`, and the fallback font's widths broke the frame. Same look as the terminal's. */
export function PlayingCard({ card }: { card: CardFace }) {
  if ("hidden" in card) return <span role="img" aria-label="hidden card" className={styles.hidden} />;
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <span
      role="img"
      aria-label={`${card.rank} of ${SUIT_NAMES[card.suit]}`}
      className={red ? styles.red : styles.black}
    >
      <span className={styles.corner} aria-hidden="true">
        {card.rank}
      </span>
      <span className={styles.suit} aria-hidden="true">
        {card.suit}
      </span>
      <span className={styles.cornerEnd} aria-hidden="true">
        {card.rank}
      </span>
    </span>
  );
}

export function Hand({
  label,
  total,
  meta,
  cards,
}: {
  label: string;
  total: string | number;
  meta?: string;
  cards: CardFace[];
}) {
  return (
    <div className={styles.hand}>
      <div className={styles.label}>
        {label} <span className={styles.total}>{total}</span>
        {meta && <span className={styles.meta}> · {meta}</span>}
      </div>
      <div className={styles.cards}>
        {cards.map((card, i) => (
          <PlayingCard key={i} card={card} />
        ))}
      </div>
    </div>
  );
}
