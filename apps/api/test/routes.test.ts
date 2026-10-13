// HTTP behaviour of the mod, web and public routes against Postgres, a fake relay (HTTP, on the
// contract schemas), a fake chain and a fake Privy.
import type { IntentResponse, StateResponse } from "@tilt/mod/protocol";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/auth/sessions";
import { createCampaign, openCompetition } from "../src/competitions/store";
import { settle } from "../src/games/settlement";
import type { AccountResponse, MoneyIntentResponse, ResponsibleLimits, VerifyResponse } from "../src/public";
import { RateLimiter } from "../src/ratelimit";
import { saveRound } from "../src/rounds";
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
      expect((await play({ type: "blackjack_stand" })).status).toBe(200);
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
      expect(account.limits).toEqual({ dailyDeposit: "9000000", dailyLoss: null, excludedUntil: null });
      expect((await putLimits({ dailyDeposit: "0", dailyLoss: null })).status).toBe(400);
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
        limits: { dailyDeposit: null, dailyLoss: null, excludedUntil: null },
      });
      expect((await app.request("/v1/account", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    });

    it("is 404 without a Solana wallet", async () => {
      expect((await app.request("/v1/account", { headers: access(BOB) })).status).toBe(404);
    });
  });

  describe("GET /v1/state", () => {
    it("shows a closed account before the first deposit", async () => {
      chain.accounts.delete(wallet);
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state).toMatchObject({
        accountOpen: false,
        balance: "0",
        round: null,
        pendingIntentId: null,
        sponsor: null,
      });
      expect(state.limits).toEqual({ minBet: "100000", maxBet: "100000000" });
      expect(state.rtp).toEqual({ blackjack: "99.00", roulette: "97.30", baccarat: "98.76", slots: "96.16" });
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
            outcome: { game: "blackjack", player: [1, 6], dealer: [9], doubled: false },
          },
        }),
      );
      relay.outcome = () => ({ status: "pending" });
      const id = randomUUID();
      await play({ type: "blackjack_hit" }, id);
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
      await saveRound(db, {
        signature: SIGNATURE,
        player: wallet,
        round: 3,
        game: "slots",
        stake: 1_000_000n,
        payout: 2_970_000n,
        fee: 30_000n,
        requestId: 8n,
        randomness: Buffer.alloc(32),
        settledAt: new Date(),
      });
      const state = (await (await app.request("/v1/state", { headers: mod })).json()) as StateResponse;
      expect(state).toMatchObject({
        accountOpen: true,
        balance: "10000000",
        pendingIntentId: id,
        sponsor: { name: "Northwind", tagline: "ship it", pool: "4000000" },
        leaderboard: [{ rank: 1, net: "1970000", isYou: true }],
        rank: 1,
        blocked: null,
        round: {
          phase: "player_turn",
          number: 4,
          stake: "1000000",
          detail: { playerTotal: 17, playerSoft: true, canHit: true },
        },
      });
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

    it("verifies a multi-draw blackjack round from every indexed draw", async () => {
      const v = must(
        vectors.blackjack.find((h) => h.draws.length > 2),
        "hand with a hit",
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
      const body = (await (await app.request(`/v1/rounds/${SIGNATURE}/verify`)).json()) as VerifyResponse;
      expect(body.matches).toBe(true);
      expect(body.replayed.detail).toMatchObject({ game: "blackjack", playerTotal: expect.any(Number) });
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

    it("sets secure headers and CORS for the web origin only", async () => {
      const res = await app.request("/v1/geo", { headers: { origin: "https://tilt.test" } });
      expect(res.headers.get("access-control-allow-origin")).toBe("https://tilt.test");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      const evil = await app.request("/v1/geo", { headers: { origin: "https://evil.test" } });
      expect(evil.headers.get("access-control-allow-origin")).not.toBe("https://evil.test");
    });
  });
});
