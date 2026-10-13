// Port of `games/baccarat.rs`: Punto Banco, standard third-card rules, infinite deck.
import type { BaccaratBet } from "@tilt/mod/protocol";
import type { Rng } from "./rng";
import { mulDiv } from "./settlement";

export interface Coup {
  player: number[];
  banker: number[];
}

const value = (rank: number) => (rank >= 10 ? 0 : rank);

export const points = (cards: readonly number[]) => cards.reduce((sum, c) => sum + value(c), 0) % 10;

/** Banker's third-card rule, given its two-card total and the player's third card value. */
export function bankerDraws(banker: number, playerThird: number | null): boolean {
  if (playerThird === null) return banker <= 5;
  if (banker <= 2) return true;
  if (banker === 3) return playerThird !== 8;
  if (banker === 4) return playerThird >= 2 && playerThird <= 7;
  if (banker === 5) return playerThird >= 4 && playerThird <= 7;
  if (banker === 6) return playerThird >= 6 && playerThird <= 7;
  return false;
}

/** Deals in casino order: player, banker, player, banker, then third cards. */
export function dealCoup(rng: Rng): Coup {
  const player = [rng.card()];
  const banker = [rng.card()];
  player.push(rng.card());
  banker.push(rng.card());
  const p = points(player);
  const b = points(banker);
  if (p >= 8 || b >= 8) return { player, banker };
  let playerThird: number | null = null;
  if (p <= 5) {
    player.push(rng.card());
    playerThird = value(player[2]);
  }
  if (bankerDraws(b, playerThird)) banker.push(rng.card());
  return { player, banker };
}

export function gross(bet: BaccaratBet, coup: Coup, stake: bigint): bigint {
  const p = points(coup.player);
  const b = points(coup.banker);
  if (bet === "tie") return p === b ? stake * 9n : 0n;
  if (p === b) return stake;
  if (bet === "player") return p > b ? stake * 2n : 0n;
  return b > p ? stake + mulDiv(stake, 95n, 100n) : 0n;
}
