// Player consent (spec §7): moving a player's money takes a fresh Privy identity token of that
// player, forwarded by `apps/api`, so a leaked API key alone cannot deposit or withdraw for anyone.
import type { PrivyClient } from "@privy-io/node";
import type { IntentRequest } from "@tilt/contract";
import { createHash } from "node:crypto";
import { IntentError } from "./chain";
import type { Db } from "./db";

export interface VerifiedIdentity {
  userId: string;
  /** Unix seconds. */
  issuedAt: number;
}

/** Checks an identity token's signature. Production uses Privy; tests inject their own. */
export interface ConsentVerifier {
  /** Throws if the token is not a valid identity token issued by Privy for this app. */
  verify(identityToken: string): Promise<VerifiedIdentity>;
}

export class PrivyConsentVerifier implements ConsentVerifier {
  constructor(private readonly privy: PrivyClient) {}

  async verify(identityToken: string): Promise<VerifiedIdentity> {
    const user = await this.privy.utils().auth().verifyIdentityToken(identityToken);
    // The signature is checked above; the SDK just does not return when the token was issued.
    const payload: unknown = JSON.parse(Buffer.from(identityToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const issuedAt = payload && typeof payload === "object" && "iat" in payload ? payload.iat : undefined;
    if (typeof issuedAt !== "number") throw new Error("identity token without iat");
    return { userId: user.id, issuedAt };
  }
}

/** Actions that move the player's USDC. Rounds only move the in-game balance. */
const NEEDS_CONSENT: ReadonlySet<IntentRequest["action"]["type"]> = new Set(["open_account", "deposit", "withdraw"]);
/** The player authenticated this recently: a token picked up from a log cannot be reused for long. */
const CONSENT_MAX_AGE_SECS = 300;

/** Throws CONSENT_REQUIRED unless the action needs no consent or carries the player's fresh identity token,
 *  not already used for another intent. */
export async function requireConsent(verifier: ConsentVerifier, db: Db, { intentId, userId, action, consent }: IntentRequest, nowMs = Date.now()): Promise<void> {
  if (!NEEDS_CONSENT.has(action.type)) return;
  if (!consent) throw new IntentError("CONSENT_REQUIRED", "this action needs the player's Privy identity token");
  const identity = await verifier.verify(consent.identityToken).catch((e: unknown) => {
    console.error(JSON.stringify({ level: "error", msg: "identity token refused", userId, error: e instanceof Error ? e.message : String(e) }));
    return undefined;
  });
  if (!identity || identity.userId !== userId) throw new IntentError("CONSENT_REQUIRED", "identity token invalid or not this player's");
  if (nowMs / 1000 - identity.issuedAt > CONSENT_MAX_AGE_SECS) {
    throw new IntentError("CONSENT_REQUIRED", `identity token older than ${CONSENT_MAX_AGE_SECS} s`);
  }
  // One token approves one intent: a token picked up in transit cannot approve other moves during
  // its 5 minutes. Replays of the same intent (e.g. after PLAYER_BUSY) may reuse it. A single
  // statement, so concurrent requests with the same token cannot both bind it.
  const tokenHash = createHash("sha256").update(consent.identityToken).digest();
  const { rowCount } = await db.query(
    `INSERT INTO consents (token_hash, intent_id) VALUES ($1, $2)
     ON CONFLICT (token_hash) DO UPDATE SET used_at = consents.used_at WHERE consents.intent_id = EXCLUDED.intent_id`,
    [tokenHash, intentId],
  );
  if (rowCount === 0) throw new IntentError("CONSENT_REQUIRED", "identity token already used for another intent");
}
