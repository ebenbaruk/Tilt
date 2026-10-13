// Test doubles and a real Postgres (TEST_DATABASE_URL). The fake relay is an HTTP server built on
// the `@tilt/contract` schemas, with the real relay's rules (auth, validation, idempotency, one
// intent in flight per player), so the api's HttpRelay client is exercised for real.
import { serve, type ServerType } from "@hono/node-server";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ErrorResponse,
  IntentRequest,
  PromoPayoutRequest,
  type Action,
  type ErrorCode,
  type IntentResponse,
} from "@tilt/contract";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import type { ChainConfig, ChainReader, PlayerState } from "../src/chain";
import { createDb, migrate, type Db } from "../src/db";
import type { AppDeps } from "../src/deps";
import { Intents } from "../src/intents";
import type { IdentityClaims, PrivyVerifier } from "../src/privy";
import { RateLimiter } from "../src/ratelimit";
import { HttpRelay } from "../src/relay";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:tilt@127.0.0.1:55432/tilt_api_test";

/** A migrated test database, or null (with a notice) when none is reachable. */
export async function testDb(): Promise<Db | null> {
  const db = createDb(TEST_DATABASE_URL);
  try {
    await migrate(db);
    return db;
  } catch (e) {
    await db.end().catch(() => undefined);
    console.warn(
      `SKIPPED: Postgres tests need TEST_DATABASE_URL (${TEST_DATABASE_URL} unreachable: ${e instanceof Error ? e.message : e})`,
    );
    return null;
  }
}

export async function resetDb(db: Db): Promise<void> {
  await db.query(
    `TRUNCATE audit_log, impressions, prizes, competitions, campaigns, indexer_cursor, draws, rounds,
              intents, limits, mod_sessions, device_codes, users CASCADE`,
  );
}

/** The value, or a failed test when a fixture lacks it. */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture has no ${what}`);
  return value;
}

// ---- Fake relay ----

export const RELAY_KEY = "r".repeat(40);

interface StoredIntent {
  userId: string;
  action: Action | { type: "promo_payout"; amount: string; poolId: string; reason: string };
  response: IntentResponse;
}

export class FakeRelay {
  readonly users = new Map<string, { solanaAddress: string; accountOpen: boolean }>();
  readonly intents = new Map<string, StoredIntent>();
  /** Decides the outcome of each new intent; submitted by default. */
  outcome: (action: StoredIntent["action"]) => Omit<IntentResponse, "intentId"> = () => ({
    status: "submitted",
    signature: `sig-${this.intents.size + 1}`,
  });
  /** Refuse deposits with 422 LIMIT_EXCEEDED (the relay's own caps). */
  limitExceeded = false;
  /** Milliseconds each intent takes, to widen race windows. */
  delayMs = 0;
  down = false;
  /** Promo payout requests received, replays included. */
  payoutCalls = 0;
  /** Identity tokens received with money moves, in order. */
  readonly consentTokens: string[] = [];
  /** Refuse money moves with 403 CONSENT_REQUIRED, as when the token expired on the way. */
  consentExpired = false;
  private server: ServerType | undefined;
  url = "";

  addUser(userId: string, address = Keypair.generate().publicKey): PublicKey {
    this.users.set(userId, { solanaAddress: address.toBase58(), accountOpen: false });
    return address;
  }

  async start(): Promise<void> {
    const app = this.app();
    await new Promise<void>((resolve) => {
      this.server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info: AddressInfo) => {
        this.url = `http://127.0.0.1:${info.port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  client(timeoutMs = 2_000): HttpRelay {
    return new HttpRelay(this.url, RELAY_KEY, timeoutMs);
  }

  private submit(intentId: string, userId: string, action: StoredIntent["action"]) {
    const existing = this.intents.get(intentId);
    if (existing) {
      const same = existing.userId === userId && JSON.stringify(existing.action) === JSON.stringify(action);
      return same ? { status: 200 as const, body: existing.response } : refuse("INTENT_CONFLICT", 409);
    }
    const busy = [...this.intents.values()].some((i) => i.userId === userId && i.response.status === "pending");
    if (busy && action.type !== "promo_payout") return refuse("PLAYER_BUSY", 409);
    if (this.limitExceeded && (action.type === "deposit" || action.type === "open_account")) {
      return refuse("LIMIT_EXCEEDED", 422);
    }
    const response: IntentResponse = { intentId, ...this.outcome(action) };
    this.intents.set(intentId, { userId, action, response });
    return { status: 200 as const, body: response };
  }

  private app(): Hono {
    const app = new Hono();
    app.use("*", async (c, next) => {
      if (this.down) return c.json(ErrorResponse.parse({ error: { code: "INTERNAL_ERROR", message: "down" } }), 503);
      if (c.req.header("authorization") !== `Bearer ${RELAY_KEY}`) return c.json(error("UNAUTHORIZED"), 401);
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      await next();
    });
    app.get("/users/:userId", (c) => {
      const user = this.users.get(c.req.param("userId"));
      return user ? c.json({ userId: c.req.param("userId"), ...user }) : c.json(error("UNKNOWN_USER"), 404);
    });
    app.post("/intents", async (c) => {
      const parsed = IntentRequest.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json(error("INVALID_REQUEST"), 400);
      // Like the relay: money moves need the player's identity token (it is checked, never stored).
      if (MONEY_MOVES.has(parsed.data.action.type)) {
        if (!parsed.data.consent || this.consentExpired) return c.json(error("CONSENT_REQUIRED"), 403);
        this.consentTokens.push(parsed.data.consent.identityToken);
      }
      const { status, body } = this.submit(parsed.data.intentId, parsed.data.userId, parsed.data.action);
      return c.json(body, status);
    });
    app.get("/intents/:id", (c) => {
      const stored = this.intents.get(c.req.param("id").toLowerCase());
      return stored ? c.json(stored.response) : c.json(error("INVALID_REQUEST"), 404);
    });
    app.post("/payouts/promo", async (c) => {
      this.payoutCalls++;
      const parsed = PromoPayoutRequest.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json(error("INVALID_REQUEST"), 400);
      const { payoutId, userId, ...payout } = parsed.data;
      const { status, body } = this.submit(payoutId, userId, { type: "promo_payout", ...payout });
      if (status !== 200) return c.json(body, status);
      const { intentId, ...rest } = body as IntentResponse;
      return c.json({ payoutId: intentId, ...rest });
    });
    app.get("/payouts/promo/:id", (c) => {
      const stored = this.intents.get(c.req.param("id").toLowerCase());
      if (!stored) return c.json(error("INVALID_REQUEST"), 404);
      const { intentId, ...rest } = stored.response;
      return c.json({ payoutId: intentId, ...rest });
    });
    return app;
  }

  /** Intents of real actions (not payouts) the relay recorded. */
  actions(): Action[] {
    return [...this.intents.values()].map((i) => i.action).filter((a): a is Action => a.type !== "promo_payout");
  }
}

const MONEY_MOVES = new Set<Action["type"]>(["open_account", "deposit", "withdraw"]);
const error = (code: ErrorCode) => ({ error: { code, message: code.toLowerCase() } });
const refuse = (code: ErrorCode, status: 409 | 422) => ({ status, body: error(code) });

// ---- Fake chain ----

export const CONFIG: ChainConfig = {
  minBet: 100_000n,
  maxBet: 100_000_000n,
  onboardingFee: 500_000n,
  minDeposit: 1_000_000n,
  mint: Keypair.generate().publicKey,
};

export class FakeChain implements ChainReader {
  readonly accounts = new Map<string, PlayerState>();
  readonly deposits = new Map<string, bigint>();
  readonly usdc = new Map<string, bigint>();

  async playerAccount(player: PublicKey): Promise<PlayerState | null> {
    return this.accounts.get(player.toBase58()) ?? null;
  }
  async deposited(player: PublicKey): Promise<bigint | null> {
    return this.deposits.get(player.toBase58()) ?? null;
  }
  async config(): Promise<ChainConfig> {
    return CONFIG;
  }
  async walletUsdc(player: PublicKey): Promise<bigint> {
    return this.usdc.get(player.toBase58()) ?? 0n;
  }
}

export const idleAccount = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  balance: 10_000_000n,
  credited: 10_000_000n,
  withdrawn: 0n,
  fees: 0n,
  rounds: 0,
  round: {
    status: { kind: "idle" },
    stake: 0n,
    payout: 0n,
    fee: 0n,
    requestId: 0n,
    outcome: { game: "blackjack", player: [], dealer: [], doubled: false },
  },
  ...overrides,
});

// ---- Fake Privy ----

/** Access tokens are "access:<did>"; identity tokens "identity:<did>:<iat seconds>". */
export class FakePrivy implements PrivyVerifier {
  async verifyAccessToken(token: string): Promise<string> {
    if (!token.startsWith("access:")) throw new Error("invalid");
    return token.slice("access:".length);
  }
  async verifyIdentityToken(token: string): Promise<IdentityClaims> {
    const match = /^identity:(.+):(\d+)$/.exec(token);
    if (!match) throw new Error("invalid");
    return { userId: match[1], issuedAt: Number(match[2]) };
  }
}

export const access = (userId: string) => ({ authorization: `Bearer access:${userId}` });
export const identity = (userId: string, ageSeconds = 10) => ({
  "x-privy-identity-token": `identity:${userId}:${Math.floor(Date.now() / 1000) - ageSeconds}`,
});

export const generousLimits = () => ({
  global: RateLimiter.perMinute(100_000),
  ip: RateLimiter.perMinute(100_000),
  token: RateLimiter.perMinute(100_000),
  auth: RateLimiter.perMinute(100_000),
  approveFailures: new RateLimiter({ capacity: 5, refillPerSecond: 5 / 600 }),
  play: RateLimiter.perMinute(100_000),
  money: RateLimiter.perMinute(100_000),
});

export function testApp(db: Db, relay: FakeRelay, chain: FakeChain, overrides: Partial<AppDeps> = {}) {
  const relayClient = relay.client();
  const deps: AppDeps = {
    db,
    relay: relayClient,
    chain,
    privy: new FakePrivy(),
    intents: new Intents(db, relayClient),
    limiters: generousLimits(),
    geo: { header: "x-country", blocked: ["US", "FR"], allowUnknown: false },
    config: {
      WEB_ORIGIN: "https://tilt.test",
      WEB_URL: "https://tilt.test",
      TRUST_PROXY: false,
      PRIVY_KEY_QUORUM_ID: "quorum-1",
      PRIVY_POLICY_ID: "policy-1",
    },
    now: Date.now,
    ...overrides,
  };
  return { app: createApp(deps), deps };
}

/** Allowed country, as the edge proxy would set it. */
export const OK_COUNTRY = { "x-country": "DE" };

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...OK_COUNTRY, ...headers },
  body: JSON.stringify(body),
});
