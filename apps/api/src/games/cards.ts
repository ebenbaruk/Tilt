// Suits are not drawn on-chain (an infinite deck only has ranks). The api derives a cosmetic
// suit from the card's position so a hand looks the same on every poll and every device.
// `side` names the hand: "dealer", baccarat's "player"/"banker", blackjack's "hand0" to "hand5".
import type { Card } from "@tilt/mod/protocol";
import { createHash } from "node:crypto";

const SUITS = ["♠", "♥", "♦", "♣"] as const;

export function suitFor(player: string, round: number, side: string, index: number): Card["suit"] {
  const digest = createHash("sha256").update(`${player}:${round}:${side}:${index}`).digest();
  return SUITS[digest[0] % SUITS.length];
}

export const toCards = (ranks: readonly number[], player: string, round: number, side: string): Card[] =>
  ranks.map((rank, i) => ({ rank, suit: suitFor(player, round, side, i) }));
