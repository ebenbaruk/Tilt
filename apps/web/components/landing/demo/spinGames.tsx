"use client";

// Roulette, Wheel and Slots, after apps/mod/hooks/games.tsx and quick.tsx: the wheels turn at
// full speed while the chain draws, then slow on a cubic ease-out into the drawn pocket.
import { useEffect, useRef } from "react";
import { Muted, Outcome } from "./parts";
import { pressedAt, spinnerAt } from "./script";
import type { Frame, GameKey } from "./types";
import styles from "./demo.module.css";

// ---- Roulette ----

/** The European wheel's pockets in their order around it, from 0. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const pocketColor = (n: number) => (n === 0 ? "green" : RED_NUMBERS.has(n) ? "red" : "black");
const FELT = { red: styles.feltRed, black: styles.feltBlack, green: styles.feltGreen } as const;
const wheelAt = (index: number) => WHEEL[((index % WHEEL.length) + WHEEL.length) % WHEEL.length] ?? 0;

/** Tiles either side of the marker, and a tile's columns with the gap after it. */
const REACH = 3;
const TILE_STEP = 5;
const POCKET = 17;
const SPIN_POCKETS = 18;
const LANDING_MS = 1200;
/** Full speed: the landing ease-out's slope at its start, so landing never jolts. */
const FULL_SPEED = (3 * SPIN_POCKETS) / LANDING_MS;
const SPIN_AT = 1800;
const LAND_AT = 2600;
const ROULETTE_RESULT_AT = LAND_AT + LANDING_MS;

export const ROULETTE_KEYS: readonly GameKey[] = [
  { key: "n", label: "spin · 2.50 · 3 bets" },
  { key: "a", label: "chip on cursor" },
  { key: "r", label: "red" },
  { key: "u", label: "undo" },
  { key: "q", label: "clear" },
];

/** Where the wheel stands under the marker, in pockets from 0: turning, then slowing onto 17. */
function wheelPosition(t: number): number {
  const rest = WHEEL.indexOf(POCKET);
  if (t < SPIN_AT) return rest;
  if (t < LAND_AT) return rest - SPIN_POCKETS - FULL_SPEED * (LAND_AT - t);
  if (t >= ROULETTE_RESULT_AT) return rest;
  return rest - SPIN_POCKETS * (1 - (t - LAND_AT) / LANDING_MS) ** 3;
}

function RouletteStrip({ position, hasBall, isIdle }: { position: number; hasBall: boolean; isIdle: boolean }) {
  // The strip moves a column at a time, not a pocket: it creeps into its pocket at the end.
  const column = Math.round(position * TILE_STEP);
  const shift = ((column % TILE_STEP) + TILE_STEP) % TILE_STEP;
  const first = (column - shift) / TILE_STEP - REACH;
  const center = Math.round(position);
  return (
    <div className={styles.strip}>
      <span className={`${styles.gold} ${styles.b} ${styles.marker}`}>▼</span>
      <div className={styles.stripWindow}>
        {Array.from({ length: REACH * 2 + 2 }, (_, slot) => {
          const index = first + slot;
          const number = wheelAt(index);
          const isCenter = index === center;
          return (
            <span
              key={index}
              className={`${styles.pocket} ${FELT[pocketColor(number)]} ${isCenter ? styles.pocketLit : isIdle ? styles.dim : ""}`}
              style={{ left: `${slot * TILE_STEP - shift}ch` }}
            >
              <span className={styles.ball}>{isCenter && hasBall ? "●" : " "}</span>
              {number}
            </span>
          );
        })}
      </div>
      <span className={`${styles.gold} ${styles.b} ${styles.marker}`}>▲</span>
    </div>
  );
}

type Bet =
  { kind: "straight"; number: number } | { kind: "dozen" | "column"; n: number } | { kind: "outside"; name: string };

/** The chips the demo places, in order, and when. */
const CHIPS: readonly { at: number; bet: Bet; stake: string }[] = [
  { at: 300, bet: { kind: "straight", number: 17 }, stake: ".5" },
  { at: 700, bet: { kind: "outside", name: "RED" }, stake: "1" },
  { at: 1100, bet: { kind: "dozen", n: 2 }, stake: "1" },
];
const WINNERS = new Set(["17", "dozen-2"]);
const betKey = (bet: Bet) =>
  bet.kind === "straight" ? String(bet.number) : bet.kind === "outside" ? bet.name : `${bet.kind}-${bet.n}`;

const DOZENS = ["1st 12", "2nd 12", "3rd 12"];
const OUTSIDE = [
  { name: "1–18", felt: styles.feltGreen },
  { name: "EVEN", felt: styles.feltGreen },
  { name: "RED", felt: styles.feltRed },
  { name: "BLACK", felt: styles.feltBlack },
  { name: "ODD", felt: styles.feltGreen },
  { name: "19–36", felt: styles.feltGreen },
];

function Felt({ t }: { t: number }) {
  const placed = new Map(CHIPS.filter((chip) => chip.at <= t).map((chip) => [betKey(chip.bet), chip.stake]));
  const isLit = (key: string) => t >= ROULETTE_RESULT_AT && WINNERS.has(key);
  // The cursor waits on the cell the next chip goes to.
  const next = CHIPS.find((chip) => chip.at > t) ?? CHIPS[CHIPS.length - 1];
  const cursor = t < SPIN_AT && next ? betKey(next.bet) : null;
  const cell = (key: string, label: string, felt: string, extra = "") => {
    const stake = placed.get(key);
    const lit = isLit(key);
    return (
      <span
        key={key}
        className={`${styles.cell} ${lit ? styles.cellLit : felt} ${stake && !lit ? styles.gold : ""} ${cursor === key ? styles.cellCursor : ""} ${extra}`}
      >
        {stake ? `●${label}` : label}
      </span>
    );
  };
  return (
    <div className={styles.felt}>
      {cell("0", "0", styles.feltGreen, styles.zero)}
      {[3, 2, 1].flatMap((row) =>
        Array.from({ length: 12 }, (_, i) => {
          const n = i * 3 + row;
          return cell(String(n), String(n), FELT[pocketColor(n)]);
        }).concat(cell(`column-${row}`, "2:1", styles.feltGreen)),
      )}
      {DOZENS.map((label, i) =>
        cell(`dozen-${i + 1}`, label, styles.feltGreen, `${styles.dozen} ${i === 0 ? styles.afterZero : ""}`),
      )}
      {OUTSIDE.map(({ name, felt }, i) =>
        cell(name, name, felt, `${styles.outside} ${i === 0 ? styles.afterZero : ""}`),
      )}
    </div>
  );
}

export function rouletteFrame(t: number): Frame {
  const landed = t >= ROULETTE_RESULT_AT;
  const placed = CHIPS.filter((chip) => chip.at <= t).length;
  const isSpinning = t >= SPIN_AT && !landed;
  const table = (
    <div className={styles.rows}>
      <RouletteStrip position={wheelPosition(t)} hasBall={landed} isIdle={t < SPIN_AT} />
      <span className={styles.wrapRow}>
        {landed ? (
          <span className={`${styles.chip} ${styles.feltBlack}`}>17 BLACK</span>
        ) : (
          <Muted>{isSpinning ? "spinning…" : "No spin yet."}</Muted>
        )}
        {placed === 0 ? (
          <Muted>No chips on the table yet.</Muted>
        ) : (
          <span className={styles.fg4}>
            on the table <span className={`${styles.gold} ${styles.b}`}>{["0.50", "1.50", "2.50"][placed - 1]}</span>
            {` · ${placed} ${placed === 1 ? "bet" : "bets"}`}
          </span>
        )}
      </span>
      <Felt t={t} />
    </div>
  );
  const line = landed ? (
    <Outcome text="2 of 3 bets win." net="+18.50" />
  ) : isSpinning ? (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  ) : (
    <Muted>Place chips with the cursor, then spin with n.</Muted>
  );
  return {
    table,
    line,
    live: isSpinning ? [] : ["n", "a", "r", "u", "q"],
    pressed: pressedAt(t, [
      [300, "a"],
      [700, "r"],
      [1100, "a"],
      [1600, "n"],
    ]),
  };
}

// ---- Wheel ----

export const WHEEL_KEYS: readonly GameKey[] = [
  { key: "n", label: "spin · 5.00 · 10 segments · medium" },
  { key: "r", label: "medium risk" },
  { key: "j", label: "segments −" },
  { key: "k", label: "segments +" },
];

/** Medium risk, 10 segments, as chain/programs/tilt/src/games/wheel.rs pays it: every other segment empty. */
const WHEEL_PAYS = ["0.00", "1.90", "0.00", "1.50", "0.00", "2.00", "0.00", "1.40", "0.00", "3.00"];
/** One color per multiplier: nothing grey, the small wins cool, the big ones warm, the biggest pink. */
const PAY_COLORS: Record<string, string> = {
  "0.00": "var(--line-4)",
  "1.40": "#7fa8f2",
  "1.50": "#5ccbc2",
  "1.90": "var(--tilt-green)",
  "2.00": "var(--tilt-gold)",
  "3.00": "var(--tilt-pink)",
};
const LEGEND = Object.keys(PAY_COLORS);
const SEGMENT = 1;
const TOP_SPEED = 0.4 / 100;
const WHEEL_LANDING_MS = 1100;
const LANDING_TURN = (TOP_SPEED * WHEEL_LANDING_MS) / 3;
const WHEEL_SPIN_AT = 600;
const WHEEL_LAND_AT = 1500;
const WHEEL_RESULT_AT = WHEEL_LAND_AT + WHEEL_LANDING_MS;

/** The segment under the pointer: turning clockwise, then slowing onto segment 1. */
function segmentAt(t: number): number {
  if (t < WHEEL_SPIN_AT || t >= WHEEL_RESULT_AT) return SEGMENT;
  if (t < WHEEL_LAND_AT) return SEGMENT + LANDING_TURN + TOP_SPEED * (WHEEL_LAND_AT - t);
  return SEGMENT + LANDING_TURN * (1 - (t - WHEEL_LAND_AT) / WHEEL_LANDING_MS) ** 3;
}

/** The disc's pixels across: odd, so the pointer stands over the middle one. */
const DISC_PX = 31;
const TAU = 2 * Math.PI;

/** The wheel as the mod draws it in half-block cells: wedges in a gold rim around a hub, pixel by pixel. */
function WheelDisc({ position }: { position: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const style = getComputedStyle(ref.current as HTMLCanvasElement);
    const resolve = (color: string) =>
      color.startsWith("var(") ? style.getPropertyValue(color.slice(4, -1)).trim() : color;
    const gold = resolve("var(--tilt-gold)");
    const hubColor = resolve("var(--fg-1)");
    const colors = WHEEL_PAYS.map((pays) => resolve(PAY_COLORS[pays] ?? "var(--line-4)"));
    const radius = DISC_PX / 2;
    const face = radius - Math.max(1, radius * 0.1);
    context.clearRect(0, 0, DISC_PX, DISC_PX);
    for (let y = 0; y < DISC_PX; y++) {
      for (let x = 0; x < DISC_PX; x++) {
        const dx = x + 0.5 - radius;
        const dy = y + 0.5 - radius;
        const distance = Math.hypot(dx, dy);
        if (distance > radius + 0.35) continue;
        let color: string;
        if (distance > face) color = gold;
        else if (distance < radius * 0.15) color = hubColor;
        else {
          const along = (Math.atan2(dx, -dy) / TAU) * WHEEL_PAYS.length + position + 0.5;
          const wedge = Math.floor(along);
          const off = along - wedge;
          const isSeam = (Math.min(off, 1 - off) * TAU * distance) / WHEEL_PAYS.length < 0.5;
          color = isSeam ? "#1c1c1c" : (colors[((wedge % 10) + 10) % 10] ?? gold);
        }
        context.fillStyle = color;
        context.fillRect(x, y, 1, 1);
      }
    }
  }, [position]);
  return <canvas ref={ref} width={DISC_PX} height={DISC_PX} className={styles.disc} />;
}

export function wheelFrame(t: number): Frame {
  const landed = t >= WHEEL_RESULT_AT;
  const isSpinning = t >= WHEEL_SPIN_AT && !landed;
  const pays = WHEEL_PAYS[SEGMENT] ?? "0.00";
  const table = (
    <div className={styles.rows}>
      <div className={styles.beside}>
        <div className={styles.discBox}>
          <span className={`${styles.gold} ${styles.b}`}>▼</span>
          <WheelDisc position={segmentAt(t)} />
        </div>
        <div className={styles.side}>
          <span className={styles.fg4}>10 segments · medium risk</span>
          {landed ? (
            <span className={styles.payChip} style={{ background: PAY_COLORS[pays] }}>{`×${pays}`}</span>
          ) : (
            <Muted>{isSpinning ? "spinning…" : "No spin yet."}</Muted>
          )}
        </div>
      </div>
      <span className={styles.wrapRow}>
        {LEGEND.map((multiplier) => (
          <span key={multiplier} className={styles.fg6}>
            <span style={{ color: PAY_COLORS[multiplier] }}>●</span>
            {` ×${multiplier}`}
          </span>
        ))}
      </span>
    </div>
  );
  const line = landed ? (
    <Outcome text="Landed on ×1.90." net="+4.50" />
  ) : isSpinning ? (
    <Muted>{`${spinnerAt(t)} drawing`}</Muted>
  ) : (
    <Muted>Spin with n.</Muted>
  );
  return {
    table,
    line,
    live: isSpinning ? [] : ["n", "r", "j", "k"],
    pressed: pressedAt(t, [[400, "n"]]),
    selected: ["r"],
  };
}

// ---- Slots ----

export const SLOTS_KEYS: readonly GameKey[] = [
  { key: "n", label: "spin · 1.00" },
  { key: "x", label: "normal" },
  { key: "f", label: "fast" },
  { key: "t", label: "turbo" },
];

/** The symbols in the mod's colors, and the pay table as chain/…/games/slots.rs pays it. */
const SYMBOL_TONES: Record<string, string> = {
  "7": styles.pink,
  "◆": styles.fg1,
  "★": styles.gold,
  "♣": styles.green,
  "¤": styles.gold,
  "◎": styles.fg4,
  "♥": styles.red,
};
const SYMBOLS = Object.keys(SYMBOL_TONES);
const PAYS = [
  { line: "7 7 7", times: 250 },
  { line: "◆ ◆ ◆", times: 100 },
  { line: "★ ★ ★", times: 40 },
  { line: "♣ ♣ ♣", times: 20 },
  { line: "¤ ¤ ¤", times: 12 },
  { line: "♥ ♥ ♥", times: 10 },
  { line: "◎ ◎ ◎", times: 5 },
  { line: "♥ ♥ ·", times: 4 },
];
const IDLE_REELS = ["♣", "7", "◆"];
const LANDED_REELS = ["★", "★", "★"];
const SLOTS_SPIN_AT = 600;
const REEL_STOPS_MS = [600, 900, 1200];
const REEL_FRAME_MS = 80;
const SLOTS_RESULT_AT = SLOTS_SPIN_AT + 1200;

export function slotsFrame(t: number): Frame {
  const elapsed = t - SLOTS_SPIN_AT;
  const reels = LANDED_REELS.map((symbol, reel) => {
    if (elapsed < 0) return { symbol: IDLE_REELS[reel] ?? symbol, tone: styles.dim, isMoving: false };
    if (elapsed >= (REEL_STOPS_MS[reel] ?? 0)) return { symbol, tone: SYMBOL_TONES[symbol] ?? "", isMoving: false };
    const passing = SYMBOLS[(Math.floor(elapsed / REEL_FRAME_MS) + reel * 3) % SYMBOLS.length] ?? symbol;
    return { symbol: passing, tone: styles.moving, isMoving: true };
  });
  const landed = t >= SLOTS_RESULT_AT;
  const table = (
    <div className={styles.beside}>
      <div className={styles.machineRow}>
        <span className={`${styles.gold} ${styles.b}`}>▸</span>
        <span className={`${styles.machine} ${landed ? styles.machineLit : ""}`}>
          {reels.map((reel, i) => (
            <span key={i} className={`${styles.reel} ${landed ? styles.machineLit : ""}`}>
              <span className={`${styles.symbol} ${reel.tone} ${styles.b}`}>{reel.symbol}</span>
            </span>
          ))}
        </span>
        <span className={`${styles.gold} ${styles.b}`}>◂</span>
      </div>
      <div className={styles.paytable}>
        <Muted>PAYS × BET</Muted>
        {PAYS.map((pay) => {
          const isLit = landed && pay.line === "★ ★ ★";
          return (
            <span key={pay.line} className={isLit ? `${styles.gold} ${styles.b}` : styles.fg4}>
              {pay.line}
              <span className={isLit ? undefined : styles.fg6}>{String(pay.times).padStart(5, " ")}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
  const line = landed ? (
    <Outcome text="★ ★ ★ pays ×40." net="+39.00" />
  ) : elapsed >= 0 ? (
    <Muted>{`${spinnerAt(t)} spinning`}</Muted>
  ) : (
    <Muted>Spin with n.</Muted>
  );
  return {
    table,
    line,
    live: elapsed >= 0 && !landed ? [] : ["n", "x", "f", "t"],
    pressed: pressedAt(t, [[400, "n"]]),
    selected: ["x"],
  };
}
