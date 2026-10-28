// Port of `games/flip.rs`: `flips` coins (1 to 10), all drawn for display; the round wins iff
// every coin lands on the chosen side, paying 0.98 × 2^flips.
import type { FlipSide } from "@tilt/mod/protocol";
import type { Rng } from "./rng";

export const MIN_FLIPS = 1;
export const MAX_FLIPS = 10;
/** `rng.below(2)`: 0 is heads. */
export const SIDES: readonly FlipSide[] = ["heads", "tails"];
const RTP_PERCENT = 98n;
const HUNDRED = 100n;

export const toss = (rng: Rng, flips: number): FlipSide[] =>
  Array.from({ length: flips }, () => SIDES[rng.below(SIDES.length)]);

export function gross(stake: bigint, side: FlipSide, results: readonly FlipSide[]): bigint {
  if (!results.every((r) => r === side)) return 0n;
  return (stake * RTP_PERCENT * (1n << BigInt(results.length))) / HUNDRED;
}

/** 0.98 × 2^flips in units of 1/10 000 (exact). */
export const scaledMultiplier = (flips: number) => RTP_PERCENT * HUNDRED * (1n << BigInt(flips));
