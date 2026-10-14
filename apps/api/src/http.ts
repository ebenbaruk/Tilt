// Shared HTTP pieces: context variables, body parsing, client IP, rate limits, geo-blocking and
// the two kinds of authentication (mod session token, Privy access token).
import type { Context, MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { z } from "zod";
import { authenticate } from "./auth/sessions";
import type { Config } from "./config";
import type { Db } from "./db";
import { ApiError } from "./errors";
import type { PrivyVerifier } from "./privy";
import type { RateLimiter } from "./ratelimit";
import { ensureUser } from "./users";

export type Env = { Variables: { userId: string; sessionId: string } };
export type Ctx = Context<Env>;

export async function parseBody<T>(c: Ctx, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) {
    // A field failing several checks (a union of string and null) is named once.
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))].join(", ");
    throw new ApiError("INVALID_REQUEST", `invalid ${fields}`);
  }
  return parsed.data;
}

export function parseParam<T>(value: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, name: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("INVALID_REQUEST", `invalid ${name}`);
  return parsed.data;
}

/** Client IP: from X-Forwarded-For only when configured to trust it, else the socket. Each of our
 *  proxies appends the address it saw, so the client is `TRUSTED_PROXY_HOPS` entries from the
 *  right; anything further left was written by the client and is never used. */
export function clientIp(c: Context, proxy: Pick<Config, "TRUST_PROXY" | "TRUSTED_PROXY_HOPS">): string {
  if (proxy.TRUST_PROXY) {
    const chain = c.req.header("x-forwarded-for")?.split(",") ?? [];
    const forwarded = chain.at(-proxy.TRUSTED_PROXY_HOPS)?.trim();
    if (forwarded) return forwarded;
  }
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return incoming?.socket.remoteAddress ?? "unknown";
}

/** Refuses with 429 once `key`'s bucket is empty. */
export function rateLimit(limiter: RateLimiter, key: (c: Ctx) => string): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!limiter.take(key(c))) throw new ApiError("RATE_LIMITED", "too many requests, slow down");
    await next();
  };
}

/** Header our edge proxy adds with EDGE_SECRET: proof the country header was set by it. */
export const EDGE_HEADER = "x-tilt-edge";

export interface GeoPolicy {
  header: string;
  blocked: readonly string[];
  allowUnknown: boolean;
  /** What the edge sends in EDGE_HEADER; null when there is no trusted edge (country unknown). */
  edgeSecret: string | null;
}

export function geoPolicy(
  config: Pick<Config, "COUNTRY_HEADER" | "BLOCKED_COUNTRIES" | "GEO_ALLOW_UNKNOWN" | "TRUST_PROXY" | "EDGE_SECRET">,
): GeoPolicy {
  return {
    header: config.COUNTRY_HEADER,
    blocked: config.BLOCKED_COUNTRIES,
    allowUnknown: config.GEO_ALLOW_UNKNOWN,
    edgeSecret: config.TRUST_PROXY ? (config.EDGE_SECRET ?? null) : null,
  };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Whether the request came through our edge (constant time, whatever the lengths). */
function fromEdge(c: Context, secret: string | null): boolean {
  const sent = c.req.header(EDGE_HEADER);
  return secret !== null && sent !== undefined && timingSafeEqual(digest(sent), digest(secret));
}

/** The caller's country, trusted only from our edge: a client can set the header itself. */
export function country(c: Context, policy: GeoPolicy): string | null {
  if (!fromEdge(c, policy.edgeSecret)) return null;
  const value = c.req.header(policy.header)?.trim().toUpperCase();
  return value && /^[A-Z]{2}$/.test(value) ? value : null;
}

export function geoAllowed(c: Context, policy: GeoPolicy): boolean {
  const code = country(c, policy);
  return code === null ? policy.allowUnknown : !policy.blocked.includes(code);
}

/** Real-money actions are refused from blocked (or unknown) countries (spec §12). */
export function geoBlock(policy: GeoPolicy): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!geoAllowed(c, policy)) throw new ApiError("GEO_BLOCKED", "Tilt is not available in your country.");
    await next();
  };
}

function bearer(c: Context): string {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) throw new ApiError("UNAUTHORIZED", "missing bearer token");
  return header.slice("Bearer ".length).trim();
}

/** Mod routes: a live play-scoped session token. */
export function modAuth(db: Db): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await authenticate(db, bearer(c));
    if (!session) throw new ApiError("UNAUTHORIZED", "invalid or expired session, run /tilt login");
    c.set("userId", session.userId);
    c.set("sessionId", session.sessionId);
    await next();
  };
}

/** Web routes: a valid Privy access token. */
export function webAuth(db: Db, privy: PrivyVerifier): MiddlewareHandler<Env> {
  return async (c, next) => {
    const userId = await privy.verifyAccessToken(bearer(c)).catch(() => {
      throw new ApiError("UNAUTHORIZED", "invalid or expired access token");
    });
    await ensureUser(db, userId);
    c.set("userId", userId);
    await next();
  };
}

export const IDENTITY_HEADER = "x-privy-identity-token";
/** How recent the identity token must be for a money move: the player just re-confirmed. */
export const CONSENT_MAX_AGE_SECONDS = 300;
/** Clock skew tolerated between Privy and us for tokens "issued in the future". */
const CLOCK_SKEW_SECONDS = 30;

/** Consent proof for deposits and withdrawals (spec §7): a fresh identity token of this user. */
/** Checks the player's fresh identity token and returns it, for the relay to check again (spec §7). */
export async function requireConsent(c: Ctx, privy: PrivyVerifier, now: () => number): Promise<string> {
  const token = c.req.header(IDENTITY_HEADER);
  if (!token) throw new ApiError("UNAUTHORIZED", "identity token required for this action");
  const claims = await privy.verifyIdentityToken(token).catch(() => {
    throw new ApiError("UNAUTHORIZED", "invalid identity token");
  });
  if (claims.userId !== c.get("userId")) throw new ApiError("FORBIDDEN", "identity token is for another user");
  const age = Math.floor(now() / 1000) - claims.issuedAt;
  if (age > CONSENT_MAX_AGE_SECONDS) throw new ApiError("UNAUTHORIZED", "identity token too old, sign in again");
  if (age < -CLOCK_SKEW_SECONDS) {
    throw new ApiError("UNAUTHORIZED", "identity token not valid yet, check your device's clock and sign in again");
  }
  return token;
}
