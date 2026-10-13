import type { Card } from "@/lib/round";
import styles from "./PlayingCard.module.css";

type Suit = Card["suit"];

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_NAMES: Record<Suit, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };

/** On-chain rank 1 (ace) to 13 (king) as printed on the card. */
export function rankLabel(rank: number): string {
  return RANKS[rank - 1] ?? "?";
}

const HIDDEN_ART = "┌─────┐\n│░░░░░│\n│░░░░░│\n│░░░░░│\n└─────┘";

function art(rank: string, suit: Suit): string {
  return `┌─────┐\n│${rank.padEnd(2)}   │\n│  ${suit}  │\n│   ${rank.padStart(2)}│\n└─────┘`;
}

export type CardFace = { rank: string; suit: Suit } | { hidden: true };

export function PlayingCard({ card }: { card: CardFace }) {
  if ("hidden" in card) {
    return (
      <pre role="img" aria-label="hidden card" className={styles.hidden}>
        {HIDDEN_ART}
      </pre>
    );
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <pre role="img" aria-label={`${card.rank} of ${SUIT_NAMES[card.suit]}`} className={red ? styles.red : styles.black}>
      {art(card.rank, card.suit)}
    </pre>
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
