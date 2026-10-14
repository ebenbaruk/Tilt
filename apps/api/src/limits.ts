// Responsible gaming (spec §4.4): daily deposit and loss limits, self-exclusion. Enforced by
// the api before any intent reaches the relay. Lowering a limit is immediate; loosening or
// removing it only takes effect 24 h later, so a tilted player cannot lift it on the spot.
import type { LimitsRequest, ResponsibleLimits } from "./public";
import { transaction, type Db, type Queryable } from "./db";
import { ensureUser } from "./users";

export const LOOSEN_DELAY = "24 hours";
const WINDOW = "24 hours";
export const MAX_EXCLUSION_DAYS = 3650;

export interface LimitPlan {
  value: bigint | null;
  /** A looser value waiting for the delay, or undefined when nothing is pending. */
  next?: bigint | null;
  /** The looser value was already waiting: its delay keeps running instead of starting over. */
  keepsDelay?: true;
}

/**
 * What a requested limit does to the current one: stricter now, looser later. `pending` is the
 * looser value already waiting, if any: asking for it again (a form that resends the field it
 * did not change) keeps it as it is; asking for the current value cancels it.
 */
export function planLimit(
  current: bigint | null,
  requested: bigint | null,
  pending?: { next: bigint | null },
): LimitPlan {
  if (pending !== undefined && requested === pending.next)
    return { value: current, next: pending.next, keepsDelay: true };
  if (requested === current) return { value: current };
  const stricter = requested !== null && (current === null || requested < current);
  return stricter ? { value: requested } : { value: current, next: requested };
}

interface LimitsRow {
  daily_deposit: string | null;
  daily_deposit_next: string | null;
  daily_deposit_next_at: Date | null;
  daily_loss: string | null;
  daily_loss_next: string | null;
  daily_loss_next_at: Date | null;
  excluded_until: Date | null;
}

const LIMITS_COLUMNS =
  "daily_deposit, daily_deposit_next, daily_deposit_next_at, daily_loss, daily_loss_next, daily_loss_next_at, excluded_until";

const pendingOf = (next: string | null, at: Date | null) =>
  at === null ? null : { value: next, at: at.toISOString() };

const toView = (row: LimitsRow | undefined): ResponsibleLimits => ({
  dailyDeposit: row?.daily_deposit ?? null,
  dailyDepositNext: row ? pendingOf(row.daily_deposit_next, row.daily_deposit_next_at) : null,
  dailyLoss: row?.daily_loss ?? null,
  dailyLossNext: row ? pendingOf(row.daily_loss_next, row.daily_loss_next_at) : null,
  excludedUntil: row?.excluded_until && row.excluded_until > new Date() ? row.excluded_until.toISOString() : null,
});

/** Applies looser limits whose delay has passed. */
async function promoteDue(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `UPDATE limits SET
       daily_deposit = CASE WHEN daily_deposit_next_at <= now() THEN daily_deposit_next ELSE daily_deposit END,
       daily_deposit_next = CASE WHEN daily_deposit_next_at <= now() THEN NULL ELSE daily_deposit_next END,
       daily_deposit_next_at = CASE WHEN daily_deposit_next_at <= now() THEN NULL ELSE daily_deposit_next_at END,
       daily_loss = CASE WHEN daily_loss_next_at <= now() THEN daily_loss_next ELSE daily_loss END,
       daily_loss_next = CASE WHEN daily_loss_next_at <= now() THEN NULL ELSE daily_loss_next END,
       daily_loss_next_at = CASE WHEN daily_loss_next_at <= now() THEN NULL ELSE daily_loss_next_at END
     WHERE user_id = $1 AND (daily_deposit_next_at <= now() OR daily_loss_next_at <= now())`,
    [userId],
  );
}

export async function getLimits(db: Queryable, userId: string): Promise<ResponsibleLimits> {
  await promoteDue(db, userId);
  const { rows } = await db.query<LimitsRow>(`SELECT ${LIMITS_COLUMNS} FROM limits WHERE user_id = $1`, [userId]);
  return toView(rows[0]);
}

const asBig = (s: string | null) => (s === null ? null : BigInt(s));

/** The looser value waiting, as planLimit takes it. */
const waiting = (next: string | null, at: Date | null) => (at === null ? undefined : { next: asBig(next) });

/** How the delay column changes: kept running, started now, or cleared. */
const delayOf = (plan: LimitPlan) => (plan.keepsDelay ? "keep" : plan.next !== undefined ? "start" : "none");

export async function setLimits(db: Db, userId: string, request: LimitsRequest): Promise<ResponsibleLimits> {
  await ensureUser(db, userId);
  return transaction(db, async (client) => {
    await client.query("INSERT INTO limits (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
    await promoteDue(client, userId);
    const { rows } = await client.query<LimitsRow>(
      `SELECT ${LIMITS_COLUMNS} FROM limits WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const row = rows[0];
    const deposit = planLimit(
      asBig(row.daily_deposit),
      asBig(request.dailyDeposit),
      waiting(row.daily_deposit_next, row.daily_deposit_next_at),
    );
    const loss = planLimit(
      asBig(row.daily_loss),
      asBig(request.dailyLoss),
      waiting(row.daily_loss_next, row.daily_loss_next_at),
    );
    const { rows: updated } = await client.query<LimitsRow>(
      `UPDATE limits SET
         daily_deposit = $2, daily_deposit_next = $3,
         daily_deposit_next_at = CASE $4 WHEN 'keep' THEN daily_deposit_next_at WHEN 'start' THEN now() + $8::interval END,
         daily_loss = $5, daily_loss_next = $6,
         daily_loss_next_at = CASE $7 WHEN 'keep' THEN daily_loss_next_at WHEN 'start' THEN now() + $8::interval END,
         updated_at = now()
       WHERE user_id = $1 RETURNING ${LIMITS_COLUMNS}`,
      [
        userId,
        deposit.value?.toString() ?? null,
        deposit.next?.toString() ?? null,
        delayOf(deposit),
        loss.value?.toString() ?? null,
        loss.next?.toString() ?? null,
        delayOf(loss),
        LOOSEN_DELAY,
      ],
    );
    return toView(updated[0]);
  });
}

/** Self-exclusion: can be extended, never shortened. */
export async function exclude(db: Db, userId: string, days: number): Promise<ResponsibleLimits> {
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXCLUSION_DAYS) throw new Error("invalid exclusion length");
  await ensureUser(db, userId);
  await db.query(
    `INSERT INTO limits (user_id, excluded_until) VALUES ($1, now() + make_interval(days => $2))
     ON CONFLICT (user_id) DO UPDATE SET
       excluded_until = GREATEST(coalesce(limits.excluded_until, now()), EXCLUDED.excluded_until),
       updated_at = now()`,
    [userId, days],
  );
  return getLimits(db, userId);
}

export type Activity =
  | { kind: "bet"; player: string }
  | { kind: "move" }
  | { kind: "deposit"; amount: bigint; intentId: string }
  | { kind: "withdraw" };

/** Why this activity is refused right now, as shown to the player; null when allowed. */
export async function blockReason(db: Queryable, userId: string, activity: Activity): Promise<string | null> {
  // Withdrawing is always allowed: a player must be able to take their money out.
  if (activity.kind === "withdraw") return null;
  const limits = await getLimits(db, userId);
  if (limits.excludedUntil) return `Self-excluded until ${limits.excludedUntil.slice(0, 10)}.`;
  if (activity.kind === "bet" && limits.dailyLoss !== null) {
    const loss = await dailyLoss(db, activity.player);
    if (loss >= BigInt(limits.dailyLoss)) return "Daily loss limit reached.";
  }
  if (activity.kind === "deposit" && limits.dailyDeposit !== null) {
    const deposited = await dailyDeposits(db, userId, activity.intentId);
    if (deposited + activity.amount > BigInt(limits.dailyDeposit)) return "Daily deposit limit reached.";
  }
  return null;
}

/** Net loss over the last 24 h from settled rounds (program payouts are net of the fee). */
export async function dailyLoss(db: Queryable, player: string): Promise<bigint> {
  const { rows } = await db.query<{ loss: string }>(
    `SELECT coalesce(sum(stake - payout), 0) AS loss FROM rounds
     WHERE player = $1 AND settled_at > now() - $2::interval`,
    [player, WINDOW],
  );
  return BigInt(rows[0].loss);
}

/** Deposits sent or in flight over the last 24 h, without the intent being checked (a retry). */
async function dailyDeposits(db: Queryable, userId: string, excludeIntentId: string): Promise<bigint> {
  const { rows } = await db.query<{ total: string }>(
    `SELECT coalesce(sum(amount), 0) AS total FROM intents
     WHERE user_id = $1 AND kind IN ('open_account', 'deposit') AND status <> 'failed'
       AND created_at > now() - $2::interval AND intent_id <> $3`,
    [userId, WINDOW, excludeIntentId],
  );
  return BigInt(rows[0].total);
}
