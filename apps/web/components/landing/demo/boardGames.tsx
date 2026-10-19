// Mines and Tower, after apps/mod/hooks/games.tsx and climb.tsx. Nothing is laid out ahead: each
// tile is drawn when it is picked, so a settled board shows only the tiles picked and the mine
// that ended it, if one did.
import type { ReactNode } from "react";
import { Muted, Outcome, Stat } from "./parts";
import { pressedAt, spinnerAt } from "./script";
import type { Frame, GameKey } from "./types";
import styles from "./demo.module.css";

const OPEN_AT = 500;
/** How long a picked tile waits on its draw, turning. */
const DRAW_MS = 400;
const PENDING_GLYPHS = ["◐", "◓", "◑", "◒"];
const PENDING_FRAME_MS = 80;
const PULSE_MS = 400;
const tileLetter = (tile: number) => String.fromCharCode(97 + tile);

type TileState = "hidden" | "open" | "lit" | "dark" | "safe" | "mine" | "pending";

function Tile({ state, letter, t, className }: { state: TileState; letter?: string; t: number; className: string }) {
  if (state === "pending") {
    const shade = Math.floor(t / PULSE_MS) % 2 === 0 ? styles.tilePending : styles.tilePendingAlt;
    return (
      <span className={`${className} ${shade}`}>
        {PENDING_GLYPHS[Math.floor(t / PENDING_FRAME_MS) % PENDING_GLYPHS.length]}
      </span>
    );
  }
  if (state === "safe") return <span className={`${className} ${styles.tileSafe}`}>◆</span>;
  if (state === "mine") return <span className={`${className} ${styles.tileMine}`}>✸</span>;
  const fill = state === "lit" ? styles.tileLit : state === "dark" ? styles.tileDark : styles.tileHidden;
  return (
    <span className={`${className} ${fill}`}>
      {state === "open" || state === "lit" ? <span className={styles.tileLetter}>{letter}</span> : null}
    </span>
  );
}

interface Pick {
  tile: number;
  at: number;
}

/** The side of a board, as the mod draws it: the multiplier, whose move it is, what comes next, the cash-out. */
function BoardSide(props: {
  head: ReactNode;
  multiplier: string;
  state: "idle" | "turn" | "drawing" | "bust" | "cashed";
  next: string | null;
  cashOut: string | null;
  count: string;
  t: number;
}) {
  const { state, t } = props;
  const pulse = Math.floor(t / PULSE_MS) % 2 === 0 ? styles.pink : styles.gold;
  return (
    <div className={styles.side}>
      {props.head}
      <Stat
        label="multiplier"
        value={state === "bust" ? "×0" : `×${props.multiplier}`}
        tone={state === "bust" ? "red" : "fg1"}
      />
      {state === "idle" && <Muted>Pick a tile once it opens.</Muted>}
      {state === "turn" && <span className={`${pulse} ${styles.b}`}>YOUR TURN</span>}
      {state === "drawing" && <span className={styles.fg4}>drawing…</span>}
      {state === "bust" && <span className={`${styles.red} ${styles.b}`}>BUST</span>}
      {state === "cashed" && <span className={`${styles.gold} ${styles.b}`}>{`CASHED OUT ×${props.multiplier}`}</span>}
      <span className={props.next && (state === "turn" || state === "drawing") ? styles.fg4 : styles.ghost}>
        next <span className={styles.fg1}>{`×${props.next ?? "—"}`}</span>
      </span>
      <span className={props.cashOut && (state === "turn" || state === "drawing") ? styles.fg4 : styles.ghost}>
        <span className={`${styles.gold} ${styles.b}`}>z</span> cash out{" "}
        <span className={`${styles.gold} ${styles.b}`}>{props.cashOut ?? "0.00"}</span>
      </span>
      <Muted>{props.count}</Muted>
    </div>
  );
}

function boardState(t: number, picks: readonly Pick[], endAt: number, busts: boolean) {
  const drawn = picks.filter((pick) => pick.at + DRAW_MS <= t);
  const pending = picks.find((pick) => pick.at <= t && pick.at + DRAW_MS > t) ?? null;
  const isBust = busts && drawn.length === picks.length;
  const safe = isBust ? drawn.slice(0, -1) : drawn;
  const state =
    t < OPEN_AT
      ? ("idle" as const)
      : isBust
        ? ("bust" as const)
        : t >= endAt
          ? ("cashed" as const)
          : pending
            ? ("drawing" as const)
            : ("turn" as const);
  return { safe, pending, isBust, state, bust: isBust ? (picks[picks.length - 1]?.tile ?? null) : null };
}

// ---- Mines ----

export const MINES_KEYS: readonly GameKey[] = [
  { key: "n", label: "play · 5.00 · 3 mines" },
  { key: "j", label: "mines −" },
  { key: "k", label: "mines +" },
  { key: "z", label: "cash out" },
];

/** Three mines in 25: ×0.99 over the chance of each safe tile so far, cut to four decimals. */
const MINES_MULTIPLIERS = ["1.0000", "1.1250", "1.2857", "1.4785", "1.7120"];
const MINES_CASH = ["5.00", "5.62", "6.42", "7.39", "8.56"];
const MINES_PICKS: readonly Pick[] = [
  { tile: 6, at: 1100 },
  { tile: 12, at: 2000 },
  { tile: 18, at: 2900 },
];
const MINES_CASH_OUT_AT = 4000;

export function minesFrame(t: number): Frame {
  const board = boardState(t, MINES_PICKS, MINES_CASH_OUT_AT, false);
  const safe = new Set(board.safe.map((pick) => pick.tile));
  const tileState = (tile: number): TileState =>
    safe.has(tile)
      ? "safe"
      : board.pending?.tile === tile
        ? "pending"
        : board.state === "turn" || board.state === "drawing"
          ? "open"
          : "hidden";
  const count = board.safe.length;
  const table = (
    <div className={styles.beside}>
      <span className={styles.mines}>
        {Array.from({ length: 25 }, (_, tile) => (
          <Tile key={tile} state={tileState(tile)} letter={tileLetter(tile)} t={t} className={styles.mineTile} />
        ))}
      </span>
      <BoardSide
        head={
          <span className={styles.fg4}>
            <span className={`${styles.pink} ${styles.b}`}>3</span> mines
          </span>
        }
        multiplier={MINES_MULTIPLIERS[count] ?? "1.0000"}
        state={board.state}
        next={MINES_MULTIPLIERS[count + 1] ?? null}
        cashOut={count > 0 ? (MINES_CASH[count] ?? null) : null}
        count={`${count} safe`}
        t={t}
      />
    </div>
  );
  const line =
    board.state === "cashed" ? (
      <Outcome text="Cashed out at ×1.4785 after 3 safe tiles." net="+2.39" />
    ) : board.state === "drawing" ? (
      <Muted>{`${spinnerAt(t)} drawing`}</Muted>
    ) : board.state === "turn" ? (
      <span className={styles.fg2}>Pick a tile with its letter, or cash out with z.</span>
    ) : (
      <Muted>Pick the mines with j and k, then play with n.</Muted>
    );
  return {
    table,
    line,
    live: board.state === "turn" ? (count > 0 ? ["z"] : []) : board.state === "drawing" ? [] : ["n", "j", "k"],
    pressed: pressedAt(t, [
      [400, "n"],
      [MINES_CASH_OUT_AT, "z"],
    ]),
  };
}

// ---- Tower ----

export const TOWER_KEYS: readonly GameKey[] = [
  { key: "n", label: "play · 5.00 · easy" },
  { key: "j", label: "difficulty −" },
  { key: "k", label: "difficulty +" },
  { key: "z", label: "cash out" },
];

const LEVELS = 9;
const TILES = 4;
/** Easy: 3 safe tiles of 4 a level, ×0.98 over the chance of every level climbed, cut to four decimals. */
const TOWER_PAYS = ["1.3066", "1.7422", "2.3229", "3.0972", "4.1297", "5.5062", "7.3417", "9.7889", "13.0519"];
const TOWER_CASH = ["6.53", "8.71", "11.61", "15.48"];
const TOWER_PICKS: readonly Pick[] = [
  { tile: 1, at: 1100 },
  { tile: 3, at: 1900 },
  { tile: 0, at: 2700 },
  { tile: 2, at: 3500 },
];
const NEVER = Number.POSITIVE_INFINITY;

export function towerFrame(t: number): Frame {
  const board = boardState(t, TOWER_PICKS, NEVER, true);
  const climbed = board.safe.length;
  const isPlaying = board.state === "turn" || board.state === "drawing";
  const tileState = (level: number, tile: number): TileState => {
    if (level < climbed) return board.safe[level]?.tile === tile ? "safe" : "dark";
    if (level > climbed || board.state === "idle") return "hidden";
    if (board.bust === tile) return "mine";
    if (board.pending?.tile === tile) return "pending";
    return isPlaying ? "lit" : "hidden";
  };
  const table = (
    <div className={styles.beside}>
      <span className={styles.tower}>
        {Array.from({ length: LEVELS }, (_, row) => {
          const level = LEVELS - 1 - row;
          const isCurrent = level === climbed && isPlaying;
          const tone = isCurrent
            ? `${styles.pink} ${styles.b}`
            : level < climbed
              ? `${styles.gold} ${styles.b}`
              : styles.fg6;
          return (
            <span key={level} className={styles.towerRow}>
              <span className={`${styles.towerPay} ${tone}`}>{`×${TOWER_PAYS[level]}`}</span>
              {Array.from({ length: TILES }, (_, tile) => (
                <Tile
                  key={tile}
                  state={tileState(level, tile)}
                  letter={tileLetter(tile)}
                  t={t}
                  className={`${styles.towerTile} ${level % 2 === 1 ? styles.towerAlt : ""}`}
                />
              ))}
            </span>
          );
        })}
      </span>
      <BoardSide
        head={
          <span className={styles.fg4}>
            <span className={`${styles.pink} ${styles.b}`}>easy</span> · 3 safe of 4
          </span>
        }
        multiplier={climbed === 0 ? "1.0000" : (TOWER_PAYS[climbed - 1] ?? "")}
        state={board.state}
        next={TOWER_PAYS[climbed] ?? null}
        cashOut={climbed > 0 ? (TOWER_CASH[climbed - 1] ?? null) : null}
        count={`${climbed} ${climbed === 1 ? "level" : "levels"}`}
        t={t}
      />
    </div>
  );
  const line =
    board.state === "bust" ? (
      <Outcome text="Fell on level 4." net="−5.00" />
    ) : board.state === "drawing" ? (
      <Muted>{`${spinnerAt(t)} drawing`}</Muted>
    ) : board.state === "turn" ? (
      <span className={styles.fg2}>Climb with a tile’s letter, or cash out with z.</span>
    ) : (
      <Muted>Pick the difficulty with j and k, then play with n.</Muted>
    );
  return {
    table,
    line,
    live: board.state === "turn" ? (climbed > 0 ? ["z"] : []) : board.state === "drawing" ? [] : ["n", "j", "k"],
    pressed: pressedAt(t, [[400, "n"]]),
  };
}
