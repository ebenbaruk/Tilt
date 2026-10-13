// Intents forwarded to the relay, mirrored in Postgres: an id is bound to one user and one
// action (replays return the recorded outcome), deposits are counted for the player's limits,
// and the mod sees which intent is still in flight.
import type { Action } from "@tilt/contract";
import type { IntentStatus } from "@tilt/mod/protocol";
import type { Db } from "./db";
import { ApiError } from "./errors";
import { NOT_RECORDED, safeIntentError, type Relay } from "./relay";

export interface IntentOutcome {
  intentId: string;
  status: IntentStatus;
  signature: string | null;
  error: { code: string; message: string } | null;
}

interface IntentRow {
  user_id: string;
  status: IntentStatus;
  signature: string | null;
  error_code: string | null;
  error_message: string | null;
  same_action: boolean;
  stale: boolean;
}

/** A pending intent the relay has never heard of after this long was lost before reaching it. */
const LOST_AFTER = "2 minutes";

const amountOf = (action: Action) => ("amount" in action ? action.amount : null);

const fromRow = (intentId: string, row: IntentRow): IntentOutcome => ({
  intentId,
  status: row.status,
  signature: row.signature,
  error: row.error_code ? { code: row.error_code, message: row.error_message ?? "" } : null,
});

export class Intents {
  /** Forwards in progress in this process, so parallel replays share one relay call. */
  private readonly inflight = new Map<string, Promise<IntentOutcome>>();

  constructor(
    private readonly db: Db,
    private readonly relay: Relay,
  ) {}

  async submit(userId: string, rawIntentId: string, action: Action): Promise<IntentOutcome> {
    const intentId = rawIntentId.toLowerCase();
    const existing = await this.record(userId, intentId, action);
    if (existing && existing.status !== "pending") return fromRow(intentId, existing);
    const running = this.inflight.get(intentId);
    if (running) return running;
    const forwarding = this.forward(userId, intentId, action).finally(() => this.inflight.delete(intentId));
    this.inflight.set(intentId, forwarding);
    return forwarding;
  }

  /** Current state of one of the user's intents; null when unknown (or lost before the relay). */
  async status(userId: string, rawIntentId: string): Promise<IntentOutcome | null> {
    const intentId = rawIntentId.toLowerCase();
    const row = await this.find(intentId);
    if (!row || row.user_id !== userId) return null;
    if (row.status !== "pending") return fromRow(intentId, row);
    const remote = await this.relay.getIntent(intentId);
    if (remote) return this.save(intentId, remote);
    if (!row.stale) return fromRow(intentId, row);
    await this.db.query("DELETE FROM intents WHERE intent_id = $1 AND status = 'pending'", [intentId]);
    return null;
  }

  /** The action first sent under this id by this user: a retry must resend exactly it. */
  async recordedAction(userId: string, rawIntentId: string): Promise<Action | null> {
    const { rows } = await this.db.query<{ action: Action }>(
      "SELECT action FROM intents WHERE intent_id = $1 AND user_id = $2",
      [rawIntentId.toLowerCase(), userId],
    );
    return rows[0]?.action ?? null;
  }

  /** The user's intent still in flight, refreshed from the relay. */
  async pending(userId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ intent_id: string }>(
      "SELECT intent_id FROM intents WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    if (!rows[0]) return null;
    const outcome = await this.status(userId, rows[0].intent_id);
    return outcome?.status === "pending" ? outcome.intentId : null;
  }

  /** Inserts the intent, or returns the existing row when this exact intent was seen before. */
  private async record(userId: string, intentId: string, action: Action, retried = false): Promise<IntentRow | null> {
    const inserted = await this.db.query(
      `INSERT INTO intents (intent_id, user_id, kind, action, amount, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') ON CONFLICT (intent_id) DO NOTHING`,
      [intentId, userId, action.type, action, amountOf(action)],
    );
    if (inserted.rowCount === 1) return null;
    const row = await this.find(intentId, action);
    // Deleted in between by a refused replay: record it afresh.
    if (!row && !retried) return this.record(userId, intentId, action, true);
    if (!row) throw new ApiError("PLAYER_BUSY", "intent busy, retry with the same id");
    if (row.user_id !== userId || !row.same_action) {
      throw new ApiError("INTENT_CONFLICT", "intent id already used for another action");
    }
    return row;
  }

  private async find(intentId: string, action?: Action): Promise<IntentRow | undefined> {
    const { rows } = await this.db.query<IntentRow>(
      `SELECT user_id, status, signature, error_code, error_message,
              coalesce(action = $2::jsonb, false) AS same_action,
              created_at < now() - $3::interval AS stale
       FROM intents WHERE intent_id = $1`,
      [intentId, action ?? null, LOST_AFTER],
    );
    return rows[0];
  }

  private async forward(userId: string, intentId: string, action: Action): Promise<IntentOutcome> {
    try {
      return await this.save(intentId, await this.relay.submitIntent({ intentId, userId, action }));
    } catch (e) {
      // Nothing was recorded by the relay: forget the intent so the same id can be sent again.
      if (e instanceof ApiError && (NOT_RECORDED.has(e.code) || e.code === "INTENT_CONFLICT")) {
        await this.db.query("DELETE FROM intents WHERE intent_id = $1 AND status = 'pending'", [intentId]);
      }
      throw e;
    }
  }

  private async save(
    intentId: string,
    remote: { status: IntentStatus; signature?: string; error?: Parameters<typeof safeIntentError>[0] },
  ): Promise<IntentOutcome> {
    const error = safeIntentError(remote.error);
    await this.db.query(
      `UPDATE intents SET status = $2, signature = $3, error_code = $4, error_message = $5, updated_at = now()
       WHERE intent_id = $1`,
      [intentId, remote.status, remote.signature ?? null, error?.code ?? null, error?.message ?? null],
    );
    return { intentId, status: remote.status, signature: remote.signature ?? null, error };
  }
}
