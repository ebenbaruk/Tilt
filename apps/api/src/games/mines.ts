// Port of `games/mines.rs`: a 5×5 board, `mines` mines, no layout drawn in advance. Each reveal
// draws fresh randomness: with `k` tiles already revealed (all safe) the clicked tile is a mine
// iff `below(25 − k) < mines`, which is distributed exactly like a uniformly random layout.
import type { Rng } from "./rng";

export const TILES = 25;
export const MIN_MINES = 1;
export const MAX_MINES = TILES - 1;
/** The board's `pending` / `busted` when there is no such tile. */
export const NO_TILE = 255;
/** House edge of 1%: the multiplier is 99/100 of the fair odds. */
const EDGE_NUMERATOR = 99n;
const EDGE_DENOMINATOR = 100n;
/** Display precision of a multiplier: 4 decimals. */
const MULTIPLIER_SCALE = 10_000n;

/** Safe tiles on a board with `mines` mines: revealing them all clears the board. */
export const safeTiles = (mines: number) => TILES - mines;

function choose(n: number, k: number): bigint {
  let c = 1n;
  for (let i = 0; i < k; i++) c = (c * BigInt(n - i)) / BigInt(i + 1);
  return c;
}

/** `stake × 0.99 × C(25, k) / C(25 − m, k)`, rounded down: the return after `k` safe reveals. */
export function uncappedGross(stake: bigint, mines: number, revealed: number): bigint {
  return (stake * EDGE_NUMERATOR * choose(TILES, revealed)) / (EDGE_DENOMINATOR * choose(safeTiles(mines), revealed));
}

/** Gain of a cleared board, before the vault's cap. */
export function boardGain(stake: bigint, mines: number): bigint {
  const cleared = uncappedGross(stake, mines, safeTiles(mines)) - stake;
  return cleared > 0n ? cleared : 0n;
}

/** Largest gain of a round: the cleared board's, bounded by the vault's `max_round_gain`. */
export function maxGain(stake: bigint, mines: number, maxRoundGain: bigint): bigint {
  const gain = boardGain(stake, mines);
  return gain < maxRoundGain ? gain : maxRoundGain;
}

/** What a cash-out after `revealed` safe tiles returns (the round's cap applied). */
export function gross(stake: bigint, mines: number, revealed: number, gain: bigint): bigint {
  const g = uncappedGross(stake, mines, revealed);
  return g < stake + gain ? g : stake + gain;
}

/** Whether another reveal is allowed: the board is not cleared and the cap is not reached. */
export const canRevealMore = (stake: bigint, mines: number, revealed: number, gain: bigint) =>
  revealed < safeTiles(mines) && uncappedGross(stake, mines, revealed) < stake + gain;

/** The reveal draw: `revealed` tiles already safe. */
export const isMine = (rng: Rng, mines: number, revealed: number) => rng.below(TILES - revealed) < mines;

/** A multiplier in units of 1/10 000, rounded down, as "1.0312". */
export function formatMultiplier(scaled: bigint): string {
  const fraction = (scaled % MULTIPLIER_SCALE).toString().padStart(4, "0");
  return `${scaled / MULTIPLIER_SCALE}.${fraction}`;
}

/** The multiplier a cash-out after `revealed` tiles pays, in units of 1/10 000 (round cap
 *  included); 1 before any reveal. */
export function scaledMultiplier(stake: bigint, mines: number, revealed: number, gain: bigint): bigint {
  if (revealed === 0) return MULTIPLIER_SCALE;
  const formula =
    (EDGE_NUMERATOR * MULTIPLIER_SCALE * choose(TILES, revealed)) /
    (EDGE_DENOMINATOR * choose(safeTiles(mines), revealed));
  if (stake <= 0n) return formula;
  const capped = ((stake + gain) * MULTIPLIER_SCALE) / stake;
  return formula < capped ? formula : capped;
}
