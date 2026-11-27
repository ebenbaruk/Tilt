// Relay cron: settles interrupted intents, keeps the house's risk pool funded, requests again
// VRF draws that never arrived, closes rounds the player abandoned (a stand or a cash-out at the
// current value, by the program), and releases settled losses and secured wins lost again from
// the vault reservation (`checkpoint`). It also forgets used identity tokens long expired.
import { PublicKey } from "@solana/web3.js";
import type { PlayerAccount, TiltChain } from "./chain";
import { purgeUsedConsents } from "./consent";
import type { Db } from "./db";
import type { Intents } from "./intents";

export interface SweepOptions {
  checkpointMinLoss: bigint;
  checkpointIntervalMs: number;
  /** What the risk pool's line should have left for new rounds (USDC base units). */
  riskPoolTarget: bigint;
}

export interface SweepReport {
  reconciled: number;
  /** Granted to the risk pool this sweep (USDC base units). */
  funded: bigint;
  expired: number;
  checkpointed: number;
  failed: number;
}

const big = (n: { toString(): string }) => BigInt(n.toString());

/** `risk::required_reserve` as the program computes it (every step rounded up): what the pool
 *  holds for open rounds of total worst case `gains`, total stake `stakes` and total
 *  `exposure` (Σ gain × stake), none gaining more than `maxGain`. */
export function requiredReserve(gains: bigint, stakes: bigint, exposure: bigint, maxGain: bigint): bigint {
  if (gains === 0n) return 0n;
  const mean = divCeil(stakes * MAX_RETURN_PERCENT, 100n);
  const b = divCeil(2n * LN_INV_EPSILON_MILLI * maxGain, 3_000n);
  const c = divCeil(exposure * 2n * LN_INV_EPSILON_MILLI * MAX_RETURN_PERCENT, 100_000n);
  const t = divCeil(b + sqrtCeil(b * b + 4n * c), 2n);
  return mean + t < gains ? mean + t : gains;
}

/** ln(1 / ε) for ε = 10⁻⁹ in thousandths, and the highest return of any game in percent: the
 *  program's `risk.rs` constants. */
const LN_INV_EPSILON_MILLI = 20_724n;
const MAX_RETURN_PERCENT = 99n;

const divCeil = (n: bigint, d: bigint) => (n + d - 1n) / d;

function sqrtCeil(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x * x === n ? x : x + 1n;
}

/** What a checkpoint would release now, as the program computes it: losses not yet forfeited
 *  (`unforfeited_loss`), then secured wins the player has lost again (`unneeded_secured_wins`). */
export function releasable(a: PlayerAccount): bigint {
  const net = big(a.balance) + big(a.withdrawn) - (big(a.credited) - big(a.forfeited));
  const secured = big(a.winReserved) - big(a.winReleased);
  const kept = net > 0n ? net : 0n;
  return (net < 0n ? -net : 0n) + (secured > kept ? secured - kept : 0n);
}

/** Grants the risk pool what its line lacks to keep `target` free for new rounds, within the
 *  free bankroll. Returns the amount granted. */
async function fundRiskPool(chain: TiltChain, target: bigint): Promise<bigint> {
  await chain.ensureRiskPool();
  const [vault, pool, held] = await Promise.all([chain.fetchVault(), chain.fetchRiskPool(), chain.fetchVaultBalance()]);
  // The line never shrinks: a pause (an incident) must not grow it. The program refuses it too.
  if (vault.config.betsPaused) return 0n;
  const maxRoundGain = big(vault.config.maxRoundGain);
  const open = requiredReserve(big(pool.gains), big(pool.stakes), big(pool.exposure), maxRoundGain);
  const used = open + big(pool.uncovered) + big(pool.transferred);
  const left = big(vault.poolLine) - used;
  // One round can hold up to `max_round_gain` of the line: below that free, a single board
  // left open would refuse every other bet until it expires.
  const wanted = target > maxRoundGain ? target : maxRoundGain;
  const free = held - big(vault.reserved);
  const amount = [wanted - left, free].reduce((a, b) => (a < b ? a : b));
  if (amount <= 0n) return 0n;
  await chain.fundRiskPool(amount);
  return amount;
}

export async function sweep(db: Db, chain: TiltChain, intents: Intents, options: SweepOptions, nowMs = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { reconciled: 0, funded: 0n, expired: 0, checkpointed: 0, failed: 0 };
  const logFailure = (msg: string, e: unknown, player?: string) => {
    report.failed++;
    console.error(JSON.stringify({ level: "error", msg, player, error: e instanceof Error ? e.message : String(e) }));
  };
  // A reconciliation failure must not stop rounds from expiring or losses from being released.
  report.reconciled = await intents.reconcile(chain).catch((e: unknown) => {
    logFailure("reconcile failed", e);
    return 0;
  });
  report.funded = await fundRiskPool(chain, options.riskPoolTarget).catch((e: unknown) => {
    logFailure("risk pool funding failed", e);
    return 0n;
  });
  await purgeUsedConsents(db).catch((e: unknown) => logFailure("consent purge failed", e));
  const { config } = await chain.fetchVault();
  const timeoutSecs = Number(config.roundTimeoutSecs.toString());
  const abandonedSecs = Number(config.abandonedRoundSecs.toString());
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
      const idleFor = nowMs / 1000 - Number(account.round.lastAction.toString());
      const stuckDraw = "awaitingDraw" in account.round.status && idleFor >= timeoutSecs;
      const abandoned = "playerTurn" in account.round.status && idleFor >= abandonedSecs;
      if (stuckDraw || abandoned) {
        await chain.expireRound(player, account.round);
        report.expired++;
        continue;
      }
      const dueForCheckpoint = !row.last_checkpoint_at || nowMs - row.last_checkpoint_at.getTime() >= options.checkpointIntervalMs;
      if (!idle || !dueForCheckpoint) continue;
      const ledger = await chain.fetchLedger(player);
      // A checkpoint or withdrawal whose Solana side did not land leaves the rollup's totals
      // ahead of the ledger: push them again.
      const unapplied =
        ledger !== null &&
        (big(account.forfeited) > big(ledger.forfeited) ||
          big(account.winReserved) > big(ledger.winReserved) ||
          big(account.winReleased) > big(ledger.winReleased));
      if (unapplied || releasable(account) >= options.checkpointMinLoss) {
        await chain.checkpoint(player);
        await db.query("UPDATE players SET last_checkpoint_at = now() WHERE user_id = $1", [row.user_id]);
        report.checkpointed++;
      }
    } catch (e) {
      logFailure("sweep failed for player", e, row.address);
    }
  }
  return report;
}
