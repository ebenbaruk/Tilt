// Player wallets: the Privy embedded Solana wallet of each user. The relay signs the
// player's side of deposits with the Privy key quorum the player added as a signer on the
// web (scoped by a Privy policy to the Tilt program).
import { PrivyClient } from "@privy-io/node";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { Db } from "./db";

export interface PlayerWallet {
  userId: string;
  walletId: string;
  address: PublicKey;
}

/** How the relay reaches player wallets. Production uses Privy; tests inject their own keys. */
export interface PlayerWallets {
  /** The user's wallet, or undefined if the user or their Solana wallet does not exist. */
  find(userId: string): Promise<PlayerWallet | undefined>;
  /** Adds the player's signature to a transaction built by the relay. */
  sign(wallet: PlayerWallet, tx: Transaction): Promise<Transaction>;
}

export class PrivyPlayerWallets implements PlayerWallets {
  constructor(
    private readonly privy: PrivyClient,
    private readonly authorizationKey: string,
    private readonly db: Db,
  ) {}

  async find(userId: string): Promise<PlayerWallet | undefined> {
    const cached = await this.db.query<{ wallet_id: string; address: string }>(
      "SELECT wallet_id, address FROM players WHERE user_id = $1",
      [userId],
    );
    const row = cached.rows[0];
    if (row) return { userId, walletId: row.wallet_id, address: new PublicKey(row.address) };

    const user = await this.privy.users()._get(userId).catch((e: unknown) => {
      if (e instanceof Error && "status" in e && e.status === 404) return undefined;
      throw e;
    });
    const wallet = user?.linked_accounts.find(
      (a) => a.type === "wallet" && "chain_type" in a && a.chain_type === "solana" && "connector_type" in a && a.connector_type === "embedded",
    );
    if (!wallet || !("id" in wallet) || !wallet.id || !("address" in wallet)) return undefined;
    await this.db.query(
      "INSERT INTO players (user_id, wallet_id, address) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING",
      [userId, wallet.id, wallet.address],
    );
    return { userId, walletId: wallet.id, address: new PublicKey(wallet.address) };
  }

  async sign(wallet: PlayerWallet, tx: Transaction): Promise<Transaction> {
    const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const { signed_transaction } = await this.privy.wallets().solana().signTransaction(wallet.walletId, {
      transaction: unsigned,
      authorization_context: { authorization_private_keys: [this.authorizationKey] },
    });
    const signed = Transaction.from(Buffer.from(signed_transaction, "base64"));
    const signature = signed.signatures.find((s) => s.publicKey.equals(wallet.address))?.signature;
    if (!signature) throw new Error(`Privy did not sign for ${wallet.address.toBase58()}`);
    tx.addSignature(wallet.address, signature);
    return tx;
  }
}
