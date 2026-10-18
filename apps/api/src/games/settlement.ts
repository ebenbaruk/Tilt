// Port of `settlement.rs`: Tilt keeps 1% of the gain of a winning round, rounded down, at least
// 1 unit (never more than the gain).

const FEE_BPS = 100n;
const BPS = 10_000n;
const MIN_FEE = 1n;

export interface Settlement {
  /** What goes back to the player's balance: gross − fee. */
  payout: bigint;
  fee: bigint;
}

export function settle(stake: bigint, gross: bigint): Settlement {
  if (gross <= stake) return { payout: gross, fee: 0n };
  const share = ((gross - stake) * FEE_BPS) / BPS;
  const fee = share > MIN_FEE ? share : MIN_FEE;
  return { payout: gross - fee, fee };
}

/** `stake * numerator / denominator`, rounded down (bigint never overflows). */
export const mulDiv = (stake: bigint, numerator: bigint, denominator: bigint): bigint =>
  (stake * numerator) / denominator;
