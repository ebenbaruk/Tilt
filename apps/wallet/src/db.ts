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
-- Global 24 h caps (deposits, promo payouts) sum over every player.
CREATE INDEX IF NOT EXISTS intents_created ON intents (created_at);
-- One move in flight per player: rounds are sequential and deposits must not overlap.
-- What Tilt pays the player from the relayer (promo payouts, devnet faucet claims, on Solana) is
-- left out: a prize or test USDC must not make the player busy. Their caps are checked under locks.
DROP INDEX IF EXISTS intents_one_pending_per_user;
DROP INDEX IF EXISTS intents_one_pending_play_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS intents_one_pending_move_per_user ON intents (user_id)
  WHERE status = 'pending' AND action->>'type' NOT IN ('promo_payout', 'faucet');
`;

export async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
}
