// Dice, Limbo, Flip and Keno: one draw each, played out as the mod plays them (apps/mod/hooks/quick.tsx).
import { Muted, Outcome, Stat, Verdict } from "./parts";
import { easeOut, pressedAt, spinnerAt } from "./script";
import type { Frame, GameKey } from "./types";
import styles from "./demo.module.css";

const DRAW_AT = 600;
const START_PRESS: readonly (readonly [number, string])[] = [[400, "n"]];

// ---- Dice ----

export const DICE_KEYS: readonly GameKey[] = [
  { key: "n", label: "roll · 5.00" },
  { key: "o", label: "roll under" },
  { key: "j", label: "chance −" },
  { key: "k", label: "chance +" },
];

/** Rolls are 0 to 9999, shown 00.00 to 99.99; the track is 40 cells of 250 rolls. */
const DICE_ROLLS = 10_000;
const DICE_CELLS = 40;
const ROLLS_PER_CELL = DICE_ROLLS / DICE_CELLS;
const TARGET = 4_900;
const ROLL = 7_125;
const DICE_ROLL_MS = 1_000;
const TUMBLE_FRAME_MS = 60;
/** Prime to the rolls, so the tumble visits all of them. */
const TUMBLE_STRIDE = 6_133;
const rollText = (roll: number) => (roll / 100).toFixed(2).padStart(5, "0");

/** The roll shown `elapsed` into it: tumbling, closing in on the drawn roll until it rests there. */
function rollAt(elapsed: number): number {
  if (elapsed >= DICE_ROLL_MS) return ROLL;
  const tumbling = ((Math.floor(elapsed / TUMBLE_FRAME_MS) + 1) * TUMBLE_STRIDE) % DICE_ROLLS;
  return Math.round(tumbling + (ROLL - tumbling) * easeOut(elapsed, 0, DICE_ROLL_MS));
}

export function diceFrame(t: number): Frame {
  const elapsed = t - DRAW_AT;
  const roll = elapsed < 0 ? null : rollAt(elapsed);
  const isRolling = elapsed >= 0 && elapsed < DICE_ROLL_MS;
  const landed = elapsed >= DICE_ROLL_MS;
  const targetCell = Math.round(TARGET / ROLLS_PER_CELL);
  const table = (
    <div className={styles.beside}>
      <div className={styles.track}>
        <span className={`${styles.trackMarker} ${landed ? styles.red : styles.fg1} ${styles.b}`}>
          {roll !== null && <span style={{ marginLeft: `${Math.floor(roll / ROLLS_PER_CELL)}ch` }}>▼</span>}
        </span>
        <span className={styles.trackBar}>
          {Array.from({ length: DICE_CELLS }, (_, cell) => (
            <span
              key={cell}
              className={
                cell === targetCell
                  ? styles.trackTarget
                  : (cell + 0.5) * ROLLS_PER_CELL < TARGET
                    ? styles.trackWin
                    : styles.trackLose
              }
            />
          ))}
        </span>
        <span className={`${styles.trackScale} ${styles.fg6}`}>
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </span>
      </div>
      <div className={styles.side}>
        <Stat label="roll under" value="49.00" />
        <span className={styles.fg4}>win chance 49.00%</span>
        <Stat label="multiplier" value="×2.00" />
        {roll === null ? (
          <Muted>No roll yet.</Muted>
        ) : isRolling ? (
          <span className={`${styles.fg1} ${styles.b}`}>{`rolling ${rollText(roll)}`}</span>
        ) : (
          <span className={styles.fg4}>
            rolled <span className={`${styles.red} ${styles.b}`}>{rollText(roll)}</span> <Verdict result="LOSE" />
          </span>
        )}
      </div>
    </div>
  );
  const line = landed ? (
    <Outcome text="Rolled 71.25: under 49.00 loses." net="−5.00" />
  ) : isRolling ? (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  ) : (
    <Muted>Roll over or under the target with n.</Muted>
  );
  return { table, line, live: isRolling ? [] : ["n", "o", "j", "k"], pressed: pressedAt(t, START_PRESS) };
}

// ---- Limbo ----

export const LIMBO_KEYS: readonly GameKey[] = [
  { key: "n", label: "play · 5.00" },
  { key: "j", label: "target −" },
  { key: "k", label: "target +" },
];

/** Hundredths: target ×3.00, drawn ×7.48. */
const LIMBO_TARGET = 300;
const LIMBO_RESULT = 748;
const LIMBO_RISE_MS = 1_000;

/** The multiplier `elapsed` into its rise: by ratios, fast at first, slowing onto the result. */
function limboAt(elapsed: number): number {
  return Math.min(LIMBO_RESULT, Math.floor(100 * (LIMBO_RESULT / 100) ** easeOut(elapsed, 0, LIMBO_RISE_MS)));
}

export function limboFrame(t: number): Frame {
  const elapsed = t - DRAW_AT;
  const current = elapsed < 0 ? null : limboAt(elapsed);
  const landed = elapsed >= LIMBO_RISE_MS;
  const reached = current !== null && current >= LIMBO_TARGET;
  const tone = current === null ? styles.fg6 : reached ? styles.gold : styles.fg1;
  const table = (
    <div className={styles.beside}>
      <span className={`${styles.limbo} ${landed ? styles.limboLit : ""}`}>
        <span className={`${tone} ${styles.b}`}>{current === null ? "×—" : `×${(current / 100).toFixed(2)}`}</span>
      </span>
      <div className={styles.side}>
        <Stat label="target" value="×3.00" />
        <span className={styles.fg4}>win chance 32.66%</span>
        {current === null ? (
          <Muted>The result has to reach the target.</Muted>
        ) : landed ? (
          <Verdict result="WIN" />
        ) : (
          <Muted>rising…</Muted>
        )}
      </div>
    </div>
  );
  const line = landed ? (
    <Outcome text="×7.48 reaches ×3.00." net="+10.00" />
  ) : current !== null ? (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  ) : (
    <Muted>Pick a target, then play with n.</Muted>
  );
  return { table, line, live: current !== null && !landed ? [] : ["n", "j", "k"], pressed: pressedAt(t, START_PRESS) };
}

// ---- Flip ----

export const FLIP_KEYS: readonly GameKey[] = [
  { key: "n", label: "flip · 5.00" },
  { key: "h", label: "heads" },
  { key: "t", label: "tails" },
  { key: "j", label: "coins −" },
  { key: "k", label: "coins +" },
];

const SPINNING_COIN = ["(|)", "(/)", "(-)", "(\\)"];
const COIN_TURN_MS = 100;
const FLIP_FIRST_MS = 450;
const FLIP_STEP_MS = 150;
const COINS = ["H", "T", "H"];
/** Every coin must land on heads: the second one decides the round, the third shows dim. */
const DECIDING = 2;
const FLIP_RESULT_AT = DRAW_AT + FLIP_FIRST_MS + (DECIDING - 1) * FLIP_STEP_MS;

export function flipFrame(t: number): Frame {
  const elapsed = t - DRAW_AT;
  const landedCoins =
    elapsed < FLIP_FIRST_MS ? 0 : Math.min(DECIDING, 1 + Math.floor((elapsed - FLIP_FIRST_MS) / FLIP_STEP_MS));
  const isSettled = t >= FLIP_RESULT_AT;
  const coins = COINS.map((side, index) => {
    if (elapsed < 0) return { text: "( )", tone: styles.dim };
    if (isSettled) {
      const tone = index >= DECIDING ? styles.fg6 : side === "H" ? styles.gold : styles.red;
      return { text: `(${side})`, tone };
    }
    if (index < landedCoins) return { text: `(${side})`, tone: side === "H" ? styles.gold : styles.red };
    return {
      text: SPINNING_COIN[(Math.floor(elapsed / COIN_TURN_MS) + index) % SPINNING_COIN.length],
      tone: styles.fg4,
    };
  });
  const table = (
    <div className={styles.rows}>
      <span className={styles.coins}>
        {coins.map((coin, index) => (
          <span key={index} className={`${coin.tone} ${styles.b}`}>
            {coin.text}
          </span>
        ))}
      </span>
      <span className={styles.fg4}>
        3 × <span className={`${styles.fg1} ${styles.b}`}>heads</span> pays{" "}
        <span className={`${styles.fg1} ${styles.b}`}>×7.84</span>
        {isSettled ? (
          <>
            {"  "}
            <Verdict result="LOSE" />
          </>
        ) : (
          <span className={styles.fg6}> · every coin has to land on it</span>
        )}
      </span>
    </div>
  );
  const line = isSettled ? (
    <Outcome text="Tails on coin 2 of 3." net="−5.00" />
  ) : elapsed >= 0 ? (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  ) : (
    <Muted>Call heads or tails, then flip with n.</Muted>
  );
  return {
    table,
    line,
    live: elapsed >= 0 && !isSettled ? [] : ["n", "h", "t", "j", "k"],
    pressed: pressedAt(t, START_PRESS),
    selected: ["h"],
  };
}

// ---- Keno ----

export const KENO_KEYS: readonly GameKey[] = [
  { key: "n", label: "play · 5.00 · 5 picks" },
  { key: "r", label: "random picks" },
];

const KENO_NUMBERS = 40;
const PICKS = new Set([7, 12, 19, 26, 33]);
const DRAWN = [3, 12, 21, 38, 26, 9, 15, 30, 1, 36];
/** Five picks' pay table, as chain/…/games/keno.rs pays it: ×0 for no hit up to ×100 for five. */
const KENO_PAYS = ["0.00", "0.25", "1.35", "3.80", "13.70", "100.00"];
const KENO_STEP_MS = 150;
const KENO_RESULT_AT = DRAW_AT + DRAWN.length * KENO_STEP_MS;

export function kenoFrame(t: number): Frame {
  const elapsed = t - DRAW_AT;
  const lit = elapsed < 0 ? [] : DRAWN.slice(0, 1 + Math.floor(elapsed / KENO_STEP_MS));
  const drawn = new Set(lit);
  const isSettled = t >= KENO_RESULT_AT;
  const newest = isSettled ? undefined : lit[lit.length - 1];
  const hits = lit.filter((n) => PICKS.has(n)).length;
  const cell = (n: number) => {
    const isPick = PICKS.has(n);
    const isDrawn = drawn.has(n);
    const text = isPick ? `[${String(n).padStart(2, " ")}]` : ` ${String(n).padStart(2, " ")} `;
    if (n === newest) {
      return (
        <span key={n} className={`${isPick ? styles.chipGold : styles.chipGrey} ${styles.b}`}>
          {text}
        </span>
      );
    }
    const tone = isPick ? (isDrawn ? styles.gold : styles.pink) : isDrawn ? styles.fg1 : styles.fg6;
    return (
      <span key={n} className={`${tone} ${isPick || isDrawn ? styles.b : ""}`}>
        {text}
      </span>
    );
  };
  const hitsText = `${hits} ${hits === 1 ? "hit" : "hits"}`;
  const table = (
    <div className={styles.rows}>
      <div className={styles.beside}>
        <span className={styles.keno}>{Array.from({ length: KENO_NUMBERS }, (_, i) => cell(i + 1))}</span>
        <div className={styles.side}>
          <span className={styles.fg4}>
            <span className={`${styles.pink} ${styles.b}`}>5</span> picks
          </span>
          {lit.length === 0 ? (
            <Muted>Ten numbers are drawn.</Muted>
          ) : isSettled ? (
            <span className={`${styles.gold} ${styles.b}`}>
              {hitsText} <Verdict result="WIN" />
            </span>
          ) : (
            <span className={`${hits > 0 ? styles.gold : styles.fg4} ${styles.b}`}>{hitsText}</span>
          )}
        </div>
      </div>
      <span className={styles.wrapRow}>
        <Muted>HITS</Muted>
        {KENO_PAYS.map((pays, count) => {
          const label = `${count} ×${pays}`;
          if (lit.length > 0 && count === hits) {
            return isSettled ? (
              <span key={count} className={`${styles.chipGold} ${styles.b}`}>{` ${label} `}</span>
            ) : (
              <span key={count} className={`${styles.fg1} ${styles.b}`}>
                {label}
              </span>
            );
          }
          return (
            <span key={count} className={pays === "0.00" ? styles.fg6 : styles.fg4}>
              {label}
            </span>
          );
        })}
      </span>
    </div>
  );
  const line = isSettled ? (
    <Outcome text="2 hits of 5 picks." net="+1.75" />
  ) : elapsed >= 0 ? (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  ) : (
    <Muted>Pick 1 to 10 numbers, then play with n.</Muted>
  );
  return { table, line, live: elapsed >= 0 && !isSettled ? [] : ["n", "r"], pressed: pressedAt(t, START_PRESS) };
}
