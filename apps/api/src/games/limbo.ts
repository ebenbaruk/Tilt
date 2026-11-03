// Port of `games/limbo.rs`: the player names a target multiplier; the result is
// 0.98 × 2^32 / v for a uniform v in 1..2^32 (P(result ≥ t) ≤ 0.98 / t), clamped to 1.00×–1 000 000×.
// A result at or above the target pays the target. Multipliers are integers ×100.
import type { Rng } from "./rng";

export const MIN_TARGET = 101;
export const MAX_TARGET = 1_000_000;
const MIN_RESULT = 100n;
const MAX_RESULT = 100_000_000n;
/** The draw `v` is uniform in 1..SPAN. */
const SPAN = 2 ** 32;
/** 98 % (×100) × SPAN: `result = NUMERATOR / v`. */
const NUMERATOR = 98n * BigInt(SPAN);
const HUNDRED = 100n;

export const isValidTarget = (target: number) =>
  Number.isInteger(target) && target >= MIN_TARGET && target <= MAX_TARGET;

/** The result multiplier ×100: clamp(floor(98 × 2^32 / v), 1.00×, 1 000 000×). */
export function result(rng: Rng): number {
  const r = NUMERATOR / BigInt(rng.below(SPAN) + 1);
  if (r < MIN_RESULT) return Number(MIN_RESULT);
  return Number(r > MAX_RESULT ? MAX_RESULT : r);
}

export const gross = (stake: bigint, target: number, result: number) =>
  result >= target ? (stake * BigInt(target)) / HUNDRED : 0n;
