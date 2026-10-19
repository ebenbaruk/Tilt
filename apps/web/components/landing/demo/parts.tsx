// Pieces every demo table draws with, after the mod's own (apps/mod/hooks/cards.tsx, view.tsx).
import type { ReactNode } from "react";
import { type Card, cardText, isRed, rankLabel } from "./script";
import styles from "./demo.module.css";

/** A large card: rank and suit in two corners, the suit in the middle; face down, the ░ back. */
export function PlayingCard({ card, faceDown = false }: { card?: Card; faceDown?: boolean }) {
  if (faceDown || card === undefined) {
    return (
      <span className={styles.cardBack}>
        <span>░░░░</span>
        <span>░░░░</span>
        <span>░░░░</span>
      </span>
    );
  }
  const corner = `${rankLabel(card.rank)}${card.suit}`;
  return (
    <span className={isRed(card) ? styles.cardRed : styles.card}>
      <span className={styles.b}>{corner}</span>
      <span className={styles.cardSuit}>{card.suit}</span>
      <span className={`${styles.b} ${styles.cardEnd}`}>{`${card.suit}${rankLabel(card.rank)}`}</span>
    </span>
  );
}

/** A hand of large cards, each overlapping the last, the last `faceDown` of them not turned yet;
 *  `more` lays a back after them: the dealer's card still to come. An empty hand shows `slots`
 *  outlines where its cards will land. */
export function CardStack({
  cards,
  faceDown = 0,
  more = false,
  slots = 0,
}: {
  cards: readonly Card[];
  faceDown?: number;
  more?: boolean;
  slots?: number;
}) {
  const firstHidden = cards.length - faceDown;
  if (cards.length === 0) {
    return (
      <span className={styles.stack}>
        {Array.from({ length: slots }, (_, index) => (
          <span key={index} className={styles.cardSlot} />
        ))}
      </span>
    );
  }
  return (
    <span className={styles.stack}>
      {cards.map((c, index) => (
        <PlayingCard key={index} card={c} faceDown={index >= firstHidden} />
      ))}
      {more && <PlayingCard faceDown />}
    </span>
  );
}

/** A small card on one row, as the mod's history and band draw them. */
export function SmallCard({ card, faceDown = false }: { card: Card; faceDown?: boolean }) {
  if (faceDown) return <span className={styles.smallBack}>▒▒</span>;
  return <span className={isRed(card) ? styles.smallRed : styles.small}>{cardText(card)}</span>;
}

/** A settled round's sentence and its signed net, gold for a gain, red for a loss. */
export function Outcome({ text, net }: { text: string; net: string }) {
  const tone = net.startsWith("+") ? styles.gold : net.startsWith("−") ? styles.red : styles.fg4;
  return (
    <>
      <span className={styles.fg1}>{text}</span>
      <span className={`${tone} ${styles.b}`}>{`  ${net}`}</span>
    </>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className={styles.fg6}>{children}</span>;
}

/** WIN in gold, LOSE in red, PUSH in grey: a settled round's verdict, as blackjack tags its hands. */
export function Verdict({ result }: { result: "WIN" | "LOSE" | "PUSH" }) {
  const tone = result === "WIN" ? styles.gold : result === "LOSE" ? styles.red : styles.fg4;
  return <span className={`${tone} ${styles.b}`}>{result}</span>;
}

/** "multiplier ×1.2857": a label in grey, its value bright. */
export function Stat({ label, value, tone = "fg1" }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <span className={styles.fg4}>
      {label} <span className={`${styles[tone]} ${styles.b}`}>{value}</span>
    </span>
  );
}

export type Tone = "fg1" | "fg4" | "fg6" | "pink" | "gold" | "green" | "red";
