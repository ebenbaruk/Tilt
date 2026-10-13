import type { RoundView } from "@tilt/api/public";
import { describeRouletteBet, pocketColor, type Card } from "@/lib/round";
import { Hand, rankLabel, type CardFace } from "./PlayingCard";
import styles from "./RoundDetail.module.css";

function faces(cards: Card[]): CardFace[] {
  return cards.map((card) => ({ rank: rankLabel(card.rank), suit: card.suit }));
}

/** The cards, pocket or reels of one round, drawn the way the panel draws them. */
export function RoundDetail({ detail }: { detail: RoundView["detail"] }) {
  switch (detail.game) {
    case "blackjack":
      return (
        <div className={styles.stack}>
          <Hand label="DEALER" total={detail.dealerTotal} cards={faces(detail.dealer)} />
          <Hand
            label="YOU"
            total={detail.playerSoft ? `soft ${detail.playerTotal}` : detail.playerTotal}
            meta={detail.doubled ? "doubled" : undefined}
            cards={faces(detail.player)}
          />
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
