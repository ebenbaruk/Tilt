// USDC amounts: integer base units (6 decimals) carried as decimal strings, never floats (spec §6.2).

export const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
/** Shown decimals: cents always, more only when the amount has them. */
const MIN_SHOWN_DECIMALS = 2;
/** Caps input at a trillion USDC: anything longer is a typo, not a deposit. */
const MAX_INTEGER_DIGITS = 12;
const MINUS = "−";

const INPUT = /^(\d+)(?:\.(\d*))?$/;
const BASE_UNITS = /^-?\d+$/;

export type ParseResult = { ok: true; value: string } | { ok: false; error: string };

/** Parses what a player typed ("12.4") into base units ("12400000"). Only positive amounts. */
export function parseAmount(input: string): ParseResult {
  const text = input.trim();
  if (text === "") return { ok: false, error: "Enter an amount." };
  const match = INPUT.exec(text);
  if (!match) return { ok: false, error: "Use digits and an optional dot, e.g. 12.40" };
  const [, whole, fraction = ""] = match;
  if (fraction.length > USDC_DECIMALS) return { ok: false, error: `USDC has at most ${USDC_DECIMALS} decimals.` };
  if (whole.replace(/^0+/, "").length > MAX_INTEGER_DIGITS) return { ok: false, error: "That amount is too large." };
  const value = BigInt(whole) * UNIT + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (value === 0n) return { ok: false, error: "Enter an amount above 0." };
  return { ok: true, value: value.toString() };
}

function toBigInt(baseUnits: string | bigint): bigint {
  if (typeof baseUnits === "bigint") return baseUnits;
  if (!BASE_UNITS.test(baseUnits)) throw new Error(`Not an integer amount: "${baseUnits}"`);
  return BigInt(baseUnits);
}

/** Base units to "1,234.50" (en-US grouping, at least 2 decimals, no rounding). */
export function formatAmount(baseUnits: string | bigint): string {
  const value = toBigInt(baseUnits);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / UNIT).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % UNIT)
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "")
    .padEnd(MIN_SHOWN_DECIMALS, "0");
  return `${negative ? MINUS : ""}${whole}.${fraction}`;
}

/** Signed delta with a real minus sign: "+1.25", "−0.50", "0.00". */
export function formatSigned(baseUnits: string | bigint): string {
  const value = toBigInt(baseUnits);
  return value > 0n ? `+${formatAmount(value)}` : formatAmount(value);
}

export function compareAmounts(a: string, b: string): number {
  const diff = toBigInt(a) - toBigInt(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}
