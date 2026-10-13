// Port of `games/slots.rs`: three reels on the same weighted strip.
import type { Rng } from "./rng";

/** Symbol index (on-chain) -> glyph shown in the terminal. The design system lists
 *  `7 ◆ ★ ♣ ¤`; the two extra symbols use `◎` and `♥` (cherry), distinct at any font size. */
export const SYMBOL_GLYPHS = ["7", "◆", "★", "♣", "¤", "◎", "♥"] as const;
// SEVEN, BAR, BELL, PLUM, ORANGE, LEMON, CHERRY
const CHERRY = 6;
const WEIGHTS = [1, 2, 4, 6, 8, 10, 10];
const STRIP = WEIGHTS.reduce((a, b) => a + b, 0);
const THREE_OF_A_KIND = [250n, 100n, 40n, 20n, 12n, 5n, 10n];
const TWO_CHERRIES = 4n;

export type Reels = [number, number, number];

export const isSymbol = (s: number) => Number.isInteger(s) && s >= 0 && s < SYMBOL_GLYPHS.length;

export function glyphs(reels: Reels): [string, string, string] {
  if (!reels.every(isSymbol)) throw new Error(`unknown slot symbol in ${reels.join(",")}`);
  return [SYMBOL_GLYPHS[reels[0]], SYMBOL_GLYPHS[reels[1]], SYMBOL_GLYPHS[reels[2]]];
}

function stop(rng: Rng): number {
  let x = rng.below(STRIP);
  for (let symbol = 0; symbol < WEIGHTS.length; symbol++) {
    if (x < WEIGHTS[symbol]) return symbol;
    x -= WEIGHTS[symbol];
  }
  throw new Error("unreachable: x < strip length");
}

export const spinReels = (rng: Rng): Reels => [stop(rng), stop(rng), stop(rng)];

function multiple([a, b, c]: Reels): bigint {
  if (a === b && b === c) return THREE_OF_A_KIND[a];
  return [a, b, c].filter((s) => s === CHERRY).length === 2 ? TWO_CHERRIES : 0n;
}

export const gross = (reels: Reels, stake: bigint) => stake * multiple(reels);
