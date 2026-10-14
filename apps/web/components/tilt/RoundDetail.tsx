import type { RoundView } from "@tilt/api/public";
import { describeRouletteBet, pocketColor, type BlackjackHand, type Card } from "@/lib/round";
import { Hand, rankLabel, type CardFace } from "./PlayingCard";
import styles from "./RoundDetail.module.css";

function faces(cards: Card[]): CardFace[] {
  return cards.map((card) => ({ rank: rankLabel(card.rank), suit: card.suit }));
}

/** "doubled · win": what happened to a blackjack hand, once known. */
function handMeta(hand: BlackjackHand): string | undefined {
  const parts = [hand.doubled ? "doubled" : null, hand.result].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The cards, pocket or reels of one round, drawn the way the panel draws them. */
export function RoundDetail({ detail }: { detail: RoundView["detail"] }) {
  switch (detail.game) {
    case "blackjack":
      return (
        <div className={styles.stack}>
          <Hand label="DEALER" total={detail.dealerTotal} cards={faces(detail.dealer)} />
          {detail.hands.map((hand, i) => (
            <Hand
              key={i}
              label={detail.hands.length === 1 ? "YOU" : `HAND ${i + 1}`}
              total={hand.soft ? `soft ${hand.total}` : hand.total}
              meta={handMeta(hand)}
              cards={faces(hand.cards)}
            />
          ))}
        </div>
      );
    case "baccarat":
      return (
        <div className={styles.stack}>
          <Hand label="PLAYER" total={detail.playerPoints} cards={faces(detail.player)} />
          <Hand label="BANKER" total={detail.bankerPoints} cards={faces(detail.banker)} />
          <p className={styles.muted}>bet on {detail.bet}</p>
        </div>
      );
    case "roulette":
      return (
        <div className={styles.stack}>
          {detail.number === null ? (
            <p className={styles.muted}>no pocket drawn</p>
          ) : (
            <span className={`${styles.pocket} ${styles[pocketColor(detail.number)]}`}>{detail.number}</span>
          )}
          <p className={styles.muted}>bet {describeRouletteBet(detail.bet)}</p>
        </div>
      );
    case "slots":
      return detail.reels === null ? (
        <p className={styles.muted}>reels not drawn</p>
      ) : (
        <div className={styles.reels} role="img" aria-label={`reels ${detail.reels.join(" ")}`}>
          {detail.reels.map((symbol, i) => (
            <span key={i} className={styles.reel}>
              {symbol}
            </span>
          ))}
        </div>
      );
  }
}
