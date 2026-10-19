// Blackjack as the mod draws it (apps/mod/hooks/blackjack.tsx): no hole card, so the dealer's
// second card is a back until the player's turn ends; cards land face down and turn one a step.
import { CardStack, Muted, Outcome } from "./parts";
import { blackjackTotal, card, type Card, DEAL_STEP_MS, pressedAt, spinnerAt } from "./script";
import type { Frame, GameKey } from "./types";
import styles from "./demo.module.css";

type Seat = "you" | "dealer";

interface Dealt {
  seat: Seat;
  card: Card;
  /** Laid face down at, then turned over at. */
  laid: number;
  shown: number;
}

export interface BlackjackScript {
  bet: string;
  deals: readonly Dealt[];
  presses: readonly (readonly [number, string])[];
  /** When the player's turn ends: a stand, a double, a bust. */
  turnEndsAt: number;
  doubled?: boolean;
  /** None while the hand is still being played when the loop ends. */
  result?: { at: number; tag: "WIN" | "LOSE" | "PUSH" | "BJ"; stake: string; text: string; net: string };
}

export const BLACKJACK_KEYS: readonly GameKey[] = [
  { key: "n", label: "deal · 5.00" },
  { key: "h", label: "hit" },
  { key: "s", label: "stand" },
  { key: "d", label: "double" },
  { key: "p", label: "split" },
];

/** The first cards: one to you, one to the dealer, a second to you, laid together and turned in that order. */
export function firstDeal(at: number, [you1, dealer1, you2]: readonly [string, string, string]): Dealt[] {
  return [
    { seat: "you", card: card(you1), laid: at, shown: at + DEAL_STEP_MS },
    { seat: "dealer", card: card(dealer1), laid: at, shown: at + 2 * DEAL_STEP_MS },
    { seat: "you", card: card(you2), laid: at, shown: at + 3 * DEAL_STEP_MS },
  ];
}

/** A card drawn later: face down for a step, then turned. */
export const draw = (at: number, seat: Seat, name: string): Dealt => ({
  seat,
  card: card(name),
  laid: at,
  shown: at + DEAL_STEP_MS,
});

const PULSE_MS = 400;
const RESULT_TONES = { WIN: styles.green, BJ: styles.gold, PUSH: styles.fg4, LOSE: styles.red } as const;

function seatAt(script: BlackjackScript, seat: Seat, t: number) {
  const laid = script.deals.filter((deal) => deal.seat === seat && deal.laid <= t);
  return { cards: laid.map((deal) => deal.card), faceDown: laid.filter((deal) => deal.shown > t).length };
}

function verdictTag(total: number, count: number) {
  if (total > 21) return <span className={`${styles.red} ${styles.b}`}> BUST</span>;
  if (total === 21 && count === 2) return <span className={`${styles.gold} ${styles.b}`}> BLACKJACK</span>;
  return null;
}

export function blackjackFrame(script: BlackjackScript, t: number): Frame {
  const dealer = seatAt(script, "dealer", t);
  const you = seatAt(script, "you", t);
  const isIdle = you.cards.length === 0;
  const isTurning = dealer.faceDown + you.faceDown > 0;
  const isTurn = !isIdle && !isTurning && t < script.turnEndsAt;
  const more = !isIdle && t < script.turnEndsAt && dealer.cards.length === 1;
  const dealerTotal = blackjackTotal(dealer.cards);
  const yourTotal = blackjackTotal(you.cards);
  const result = script.result && t >= script.result.at ? script.result : null;
  const highlight = Math.floor(t / PULSE_MS) % 2 === 0 ? styles.pink : styles.gold;

  const dealerLabel = dealer.faceDown > 0 || isIdle ? "" : more ? `${dealerTotal.total} + ?` : `${dealerTotal.total}`;
  const youLabel = you.faceDown > 0 || isIdle ? "" : `${yourTotal.soft ? "soft " : ""}${yourTotal.total}`;
  const stake = `${result?.stake ?? script.bet}${script.doubled && t >= script.turnEndsAt ? " doubled" : ""}`;

  const table = (
    <div className={styles.rows}>
      <div className={styles.hand}>
        <span className={styles.fg4}>
          DEALER <span className={styles.fg1}>{dealerLabel}</span>
          {dealerLabel && !more && verdictTag(dealerTotal.total, dealer.cards.length)}
        </span>
        <CardStack cards={dealer.cards} faceDown={dealer.faceDown} more={more} slots={2} />
      </div>
      <div className={styles.hand}>
        <span className={isTurn ? `${highlight} ${styles.b}` : styles.fg4}>
          {isTurn ? "▶ " : ""}YOU <span className={styles.fg1}>{youLabel}</span>
          {youLabel && verdictTag(yourTotal.total, you.cards.length)}
        </span>
        <CardStack cards={you.cards} faceDown={you.faceDown} slots={2} />
        <span className={styles.fg6}>
          {result ? <span className={`${RESULT_TONES[result.tag]} ${styles.b}`}>{result.tag} </span> : "bet "}
          {isIdle ? script.bet : stake}
        </span>
      </div>
    </div>
  );

  let line;
  if (result) line = <Outcome text={result.text} net={result.net} />;
  else if (isIdle) line = <Muted>No hand yet. Deal one with n.</Muted>;
  else if (isTurn) line = <span className={styles.fg2}>Hit, stand or double.</span>;
  else line = <Muted>{`${spinnerAt(t)} drawing`}</Muted>;

  const isPair = you.cards.length === 2 && you.cards[0]?.rank === you.cards[1]?.rank;
  const live = isIdle || result ? ["n"] : isTurn ? ["h", "s", "d", ...(isPair ? ["p"] : [])] : [];
  return { table, line, live, pressed: pressedAt(t, script.presses) };
}

/** The showcase's hand: 11 against a 9, doubled, and the dealer busts. */
export const SHOWCASE_HAND: BlackjackScript = {
  bet: "5.00",
  deals: [
    ...firstDeal(700, ["6♦", "9♣", "5♣"]),
    draw(2700, "you", "10♠"),
    draw(3400, "dealer", "7♥"),
    draw(4100, "dealer", "K♦"),
  ],
  presses: [
    [500, "n"],
    [2500, "d"],
  ],
  turnEndsAt: 2500,
  doubled: true,
  result: { at: 4500, tag: "WIN", stake: "10.00", text: "Dealer busts at 26.", net: "+10.00" },
};
