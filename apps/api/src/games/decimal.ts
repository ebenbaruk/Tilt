// Display of the integer multipliers the rules compute: never a float on the way.

/** Cumulative multipliers (mines, hilo, tower, flip, dice) show 4 decimals… */
export const MULTIPLIER_DECIMALS = 4;
export const MULTIPLIER_SCALE = 10n ** BigInt(MULTIPLIER_DECIMALS);
/** …chosen targets and pay tables (limbo, keno, wheel), stored ×100, show 2. */
export const HUNDREDTHS_DECIMALS = 2;

/** `value` in units of 10^-decimals, as a decimal string: (10312n, 4) -> "1.0312". */
export function formatFixed(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0");
  return `${value / scale}.${fraction}`;
}
