// Relay cron: settles interrupted intents, closes rounds players abandoned (spec: a hand never
// blocks an account) and releases settled losses from the vault reservation (`checkpoint`).
import { PublicKey } from "@solana/web3.js";
import type { PlayerAccount, TiltChain } from "./chain";
import type { Db } from "./db";
import type { Intents } from "./intents";

export interface SweepOptions {
  checkpointMinLoss: bigint;
  checkpointIntervalMs: number;
}

export interface SweepReport {
  reconciled: number;
  expired: number;
  checkpointed: number;
  failed: number;
}

const big = (n: { toString(): string }) => BigInt(n.toString());

/** Losses not yet released, as the program computes them (`unforfeited_loss`). */
function unforfeitedLoss(a: PlayerAccount): bigint {
  const net = big(a.balance) + big(a.withdrawn) - (big(a.credited) - big(a.forfeited));
  return net < 0n ? -net : 0n;
}

export async function sweep(db: Db, chain: TiltChain, intents: Intents, options: SweepOptions, nowMs = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { reconciled: 0, expired: 0, checkpointed: 0, failed: 0 };
  // A reconciliation failure must not stop rounds from expiring or losses from being released.
  report.reconciled = await intents.reconcile(chain).catch((e: unknown) => {
    report.failed++;
    console.error(JSON.stringify({ level: "error", msg: "reconcile failed", error: e instanceof Error ? e.message : String(e) }));
    return 0;
  });
  const timeoutSecs = Number((await chain.fetchVault()).config.roundTimeoutSecs.toString());
  // Only players whose account opening landed have anything to sweep.
  const { rows } = await db.query<{ user_id: string; address: string; last_checkpoint_at: Date | null }>(
    `SELECT p.user_id, p.address, p.last_checkpoint_at FROM players p
     WHERE EXISTS (SELECT 1 FROM intents i WHERE i.user_id = p.user_id AND i.status = 'submitted' AND i.action->>'type' = 'open_account')`,
  );
  for (const row of rows) {
    const player = new PublicKey(row.address);
    try {
      const account = await chain.fetchPlayerAccount(player);
      if (!account) continue;
      const idle = "idle" in account.round.status;
      const lastAction = Number(account.round.lastAction.toString());
      if (!idle && nowMs / 1000 - lastAction >= timeoutSecs) {
        await chain.expireRound(player);
        report.expired++;
        continue;
      }
      const dueForCheckpoint = !row.last_checkpoint_at || nowMs - row.last_checkpoint_at.getTime() >= options.checkpointIntervalMs;
      if (!idle || !dueForCheckpoint) continue;
      const ledger = await chain.fetchLedger(player);
      // A checkpoint whose Solana side did not land leaves forfeited ahead of the ledger: push it again.
      const unapplied = ledger !== null && big(account.forfeited) > big(ledger.forfeited);
      if (unapplied || unforfeitedLoss(account) >= options.checkpointMinLoss) {
        await chain.checkpoint(player);
        await db.query("UPDATE players SET last_checkpoint_at = now() WHERE user_id = $1", [row.user_id]);
        report.checkpointed++;
      }
    } catch (e) {
      report.failed++;
      console.error(JSON.stringify({ level: "error", msg: "sweep failed for player", player: row.address, error: e instanceof Error ? e.message : String(e) }));
    }
  }
  return report;
}
