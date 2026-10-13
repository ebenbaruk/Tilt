// Device-code login of the mod (`/tilt login`, RFC 8628 style): the mod gets a secret device
// code and shows a short user code; the player approves it on the web with Privy; the mod's
// next poll trades the device code for a play-only session token, once.
import type { DeviceStartResponse, DeviceTokenResponse } from "@tilt/mod/protocol";
import { ApiError } from "../errors";
import { transaction, type Db } from "../db";
import { ensureUser } from "../users";
import { newSecret, newUserCode, normalizeUserCode, sha256 } from "./secrets";
import { createSession } from "./sessions";

export const DEVICE_CODE_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 5;
const DEVICE_CODE_FORMAT = /^[A-Za-z0-9_-]{43}$/;
/** Expired codes are kept a day for the audit trail, then dropped. */
const RETENTION = "1 day";
const UNIQUE_VIOLATION = "23505";
const USER_CODE_ATTEMPTS = 3;

const isUniqueViolation = (e: unknown) => e instanceof Error && "code" in e && e.code === UNIQUE_VIOLATION;

export async function startDeviceLogin(db: Db, webUrl: string): Promise<DeviceStartResponse> {
  await db.query("DELETE FROM device_codes WHERE expires_at < now() - $1::interval", [RETENTION]);
  const deviceCode = newSecret();
  for (let attempt = 1; ; attempt++) {
    const userCode = newUserCode();
    try {
      await db.query(
        `INSERT INTO device_codes (device_code_hash, user_code, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))`,
        [sha256(deviceCode), userCode, DEVICE_CODE_TTL_SECONDS],
      );
      const verifyUrl = new URL("/connect", webUrl);
      verifyUrl.searchParams.set("code", userCode);
      return {
        deviceCode,
        userCode,
        verifyUrl: verifyUrl.toString(),
        expiresIn: DEVICE_CODE_TTL_SECONDS,
        interval: POLL_INTERVAL_SECONDS,
      };
    } catch (e) {
      // A user-code collision (1 in 1e12 per live code): draw another one.
      if (!isUniqueViolation(e) || attempt >= USER_CODE_ATTEMPTS) throw e;
    }
  }
}

interface DeviceRow {
  id: string;
  status: "pending" | "approved" | "consumed";
  user_id: string | null;
  expired: boolean;
  too_soon: boolean;
}

/** One poll of the mod. Polling faster than the interval is refused (RFC 8628 slow_down). */
export async function pollDeviceLogin(db: Db, deviceCode: string): Promise<DeviceTokenResponse> {
  if (!DEVICE_CODE_FORMAT.test(deviceCode)) throw new ApiError("INVALID_REQUEST", "unknown device code");
  return transaction(db, async (client) => {
    const { rows } = await client.query<DeviceRow>(
      `SELECT id, status, user_id, expires_at <= now() AS expired,
              coalesce(last_polled_at > now() - make_interval(secs => $2), false) AS too_soon
       FROM device_codes WHERE device_code_hash = $1 FOR UPDATE`,
      [sha256(deviceCode), POLL_INTERVAL_SECONDS],
    );
    const row = rows[0];
    if (!row) throw new ApiError("INVALID_REQUEST", "unknown device code");
    if (row.too_soon) throw new ApiError("RATE_LIMITED", `slow down: poll every ${POLL_INTERVAL_SECONDS} s`);
    await client.query("UPDATE device_codes SET last_polled_at = now() WHERE id = $1", [row.id]);
    // Single use: once traded for a token, the code is spent like an expired one.
    if (row.expired || row.status === "consumed") return { status: "expired" };
    if (row.status === "pending" || !row.user_id) return { status: "pending" };
    await client.query("UPDATE device_codes SET status = 'consumed' WHERE id = $1", [row.id]);
    const session = await createSession(client, row.user_id);
    return { status: "approved", token: session.token, expiresAt: session.expiresAt.toISOString() };
  });
}

/** The player approves the code shown by their mod. False when unknown, expired or used. */
export async function approveDeviceLogin(db: Db, userCodeInput: string, userId: string): Promise<boolean> {
  const userCode = normalizeUserCode(userCodeInput);
  if (!userCode) return false;
  await ensureUser(db, userId);
  const { rowCount } = await db.query(
    `UPDATE device_codes SET status = 'approved', user_id = $2
     WHERE user_code = $1 AND status = 'pending' AND expires_at > now()`,
    [userCode, userId],
  );
  return rowCount === 1;
}
