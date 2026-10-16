// HTTP behaviour of the mod, web and public routes against Postgres, a fake relay (HTTP, on the
// contract schemas), a fake chain and a fake Privy.
import { PublicKey } from "@solana/web3.js";
import { playerAccountAddress } from "@tilt/contract";
import type { IntentResponse, StateResponse } from "@tilt/mod/protocol";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { createCampaign, openCompetition } from "../src/competitions/store";
import { migrate } from "../src/db";
import { settle } from "../src/games/settlement";
import type { AccountResponse, MoneyIntentResponse, ResponsibleLimits, VerifyResponse } from "../src/public";
import { RateLimiter } from "../src/ratelimit";
import { saveDetail, saveDraw, saveRound } from "../src/rounds";
import { ensureUser } from "../src/users";
import vectors from "./fixtures/rust-vectors.json";
import {
  access,
  FakeChain,
  FakeRelay,
  idleAccount,
  identity,
  json,
  must,
  EDGE,
  EDGE_SECRET,
  OK_COUNTRY,
  resetDb,
  testApp,
  testDb,
} from "./helpers";

const db = await testDb();
const ALICE = "did:privy:cmalice00000000000000000a";
const BOB = "did:privy:cmbob0000000000000000000b";
const SIGNATURE = "5".repeat(88);

describe.skipIf(!db)("api routes", () => {
  if (!db) return;
  const relay = new FakeRelay();
  let chain: FakeChain;
  let app: ReturnType<typeof testApp>["app"];
  let mod: Record<string, string>;
  let wallet: string;

  beforeAll(() => relay.start());
  afterAll(async () => {
    await relay.stop();
    await db.end();
  });
  beforeEach(async () => {
    await resetDb(db);
    relay.intents.clear();
    relay.users.clear();
    relay.outcome = () => ({ status: "submitted", signature: `sig-${relay.intents.size + 1}` });
    relay.limitExceeded = false;
    relay.delayMs = 0;
    relay.down = false;
    chain = new FakeChain();
    ({ app } = testApp(db, relay, chain));
    wallet = relay.addUser(ALICE).toBase58();
    chain.accounts.set(wallet, idleAccount());
    chain.deposits.set(wallet, 10_000_000n);
    await ensureUser(db, ALICE);
    mod = { authorization: `Bearer ${(await createSession(db, ALICE)).token}` };
  });

  const play = (action: unknown, intentId: string = randomUUID(), headers: Record<string, string> = {}) =>
    app.request("/v1/play", json({ intentId, action }, { ...mod, ...headers }));
  const slots = { type: "slots_spin", amount: "1000000" };

  describe("POST /v1/play", () => {
    it("forwards a game move to the relay and returns its outcome", async () => {
      const res = await play(slots);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "submitted", error: null });
      expect(relay.actions()).toEqual([slots]);
    });

    it("forwards the mines moves", async () => {
      const moves = [
        { type: "mines_bet", amount: "1000000", mines: 1 },
        { type: "mines_bet", amount: "1000000", mines: 24 },
        { type: "mines_reveal", tile: 0 },
        { type: "mines_reveal", tile: 24 },
        { type: "mines_cashout" },
      ];
      for (const action of moves) expect((await play(action)).status, JSON.stringify(action)).toBe(200);
      expect(relay.actions()).toEqual(moves);
    });

    it("refuses money actions and malformed moves without calling the relay", async () => {
      for (const action of [
        { type: "deposit", amount: "1000000" },
        { type: "withdraw", amount: "1000000" },
        { type: "open_account", amount: "1000000" },
        { type: "slots_spin", amount: "1.5" },
        { type: "slots_spin", amount: "-1" },
        { type: "slots_spin", amount: 1000000 },
        { type: "roulette_spin", amount: "1000000", bet: { kind: "straight", number: 37 } },
        { type: "roulette_spin", amount: "1000000", bet: { kind: "dozen", dozen: 4 } },
        { type: "blackjack_hit", extra: true },
        { type: "blackjack_bet", amount: "1000000" },
        { type: "blackjack_bet", amount: "1000000", hands: 0 },
        { type: "blackjack_bet", amount: "1000000", hands: 7 },
        { type: "blackjack_bet", amount: "1000000", hands: 1.5 },
        { type: "mines_bet", amount: "1000000", mines: 0 },
        { type: "mines_bet", amount: "1000000", mines: 25 },
        { type: "mines_bet", amount: "1000000", mines: 2.5 },
        { type: "mines_bet", amount: "1000000" },
        { type: "mines_bet", mines: 3 },
        { type: "mines_reveal", tile: 25 },
        { type: "mines_reveal", tile: -1 },
        { type: "mines_reveal", tile: 1.5 },
        { type: "mines_reveal", tile: "3" },
        { type: "mines_reveal" },
        { type: "mines_cashout", tile: 3 },
      ]) {
        const res = await play(action);
        expect(res.status, JSON.stringify(action)).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
      }
      expect((await app.request("/v1/play", json({ intentId: "nope", action: slots }, mod))).status).toBe(400);
      expect(relay.intents.size).toBe(0);
    });

    it("sends one relay intent when the same intent is replayed in parallel", async () => {
      relay.delayMs = 50;
      const id = randomUUID();
      const results = await Promise.all([play(slots, id), play(slots, id), play(slots, id.toUpperCase())]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(relay.intents.size).toBe(1);
      const again = (await (await play(slots, id)).json()) as IntentResponse;
      expect(again).toMatchObject({ intentId: id, status: "submitted" });
      expect(relay.intents.size).toBe(1);
    });

    it("refuses to reuse an intent id for another action", async () => {
      const id = randomUUID();
      await play(slots, id);
      const res = await play({ type: "slots_spin", amount: "2000000" }, id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "INTENT_CONFLICT" } });
    });

    it("passes PLAYER_BUSY through as 409, and the same id can be sent again later", async () => {
      relay.outcome = () => ({ status: "pending" });
      await play(slots);
      const id = randomUUID();
      const busy = await play({ type: "blackjack_hit" }, id);
      expect(busy.status).toBe(409);
      expect(await busy.json()).toMatchObject({ error: { code: "PLAYER_BUSY" } });
      for (const i of relay.intents.values()) i.response = { ...i.response, status: "submitted" };
      relay.outcome = () => ({ status: "submitted", signature: "s" });
      expect((await play({ type: "blackjack_hit" }, id)).status).toBe(200);
    });

    it("shows Anchor error names but never raw upstream text", async () => {
      relay.outcome = () => ({ status: "failed", error: { code: "PROGRAM_ERROR", message: "InsufficientBalance" } });
      expect(await (await play(slots)).json()).toMatchObject({
        status: "failed",
        error: { code: "PROGRAM_ERROR", message: "InsufficientBalance" },
      });
      relay.outcome = () => ({ status: "failed", error: { code: "NETWORK_ERROR", message: "rpc 10.1.2.3 timeout" } });
      const body = (await (await play(slots)).json()) as IntentResponse;
      expect(body.error).toEqual({ code: "NETWORK_ERROR", message: "network error, try again" });
    });

    it("reports a relay outage as 502 and accepts the same id once it is back", async () => {
      relay.down = true;
      const id = randomUUID();
      const res = await play(slots, id);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: { code: "UPSTREAM_ERROR", message: "relay unavailable, retry with the same id" },
      });
      relay.down = false;
      expect((await play(slots, id)).status).toBe(200);
      expect(relay.intents.size).toBe(1);
    });

    it("is geo-blocked, failing closed without a country", async () => {
      expect((await play(slots, randomUUID(), { "x-country": "FR" })).status).toBe(451);
      const noCountry = await app.request("/v1/play", {
        method: "POST",
        headers: { ...mod, "content-type": "application/json" },
        body: JSON.stringify({ intentId: randomUUID(), action: slots }),
      });
      expect(noCountry.status).toBe(451);
      expect(await noCountry.json()).toMatchObject({ error: { code: "GEO_BLOCKED" } });
      expect(relay.intents.size).toBe(0);
    });

    it("needs a wallet", async () => {
      relay.users.clear();
      await ensureUser(db, BOB);
      const bob = { authorization: `Bearer ${(await createSession(db, BOB)).token}` };
      const res = await play(slots, randomUUID(), bob);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "ACCOUNT_NOT_OPEN" } });
    });

    it("is rate limited per player", async () => {
      ({ app } = testApp(db, relay, chain, {
        limiters: { ...testApp(db, relay, chain).deps.limiters, play: RateLimiter.perMinute(2) },
      }));
      expect((await play(slots)).status).toBe(200);
      expect((await play(slots)).status).toBe(200);
      expect((await play(slots)).status).toBe(429);
    });
  });

  describe("GET /v1/intents/:id", () => {
    it("returns the player's intent and hides other players' ones", async () => {
      relay.outcome = () => ({ status: "pending" });
      const id = randomUUID();
      await play(slots, id);
      must(relay.intents.get(id), "intent").response = { intentId: id, status: "submitted", signature: "abc" };
      expect(await (await app.request(`/v1/intents/${id}`, { headers: mod })).json()).toEqual({
        intentId: id,
        status: "submitted",
        error: null,
      });
      await ensureUser(db, BOB);
      const bob = { authorization: `Bearer ${(await createSession(db, BOB)).token}` };
      expect((await app.request(`/v1/intents/${id}`, { headers: bob })).status).toBe(404);
      expect((await app.request(`/v1/intents/not-a-uuid`, { headers: mod })).status).toBe(400);
    });
  });

  describe("responsible gaming", () => {
    const exclude = (days: number) => app.request("/v1/account/exclude", json({ days }, access(ALICE)));
    const putLimits = (body: unknown) =>
      app.request("/v1/account/limits", { ...json(body, access(ALICE)), method: "PUT" });

    it("self-exclusion blocks play and deposits, not withdrawals, and cannot be shortened", async () => {
      const first = (await (await exclude(30)).json()) as ResponsibleLimits;
      expect(first.excludedUntil).not.toBeNull();
      const res = await play(slots);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: { code: "BLOCKED", message: expect.stringContaining("Self-excluded") },
      });
      expect((await play({ type: "blackjack_stand" })).status).toBe(403);
      const deposit = { intentId: randomUUID(), amount: "5000000" };
      const consent = { ...access(ALICE), ...identity(ALICE) };
      expect((await app.request("/v1/account/deposit", json(deposit, consent))).status).toBe(403);
      expect((await app.request("/v1/account/withdraw", json(deposit, consent))).status).toBe(200);
      const shorter = (await (await exclude(1)).json()) as ResponsibleLimits;
      expect(shorter.excludedUntil).toBe(first.excludedUntil);
      expect((await exclude(0)).status).toBe(400);
      expect((await exclude(3651)).status).toBe(400);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state.blocked).toContain("Self-excluded");
    });

    it("the daily loss limit stops new bets but lets the hand finish", async () => {
      await putLimits({ dailyDeposit: null, dailyLoss: "1000000" });
      await saveRound(db, {
        signature: SIGNATURE,
        player: wallet,
        round: 1,
        game: "slots",
        stake: 1_000_000n,
        payout: 0n,
        fee: 0n,
        requestId: 1n,
        randomness: Buffer.alloc(32),
        settledAt: new Date(),
      });
      expect((await play(slots)).status).toBe(403);
      expect((await play({ type: "blackjack_double" })).status).toBe(403);
      expect((await play({ type: "mines_bet", amount: "1000000", mines: 3 })).status).toBe(403);
      expect((await play({ type: "blackjack_stand" })).status).toBe(200);
      expect((await play({ type: "mines_reveal", tile: 4 })).status).toBe(200);
      expect((await play({ type: "mines_cashout" })).status).toBe(200);
    });

    it("the daily deposit limit counts deposits sent in the last 24 h", async () => {
      await putLimits({ dailyDeposit: "6000000", dailyLoss: null });
      const consent = { ...access(ALICE), ...identity(ALICE) };
      const deposit = (amount: string) =>
        app.request("/v1/account/deposit", json({ intentId: randomUUID(), amount }, consent));
      expect((await deposit("5000000")).status).toBe(200);
      const over = await deposit("2000000");
      expect(over.status).toBe(403);
      expect(await over.json()).toMatchObject({ error: { code: "BLOCKED", message: "Daily deposit limit reached." } });
      expect((await deposit("1000000")).status).toBe(200);
    });

    it("the daily deposit limit holds against parallel deposits", async () => {
      await putLimits({ dailyDeposit: "6000000", dailyLoss: null });
      relay.delayMs = 50;
      const consent = { ...access(ALICE), ...identity(ALICE) };
      const deposit = () =>
        app.request("/v1/account/deposit", json({ intentId: randomUUID(), amount: "4000000" }, consent));
      const statuses = (await Promise.all([deposit(), deposit()])).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 403]);
      expect(relay.actions()).toHaveLength(1);
    });

    it("lowers limits at once and raises them only after 24 h", async () => {
      expect(await (await putLimits({ dailyDeposit: "5000000", dailyLoss: "2000000" })).json()).toMatchObject({
        dailyDeposit: "5000000",
        dailyLoss: "2000000",
      });
      expect(await (await putLimits({ dailyDeposit: "9000000", dailyLoss: null })).json()).toMatchObject({
        dailyDeposit: "5000000",
        dailyLoss: "2000000",
      });
      await db.query(
        "UPDATE limits SET daily_deposit_next_at = now() - interval '1 second', daily_loss_next_at = now()",
      );
      const account = (await (await app.request("/v1/account", { headers: access(ALICE) })).json()) as AccountResponse;
      expect(account.limits).toEqual({
        dailyDeposit: "9000000",
        dailyDepositNext: null,
        dailyLoss: null,
        dailyLossNext: null,
        excludedUntil: null,
      });
      expect((await putLimits({ dailyDeposit: "0", dailyLoss: null })).status).toBe(400);
      // "-1" fails both sides of `amount | null`: the player reads the field's name once.
      const negative = await putLimits({ dailyDeposit: "-1", dailyLoss: null });
      expect(await negative.json()).toMatchObject({ error: { message: "invalid dailyDeposit" } });
    });

    // The web form sends both fields: changing one must not cancel a raise waiting on the other.
    it("keeps a pending raise when the form sends it back unchanged, and shows it", async () => {
      await putLimits({ dailyDeposit: "5000000", dailyLoss: "2000000" });
      const raised = (await (
        await putLimits({ dailyDeposit: "9000000", dailyLoss: "2000000" })
      ).json()) as ResponsibleLimits;
      expect(raised).toMatchObject({
        dailyDeposit: "5000000",
        dailyDepositNext: { value: "9000000" },
        dailyLossNext: null,
      });
      const at = raised.dailyDepositNext?.at;

      const lossOnly = (await (
        await putLimits({ dailyDeposit: "9000000", dailyLoss: "1000000" })
      ).json()) as ResponsibleLimits;
      expect(lossOnly).toMatchObject({ dailyDeposit: "5000000", dailyLoss: "1000000" });
      expect(lossOnly.dailyDepositNext).toEqual({ value: "9000000", at });

      const cancelled = (await (
        await putLimits({ dailyDeposit: "5000000", dailyLoss: "1000000" })
      ).json()) as ResponsibleLimits;
      expect(cancelled).toMatchObject({ dailyDeposit: "5000000", dailyDepositNext: null });
    });

    // A bet or deposit the relay already took must keep reporting its outcome: answering a retry
    // with BLOCKED would tell the player it never happened.
    it("a retried bet returns its outcome even once the loss limit it caused is reached", async () => {
      await putLimits({ dailyDeposit: null, dailyLoss: "1000000" });
      const id = randomUUID();
      expect((await play(slots, id)).status).toBe(200);
      await saveRound(db, {
        signature: SIGNATURE,
        player: wallet,
        round: 1,
        game: "slots",
        stake: 1_000_000n,
        payout: 0n,
        fee: 0n,
        requestId: 1n,
        randomness: Buffer.alloc(32),
        settledAt: new Date(),
      });
      const retry = await play(slots, id);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ intentId: id, status: "submitted" });
      expect((await play(slots)).status).toBe(403);
      expect(relay.actions()).toEqual([slots]);
    });

    it("a retried deposit returns its outcome after a self-exclusion, whatever the id's case", async () => {
      await putLimits({ dailyDeposit: "6000000", dailyLoss: null });
      const consent = { ...access(ALICE), ...identity(ALICE) };
      const id = randomUUID().toUpperCase();
      const deposit = () => app.request("/v1/account/deposit", json({ intentId: id, amount: "5000000" }, consent));
      expect((await deposit()).status).toBe(200);
      expect((await deposit()).status).toBe(200);
      await exclude(30);
      const retry = await deposit();
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ intentId: id.toLowerCase(), status: "submitted" });
      expect(relay.actions()).toEqual([{ type: "deposit", amount: "5000000" }]);
    });
  });

  describe("money moves", () => {
    const consent = (userId = ALICE, age = 10) => ({ ...access(userId), ...identity(userId, age) });
    const deposit = (headers: Record<string, string>, body: unknown = { intentId: randomUUID(), amount: "5000000" }) =>
      app.request("/v1/account/deposit", json(body, headers));

    it("need a fresh identity token of the same user: the consent proof", async () => {
      expect((await deposit(access(ALICE))).status).toBe(401);
      expect((await deposit({ ...access(ALICE), "x-privy-identity-token": "forged" })).status).toBe(401);
      expect((await deposit(consent(ALICE, 301))).status).toBe(401);
      expect((await deposit(consent(ALICE, -3600))).status).toBe(401);
      const other = await deposit({ ...access(ALICE), ...identity(BOB) });
      expect(other.status).toBe(403);
      expect(await other.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
      const withdraw = await app.request(
        "/v1/account/withdraw",
        json({ intentId: randomUUID(), amount: "1" }, access(ALICE)),
      );
      expect(withdraw.status).toBe(401);
      expect(relay.intents.size).toBe(0);
      const headers = consent();
      expect((await deposit(headers)).status).toBe(200);
      // The relay checks the same token again (defence in depth), and nothing stores it.
      expect(relay.consentTokens.at(-1)).toBe(headers["x-privy-identity-token"]);
    });

    it("maps a consent refused by the relay to 403, and the same id can be sent again", async () => {
      relay.consentExpired = true;
      const body = { intentId: randomUUID(), amount: "5000000" };
      const refused = await deposit(consent(), body);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
      relay.consentExpired = false;
      expect((await deposit(consent(), body)).status).toBe(200);
    });

    it("opens the account on the first deposit, then deposits; retries reuse the first action", async () => {
      chain.deposits.delete(wallet);
      const tooSmall = await deposit(consent(), { intentId: randomUUID(), amount: "1000000" });
      expect(tooSmall.status).toBe(400);
      const id = randomUUID();
      const first = (await (
        await deposit(consent(), { intentId: id, amount: "5000000" })
      ).json()) as MoneyIntentResponse;
      expect(first).toMatchObject({ intentId: id, status: "submitted", signature: expect.any(String), error: null });
      chain.deposits.set(wallet, 4_500_000n);
      expect((await deposit(consent(), { intentId: id, amount: "5000000" })).status).toBe(200);
      expect((await deposit(consent(), { intentId: id, amount: "6000000" })).status).toBe(409);
      expect((await deposit(consent())).status).toBe(200);
      expect(relay.actions()).toEqual([
        { type: "open_account", amount: "5000000" },
        { type: "deposit", amount: "5000000" },
      ]);
    });

    it("withdraws to the player's wallet and reports the intent", async () => {
      const id = randomUUID();
      const res = await app.request("/v1/account/withdraw", json({ intentId: id, amount: "3000000" }, consent()));
      expect(await res.json()).toMatchObject({ intentId: id, status: "submitted" });
      expect(relay.actions()).toEqual([{ type: "withdraw", amount: "3000000" }]);
      const status = await app.request(`/v1/account/intents/${id}`, { headers: access(ALICE) });
      expect(await status.json()).toMatchObject({ intentId: id, status: "submitted", signature: expect.any(String) });
      expect((await app.request(`/v1/account/intents/${id}`, { headers: access(BOB) })).status).toBe(404);
    });

    it("maps the relay's deposit caps to BLOCKED", async () => {
      relay.limitExceeded = true;
      const res = await deposit(consent());
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "BLOCKED" } });
    });

    it("withdrawals are never geo-blocked: players can always take their money out", async () => {
      const withdraw = (headers: Record<string, string>) =>
        app.request("/v1/account/withdraw", json({ intentId: randomUUID(), amount: "1000000" }, headers));
      expect((await withdraw({ ...consent(), "x-country": "US" })).status).toBe(200);
      expect((await withdraw({ ...consent(), "x-tilt-edge": "", "x-country": "" })).status).toBe(200);
    });

    it("deposits are geo-blocked, and money moves rate limited", async () => {
      expect((await deposit({ ...consent(), "x-country": "US" })).status).toBe(451);
      ({ app } = testApp(db, relay, chain, {
        limiters: { ...testApp(db, relay, chain).deps.limiters, money: RateLimiter.perMinute(1) },
      }));
      expect((await deposit(consent())).status).toBe(200);
      expect((await deposit(consent())).status).toBe(429);
    });
  });

  describe("GET /v1/account", () => {
    it("reads balances, totals and the signer config", async () => {
      chain.accounts.set(
        wallet,
        idleAccount({ balance: 7_000_000n, credited: 9_000_000n, withdrawn: 1_000_000n, fees: 20_000n, rounds: 12 }),
      );
      chain.deposits.set(wallet, 10_000_000n);
      chain.usdc.set(wallet, 42n);
      const body = (await (await app.request("/v1/account", { headers: access(ALICE) })).json()) as AccountResponse;
      expect(body).toEqual({
        userId: ALICE,
        solanaAddress: wallet,
        accountOpen: true,
        balance: "8000000",
        walletUsdc: "42",
        totals: { deposited: "10000000", withdrawn: "1000000", fees: "20000", rounds: 12 },
        minFirstDeposit: "1500000",
        onboardingFee: "500000",
        privySigner: { signerId: "quorum-1", policyIds: ["policy-1"] },
        limits: {
          dailyDeposit: null,
          dailyDepositNext: null,
          dailyLoss: null,
          dailyLossNext: null,
          excludedUntil: null,
        },
      });
      expect((await app.request("/v1/account", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    });

    it("is 404 without a Solana wallet", async () => {
      expect((await app.request("/v1/account", { headers: access(BOB) })).status).toBe(404);
    });
  });

  describe("GET /v1/state", () => {
    const openDaily = async () => {
      const campaign = await createCampaign(
        db,
        { sponsor: "Northwind", tagline: "ship it", budget: 10_000_000n, commissionBps: 4000 },
        "test",
      );
      await openCompetition(
        db,
        {
          campaign,
          name: "daily",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          pool: 3_000_000n,
          splitBps: [5000, 2500, 1000],
          sharedRanks: 2,
          minStake: 0n,
          dropPool: 1_000_000n,
          dropCount: 2,
          ticketsPerHour: 10,
        },
        "test",
      );
    };
    /** A settled 1 USDC slots spin netting `net` for `player`. */
    const won = (player: string, net: bigint, round = 1) =>
      saveRound(db, {
        signature: `${player}-${round}`.padEnd(88, "1"),
        player,
        round,
        game: "slots",
        stake: 1_000_000n,
        payout: 1_000_000n + net,
        fee: 30_000n,
        requestId: BigInt(round),
        randomness: Buffer.alloc(32),
        settledAt: new Date(),
      });

    it("shows a closed account before the first deposit", async () => {
      chain.accounts.delete(wallet);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state).toMatchObject({
        accountOpen: false,
        balance: "0",
        round: null,
        pendingIntentId: null,
        sponsor: null,
        ahead: null,
        webUrl: "https://tilt.test",
      });
      expect(state.limits).toEqual({ minBet: "100000", maxBet: "100000000" });
      expect(state.rtp).toEqual({
        blackjack: "99.00",
        roulette: "97.30",
        baccarat: "98.76",
        slots: "96.16",
        mines: "99.00",
      });
    });

    it("shows the hand in play, the pending intent, the sponsor and the leaderboard", async () => {
      chain.accounts.set(
        wallet,
        idleAccount({
          rounds: 3,
          round: {
            status: { kind: "player_turn" },
            stake: 1_000_000n,
            payout: 0n,
            fee: 0n,
            requestId: 9n,
            outcome: {
              game: "blackjack",
              bet: "1000000",
              hands: [{ cards: [1, 6], doubled: false, split: false }],
              active: 0,
              dealer: [9],
              splits: 0,
            },
          },
        }),
      );
      relay.outcome = () => ({ status: "pending" });
      const id = randomUUID();
      await play({ type: "blackjack_hit" }, id);
      await openDaily();
      await won(wallet, 1_970_000n, 3);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state).toMatchObject({
        accountOpen: true,
        balance: "10000000",
        pendingIntentId: id,
        sponsor: { name: "Northwind", tagline: "ship it", pool: "4000000" },
        leaderboard: [{ rank: 1, net: "1970000", isYou: true }],
        rank: 1,
        ahead: null,
        blocked: null,
        round: {
          phase: "player_turn",
          number: 4,
          stake: "1000000",
          detail: { activeHand: 0, hands: [{ total: 17, soft: true, result: null }], canHit: true },
        },
      });
    });

    it("shows who is ranked right above the player, even outside the top ten", async () => {
      await openDaily();
      // Eleven players ahead, one behind: the player is #12, the one to pass is #11.
      for (let i = 1; i <= 11; i++) await won(`rival${String(i).padStart(2, "0")}`, 10_000_000n - BigInt(i));
      await won("trailer", 1n);
      await won(wallet, 5_000_000n);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state.rank).toBe(12);
      expect(state.ahead).toEqual({ rank: 11, handle: "riv…l11", net: "9999989", isYou: false });
      expect(state.leaderboard.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    });

    it("takes the player above from the tie order when nets are equal", async () => {
      await openDaily();
      // Ties are ranked by wallet, so a rival sorting before every wallet ranks above an equal net.
      await won("0tie", 2_000_000n);
      await won(wallet, 2_000_000n);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state.rank).toBe(2);
      expect(state.ahead).toMatchObject({ rank: 1, net: "2000000", isYou: false });
    });

    it("shows no one above an unranked player", async () => {
      await openDaily();
      await won("rival", 1_000_000n);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state).toMatchObject({ rank: null, ahead: null });
    });

    it("shows the last settled round with its signature and keeps its detail for /verify", async () => {
      const slot = must(
        vectors.slots.find((s) => s.gross !== "0"),
        "winning spin",
      );
      const { payout, fee } = settle(1_000_000n, BigInt(slot.gross));
      chain.accounts.set(
        wallet,
        idleAccount({
          rounds: 1,
          round: {
            status: { kind: "idle" },
            stake: 1_000_000n,
            payout,
            fee,
            requestId: 1n,
            outcome: { game: "slots", reels: slot.reels as [number, number, number] },
          },
        }),
      );
      await saveRound(db, {
        signature: SIGNATURE,
        player: wallet,
        round: 1,
        game: "slots",
        stake: 1_000_000n,
        payout,
        fee,
        requestId: 1n,
        randomness: Buffer.from(slot.seed, "hex"),
        settledAt: new Date(),
      });
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state.round).toMatchObject({ phase: "idle", number: 1, settledSignature: SIGNATURE, payout: slot.gross });
      const { rows } = await db.query("SELECT detail FROM rounds WHERE signature = $1", [SIGNATURE]);
      expect(rows[0].detail).toEqual({ game: "slots", reels: slot.reels });
    });

    it("shows no round for a blackjack hand played before tables, so the mod can still bet", async () => {
      chain.accounts.set(wallet, idleAccount({ rounds: 13, round: { ...idleAccount().round, stake: 100_000n } }));
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state).toMatchObject({ accountOpen: true, round: null });
    });
  });

  describe("POST /v1/impressions", () => {
    it("aggregates time on screen per minute for the running sponsor, capped at 60 s", async () => {
      const campaign = await createCampaign(
        db,
        { sponsor: "Northwind", tagline: null, budget: 1_000n, commissionBps: 0 },
        "t",
      );
      await openCompetition(
        db,
        {
          campaign,
          name: "c",
          startsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 3_600_000),
          pool: 1_000n,
          splitBps: [10000],
          sharedRanks: 0,
          minStake: 0n,
          dropPool: 0n,
          dropCount: 0,
          ticketsPerHour: 1,
        },
        "t",
      );
      const report = (sponsor: string, seconds: number) =>
        app.request("/v1/impressions", json({ sponsor, seconds }, mod));
      expect((await report("Northwind", 40)).status).toBe(204);
      expect((await report("Northwind", 40)).status).toBe(204);
      expect((await report("Other", 10)).status).toBe(404);
      expect((await report("Northwind", 61)).status).toBe(400);
      const { rows } = await db.query<{ seconds: number }>("SELECT seconds FROM impressions");
      expect(rows.map((r) => r.seconds)).toEqual([60]);
    });
  });

  describe("public routes", () => {
    it("verifies a settled round from its randomness", async () => {
      const v = must(
        vectors.roulette.find((r) => r.red !== "0"),
        "red win",
      );
      const { payout, fee } = settle(1_000_000n, BigInt(v.red));
      await saveRound(db, {
        signature: SIGNATURE,
        player: wallet,
        round: 1,
        game: "roulette",
        stake: 1_000_000n,
        payout,
        fee,
        requestId: 1n,
        randomness: Buffer.from(v.seed, "hex"),
        settledAt: new Date(),
      });
      await db.query("UPDATE rounds SET detail = $1", [{ game: "roulette", bet: { kind: "red" }, number: v.number }]);
      const body = (await (await app.request(`/v1/rounds/${SIGNATURE}/verify`)).json()) as VerifyResponse;
      expect(body).toMatchObject({
        signature: SIGNATURE,
        player: wallet,
        round: 1,
        game: "roulette",
        randomness: v.seed,
        matches: true,
        onChain: { stake: "1000000", payout: v.red, fee: fee.toString() },
        replayed: { payout: v.red, detail: { number: v.number, bet: { kind: "red" } } },
      });
      await db.query("UPDATE rounds SET payout = payout + 1");
      expect(((await (await app.request(`/v1/rounds/${SIGNATURE}/verify`)).json()) as VerifyResponse).matches).toBe(
        false,
      );
      expect((await app.request(`/v1/rounds/${"4".repeat(88)}/verify`)).status).toBe(404);
      expect((await app.request(`/v1/rounds/0OIl/verify`)).status).toBe(400);
    });

    it("verifies a multi-draw blackjack round with splits from every indexed draw", async () => {
      const v = must(
        vectors.blackjack.find((h) => h.draws.length > 2 && h.splits > 0 && h.hands.length > 2),
        "multi-hand round with a split",
      );
      const { playerAccountAddress } = await import("@tilt/contract");
      const { PublicKey } = await import("@solana/web3.js");
      const account = playerAccountAddress(new PublicKey(wallet)).toBase58();
      for (const [i, draw] of v.draws.entries()) {
        await db.query("INSERT INTO draws (account, request_id, randomness, signature) VALUES ($1, $2, $3, $4)", [
          account,
          11 + i,
          draw,
          `d${i}`,
        ]);
      }
      const base = { player: wallet, game: "blackjack" as const, settledAt: new Date() };
      await saveRound(db, {
        ...base,
        signature: "4".repeat(88),
        round: 1,
        stake: 1n,
        payout: 0n,
        fee: 0n,
        requestId: 10n,
        randomness: Buffer.alloc(32),
      });
      await saveRound(db, {
        ...base,
        signature: SIGNATURE,
        round: 2,
        stake: BigInt(v.stake),
        payout: BigInt(v.payout),
        fee: BigInt(v.fee),
        requestId: BigInt(10 + v.draws.length),
        randomness: Buffer.from(v.draws[v.draws.length - 1], "hex"),
      });
      // The indexer's snapshot pins the exact hands (several move sequences can pay the same).
      const { bet, hands, active, dealer, splits } = v;
      await saveDetail(db, wallet, 2, BigInt(10 + v.draws.length), {
        game: "blackjack",
        bet,
        hands,
        active,
        dealer,
        splits,
      });
      const body = (await (await app.request(`/v1/rounds/${SIGNATURE}/verify`)).json()) as VerifyResponse;
      expect(body.matches).toBe(true);
      if (body.replayed.detail.game !== "blackjack") throw new Error("unexpected detail");
      expect(
        body.replayed.detail.hands.map((h) => ({
          ranks: h.cards.map((c) => c.rank),
          doubled: h.doubled,
          split: h.split,
        })),
      ).toEqual(v.hands.map((h) => ({ ranks: h.cards, doubled: h.doubled, split: h.split })));
    });

    it("still verifies a single-hand round indexed before tables and splits, its detail migrated", async () => {
      const v = must(
        vectors.blackjack.find((h) => h.hands.length === 1 && h.hands[0].doubled),
        "doubled single hand",
      );
      const [hand] = v.hands;
      await saveRound(db, {
        player: wallet,
        game: "blackjack",
        settledAt: new Date(),
        signature: SIGNATURE,
        round: 1,
        stake: BigInt(v.stake),
        payout: BigInt(v.payout),
        fee: BigInt(v.fee),
        requestId: BigInt(v.draws.length),
        randomness: Buffer.from(v.draws[v.draws.length - 1], "hex"),
      });
      const legacy = { game: "blackjack", player: hand.cards, dealer: v.dealer, doubled: hand.doubled };
      await db.query("UPDATE rounds SET detail = $1 WHERE signature = $2", [legacy, SIGNATURE]);
      await migrate(db);
      const { rows } = await db.query("SELECT detail FROM rounds WHERE signature = $1", [SIGNATURE]);
      expect(rows[0].detail).toEqual({
        game: "blackjack",
        bet: v.bet,
        hands: v.hands,
        active: 1,
        dealer: v.dealer,
        splits: 0,
      });
      const { playerAccountAddress } = await import("@tilt/contract");
      const { PublicKey } = await import("@solana/web3.js");
      const account = playerAccountAddress(new PublicKey(wallet)).toBase58();
      for (const [i, draw] of v.draws.entries()) {
        await db.query("INSERT INTO draws (account, request_id, randomness, signature) VALUES ($1, $2, $3, $4)", [
          account,
          1 + i,
          draw,
          `d${i}`,
        ]);
      }
      const body = (await (await app.request(`/v1/rounds/${SIGNATURE}/verify`)).json()) as VerifyResponse;
      expect(body.matches).toBe(true);
    });

    it("migrates a rounds table created before mines so that mines rounds can be stored", async () => {
      await db.query("ALTER TABLE rounds DROP CONSTRAINT rounds_game_check");
      await db.query(
        "ALTER TABLE rounds ADD CONSTRAINT rounds_game_check CHECK (game IN ('blackjack', 'roulette', 'baccarat', 'slots'))",
      );
      await migrate(db);
      await migrate(db);
      const round = {
        signature: SIGNATURE,
        player: wallet,
        round: 1,
        game: "mines" as const,
        stake: 1n,
        payout: 0n,
        fee: 0n,
        requestId: 1n,
        randomness: Buffer.alloc(32, 1),
        settledAt: new Date(),
      };
      expect(await saveRound(db, round)).toBe(true);
    });

    it("verifies mines rounds from their reveal draws, cashed out (no draw of its own) or busted", async () => {
      const account = playerAccountAddress(new PublicKey(wallet)).toBase58();
      const cashedOut = must(
        vectors.mines.find((m) => m.cashout && m.draws.length > 1),
        "cash-out after several tiles",
      );
      const busted = must(
        vectors.mines.find((m) => m.busted !== null && m.draws.length > 1),
        "bust after a safe tile",
      );
      const base = { player: wallet, game: "mines" as const, stake: 1_000_000n, settledAt: new Date() };
      // Round 1 cashed out: its event names the last reveal's request, with zero randomness.
      let requestId = 0n;
      const rounds = [
        { v: cashedOut, signature: "4".repeat(88) },
        { v: busted, signature: SIGNATURE },
      ];
      for (const [i, { v, signature }] of rounds.entries()) {
        for (const [j, draw] of v.draws.entries()) {
          requestId++;
          await saveDraw(db, { account, requestId, randomness: Buffer.from(draw, "hex"), signature: `d${i}${j}` });
        }
        await saveRound(db, {
          ...base,
          signature,
          round: i + 1,
          payout: BigInt(v.payout),
          fee: BigInt(v.fee),
          requestId,
          randomness: v.cashout ? Buffer.alloc(32) : Buffer.from(v.draws[v.draws.length - 1], "hex"),
        });
        await saveDetail(db, wallet, i + 1, requestId, {
          game: "mines",
          mines: v.mines,
          order: v.order,
          pending: null,
          busted: v.busted,
          maxGain: v.maxGain,
        });
      }
      const verify = async (signature: string) =>
        (await (await app.request(`/v1/rounds/${signature}/verify`)).json()) as VerifyResponse;
      const cash = await verify("4".repeat(88));
      expect(cash).toMatchObject({
        game: "mines",
        matches: true,
        replayed: { payout: cashedOut.gross, detail: { game: "mines", revealed: cashedOut.order, busted: null } },
      });
      const bust = await verify(SIGNATURE);
      expect(bust).toMatchObject({
        matches: true,
        replayed: { payout: "0", detail: { revealed: busted.order, busted: busted.busted } },
      });
    });

    it("tells the web whether the caller's country may play", async () => {
      expect(await (await app.request("/v1/geo", { headers: OK_COUNTRY })).json()).toEqual({
        allowed: true,
        country: "DE",
      });
      expect(await (await app.request("/v1/geo", { headers: { ...EDGE, "x-country": "fr" } })).json()).toEqual({
        allowed: false,
        country: "FR",
      });
      expect(await (await app.request("/v1/geo")).json()).toEqual({ allowed: false, country: null });
    });

    it("trusts the country header only from our edge", async () => {
      const geo = async (headers: Record<string, string>) => (await app.request("/v1/geo", { headers })).json();
      const unknown = { allowed: false, country: null };
      expect(await geo({ "x-country": "DE" })).toEqual(unknown);
      expect(await geo({ "x-tilt-edge": "wrong", "x-country": "DE" })).toEqual(unknown);
      expect(await geo({ "x-tilt-edge": `${EDGE_SECRET}x`, "x-country": "DE" })).toEqual(unknown);
      const { deps } = testApp(db, relay, chain);
      const open = testApp(db, relay, chain, { geo: { ...deps.geo, allowUnknown: true } }).app;
      expect(await (await open.request("/v1/geo", { headers: { "x-country": "US" } })).json()).toEqual({
        allowed: true,
        country: null,
      });
    });

    it("reports health, unknown routes and oversized bodies", async () => {
      expect(await (await app.request("/health")).json()).toEqual({ ok: true });
      expect((await app.request("/v1/nope")).status).toBe(404);
      const big = await app.request(
        "/v1/play",
        json({ intentId: randomUUID(), action: slots, pad: "x".repeat(9000) }, mod),
      );
      expect(big.status).toBe(413);
    });

    it("never lets one flooding IP exhaust the global limit for others", async () => {
      const { deps } = testApp(db, relay, chain);
      const limited = testApp(db, relay, chain, {
        limiters: { ...deps.limiters, global: RateLimiter.perMinute(5), ip: RateLimiter.perMinute(3) },
        config: { ...deps.config, TRUST_PROXY: true },
      }).app;
      const from = (ip: string) => limited.request("/v1/geo", { headers: { "x-forwarded-for": ip } });
      for (let i = 0; i < 10; i++) await from("6.6.6.6");
      expect((await from("6.6.6.6")).status).toBe(429);
      expect((await from("1.1.1.1")).status).toBe(200);
    });

    it("keeps answering health checks while a flood is rate limited", async () => {
      const { deps } = testApp(db, relay, chain);
      const limited = testApp(db, relay, chain, {
        limiters: { ...deps.limiters, global: RateLimiter.perMinute(2), ip: RateLimiter.perMinute(2) },
      }).app;
      for (let i = 0; i < 5; i++) await limited.request("/v1/geo");
      expect((await limited.request("/v1/geo")).status).toBe(429);
      expect((await limited.request("/health")).status).toBe(200);
    });

    it("sets secure headers and CORS for the web origin only", async () => {
      const res = await app.request("/v1/geo", { headers: { origin: "https://tilt.test" } });
      expect(res.headers.get("access-control-allow-origin")).toBe("https://tilt.test");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const evil = await app.request("/v1/geo", { headers: { origin: "https://evil.test" } });
      expect(evil.headers.get("access-control-allow-origin")).not.toBe("https://evil.test");
    });
  });
});
