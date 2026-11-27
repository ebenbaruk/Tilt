// HTTP API of the relay, for `apps/api` only (private network + shared key, spec §7).
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  ErrorResponse,
  FaucetClaimRequest,
  IntentRequest,
  PrivyUserId,
  PromoPayoutRequest,
  type ErrorCode,
  type FaucetClaimResponse,
  type IntentResponse,
  type PromoPayoutResponse,
  type UserResponse,
} from "@tilt/contract";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IntentError, type TiltChain } from "./chain";
import { type ConsentVerifier, requireConsent } from "./consent";
import type { Db } from "./db";
import { FaucetLimitError, faucetStatus } from "./faucet";
import type { Intents } from "./intents";
import type { PlayerWallets } from "./players";

export interface AppDeps {
  /** Accepted bearer keys: the current one, plus the next one during a rotation. */
  apiKeys: readonly string[];
  intents: Intents;
  players: PlayerWallets;
  chain: Pick<TiltChain, "isOpen">;
  db: Db;
  consent: ConsentVerifier;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of the bearer token with each configured key. */
function authorized(header: string | undefined, apiKeys: readonly string[]): boolean {
  const token = digest(header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "");
  return apiKeys.map((key) => timingSafeEqual(token, digest(key))).includes(true);
}

const error = (code: ErrorCode, message: string, retryAt?: Date): ErrorResponse => ({ error: { code, message, ...(retryAt && { retryAt: retryAt.toISOString() }) } });
const invalid = (issues: z.ZodIssue[]) => error("INVALID_REQUEST", issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

/** Refusals of the request itself, not of the action. CONSENT_REQUIRED, PLAYER_BUSY and
 *  LIMIT_EXCEEDED record nothing (the same id can be sent again); INTENT_CONFLICT means the id
 *  is already taken. */
const REQUEST_REFUSALS: Partial<Record<ErrorCode, 403 | 409 | 422>> = { CONSENT_REQUIRED: 403, INTENT_CONFLICT: 409, PLAYER_BUSY: 409, LIMIT_EXCEEDED: 422 };

const Id = z.string().uuid().transform((s) => s.toLowerCase());

/** Valid requests stay well under this, identity token included; larger ones are refused unread. */
const MAX_BODY_BYTES = 8 * 1024;

const asPayout = ({ intentId, ...rest }: IntentResponse): PromoPayoutResponse => ({ payoutId: intentId, ...rest });

/** Runs an intent (or payout), turning request-level refusals into 409 / 422 responses. */
async function run<T>(submit: () => Promise<IntentResponse>, shape: (r: IntentResponse) => T): Promise<{ body: T | ErrorResponse; status: 200 | 403 | 409 | 422 }> {
  try {
    return { body: shape(await submit()), status: 200 };
  } catch (e) {
    const status = e instanceof IntentError ? REQUEST_REFUSALS[e.code] : undefined;
    if (e instanceof IntentError && status) return { body: error(e.code, e.message, e instanceof FaucetLimitError ? e.retryAt : undefined), status };
    throw e;
  }
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(error("INVALID_REQUEST", "request body too large"), 413) }));

  app.get("/health", async (c) => {
    const ok = await deps.db.query("SELECT 1").then(() => true, () => false);
    return c.json({ ok }, ok ? 200 : 503);
  });

  app.use("*", async (c, next) => {
    if (!authorized(c.req.header("authorization"), deps.apiKeys)) return c.json(error("UNAUTHORIZED", "invalid API key"), 401);
    await next();
  });

  app.get("/users/:userId", async (c) => {
    const parsed = PrivyUserId.safeParse(c.req.param("userId"));
    if (!parsed.success) return c.json(error("INVALID_REQUEST", "userId must be a Privy user id"), 400);
    const userId = parsed.data;
    const wallet = await deps.players.find(userId);
    if (!wallet) return c.json(error("UNKNOWN_USER", "no Solana wallet for this user"), 404);
    const body: UserResponse = { userId, solanaAddress: wallet.address.toBase58(), accountOpen: await deps.chain.isOpen(wallet.address) };
    return c.json(body);
  });

  app.post("/intents", async (c) => {
    const parsed = IntentRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    // The identity token is checked, then dropped: only its hash is kept, to refuse it for another intent.
    const { consent: _, ...intent } = parsed.data;
    const { body, status } = await run(async () => {
      await requireConsent(deps.consent, deps.db, parsed.data);
      return deps.intents.submit(intent);
    }, (r) => r);
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

  app.get("/faucet/:userId", async (c) => {
    const userId = PrivyUserId.safeParse(c.req.param("userId"));
    if (!userId.success) return c.json(error("INVALID_REQUEST", "userId must be a Privy user id"), 400);
    return c.json(await faucetStatus(deps.db, userId.data, deps.intents.faucet));
  });

  app.post("/faucet/claims", async (c) => {
    const parsed = FaucetClaimRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const faucet = deps.intents.faucet;
    if (!faucet) return c.json(error("FAUCET_DISABLED", "the faucet is not enabled on this relay"), 403);
    const { claimId, userId } = parsed.data;
    // The amount is the relay's, never the caller's.
    const amount = faucet.amount.toString();
    const { body, status } = await run(
      () => deps.intents.submit({ intentId: claimId, userId, action: { type: "faucet", claimId, amount } }),
      ({ intentId, ...rest }): FaucetClaimResponse => ({ claimId: intentId, amount, ...rest }),
    );
    return c.json(body, status);
  });

  app.onError((e, c) => {
    console.error(JSON.stringify({ level: "error", msg: "unhandled relay error", path: c.req.path, error: e.message }));
    return c.json(error("INTERNAL_ERROR", "internal error"), 500);
  });

  return app;
}
