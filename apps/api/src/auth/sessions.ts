// Mod sessions: opaque bearer tokens, scope "play" only (no deposit, withdrawal or account
// change, spec §10.5), 30 days, revocable from the web.
import type { ModSession } from "../public";
import type { Db, Queryable } from "../db";
import { newSecret, sha256 } from "./secrets";

export const SESSION_TTL_DAYS = 30;
const TOKEN_PREFIX = "tilt_";
const TOKEN_FORMAT = /^tilt_[A-Za-z0-9_-]{43}$/;
/** last_used_at is informational: one write per minute per session is plenty. */
const LAST_USED_RESOLUTION = "60 seconds";

export interface SessionPrincipal {
  sessionId: string;
  userId: string;
}

export interface NewSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Queryable, userId: string): Promise<NewSession> {
  const token = newSecret(TOKEN_PREFIX);
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO mod_sessions (token_hash, user_id, scope, expires_at)
     VALUES ($1, $2, 'play', now() + make_interval(days => $3)) RETURNING expires_at`,
    [sha256(token), userId, SESSION_TTL_DAYS],
  );
  return { token, expiresAt: rows[0].expires_at };
}

/** The session behind a bearer token, or null if unknown, expired or revoked. */
export async function authenticate(db: Db, token: string): Promise<SessionPrincipal | null> {
  if (!TOKEN_FORMAT.test(token)) return null;
  const { rows } = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM mod_sessions
     WHERE token_hash = $1 AND scope = 'play' AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(token)],
  );
  const session = rows[0];
  if (!session) return null;
  await db.query(
    `UPDATE mod_sessions SET last_used_at = now()
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - $2::interval)`,
    [session.id, LAST_USED_RESOLUTION],
  );
  return { sessionId: session.id, userId: session.user_id };
}

export async function listSessions(db: Db, userId: string): Promise<ModSession[]> {
  const { rows } = await db.query<{ id: string; created_at: Date; last_used_at: Date | null; expires_at: Date }>(
    `SELECT id, created_at, last_used_at, expires_at FROM mod_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
    expiresAt: r.expires_at.toISOString(),
  }));
}

/** True when the session existed, belonged to the user and was still active. */
export async function revokeSession(db: Db, userId: string, sessionId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    "UPDATE mod_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
    [sessionId, userId],
  );
  return rowCount === 1;
}

export async function revokeAllSessions(db: Queryable, userId: string): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE mod_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
  return rowCount ?? 0;
}
