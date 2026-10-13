// How a competition pool is split over the final ranking (spec §9.2), e.g. 50 % / 25 % / 10 %
// to the top three and the rest shared by the next ranks. Pure and integer-only.

const BPS = 10_000n;

/** Prize per rank (index 0 = rank 1). Dust left by rounding stays in the pool. */
export function splitPool(pool: bigint, splitBps: readonly number[], sharedRanks: number): bigint[] {
  if (pool < 0n) throw new Error("pool must not be negative");
  if (splitBps.some((b) => !Number.isInteger(b) || b < 0)) throw new Error("split must be non-negative integers");
  if (!Number.isInteger(sharedRanks) || sharedRanks < 0) throw new Error("shared ranks must be a non-negative integer");
  const totalBps = splitBps.reduce((a, b) => a + BigInt(b), 0n);
  if (totalBps > BPS) throw new Error("split exceeds 100 %");
  const top = splitBps.map((b) => (pool * BigInt(b)) / BPS);
  const rest = pool - top.reduce((a, b) => a + b, 0n);
  const shared = sharedRanks > 0 ? rest / BigInt(sharedRanks) : 0n;
  return [...top, ...Array.from({ length: sharedRanks }, () => shared)];
}

export interface Standing {
  player: string;
  net: bigint;
}

export interface RankPrize {
  rank: number;
  player: string;
  amount: bigint;
}

/** Prizes for a final ranking (best first). Only a positive net gain wins a prize. */
export function rankPrizes(standings: readonly Standing[], amounts: readonly bigint[]): RankPrize[] {
  return standings
    .slice(0, amounts.length)
    .map((s, i) => ({ rank: i + 1, player: s.player, amount: amounts[i], net: s.net }))
    .filter((p) => p.net > 0n && p.amount > 0n)
    .map(({ rank, player, amount }) => ({ rank, player, amount }));
}
