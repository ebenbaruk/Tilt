import { IntentError, type RecordSend, type TiltChain } from "./chain";
import type { Db } from "./db";
import type { Executor, RelayAction } from "./intents";
import type { PlayerWallets } from "./players";

/** Executes intents against the Tilt program for real players. */
export class ChainExecutor implements Executor {
  constructor(
    private readonly chain: TiltChain,
    private readonly players: PlayerWallets,
    private readonly db: Db,
  ) {}

  async execute(userId: string, action: RelayAction, record: RecordSend): Promise<string> {
    const wallet = await this.players.find(userId);
    if (!wallet) throw new IntentError("UNKNOWN_USER", "no Solana wallet for this user");
    // The sweeper finds players' addresses here, whatever wallet provider resolved them.
    await this.db.query(
      "INSERT INTO players (user_id, wallet_id, address) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING",
      [userId, wallet.walletId, wallet.address.toBase58()],
    );
    switch (action.type) {
      case "open_account":
        return this.chain.openAccount(wallet, BigInt(action.amount), this.players, record);
      case "deposit":
        return this.chain.deposit(wallet, BigInt(action.amount), this.players, record);
      case "promo_payout":
        return this.chain.payPromo(wallet.address, action.payoutId, BigInt(action.amount), record);
      case "faucet":
        return this.chain.payFaucet(wallet.address, BigInt(action.amount), record);
      default:
        return this.chain.play(wallet.address, action, record);
    }
  }
}
