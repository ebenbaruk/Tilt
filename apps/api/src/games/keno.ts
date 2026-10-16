// Port of `games/keno.rs`: 1 to 10 picks out of 1..40, 10 distinct numbers drawn, paid by hits.
// The pay tables mirror the program's exactly (checked against its Rust in the parity tests).
import type { Rng } from "./rng";

export const NUMBERS = 40;
export const DRAWN = 10;
export const MAX_PICKS = 10;
const HUNDRED = 100n;

/** Stake multiples ×100 by hits (0 to n), for n = 1 to 10 picks (`PAYTABLES[n − 1]`). */
export const PAYTABLES: readonly (readonly bigint[])[] = [
  [0n, 392n],
  [0n, 170n, 565n],
  [0n, 80n, 210n, 2_800n],
  [0n, 75n, 160n, 480n, 5_000n],
  [0n, 25n, 140n, 390n, 1_450n, 10_000n],
  [0n, 0n, 100n, 350n, 700n, 1_870n, 20_000n],
  [0n, 0n, 50n, 290n, 440n, 1_400n, 3_200n, 30_000n],
  [0n, 0n, 0n, 210n, 420n, 1_200n, 2_900n, 8_300n, 50_000n],
  [0n, 0n, 0n, 150n, 300n, 800n, 1_500n, 5_800n, 15_000n, 75_000n],
  [0n, 0n, 0n, 140n, 220n, 440n, 790n, 2_000n, 5_400n, 24_700n, 100_000n],
];

/** The pay table for `picks` numbers. Needs 1 to 10 picks. */
export function paytable(picks: number): readonly bigint[] {
  const table = PAYTABLES[picks - 1];
  if (!table) throw new Error(`no keno pay table for ${picks} picks`);
  return table;
}

/** 1 to 10 distinct numbers, each in 1..40. */
export const isValid = (picks: readonly number[]) =>
  picks.length >= 1 &&
  picks.length <= MAX_PICKS &&
  picks.every((n) => Number.isInteger(n) && n >= 1 && n <= NUMBERS) &&
  new Set(picks).size === picks.length;

/** The first 10 steps of a Fisher–Yates shuffle of 1..40 (step `i` swaps `i` and `i + below(40 − i)`). */
export function draw(rng: Rng): number[] {
  const pool = Array.from({ length: NUMBERS }, (_, i) => i + 1);
  for (let i = 0; i < DRAWN; i++) {
    const j = i + rng.below(NUMBERS - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, DRAWN);
}

export const hits = (picks: readonly number[], drawn: readonly number[]) =>
  picks.filter((n) => drawn.includes(n)).length;

export const gross = (stake: bigint, picks: number, hits: number) => (stake * paytable(picks)[hits]) / HUNDRED;
