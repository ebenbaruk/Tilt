import type { RoundView } from "@tilt/api/public";
import { describeRouletteBet, pocketColor, type BlackjackHand, type Card, type MinesDetail } from "@/lib/round";
import { Hand, rankLabel, type CardFace } from "./PlayingCard";
import styles from "./RoundDetail.module.css";

function faces(cards: Card[]): CardFace[] {
  return cards.map((card) => ({ rank: rankLabel(card.rank), suit: card.suit }));
}

/** "split · doubled · win": what happened to a blackjack hand, once known. */
function handMeta(hand: BlackjackHand): string | undefined {
  const parts = [hand.split ? "split" : null, hand.doubled ? "doubled" : null, hand.result].filter(
    (part) => part !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

const MINES_TILES = 25;
const MINES_COLUMNS = 5;

function tileName(tile: number): string {
  return `row ${Math.floor(tile / MINES_COLUMNS) + 1} column ${(tile % MINES_COLUMNS) + 1}`;
}

/** "cashed out at ×1.4500": how a mines round ended, once known. */
function minesOutcome(detail: MinesDetail): string {
  if (detail.busted !== null) return `hit a mine at ${tileName(detail.busted)}`;
  if (detail.pending !== null) return `${tileName(detail.pending)} awaiting its draw`;
  if (detail.revealed.length === 0) return "no tile revealed";
  return `cashed out at ×${detail.multiplier}`;
}

/** The 5×5 board: safe tiles numbered in reveal order, the busting mine, the rest hidden. */
function MinesBoard({ detail }: { detail: MinesDetail }) {
  const order = new Map(detail.revealed.map((tile, i) => [tile, i + 1]));
  const outcome = minesOutcome(detail);
  return (
    <div className={styles.stack}>
      <div className={styles.mines} role="img" aria-label={`${detail.revealed.length} safe tiles revealed, ${outcome}`}>
        {Array.from({ length: MINES_TILES }, (_, tile) => {
          const step = order.get(tile);
          if (tile === detail.busted)
            return (
              <span key={tile} className={`${styles.tile} ${styles.mine}`}>
                ✸
              </span>
            );
          if (step !== undefined)
            return (
              <span key={tile} className={`${styles.tile} ${styles.safe}`}>
                {step}
              </span>
            );
          return (
            <span key={tile} className={styles.tile}>
              {tile === detail.pending ? "…" : "·"}
            </span>
          );
        })}
      </div>
      <p className={styles.muted}>
        {detail.mines} {detail.mines === 1 ? "mine" : "mines"} · {outcome}
      </p>
    </div>
  );
}

/** The cards, pocket, reels or board of one round, drawn the way the panel draws them. */
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
    case "mines":
      return <MinesBoard detail={detail} />;
  }
}
