// Players known to the api: Privy user id, plus their Solana wallet once the relay told us.
import type { PublicKey } from "@solana/web3.js";
import type { Queryable } from "./db";

export async function ensureUser(db: Queryable, userId: string): Promise<void> {
  await db.query("INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
}

/** The wallet never changes (Privy embedded wallet); recorded so rounds map back to users. */
export async function recordWallet(db: Queryable, userId: string, address: PublicKey): Promise<void> {
  await db.query("UPDATE users SET solana_address = $2 WHERE user_id = $1 AND solana_address IS NULL", [
    userId,
    address.toBase58(),
  ]);
}
