// Prize review and payment. A prize is paid only after an admin approved it, through the
// relay's promo payout with the prize's deterministic id: re-running, even concurrently or
// after a crash, can never pay a prize twice (the relay and the program enforce it too).
import type { PromoPayoutResponse } from "@tilt/contract";
import { audit, type Db } from "../db";
import { ApiError } from "../errors";
import { log } from "../log";
import { safeIntentError, type Relay } from "../relay";

export type PrizeStatus = "pending_review" | "approved" | "paid" | "failed";

export interface Prize {
  id: string;
  competitionId: string;
  kind: "rank" | "drop";
  rank: number;
  player: string;
  userId: string | null;
  amount: string;
  status: PrizeStatus;
  signature: string | null;
  error: string | null;
}

/** A claim older than this is considered abandoned (crashed run) and may be taken again. */
const CLAIM_TIMEOUT = "5 minutes";

interface PrizeRow {
  id: string;
  competition_id: string;
  kind: "rank" | "drop";
  rank: number;
  player: string;
  user_id: string | null;
  amount: string;
  status: PrizeStatus;
  signature: string | null;
  error: string | null;
}

const toPrize = (r: PrizeRow): Prize => ({
  id: r.id,
  competitionId: r.competition_id,
  kind: r.kind,
  rank: r.rank,
  player: r.player,
  userId: r.user_id,
  amount: r.amount,
  status: r.status,
  signature: r.signature,
  error: r.error,
});

export async function listPrizes(db: Db, status?: PrizeStatus): Promise<Prize[]> {
  const { rows } = await db.query<PrizeRow>(
    `SELECT id, competition_id, kind, rank, player, user_id, amount, status, signature, error FROM prizes
     WHERE $1::text IS NULL OR status = $1 ORDER BY created_at, competition_id, kind, rank`,
    [status ?? null],
  );
  return rows.map(toPrize);
}

/** Approves one prize (by id) or every prize under review of a competition. */
export async function approvePrizes(db: Db, target: { id: string } | { competitionId: string }, actor: string) {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE prizes SET status = 'approved', approved_at = now()
     WHERE status = 'pending_review' AND ${"id" in target ? "id" : "competition_id"} = $1 RETURNING id`,
    ["id" in target ? target.id : target.competitionId],
  );
  await audit(db, actor, "prize:approve", { target, approved: rows.map((r) => r.id) });
  return rows.length;
}

export interface PayReport {
  paid: number;
  pending: number;
  failed: number;
  skipped: number;
}

/** Takes the prize for this run, unless another run holds a fresh claim on it. */
async function claim(db: Db, id: string): Promise<PrizeRow | undefined> {
  const { rows } = await db.query<PrizeRow>(
    `UPDATE prizes SET pay_started_at = now()
     WHERE id = $1 AND status = 'approved'
       AND (pay_started_at IS NULL OR pay_started_at < now() - $2::interval)
     RETURNING id, competition_id, kind, rank, player, user_id, amount, status, signature, error`,
    [id, CLAIM_TIMEOUT],
  );
  return rows[0];
}

async function sendPayout(relay: Relay, prize: PrizeRow, userId: string): Promise<PromoPayoutResponse> {
  try {
    return await relay.payPromo({
      payoutId: prize.id,
      userId,
      amount: prize.amount,
      poolId: prize.competition_id,
      reason: `${prize.kind} #${prize.rank}`,
    });
  } catch (e) {
    // Already submitted (e.g. by a crashed run): read its outcome, never re-issue under a new id.
    if (!(e instanceof ApiError && e.code === "INTENT_CONFLICT")) throw e;
    const existing = await relay.getPromo(prize.id);
    if (!existing) throw e;
    return existing;
  }
}

async function settlePrize(db: Db, id: string, result: PromoPayoutResponse): Promise<"paid" | "pending" | "failed"> {
  if (result.status === "pending") return "pending";
  if (result.status === "submitted") {
    await db.query("UPDATE prizes SET status = 'paid', signature = $2, paid_at = now(), error = NULL WHERE id = $1", [
      id,
      result.signature ?? null,
    ]);
    return "paid";
  }
  const error = safeIntentError(result.error);
  await db.query("UPDATE prizes SET status = 'failed', error = $2 WHERE id = $1", [
    id,
    error ? `${error.code}: ${error.message}` : "failed",
  ]);
  return "failed";
}

/** Pays every approved prize. Pending payouts stay approved and are checked again next run. */
export async function payPrizes(db: Db, relay: Relay, actor: string): Promise<PayReport> {
  const report: PayReport = { paid: 0, pending: 0, failed: 0, skipped: 0 };
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM prizes WHERE status = 'approved' ORDER BY created_at",
  );
  for (const { id } of rows) {
    const prize = await claim(db, id);
    if (!prize) {
      report.skipped++;
      continue;
    }
    if (!prize.user_id) {
      await db.query("UPDATE prizes SET status = 'failed', error = 'no Tilt user for this wallet' WHERE id = $1", [id]);
      report.failed++;
      continue;
    }
    // Outcome unknown (relay unreachable): left approved, the next run asks again with the same id.
    const outcome = await sendPayout(relay, prize, prize.user_id).then(
      (result) => settlePrize(db, id, result),
      (e: unknown) => {
        log.error("prize payout not sent", e, { prize: id });
        return "pending" as const;
      },
    );
    report[outcome]++;
    await audit(db, actor, "prize:pay", { id, outcome });
  }
  return report;
}
