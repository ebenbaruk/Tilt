// Intents: each is executed at most once (by intent id) and one at a time per player.
// The intent row is committed before anything is signed, and the transaction signature is
// committed before it is sent, so a crash never loses track of what reached the chain:
// `reconcile` settles whatever was left pending.
import type { Action, IntentResponse, PromoPayoutRequest } from "@tilt/contract";
import pg from "pg";
import { IntentError, type Network, type RecordSend, type SentTransaction, type TransactionStatus, UnconfirmedError } from "./chain";
import type { Db } from "./db";

/** A promo payout, run and stored like an intent: its payout id is the intent id. */
export type PromoPayoutAction = { type: "promo_payout" } & Omit<PromoPayoutRequest, "userId">;
export type RelayAction = Action | PromoPayoutAction;
export interface RelayIntent {
  intentId: string;
  userId: string;
  action: RelayAction;
}

/** Runs one action on-chain and returns its transaction signature; throws IntentError on refusal.
 *  `record` must be awaited before the transaction is sent. */
export interface Executor {
  execute(userId: string, action: RelayAction, record: RecordSend): Promise<string>;
}

/** Relay-side bounds on what `apps/api` can trigger (defense in depth, spec §10.1). */
export interface RelayLimits {
  maxDeposit: bigint;
  dailyDepositLimit: bigint;
  /** Each payout costs the relayer rent (payout record, maybe a token account): no dust prizes. */
  minPromoPayout: bigint;
}

interface IntentRow {
  intent_id: string;
  user_id: string;
  action: RelayAction;
  status: IntentResponse["status"];
  signature: string | null;
  network: SentTransaction["network"] | null;
  last_valid_block_height: string | null;
  error_code: string | null;
  error_message: string | null;
}

type ErrorCodeValue = NonNullable<IntentResponse["error"]>["code"];

/** An intent with no recorded signature this old was interrupted before sending. */
const UNSENT_INTENT_TIMEOUT_MS = 180_000;
/** Signed intents are left to their own execution (Solana confirmation takes up to ~90 s) before reconciling. */
const SENT_INTENT_RECONCILE_AFTER_MS = 120_000;
const UNIQUE_VIOLATION = "23505";

/** JSON with sorted keys, so an action read back from JSONB compares equal to the request. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toResponse(row: IntentRow): IntentResponse {
  return {
    intentId: row.intent_id,
    status: row.status,
    ...(row.signature ? { signature: row.signature } : {}),
    ...(row.error_code ? { error: { code: row.error_code as ErrorCodeValue, message: row.error_message ?? "" } } : {}),
  };
}

interface Outcome {
  status: IntentResponse["status"];
  code: ErrorCodeValue | null;
  message: string | null;
}

function outcomeOf(e: unknown, sent: boolean): Outcome {
  // Refused by the program or by the relay's checks; nothing landed.
  if (e instanceof IntentError) return { status: "failed", code: e.code, message: e.message };
  const message = e instanceof Error ? e.message : String(e);
  // Once the signature is recorded the transaction may have been sent: only the chain can tell.
  if (e instanceof UnconfirmedError || sent) return { status: "pending", code: "NETWORK_ERROR", message };
  return { status: "failed", code: "NETWORK_ERROR", message };
}

function settledOutcome(status: TransactionStatus, network: Network): Outcome | undefined {
  switch (status.state) {
    case "landed":
      return { status: "submitted", code: null, message: null };
    case "failed":
      return { status: "failed", code: "PROGRAM_ERROR", message: status.reason };
    case "expired":
      // The rollup's signature history cannot be relied on: a transaction it does not report may
      // well have landed. Left pending (STUCK_INTENTS) rather than risk calling a played round failed.
      if (network === "rollup") return undefined;
      return { status: "failed", code: "NETWORK_ERROR", message: "transaction expired without landing" };
    case "in_flight":
      return undefined;
  }
}

const isDeposit = (action: RelayAction): action is Extract<Action, { type: "open_account" | "deposit" }> =>
  action.type === "open_account" || action.type === "deposit";

export class Intents {
  constructor(
    private readonly db: Db,
    private readonly executor: Executor,
    private readonly limits: RelayLimits,
  ) {}

  /** An intent, or a promo payout when `promo` is set; undefined if the id is unknown or of the other kind. */
  async get(intentId: string, promo = false): Promise<IntentResponse | undefined> {
    const { rows } = await this.db.query<IntentRow>(
      "SELECT * FROM intents WHERE intent_id = $1 AND (action->>'type' = 'promo_payout') = $2",
      [intentId, promo],
    );
    return rows[0] && toResponse(rows[0]);
  }

  async submit(request: RelayIntent): Promise<IntentResponse> {
    const existing = await this.claim(request);
    if (existing) return existing;
    let sent = false;
    const record: RecordSend = async (tx) => {
      const { rowCount } = await this.db.query(
        `UPDATE intents SET signature = $2, network = $3, last_valid_block_height = $4, updated_at = now()
         WHERE intent_id = $1 AND status = 'pending'`,
        [request.intentId, tx.signature, tx.network, tx.lastValidBlockHeight],
      );
      if (rowCount !== 1) throw new Error("intent settled while executing; not sending");
      sent = true;
    };
    const outcome = await this.executor.execute(request.userId, request.action, record).then(
      (): Outcome => ({ status: "submitted", code: null, message: null }),
      (e: unknown) => outcomeOf(e, sent),
    );
    return this.settle(request.intentId, outcome);
  }

  /** Settles pending intents whose execution was interrupted or whose confirmation was missed. */
  async reconcile(chain: { transactionStatus(tx: SentTransaction): Promise<TransactionStatus> }): Promise<number> {
    const { rows } = await this.db.query<IntentRow>(
      `SELECT * FROM intents WHERE status = 'pending' AND updated_at < now() - make_interval(secs =>
         CASE WHEN signature IS NULL THEN $1::float8 ELSE $2::float8 END)`,
      [UNSENT_INTENT_TIMEOUT_MS / 1000, SENT_INTENT_RECONCILE_AFTER_MS / 1000],
    );
    let settled = 0;
    for (const row of rows) {
      // One failing RPC call must not hold up the other intents; the next sweep retries this one.
      try {
        const outcome = row.signature && row.network && row.last_valid_block_height
          ? settledOutcome(await chain.transactionStatus({ signature: row.signature, network: row.network, lastValidBlockHeight: Number(row.last_valid_block_height) }), row.network)
          : { status: "failed" as const, code: "NETWORK_ERROR" as const, message: "interrupted before sending" };
        if (!outcome) continue;
        // Guarded on the signature read above: an execution that resumed and recorded one since wins.
        const { rowCount } = await this.db.query(
          `UPDATE intents SET status = $2, error_code = $3, error_message = $4, updated_at = now()
           WHERE intent_id = $1 AND status = 'pending' AND signature IS NOT DISTINCT FROM $5`,
          [row.intent_id, outcome.status, outcome.code, outcome.message, row.signature],
        );
        settled += rowCount ?? 0;
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "reconcile failed for intent", intentId: row.intent_id, error: e instanceof Error ? e.message : String(e) }));
      }
    }
    return settled;
  }

  /** Commits a pending row for a new intent, or returns the stored outcome of a replayed one. */
  private async claim(request: RelayIntent): Promise<IntentResponse | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      // Short critical section (no network calls): serializes the cap check and the insert.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [request.userId]);
      const { rows } = await client.query<IntentRow>("SELECT * FROM intents WHERE intent_id = $1", [request.intentId]);
      if (rows[0]) {
        await client.query("COMMIT");
        return this.replay(rows[0], request);
      }
      if (isDeposit(request.action)) await this.checkDepositLimits(client, request.userId, BigInt(request.action.amount));
      if (request.action.type === "promo_payout" && BigInt(request.action.amount) < this.limits.minPromoPayout) {
        throw new IntentError("LIMIT_EXCEEDED", `promo payouts start at ${this.limits.minPromoPayout} base units`);
      }
      await client.query("INSERT INTO intents (intent_id, user_id, action, status) VALUES ($1, $2, $3, 'pending')", [
        request.intentId,
        request.userId,
        request.action,
      ]);
      await client.query("COMMIT");
      return undefined;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!(e instanceof pg.DatabaseError) || e.code !== UNIQUE_VIOLATION) throw e;
      if (e.constraint === "intents_one_pending_per_user") throw new IntentError("PLAYER_BUSY", "another intent of this player is in flight");
      // Same intent id inserted concurrently under another user's lock.
      const { rows } = await this.db.query<IntentRow>("SELECT * FROM intents WHERE intent_id = $1", [request.intentId]);
      if (!rows[0]) throw e;
      return this.replay(rows[0], request);
    } finally {
      client.release();
    }
  }

  private replay(existing: IntentRow, request: RelayIntent): IntentResponse {
    if (existing.user_id !== request.userId || canonical(existing.action) !== canonical(request.action)) {
      throw new IntentError("INTENT_CONFLICT", "intent id already used for another action");
    }
    return toResponse(existing);
  }

  private async checkDepositLimits(client: pg.PoolClient, userId: string, amount: bigint): Promise<void> {
    if (amount > this.limits.maxDeposit) throw new IntentError("LIMIT_EXCEEDED", `deposits are capped at ${this.limits.maxDeposit} base units`);
    const { rows } = await client.query<{ total: string }>(
      `SELECT coalesce(sum((action->>'amount')::numeric), 0)::text AS total FROM intents
       WHERE user_id = $1 AND action->>'type' IN ('open_account', 'deposit') AND status <> 'failed'
       AND created_at > now() - interval '24 hours'`,
      [userId],
    );
    if (BigInt(rows[0].total) + amount > this.limits.dailyDepositLimit) {
      throw new IntentError("LIMIT_EXCEEDED", `deposits are capped at ${this.limits.dailyDepositLimit} base units per 24 h`);
    }
  }

  /** Writes the outcome of an execution unless the intent was settled meanwhile. A transaction
   *  seen landing always wins: reconciliation must never leave a landed transaction "failed". */
  private async settle(intentId: string, outcome: Outcome): Promise<IntentResponse> {
    const { rows } = await this.db.query<IntentRow>(
      `UPDATE intents SET status = $2, error_code = $3, error_message = $4, updated_at = now()
       WHERE intent_id = $1 AND (status = 'pending' OR ($2 = 'submitted' AND status = 'failed')) RETURNING *`,
      [intentId, outcome.status, outcome.code, outcome.message],
    );
    if (rows[0]) return toResponse(rows[0]);
    const stored = (await this.db.query<IntentRow>("SELECT * FROM intents WHERE intent_id = $1", [intentId])).rows[0];
    if (!stored) throw new Error(`intent ${intentId} vanished`);
    const current = toResponse(stored);
    if (outcome.status !== "pending" && current.status !== outcome.status) {
      console.error(JSON.stringify({ level: "error", msg: "intent settled differently by reconciliation", intentId, executed: outcome.status, stored: current.status }));
    }
    return current;
  }
}
