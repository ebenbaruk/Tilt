// Postgres: player wallets (cache of Privy) and intents (idempotency and audit trail).
import pg from "pg";

export type Db = pg.Pool;

/** Fail fast instead of queueing forever when the pool or the database is stuck. */
const CONNECTION_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 10_000;

export function createDb(url: string): Db {
  return new pg.Pool({
    connectionString: url,
    max: 20,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  user_id            TEXT PRIMARY KEY,
  wallet_id          TEXT NOT NULL,
  address            TEXT NOT NULL UNIQUE,
  last_checkpoint_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intents (
  intent_id               UUID PRIMARY KEY,
  user_id                 TEXT NOT NULL,
  action                  JSONB NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'failed')),
  -- Recorded before the transaction is sent, so an interrupted intent can be settled later.
  signature               TEXT,
  network                 TEXT CHECK (network IN ('solana', 'rollup')),
  last_valid_block_height BIGINT,
  error_code              TEXT,
  error_message           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intents_user_created ON intents (user_id, created_at);
-- One intent in flight per player: rounds are sequential and deposits must not overlap.
-- Promo payouts (relayer-signed, on Solana) are left out: a prize must not make the player busy.
DROP INDEX IF EXISTS intents_one_pending_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS intents_one_pending_play_per_user ON intents (user_id)
  WHERE status = 'pending' AND action->>'type' <> 'promo_payout';
`;

export async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
}
