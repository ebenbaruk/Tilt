// Routes of the web app (Privy access token). Money moves also need a fresh identity token:
// the player's consent (spec §7). A mod session token is never accepted here.
import type { PublicKey } from "@solana/web3.js";
import type { Action } from "@tilt/contract";
import type { Hono } from "hono";
import { listSessions, revokeSession } from "../auth/sessions";
import type { AppDeps } from "../deps";
import { ApiError } from "../errors";
import { geoBlock, parseBody, parseParam, rateLimit, requireConsent, webAuth, type Ctx, type Env } from "../http";
import type { IntentOutcome } from "../intents";
import { blockReason, exclude, getLimits, setLimits } from "../limits";
import type { AccountResponse, MoneyIntentResponse, SessionsResponse } from "../public";
import { DepositSchema, ExcludeSchema, IdParam, LimitsSchema, WithdrawSchema } from "../schemas";
import { spendable } from "../state";
import { walletOf } from "../wallets";

const toMoneyResponse = (o: IntentOutcome): MoneyIntentResponse => ({
  intentId: o.intentId,
  status: o.status,
  signature: o.signature,
  error: o.error,
});

async function requireWallet(deps: AppDeps, userId: string): Promise<PublicKey> {
  const wallet = await walletOf(deps.db, deps.relay, userId);
  if (!wallet) throw new ApiError("NOT_FOUND", "no Solana wallet yet, sign in again on the web");
  return wallet;
}

/** First deposit opens the account (onboarding fee taken from it, spec §6.1), later ones top it up. */
async function depositAction(deps: AppDeps, wallet: PublicKey, amount: string): Promise<Action> {
  const [deposited, config] = await Promise.all([deps.chain.deposited(wallet), deps.chain.config()]);
  if (deposited === null) {
    const min = config.onboardingFee + config.minDeposit;
    if (BigInt(amount) < min) throw new ApiError("INVALID_REQUEST", `first deposit is at least ${min}`);
    return { type: "open_account", amount };
  }
  if (BigInt(amount) < config.minDeposit)
    throw new ApiError("INVALID_REQUEST", `deposit is at least ${config.minDeposit}`);
  return { type: "deposit", amount };
}

async function account(deps: AppDeps, userId: string): Promise<AccountResponse> {
  const wallet = await requireWallet(deps, userId);
  const [player, deposited, config, walletUsdc, limits] = await Promise.all([
    deps.chain.playerAccount(wallet),
    deps.chain.deposited(wallet),
    deps.chain.config(),
    deps.chain.walletUsdc(wallet),
    getLimits(deps.db, userId),
  ]);
  return {
    userId,
    solanaAddress: wallet.toBase58(),
    accountOpen: deposited !== null,
    balance: player ? spendable(player, deposited).toString() : "0",
    walletUsdc: walletUsdc.toString(),
    totals: {
      deposited: (deposited ?? 0n).toString(),
      withdrawn: (player?.withdrawn ?? 0n).toString(),
      fees: (player?.fees ?? 0n).toString(),
      rounds: player?.rounds ?? 0,
    },
    minFirstDeposit: (config.onboardingFee + config.minDeposit).toString(),
    onboardingFee: config.onboardingFee.toString(),
    privySigner: { signerId: deps.config.PRIVY_KEY_QUORUM_ID, policyIds: [deps.config.PRIVY_POLICY_ID] },
    limits,
  };
}

export function webRoutes(app: Hono<Env>, deps: AppDeps): void {
  // Hono's "/v1/account/*" also matches "/v1/account" itself.
  app.use("/v1/account/*", webAuth(deps.db, deps.privy));
  app.use(
    "/v1/account/*",
    rateLimit(deps.limiters.token, (c) => c.get("userId")),
  );
  const money = [rateLimit(deps.limiters.money, (c: Ctx) => c.get("userId")), geoBlock(deps.geo)] as const;

  app.get("/v1/account", async (c) => c.json(await account(deps, c.get("userId"))));

  app.post("/v1/account/deposit", ...money, async (c) => {
    await requireConsent(c, deps.privy, deps.now);
    const userId = c.get("userId");
    const { intentId, amount } = await parseBody(c, DepositSchema);
    const wallet = await requireWallet(deps, userId);
    const action = (await deps.intents.recordedAction(userId, intentId)) ?? (await depositAction(deps, wallet, amount));
    if ((action.type !== "open_account" && action.type !== "deposit") || action.amount !== amount) {
      throw new ApiError("INTENT_CONFLICT", "intent id already used for another action");
    }
    const reason = await blockReason(deps.db, userId, { kind: "deposit", amount: BigInt(amount), intentId });
    if (reason) throw new ApiError("BLOCKED", reason);
    return c.json(toMoneyResponse(await deps.intents.submit(userId, intentId, action)));
  });

  app.post("/v1/account/withdraw", ...money, async (c) => {
    await requireConsent(c, deps.privy, deps.now);
    const userId = c.get("userId");
    const { intentId, amount } = await parseBody(c, WithdrawSchema);
    await requireWallet(deps, userId);
    return c.json(toMoneyResponse(await deps.intents.submit(userId, intentId, { type: "withdraw", amount })));
  });

  app.get("/v1/account/intents/:intentId", async (c) => {
    const intentId = parseParam(c.req.param("intentId"), IdParam, "intentId");
    const outcome = await deps.intents.status(c.get("userId"), intentId);
    if (!outcome) throw new ApiError("NOT_FOUND", "unknown intent");
    return c.json(toMoneyResponse(outcome));
  });

  app.get("/v1/account/sessions", async (c) =>
    c.json({ sessions: await listSessions(deps.db, c.get("userId")) } satisfies SessionsResponse),
  );

  app.delete("/v1/account/sessions/:id", async (c) => {
    const id = parseParam(c.req.param("id"), IdParam, "session id");
    if (!(await revokeSession(deps.db, c.get("userId"), id))) throw new ApiError("NOT_FOUND", "unknown session");
    return c.body(null, 204);
  });

  app.put("/v1/account/limits", async (c) => {
    const request = await parseBody(c, LimitsSchema);
    return c.json(await setLimits(deps.db, c.get("userId"), request));
  });

  app.post("/v1/account/exclude", async (c) => {
    const { days } = await parseBody(c, ExcludeSchema);
    return c.json(await exclude(deps.db, c.get("userId"), days));
  });
}
