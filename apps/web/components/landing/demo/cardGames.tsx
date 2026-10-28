// Baccarat and Hilo, after apps/mod/hooks/games.tsx and climb.tsx.
import { CardStack, Muted, Outcome, SmallCard, Stat } from "./parts";
import { baccaratPoints, card, type Card, DEAL_STEP_MS, pressedAt, spinnerAt } from "./script";
import type { Frame, GameKey } from "./types";
import styles from "./demo.module.css";

const PULSE_MS = 400;
const pulse = (t: number) => (Math.floor(t / PULSE_MS) % 2 === 0 ? styles.pink : styles.gold);
/** Multipliers as the mod shows them: two decimals, cut, never rounded up. */
export const shortMultiplier = (value: number): string => (Math.floor(value * 100) / 100).toFixed(2);

// ---- Baccarat ----

export const BACCARAT_KEYS: readonly GameKey[] = [
  { key: "n", label: "deal · 5.00" },
  { key: "p", label: "player" },
  { key: "y", label: "banker" },
  { key: "t", label: "tie" },
];

const PUNTO = { cards: ["4♣", "2♦"].map(card), dealt: [0, 2] };
const BANCO = { cards: ["K♠", "5♥", "3♣"].map(card), dealt: [1, 3, 4] };
/** The coup's cards land face down at DEAL_AT and turn one a step; the banker's third comes later. */
const DEAL_AT = 800;
const BANKER_THIRD_AT = 2100;
const BACCARAT_RESULT_AT = 2600;

/** When each card in deal order turns over. */
function baccaratShownAt(order: number): number {
  return order < 4 ? DEAL_AT + (order + 1) * DEAL_STEP_MS : BANKER_THIRD_AT + DEAL_STEP_MS;
}

function baccaratSide(side: typeof PUNTO, t: number) {
  const laid = side.cards.filter((_, i) => (side.dealt[i] < 4 ? DEAL_AT : BANKER_THIRD_AT) <= t);
  const faceDown = laid.filter((_, i) => baccaratShownAt(side.dealt[i]) > t).length;
  return { cards: laid, faceDown, points: baccaratPoints(laid) };
}

export function baccaratFrame(t: number): Frame {
  const player = baccaratSide(PUNTO, t);
  const banker = baccaratSide(BANCO, t);
  const isIdle = player.cards.length === 0;
  const isShown = !isIdle && player.faceDown + banker.faceDown === 0;
  const isSettled = t >= BACCARAT_RESULT_AT;
  const column = (label: string, side: ReturnType<typeof baccaratSide>, wins: boolean) => (
    <div className={styles.hand}>
      <span className={styles.fg4}>
        {label} <span className={styles.fg1}>{isShown ? side.points : ""}</span>
        {isSettled && wins && <span className={`${styles.gold} ${styles.b}`}> WINS</span>}
      </span>
      <CardStack cards={side.cards} faceDown={side.faceDown} slots={2} />
    </div>
  );
  const table = (
    <div className={styles.rows}>
      <span className={styles.fg4}>
        bet <span className={`${styles.fg1} ${styles.b}`}>banker</span>{" "}
        {isSettled ? (
          <span className={styles.fg6}>
            <span className={`${styles.gold} ${styles.b}`}>WIN</span> 5.00
          </span>
        ) : (
          "· pays ×1.95"
        )}
      </span>
      <div className={styles.split}>
        {column("PLAYER", player, false)}
        {column("BANKER", banker, true)}
      </div>
    </div>
  );
  const line = isSettled ? (
    <Outcome text="Banker wins 8 to 6: pays ×1.95." net="+4.75" />
  ) : isIdle ? (
    <Muted>Pick player, banker or tie, then deal with n.</Muted>
  ) : (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  );
  return {
    table,
    line,
    live: isIdle || isSettled ? ["n", "p", "y", "t"] : [],
    pressed: pressedAt(t, [[600, "n"]]),
    selected: ["y"],
  };
}

// ---- Hilo ----

export const HILO_KEYS: readonly GameKey[] = [
  { key: "n", label: "play · 5.00" },
  { key: "h", label: "higher" },
  { key: "l", label: "lower" },
  { key: "s", label: "skip" },
  { key: "z", label: "cash out" },
];

type Guess = "higher" | "lower";
const GUESS_GLYPHS: Record<Guess, string> = { higher: "▲", lower: "▼" };
const RANKS = 13;
const HILO_RETURN = 0.98;
const HILO_STAKE = 5;

/** The ranks of 13 a guess wins on, from this card's rank: the same rank counts, except at the ends. */
function winningRanks(guess: Guess, rank: number): number {
  if (guess === "higher") return rank === 1 ? RANKS - 1 : RANKS + 1 - rank;
  return rank === RANKS ? RANKS - 1 : rank;
}

const guessName = (guess: Guess, rank: number) =>
  (guess === "higher" ? rank === 1 : rank === RANKS) ? guess : `${guess} or same`;

const HILO_CARDS = ["5♣", "J♥", "4♠", "9♦"].map(card);
const GUESSES: readonly Guess[] = ["higher", "lower", "higher"];
/** When each guess is pressed; its card lands a moment later and turns a step after that. */
const GUESS_AT = [1800, 3000, 4200];
const HILO_START_AT = 600;
const CASH_OUT_AT = 5400;
const LAND_MS = 100;

/** The multiplier after `right` right guesses: the 98% return over each guess's chance. */
function hiloMultiplier(right: number): number {
  let value = HILO_RETURN;
  for (let i = 0; i < right; i++) value *= RANKS / winningRanks(GUESSES[i], HILO_CARDS[i].rank);
  return value;
}

export function hiloFrame(t: number): Frame {
  const laidAt = [HILO_START_AT, ...GUESS_AT.map((at) => at + LAND_MS)];
  const laid = HILO_CARDS.filter((_, i) => laidAt[i] <= t);
  const turning = laid.filter((_, i) => laidAt[i] + DEAL_STEP_MS > t).length;
  const shown = laid.length - turning;
  const pending = GUESS_AT.findIndex((at, i) => at <= t && laidAt[i + 1] > t);
  const right = Math.max(0, shown - 1);
  const isIdle = laid.length === 0;
  const isCashedOut = t >= CASH_OUT_AT;
  const isTurn = !isIdle && !isCashedOut && turning === 0 && pending < 0;
  const current = HILO_CARDS[shown - 1];
  const multiplier = hiloMultiplier(right);
  const cashOut = shortMultiplier(HILO_STAKE * multiplier);

  const history = laid.map((c: Card, i) => (
    <span key={i}>
      {i > 0 && <span className={i < shown ? styles.green : styles.fg6}>{` ${GUESS_GLYPHS[GUESSES[i - 1]]} `}</span>}
      <SmallCard card={c} faceDown={i >= shown} />
    </span>
  ));
  const offer = (guess: Guess) =>
    current && (
      <span className={styles.fg4}>
        {`${GUESS_GLYPHS[guess]} ${guessName(guess, current.rank)} `}
        <span className={styles.fg6}>{`${Math.round((winningRanks(guess, current.rank) * 100) / RANKS)}% `}</span>
        <span className={`${styles.fg1} ${styles.b}`}>
          ×{shortMultiplier((multiplier * RANKS) / winningRanks(guess, current.rank))}
        </span>
      </span>
    );

  const state = isCashedOut ? (
    <span className={`${styles.gold} ${styles.b}`}>{`CASHED OUT ×${shortMultiplier(multiplier)}`}</span>
  ) : isTurn ? (
    <span className={`${pulse(t)} ${styles.b}`}>YOUR TURN</span>
  ) : isIdle ? (
    <Muted>Higher or lower: each right guess raises the multiplier.</Muted>
  ) : (
    <span className={styles.fg4}>{`drawing…${pending >= 0 ? ` ${GUESS_GLYPHS[GUESSES[pending]]}` : ""}`}</span>
  );

  const table = (
    <div className={styles.beside}>
      <div className={styles.rows}>
        <CardStack cards={laid} faceDown={turning} more={pending >= 0 && turning === 0} slots={1} />
        <span className={styles.history}>{isIdle ? <Muted>no cards yet</Muted> : history}</span>
      </div>
      <div className={styles.side}>
        <Stat label="multiplier" value={turning > 0 ? "×…" : right === 0 ? "×—" : `×${shortMultiplier(multiplier)}`} />
        {state}
        <span className={isTurn ? undefined : styles.ghost}>{offer("higher")}</span>
        <span className={isTurn ? undefined : styles.ghost}>{offer("lower")}</span>
        <span className={right > 0 && !isCashedOut ? styles.fg4 : styles.ghost}>
          <span className={`${styles.gold} ${styles.b}`}>z</span> cash out{" "}
          <span className={`${styles.gold} ${styles.b}`}>{cashOut}</span>
        </span>
        <Muted>{`${right} right`}</Muted>
      </div>
    </div>
  );

  const line = isCashedOut ? (
    <Outcome
      text={`Cashed out at ×${shortMultiplier(multiplier)} after ${right} right guesses.`}
      net={`+${shortMultiplier(HILO_STAKE * multiplier - HILO_STAKE)}`}
    />
  ) : isIdle ? (
    <Muted>Start with n.</Muted>
  ) : isTurn ? (
    <span className={styles.fg2}>Higher, lower or cash out.</span>
  ) : (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  );
  return {
    table,
    line,
    live: isIdle || isCashedOut ? ["n"] : isTurn ? ["h", "l", "s", ...(right > 0 ? ["z"] : [])] : [],
    pressed: pressedAt(t, HILO_PRESSES),
  };
}

const HILO_PRESSES: readonly (readonly [number, string])[] = [
  [500, "n"],
  ...GUESS_AT.map((at, i) => [at, GUESSES[i] === "higher" ? "h" : "l"] as const),
  [CASH_OUT_AT, "z"],
];
