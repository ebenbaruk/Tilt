// Port of `games/tower.rs` (Dragon Tower): 9 levels of `tiles` tiles, `safe` of them safe. Nothing
// is drawn in advance: each climb draws fresh randomness, safe iff `below(tiles) < safe`. After L
// safe levels a cash-out pays 0.98 × (tiles / safe)^L, capped at the round's gain.
import type { TowerDifficulty } from "@tilt/mod/protocol";
import { MULTIPLIER_SCALE } from "./decimal";
import type { Rng } from "./rng";

export const LEVELS = 9;
export const DIFFICULTIES: Record<TowerDifficulty, { tiles: number; safe: number }> = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
  master: { tiles: 4, safe: 1 },
};
/** On-chain `TowerDifficulty` order. */
export const DIFFICULTY_NAMES: readonly TowerDifficulty[] = ["easy", "medium", "hard", "expert", "master"];
const RTP_PERCENT = 98n;
const HUNDRED = 100n;

/** `stake × 0.98 × tiles^L / safe^L`, rounded down: the return after `levels` safe levels. */
export function uncappedGross(stake: bigint, difficulty: TowerDifficulty, levels: number): bigint {
  const { tiles, safe } = DIFFICULTIES[difficulty];
  const l = BigInt(levels);
  return (stake * RTP_PERCENT * BigInt(tiles) ** l) / (HUNDRED * BigInt(safe) ** l);
}

/** Largest gain of a round: the top of the tower's, bounded by the vault's `max_round_gain`. */
export function maxGain(stake: bigint, difficulty: TowerDifficulty, maxRoundGain: bigint): bigint {
  const top = uncappedGross(stake, difficulty, LEVELS) - stake;
  const gain = top > 0n ? top : 0n;
  return gain < maxRoundGain ? gain : maxRoundGain;
}

/** What a cash-out after `levels` safe levels returns (the round's cap applied). */
export function gross(stake: bigint, difficulty: TowerDifficulty, levels: number, gain: bigint): bigint {
  const g = uncappedGross(stake, difficulty, levels);
  return g < stake + gain ? g : stake + gain;
}

/** Whether another climb is allowed: the top is not reached and neither is the cap. */
export const canClimbMore = (stake: bigint, difficulty: TowerDifficulty, levels: number, gain: bigint) =>
  levels < LEVELS && uncappedGross(stake, difficulty, levels) < stake + gain;

/** The climb draw. */
export const isSafe = (rng: Rng, difficulty: TowerDifficulty) => {
  const { tiles, safe } = DIFFICULTIES[difficulty];
  return rng.below(tiles) < safe;
};

/** The multiplier a cash-out after `levels` levels pays, in units of 1/10 000 (round cap
 *  included); 1 before any level. */
export function scaledMultiplier(stake: bigint, difficulty: TowerDifficulty, levels: number, gain: bigint): bigint {
  if (levels === 0) return MULTIPLIER_SCALE;
  const formula = uncappedGross(MULTIPLIER_SCALE, difficulty, levels);
  if (stake <= 0n) return formula;
  const capped = ((stake + gain) * MULTIPLIER_SCALE) / stake;
  return formula < capped ? formula : capped;
}
