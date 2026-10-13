// Port of `games/roulette.rs`: European wheel, one bet per spin.
import type { RouletteBet } from "@tilt/mod/protocol";
import type { Rng } from "./rng";

const POCKETS = 37;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const isRed = (n: number) => RED.has(n);

/** Stake multiple returned on a win, stake included. */
function winMultiple(bet: RouletteBet): bigint {
  if (bet.kind === "straight") return 36n;
  return bet.kind === "dozen" || bet.kind === "column" ? 3n : 2n;
}

export function wins(bet: RouletteBet, n: number): boolean {
  if (bet.kind === "straight") return n === bet.number;
  // Zero loses every bet except a straight on zero.
  if (n === 0) return false;
  switch (bet.kind) {
    case "red":
      return isRed(n);
    case "black":
      return !isRed(n);
    case "odd":
      return n % 2 === 1;
    case "even":
      return n % 2 === 0;
    case "low":
      return n <= 18;
    case "high":
      return n >= 19;
    case "dozen":
      return Math.floor((n - 1) / 12) + 1 === bet.dozen;
    case "column":
      return ((n - 1) % 3) + 1 === bet.column;
  }
}

export const spin = (rng: Rng) => rng.below(POCKETS);

export const gross = (bet: RouletteBet, n: number, stake: bigint) => (wins(bet, n) ? stake * winMultiple(bet) : 0n);

/** Every bet the program accepts, for searching which one explains a settled payout. */
export const ALL_BETS: readonly RouletteBet[] = [
  ...Array.from({ length: POCKETS }, (_, number): RouletteBet => ({ kind: "straight", number })),
  { kind: "red" },
  { kind: "black" },
  { kind: "odd" },
  { kind: "even" },
  { kind: "low" },
  { kind: "high" },
  ...([1, 2, 3] as const).map((dozen): RouletteBet => ({ kind: "dozen", dozen })),
  ...([1, 2, 3] as const).map((column): RouletteBet => ({ kind: "column", column })),
];
