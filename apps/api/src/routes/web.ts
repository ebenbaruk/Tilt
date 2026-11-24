// Routes of the web app (Privy access token). Money moves also need a fresh identity token:
// the player's consent (spec §7). A mod session token is never accepted here.
import type { PublicKey } from "@solana/web3.js";
import type { Action } from "@tilt/contract";
import type { Hono } from "hono";
import { listSessions, revokeSession } from "../auth/sessions";
import type { Queryable } from "../db";
import type { AppDeps } from "../deps";
import { ApiError } from "../errors";
import { geoBlock, parseBody, parseParam, rateLimit, requireConsent, webAuth, type Ctx, type Env } from "../http";
import type { IntentOutcome } from "../intents";
import { blockReason, exclude, getLimits, setLimits } from "../limits";
import { log } from "../log";
import type { AccountResponse, FaucetResponse, MoneyIntentResponse, SessionsResponse } from "../public";
import { safeIntentError } from "../relay";
import { DepositSchema, ExcludeSchema, FaucetSchema, IdParam, LimitsSchema, WithdrawSchema } from "../schemas";
import { spendable } from "../state";
import { walletOf } from "../wallets";

const toMoneyResponse = (o: IntentOutcome): MoneyIntentResponse => ({
  intentId: o.intentId,
  status: o.status,
  signature: o.signature,
  error: o.error,
});

const USDC_UNITS = 1_000_000n;

/** "5.3 USDC" from base units: an error the player reads must not look like 5 million. */
function usdcText(units: bigint): string {
  const fraction = (units % USDC_UNITS).toString().padStart(6, "0").replace(/0+$/, "");
  return `${units / USDC_UNITS}${fraction ? `.${fraction}` : ""} USDC`;
}

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
    if (BigInt(amount) < min) throw new ApiError("INVALID_REQUEST", `first deposit is at least ${usdcText(min)}`);
    return { type: "open_account", amount };
  }
  if (BigInt(amount) < config.minDeposit)
    throw new ApiError("INVALID_REQUEST", `deposit is at least ${usdcText(config.minDeposit)}`);
  return { type: "deposit", amount };
}

/** The faucet as the account page shows it. Its status is best effort: the page must load (and
 *  withdrawals stay reachable) when the relay can't say, so a failure only hides the faucet. */
async function faucetOf(deps: AppDeps, userId: string): Promise<AccountResponse["faucet"]> {
  try {
    const status = await deps.relay.faucetStatus(userId);
    return status.enabled && status.amount ? { amount: status.amount, nextClaimAt: status.nextClaimAt } : null;
  } catch (e) {
    log.warn("faucet status unavailable", { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function account(deps: AppDeps, userId: string): Promise<AccountResponse> {
  const wallet = await requireWallet(deps, userId);
  const [player, deposited, config, walletUsdc, limits, faucet] = await Promise.all([
    deps.chain.playerAccount(wallet),
    deps.chain.deposited(wallet),
    deps.chain.config(),
    deps.chain.walletUsdc(wallet),
    getLimits(deps.db, userId),
    faucetOf(deps, userId),
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
    faucet,
  };
}

export function webRoutes(app: Hono<Env>, deps: AppDeps): void {
  // Hono's "/v1/account/*" also matches "/v1/account" itself.
  app.use("/v1/account/*", webAuth(deps.db, deps.privy));
  app.use(
    "/v1/account/*",
    rateLimit(deps.limiters.token, (c) => c.get("userId")),
  );
  const moneyLimit = rateLimit(deps.limiters.money, (c: Ctx) => c.get("userId"));

  app.get("/v1/account", async (c) => c.json(await account(deps, c.get("userId"))));

  app.post("/v1/account/deposit", moneyLimit, geoBlock(deps.geo), async (c) => {
    const identityToken = await requireConsent(c, deps.privy, deps.now);
    const userId = c.get("userId");
    const { intentId, amount } = await parseBody(c, DepositSchema);
    const wallet = await requireWallet(deps, userId);
    const action = (await deps.intents.recordedAction(userId, intentId)) ?? (await depositAction(deps, wallet, amount));
    if ((action.type !== "open_account" && action.type !== "deposit") || action.amount !== amount) {
      throw new ApiError("INTENT_CONFLICT", "intent id already used for another action");
    }
    // Checked under the intent's insert: two parallel deposits cannot both fit the daily limit.
    const guard = async (db: Queryable) => {
      const reason = await blockReason(db, userId, { kind: "deposit", amount: BigInt(amount), intentId });
      if (reason) throw new ApiError("BLOCKED", reason);
    };
    const consent = { identityToken };
    return c.json(toMoneyResponse(await deps.intents.submit(userId, intentId, action, { consent, guard })));
  });

  // Not geo-blocked: withdrawing is always allowed, a player must be able to take their money out.
  app.post("/v1/account/withdraw", moneyLimit, async (c) => {
    const identityToken = await requireConsent(c, deps.privy, deps.now);
    const userId = c.get("userId");
    const { intentId, amount } = await parseBody(c, WithdrawSchema);
    await requireWallet(deps, userId);
    const action = { type: "withdraw", amount } as const;
    return c.json(toMoneyResponse(await deps.intents.submit(userId, intentId, action, { consent: { identityToken } })));
  });

  // Devnet test USDC: the relay sets the amount and enforces the caps; it refuses when disabled.
  app.post("/v1/account/faucet", moneyLimit, geoBlock(deps.geo), async (c) => {
    const userId = c.get("userId");
    const { claimId } = await parseBody(c, FaucetSchema);
    await requireWallet(deps, userId);
    const claim = await deps.relay.claimFaucet({ claimId, userId });
    const body: FaucetResponse = {
      claimId: claim.claimId,
      amount: claim.amount,
      status: claim.status,
      signature: claim.signature ?? null,
      error: safeIntentError(claim.error),
    };
    return c.json(body);
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
