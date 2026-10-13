// Random drops (spec §9.2): each eligible round is one ticket, whatever its stake, capped per
// player and per hour. The seed is committed (sha256) when the competition opens and revealed
// when it closes; ticket order is HMAC-SHA256(seed, round signature), so anyone can recompute
// the winners from the revealed seed and the public rounds.
import { createHash, createHmac, randomBytes } from "node:crypto";

export interface Ticket {
  signature: string;
  player: string;
  settledAt: Date;
}

const HOUR_MS = 3_600_000;
const SEED_BYTES = 32;

export function newSeed(): { seed: Buffer; hash: string } {
  const seed = randomBytes(SEED_BYTES);
  return { seed, hash: seedHash(seed) };
}

export const seedHash = (seed: Buffer) => createHash("sha256").update(seed).digest("hex");

const chronological = (a: Ticket, b: Ticket) =>
  a.settledAt.getTime() - b.settledAt.getTime() || (a.signature < b.signature ? -1 : 1);

/** Keeps each player's first `perHour` rounds of every clock hour. */
export function capTickets(rounds: readonly Ticket[], perHour: number): Ticket[] {
  const used = new Map<string, number>();
  return [...rounds].sort(chronological).filter((t) => {
    const key = `${t.player}:${Math.floor(t.settledAt.getTime() / HOUR_MS)}`;
    const count = used.get(key) ?? 0;
    if (count >= perHour) return false;
    used.set(key, count + 1);
    return true;
  });
}

export const ticketScore = (seed: Buffer, signature: string) =>
  createHmac("sha256", seed).update(signature).digest("hex");

/** Winners in draw order: lowest scores first, one drop per player. */
export function drawWinners(seed: Buffer, tickets: readonly Ticket[], count: number): Ticket[] {
  const scored = tickets.map((t) => ({ t, score: ticketScore(seed, t.signature) }));
  scored.sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));
  const winners: Ticket[] = [];
  const seen = new Set<string>();
  for (const { t } of scored) {
    if (winners.length >= count) break;
    if (seen.has(t.player)) continue;
    seen.add(t.player);
    winners.push(t);
  }
  return winners;
}
