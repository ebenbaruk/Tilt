// Port of `games/dice.rs`: a roll of 00.00 to 99.99 (0 to 9999), under or over a target. The
// winning count W (target under, 10000 − target over) is 1 % to 98 % of the rolls; a win pays
// 0.98 × 10000 / W, so the RTP is 98 % exactly (before the floor).
import { MULTIPLIER_SCALE } from "./decimal";
import type { Rng } from "./rng";

export const ROLLS = 10_000;
export const MIN_WINNING = 100;
export const MAX_WINNING = 9_800;
/** 98 % of the rolls: the multiplier is RETURN / W. */
const RETURN = 9_800n;

export const winningCount = (target: number, over: boolean) => (over ? ROLLS - target : target);

export function isValidTarget(target: number, over: boolean): boolean {
  const w = winningCount(target, over);
  return Number.isInteger(target) && w >= MIN_WINNING && w <= MAX_WINNING;
}

export const roll = (rng: Rng) => rng.below(ROLLS);

export const wins = (roll: number, target: number, over: boolean) => (over ? roll >= target : roll < target);

export function gross(stake: bigint, target: number, over: boolean, roll: number): bigint {
  if (!wins(roll, target, over)) return 0n;
  return (stake * RETURN) / BigInt(winningCount(target, over));
}

/** 9800 / W in units of 1/10 000, rounded down. */
export const scaledMultiplier = (target: number, over: boolean) =>
  (RETURN * MULTIPLIER_SCALE) / BigInt(winningCount(target, over));
