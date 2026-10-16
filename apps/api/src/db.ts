// Postgres: sessions, the index of settled rounds, competitions and responsible-gaming limits.
// The index is a display cache rebuilt from the chain (spec §10.2); no payment is decided on it
// except sponsor prizes, which go through a manual review first.
import pg from "pg";

export type Db = pg.Pool;
export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

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

/** Runs `fn` in one transaction, rolled back on any error. */
export async function transaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const U64 = "NUMERIC(20, 0)";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  solana_address TEXT UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Device-code login of the mod. Only hashes of the device code are stored.
CREATE TABLE IF NOT EXISTS device_codes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash BYTEA NOT NULL UNIQUE,
  user_code        TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'consumed')),
  user_id          TEXT REFERENCES users (user_id),
  expires_at       TIMESTAMPTZ NOT NULL,
  last_polled_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'pending' OR user_id IS NOT NULL)
);

-- Mod sessions: sha256 of the bearer token only, scope limited to play (spec §10.5).
CREATE TABLE IF NOT EXISTS mod_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   BYTEA NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users (user_id),
  scope        TEXT NOT NULL CHECK (scope = 'play'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mod_sessions_user ON mod_sessions (user_id);

-- Mirror of the intents sent to the relay: idempotency on our side, limits accounting and
-- the player's pending intent.
CREATE TABLE IF NOT EXISTS intents (
  intent_id     UUID PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (user_id),
  kind          TEXT NOT NULL,
  action        JSONB NOT NULL,
  amount        ${U64},
  status        TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'failed')),
  signature     TEXT,
  error_code    TEXT,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intents_user_created ON intents (user_id, created_at);

-- Settled rounds, from RoundSettled events (rollup). detail: the round read from the account
-- right after it settled, when caught (bet, cards), for display and /verify.
CREATE TABLE IF NOT EXISTS rounds (
  signature  TEXT PRIMARY KEY,
  player     TEXT NOT NULL,
  round      INTEGER NOT NULL,
  game       TEXT NOT NULL CHECK (game IN ('blackjack', 'roulette', 'baccarat', 'slots', 'mines', 'dice', 'limbo',
                                           'flip', 'keno', 'wheel', 'hilo', 'tower')),
  stake      ${U64} NOT NULL,
  payout     ${U64} NOT NULL,
  fee        ${U64} NOT NULL,
  request_id ${U64} NOT NULL,
  randomness TEXT NOT NULL,
  detail     JSONB,
  settled_at TIMESTAMPTZ NOT NULL,
  UNIQUE (player, round)
);
CREATE INDEX IF NOT EXISTS rounds_settled_at ON rounds (settled_at);
CREATE INDEX IF NOT EXISTS rounds_player_settled_at ON rounds (player, settled_at);
-- Blackjack details from before multi-hand tables (one hand: player, dealer, doubled) in
-- today's shape: one hand of the whole stake, or of half of it when doubled.
UPDATE rounds SET detail = jsonb_build_object(
  'game', 'blackjack',
  'bet', (CASE WHEN (detail->>'doubled')::boolean THEN div(stake, 2) ELSE stake END)::text,
  'hands', jsonb_build_array(jsonb_build_object('cards', detail->'player', 'doubled', detail->'doubled')),
  'active', 1,
  'dealer', detail->'dealer')
WHERE game = 'blackjack' AND detail ? 'player';
-- Blackjack details from before splits, in today's shape: no hand born from a split.
UPDATE rounds SET detail = jsonb_set(detail, '{hands}', (
    SELECT jsonb_agg(hand || '{"split": false}' ORDER BY i) FROM jsonb_array_elements(detail->'hands') WITH ORDINALITY AS h(hand, i)
  )) || '{"splits": 0}'
WHERE game = 'blackjack' AND detail ? 'bet' AND NOT detail ? 'splits';
-- Mines, then dice to tower: widen the game check of tables created before them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_game_check'
                 AND pg_get_constraintdef(oid) LIKE '%tower%') THEN
    ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_game_check;
    ALTER TABLE rounds ADD CONSTRAINT rounds_game_check
      CHECK (game IN ('blackjack', 'roulette', 'baccarat', 'slots', 'mines', 'dice', 'limbo', 'flip', 'keno',
                      'wheel', 'hilo', 'tower'));
  END IF;
END $$;

-- Every VRF callback (one per draw), keyed by player account: blackjack rounds take several.
CREATE TABLE IF NOT EXISTS draws (
  account    TEXT NOT NULL,
  request_id ${U64} NOT NULL,
  randomness TEXT NOT NULL,
  signature  TEXT NOT NULL,
  PRIMARY KEY (account, request_id)
);

-- indexed_through: every round settled before this time is indexed (competitions close on it).
CREATE TABLE IF NOT EXISTS indexer_cursor (
  name       TEXT PRIMARY KEY,
  signature  TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE indexer_cursor ADD COLUMN IF NOT EXISTS indexed_through TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS campaigns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor        TEXT NOT NULL UNIQUE,
  tagline        TEXT,
  budget         ${U64} NOT NULL CHECK (budget > 0),
  commission_bps INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns (id),
  name             TEXT NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  pool             ${U64} NOT NULL CHECK (pool >= 0),
  split_bps        INTEGER[] NOT NULL,
  shared_ranks     INTEGER NOT NULL CHECK (shared_ranks >= 0),
  min_stake        ${U64} NOT NULL,
  drop_pool        ${U64} NOT NULL CHECK (drop_pool >= 0),
  drop_count       INTEGER NOT NULL CHECK (drop_count >= 0),
  tickets_per_hour INTEGER NOT NULL CHECK (tickets_per_hour > 0),
  -- Secret until close; its sha256 is published from the start (spec §9.2).
  drop_seed        BYTEA NOT NULL,
  drop_seed_hash   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- Prizes wait for a manual anti-fraud review before any payout (spec §10.3).
CREATE TABLE IF NOT EXISTS prizes (
  id             UUID PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES competitions (id),
  kind           TEXT NOT NULL CHECK (kind IN ('rank', 'drop')),
  rank           INTEGER NOT NULL,
  player         TEXT NOT NULL,
  user_id        TEXT REFERENCES users (user_id),
  amount         ${U64} NOT NULL CHECK (amount > 0),
  status         TEXT NOT NULL DEFAULT 'pending_review'
                 CHECK (status IN ('pending_review', 'approved', 'paid', 'failed')),
  signature      TEXT,
  error          TEXT,
  pay_started_at TIMESTAMPTZ,
  approved_at    TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, kind, rank)
);

-- Sponsor panel time on screen, aggregated per minute.
CREATE TABLE IF NOT EXISTS impressions (
  sponsor TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (user_id),
  minute  TIMESTAMPTZ NOT NULL,
  seconds INTEGER NOT NULL CHECK (seconds BETWEEN 0 AND 60),
  PRIMARY KEY (sponsor, user_id, minute)
);

-- Responsible gaming (spec §4.4). A looser limit waits in *_next until *_next_at.
CREATE TABLE IF NOT EXISTS limits (
  user_id               TEXT PRIMARY KEY REFERENCES users (user_id),
  daily_deposit         ${U64},
  daily_deposit_next    ${U64},
  daily_deposit_next_at TIMESTAMPTZ,
  daily_loss            ${U64},
  daily_loss_next       ${U64},
  daily_loss_next_at    TIMESTAMPTZ,
  excluded_until        TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin actions, append-only (spec §10.7).
CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  details JSONB NOT NULL
);
`;

/** Arbitrary key of the advisory lock that serialises concurrent migrations (several instances). */
const MIGRATION_LOCK = 7_349_201;

export async function migrate(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(SCHEMA);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function audit(db: Queryable, actor: string, action: string, details: object): Promise<void> {
  await db.query("INSERT INTO audit_log (actor, action, details) VALUES ($1, $2, $3)", [actor, action, details]);
}
