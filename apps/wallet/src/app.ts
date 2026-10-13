// HTTP API of the relay, for `apps/api` only (private network + shared key, spec §7).
import { Hono } from "hono";
import {
  ErrorResponse,
  IntentRequest,
  PromoPayoutRequest,
  type ErrorCode,
  type IntentResponse,
  type PromoPayoutResponse,
  type UserResponse,
} from "@tilt/contract";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IntentError, type TiltChain } from "./chain";
import type { Db } from "./db";
import type { Intents } from "./intents";
import type { PlayerWallets } from "./players";

export interface AppDeps {
  /** Accepted bearer keys: the current one, plus the next one during a rotation. */
  apiKeys: readonly string[];
  intents: Intents;
  players: PlayerWallets;
  chain: Pick<TiltChain, "isOpen">;
  db: Db;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of the bearer token with each configured key. */
function authorized(header: string | undefined, apiKeys: readonly string[]): boolean {
  const token = digest(header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "");
  return apiKeys.map((key) => timingSafeEqual(token, digest(key))).includes(true);
}

const error = (code: ErrorCode, message: string): ErrorResponse => ({ error: { code, message } });
const invalid = (issues: z.ZodIssue[]) => error("INVALID_REQUEST", issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

/** Refusals of the request itself, not of the action. PLAYER_BUSY and LIMIT_EXCEEDED record
 *  nothing (the same id can be sent again); INTENT_CONFLICT means the id is already taken. */
const REQUEST_REFUSALS: Partial<Record<ErrorCode, 409 | 422>> = { INTENT_CONFLICT: 409, PLAYER_BUSY: 409, LIMIT_EXCEEDED: 422 };

const Id = z.string().uuid().transform((s) => s.toLowerCase());

const asPayout = ({ intentId, ...rest }: IntentResponse): PromoPayoutResponse => ({ payoutId: intentId, ...rest });

/** Runs an intent (or payout), turning request-level refusals into 409 / 422 responses. */
async function run<T>(submit: () => Promise<IntentResponse>, shape: (r: IntentResponse) => T): Promise<{ body: T | ErrorResponse; status: 200 | 409 | 422 }> {
  try {
    return { body: shape(await submit()), status: 200 };
  } catch (e) {
    const status = e instanceof IntentError ? REQUEST_REFUSALS[e.code] : undefined;
    if (e instanceof IntentError && status) return { body: error(e.code, e.message), status };
    throw e;
  }
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const ok = await deps.db.query("SELECT 1").then(() => true, () => false);
    return c.json({ ok }, ok ? 200 : 503);
  });

  app.use("*", async (c, next) => {
    if (!authorized(c.req.header("authorization"), deps.apiKeys)) return c.json(error("UNAUTHORIZED", "invalid API key"), 401);
    await next();
  });

  app.get("/users/:userId", async (c) => {
    const userId = c.req.param("userId");
    const wallet = await deps.players.find(userId);
    if (!wallet) return c.json(error("UNKNOWN_USER", "no Solana wallet for this user"), 404);
    const body: UserResponse = { userId, solanaAddress: wallet.address.toBase58(), accountOpen: await deps.chain.isOpen(wallet.address) };
    return c.json(body);
  });

  app.post("/intents", async (c) => {
    const parsed = IntentRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const { body, status } = await run(() => deps.intents.submit(parsed.data), (r) => r);
    return c.json(body, status);
  });

  app.get("/intents/:intentId", async (c) => {
    const intentId = Id.safeParse(c.req.param("intentId"));
    if (!intentId.success) return c.json(error("INVALID_REQUEST", "intentId must be a UUID"), 400);
    const intent = await deps.intents.get(intentId.data);
    return intent ? c.json(intent) : c.json(error("INVALID_REQUEST", "unknown intent"), 404);
  });

  app.post("/payouts/promo", async (c) => {
    const parsed = PromoPayoutRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const { payoutId, userId, ...payout } = parsed.data;
    const { body, status } = await run(
      () => deps.intents.submit({ intentId: payoutId, userId, action: { type: "promo_payout", payoutId, ...payout } }),
      asPayout,
    );
    return c.json(body, status);
  });

  app.get("/payouts/promo/:payoutId", async (c) => {
    const payoutId = Id.safeParse(c.req.param("payoutId"));
    if (!payoutId.success) return c.json(error("INVALID_REQUEST", "payoutId must be a UUID"), 400);
    const payout = await deps.intents.get(payoutId.data, true);
    return payout ? c.json(asPayout(payout)) : c.json(error("INVALID_REQUEST", "unknown payout"), 404);
  });

  app.onError((e, c) => {
    console.error(JSON.stringify({ level: "error", msg: "unhandled relay error", path: c.req.path, error: e.message }));
    return c.json(error("INTERNAL_ERROR", "internal error"), 500);
  });

  return app;
}
