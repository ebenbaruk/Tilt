// The player's Solana wallet (Privy embedded wallet), learned from the relay once and cached.
import { PublicKey } from "@solana/web3.js";
import type { Queryable } from "./db";
import type { Relay } from "./relay";
import { recordWallet } from "./users";

/** null while the user has no Solana wallet (Privy creates it at first web login). */
export async function walletOf(db: Queryable, relay: Relay, userId: string): Promise<PublicKey | null> {
  const { rows } = await db.query<{ solana_address: string | null }>(
    "SELECT solana_address FROM users WHERE user_id = $1",
    [userId],
  );
  const cached = rows[0]?.solana_address;
  if (cached) return new PublicKey(cached);
  const user = await relay.getUser(userId);
  if (!user) return null;
  const address = new PublicKey(user.solanaAddress);
  await recordWallet(db, userId, address);
  return address;
}
