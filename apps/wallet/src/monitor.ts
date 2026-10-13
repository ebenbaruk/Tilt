// Monitoring (spec §10.7): checks run by the cron, reported as structured `alert` log lines
// for the log pipeline to page on. Solvency is checked on-chain state, not trusted counters.
import { escrowPdaFromEscrowAuthority } from "@magicblock-labs/ephemeral-rollups-sdk";
import { getAccount } from "@solana/spl-token";
import { vaultTokenAddress } from "@tilt/contract";
import type { TiltChain } from "./chain";
import type { Db } from "./db";

export interface MonitorThresholds {
  /** The relayer pays fees and account rents on Solana. */
  minRelayerLamports: bigint;
  /** The relayer's MagicBlock escrow pays the Magic Actions of withdrawals and checkpoints. */
  minEscrowLamports: bigint;
  /** Bankroll not reserved for players (USDC base units): below it, new accounts get refused. */
  minFreeBankroll: bigint;
}

/** What the monitor looks at, gathered from the chain and the database. */
export interface Snapshot {
  vaultBalance: bigint;
  reserved: bigint;
  relayerLamports: bigint;
  escrowLamports: bigint;
  stuckIntents: number;
  paused: { deposits: boolean; bets: boolean; payouts: boolean };
}

export type AlertCode = "INSOLVENT" | "LOW_FREE_BANKROLL" | "LOW_RELAYER_SOL" | "LOW_ESCROW" | "STUCK_INTENTS" | "PAUSED" | "MONITOR_FAILED";

export interface Alert {
  code: AlertCode;
  severity: "critical" | "warning";
  message: string;
}

/** Pending intents older than this are stuck: reconciliation should have settled them. */
const STUCK_INTENT_SECS = 600;

export function evaluate(s: Snapshot, t: MonitorThresholds): Alert[] {
  const alerts: Alert[] = [];
  const free = s.vaultBalance - s.reserved;
  if (free < 0n) {
    alerts.push({ code: "INSOLVENT", severity: "critical", message: `vault holds ${s.vaultBalance} but owes up to ${s.reserved}` });
  } else if (free < t.minFreeBankroll) {
    alerts.push({ code: "LOW_FREE_BANKROLL", severity: "warning", message: `${free} unreserved in the vault` });
  }
  if (s.relayerLamports < t.minRelayerLamports) {
    alerts.push({ code: "LOW_RELAYER_SOL", severity: "critical", message: `relayer has ${s.relayerLamports} lamports` });
  }
  if (s.escrowLamports < t.minEscrowLamports) {
    alerts.push({ code: "LOW_ESCROW", severity: "critical", message: `relayer escrow has ${s.escrowLamports} lamports: withdrawals and checkpoints will stall` });
  }
  if (s.stuckIntents > 0) {
    alerts.push({ code: "STUCK_INTENTS", severity: "warning", message: `${s.stuckIntents} intents pending for over ${STUCK_INTENT_SECS} s` });
  }
  const paused = Object.entries(s.paused).filter(([, on]) => on).map(([name]) => name);
  if (paused.length) alerts.push({ code: "PAUSED", severity: "warning", message: `paused: ${paused.join(", ")}` });
  return alerts;
}

export async function snapshot(db: Db, chain: TiltChain): Promise<Snapshot> {
  const vault = await chain.fetchVault();
  const relayer = vault.relayer;
  const [vaultToken, relayerLamports, escrowLamports, stuck] = await Promise.all([
    getAccount(chain.base, vaultTokenAddress()),
    chain.base.getBalance(relayer),
    chain.base.getBalance(escrowPdaFromEscrowAuthority(relayer)),
    db.query<{ n: string }>("SELECT count(*) AS n FROM intents WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1)", [STUCK_INTENT_SECS]),
  ]);
  return {
    vaultBalance: vaultToken.amount,
    reserved: BigInt(vault.reserved.toString()),
    relayerLamports: BigInt(relayerLamports),
    escrowLamports: BigInt(escrowLamports),
    stuckIntents: Number(stuck.rows[0].n),
    paused: { deposits: vault.config.depositsPaused, bets: vault.config.betsPaused, payouts: vault.config.payoutsPaused },
  };
}

/** The alerts of one monitoring pass. Failing to look is itself critical: it would hide every other alert. */
export async function check(db: Db, chain: TiltChain, t: MonitorThresholds): Promise<Alert[]> {
  return snapshot(db, chain).then(
    (s) => evaluate(s, t),
    (e: unknown) => [{ code: "MONITOR_FAILED", severity: "critical", message: `monitoring failed: ${e instanceof Error ? e.message : String(e)}` }],
  );
}
