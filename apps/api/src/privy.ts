// Privy token checks for the web routes. Access tokens authenticate; a fresh identity token is
// the player's consent proof for money moves (spec §7). Tests inject a fake verifier.
import { PrivyClient } from "@privy-io/node";

export interface IdentityClaims {
  userId: string;
  /** Unix seconds the token was issued at. */
  issuedAt: number;
}

export interface PrivyVerifier {
  /** Resolves the Privy user id (`did:privy:…`); rejects any invalid or expired token. */
  verifyAccessToken(token: string): Promise<string>;
  verifyIdentityToken(token: string): Promise<IdentityClaims>;
}

/** `iat` of a JWT whose signature was already verified. */
function issuedAt(jwt: string): number {
  const payload: unknown = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
  const iat = typeof payload === "object" && payload !== null && "iat" in payload ? payload.iat : undefined;
  if (typeof iat !== "number") throw new Error("identity token has no iat");
  return iat;
}

export class PrivyTokenVerifier implements PrivyVerifier {
  private readonly privy: PrivyClient;

  constructor(appId: string, appSecret: string) {
    this.privy = new PrivyClient({ appId, appSecret });
  }

  async verifyAccessToken(token: string): Promise<string> {
    const claims = await this.privy.utils().auth().verifyAccessToken(token);
    return claims.user_id;
  }

  async verifyIdentityToken(token: string): Promise<IdentityClaims> {
    const user = await this.privy.utils().auth().verifyIdentityToken(token);
    return { userId: user.id, issuedAt: issuedAt(token) };
  }
}
