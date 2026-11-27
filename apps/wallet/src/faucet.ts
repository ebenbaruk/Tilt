// Devnet faucet: test USDC from the relayer's reserve (its own token account for the vault mint)
// to a player's wallet. A claim is an intent of type "faucet": idempotent by claim id, kept in the
// intents table as the audit trail, and checked against its caps under the claim's locks.
import type { FaucetStatusResponse } from "@tilt/contract";
import type { Connection } from "@solana/web3.js";
import type pg from "pg";
import { IntentError } from "./chain";
import type { Db } from "./db";

/** Solana devnet's genesis hash: the only cluster the faucet may run on. */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export interface FaucetLimits {
  /** What one claim pays, which is also what one player can claim per rolling 24 h (USDC base units). */
  amount: bigint;
  /** What all players together can claim per rolling 24 h (USDC base units). */
  dailyLimit: bigint;
}

/** A refused claim, with when the next one can succeed. */
export class FaucetLimitError extends IntentError {
  constructor(
    message: string,
    readonly retryAt: Date,
  ) {
    super("LIMIT_EXCEEDED", message);
  }
}

/** Test USDC must never be handed out elsewhere: the relay refuses to start the faucet off devnet. */
export async function assertDevnet(base: Pick<Connection, "getGenesisHash">): Promise<void> {
  const genesis = await base.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(`FAUCET_ENABLED needs Solana devnet, but SOLANA_RPC_URL has genesis hash ${genesis}`);
  }
}

interface Claim {
  user_id: string;
  amount: string;
  /** When the claim leaves the rolling 24 h window. */
  until: Date;
}

/** Claims that count against the caps: every one not failed in the last 24 h, oldest first. */
const RECENT_CLAIMS = `SELECT user_id, action->>'amount' AS amount, created_at + interval '24 hours' AS until FROM intents
  WHERE action->>'type' = 'faucet' AND status <> 'failed' AND created_at > now() - interval '24 hours'
  ORDER BY created_at`;

/** When `amount` more fits under `cap` as the oldest claims leave the window; undefined if it fits now. */
function fitsAt(claims: readonly Claim[], amount: bigint, cap: bigint): Date | undefined {
  // Fail closed on a misconfiguration: dropping every claim would still not fit, yet say "now".
  if (amount > cap) throw new Error("faucet amount above its cap");
  let total = claims.reduce((sum, claim) => sum + BigInt(claim.amount), 0n);
  let at: Date | undefined;
  for (const claim of claims) {
    if (total + amount <= cap) break;
    total -= BigInt(claim.amount);
    at = claim.until;
  }
  return at;
}

interface NextClaim {
  /** Set while the player's own 24 h window is used up. */
  player?: Date;
  /** Set while all players together reached the daily limit. */
  global?: Date;
}

function nextClaim(claims: readonly Claim[], userId: string, limits: FaucetLimits): NextClaim {
  return {
    player: fitsAt(claims.filter((claim) => claim.user_id === userId), limits.amount, limits.amount),
    global: fitsAt(claims, limits.amount, limits.dailyLimit),
  };
}

const latest = ({ player, global }: NextClaim): Date | undefined =>
  player && global ? new Date(Math.max(player.getTime(), global.getTime())) : (player ?? global);

/** What the player is told before claiming. Not a promise: the claim checks again under its locks. */
export async function faucetStatus(db: Db, userId: string, limits: FaucetLimits | undefined): Promise<FaucetStatusResponse> {
  if (!limits) return { enabled: false, amount: null, nextClaimAt: null };
  const { rows } = await db.query<Claim>(RECENT_CLAIMS);
  return { enabled: true, amount: limits.amount.toString(), nextClaimAt: latest(nextClaim(rows, userId, limits))?.toISOString() ?? null };
}

/** Run inside the claim's transaction, under the player's lock: refuses a claim past either cap. */
export async function checkFaucetLimits(client: pg.PoolClient, userId: string, limits: FaucetLimits | undefined): Promise<void> {
  if (!limits) throw new IntentError("FAUCET_DISABLED", "the faucet is not enabled on this relay");
  // The global cap sums every player's claims: serialized across players, not just per player.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('faucet', 0))");
  const { rows } = await client.query<Claim>(RECENT_CLAIMS);
  const next = nextClaim(rows, userId, limits);
  const retryAt = latest(next);
  if (!retryAt) return;
  const why = next.player ? "test USDC already claimed in the last 24 h" : "the faucet's daily total is reached";
  throw new FaucetLimitError(`${why}; next claim at ${retryAt.toISOString()}`, retryAt);
}
