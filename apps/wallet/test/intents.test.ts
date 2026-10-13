// Relay behaviour against a real Postgres (TEST_DATABASE_URL), with the on-chain executor
// replaced at its interface: idempotency, one intent in flight per player, crash recovery,
// deposit caps, auth and validation.
import type { Action } from "@tilt/contract";
import { PublicKey, Transaction } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { IntentError, type RecordSend, type SentTransaction, type TiltChain, type TransactionStatus, UnconfirmedError } from "../src/chain";
import { createDb, migrate, type Db } from "../src/db";
import { Intents, type Executor, type RelayLimits } from "../src/intents";
import type { PlayerWallet, PlayerWallets } from "../src/players";
import { sweep } from "../src/sweeper";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:tilt@127.0.0.1:55432/tilt_test";
const API_KEY = "k".repeat(40);
const USER = "did:privy:test-user";
const ADDRESS = new PublicKey("6aEPgBvxq7QBzC4VZ8vL6epiXn24eHbPyq2sVZY93t2N");
const LIMITS: RelayLimits = { maxDeposit: 100_000_000n, dailyDepositLimit: 150_000_000n, minPromoPayout: 1_000_000n };

let db: Db;
beforeAll(async () => {
  db = createDb(DATABASE_URL);
  await migrate(db);
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE intents, players"));

const sent = (signature = `sig-${randomUUID()}`): SentTransaction => ({ network: "rollup", signature, lastValidBlockHeight: 100 });

/** Records calls; `run` decides each outcome. By default records a transaction and lands it. */
class FakeExecutor implements Executor {
  calls: Action[] = [];
  constructor(
    private readonly run: (action: Action, record: RecordSend) => Promise<string> = async (_action, record) => {
      const tx = sent();
      await record(tx);
      return tx.signature;
    },
  ) {}
  async execute(_userId: string, action: Action, record: RecordSend): Promise<string> {
    this.calls.push(action);
    return this.run(action, record);
  }
}

const players: PlayerWallets = {
  async find(userId: string): Promise<PlayerWallet | undefined> {
    return userId === USER ? { userId, walletId: "w", address: ADDRESS } : undefined;
  },
  async sign(_wallet: PlayerWallet, tx: Transaction) {
    return tx;
  },
};

const intent = (action: Action, intentId = randomUUID(), userId = USER) => ({ intentId, userId, action });
const bet: Action = { type: "slots_spin", amount: "1000000" };
const deposit = (amount: number): Action => ({ type: "deposit", amount: String(amount) });
const promo = (amount: number, userId = USER) => {
  const payoutId = randomUUID();
  return { intentId: payoutId, userId, action: { type: "promo_payout" as const, payoutId, amount: String(amount), poolId: "weekly", reason: "1st place" } };
};

describe("intents", () => {
  it("runs an intent once, however often it is submitted", async () => {
    const executor = new FakeExecutor();
    const intents = new Intents(db, executor, LIMITS);
    const request = intent(bet);
    const results = await Promise.all([intents.submit(request), intents.submit(request), intents.submit(request)]);
    expect(executor.calls).toHaveLength(1);
    for (const r of results) expect(["pending", "submitted"]).toContain(r.status);
    expect(await intents.submit(request)).toMatchObject({ status: "submitted", signature: expect.any(String) });
  });

  it("refuses to reuse an intent id for a different action or player", async () => {
    const intents = new Intents(db, new FakeExecutor(), LIMITS);
    const request = intent(bet);
    await intents.submit(request);
    await expect(intents.submit({ ...request, action: { type: "slots_spin", amount: "2000000" } })).rejects.toMatchObject({ code: "INTENT_CONFLICT" });
    await expect(intents.submit({ ...request, userId: "did:privy:other" })).rejects.toMatchObject({ code: "INTENT_CONFLICT" });
  });

  it("keeps one intent in flight per player, without tying up the pool", async () => {
    const executor = new FakeExecutor(async (_action, record) => {
      await sleep(300);
      await record(sent());
      return "sig";
    });
    const intents = new Intents(db, executor, LIMITS);
    // More concurrent requests than pool connections: none may wait on the chain call.
    const mine = Array.from({ length: 30 }, () => intents.submit(intent(bet)).then((r) => r.status, (e: IntentError) => e.code));
    const other = intents.submit(intent(bet, randomUUID(), "did:privy:other"));
    const statuses = await Promise.all(mine);
    expect(statuses.filter((s) => s === "submitted")).toHaveLength(1);
    expect(statuses.filter((s) => s === "PLAYER_BUSY")).toHaveLength(29);
    expect((await other).status).toBe("submitted");
    expect((await intents.submit(intent(bet))).status).toBe("submitted");
  });

  it("tells refusals, unsent failures and unknown outcomes apart", async () => {
    const intents = new Intents(db, new FakeExecutor(async (action, record) => {
      if (action.type === "withdraw") throw new IntentError("PROGRAM_ERROR", "InsufficientBalance");
      if (action.type === "blackjack_hit") throw new Error("Privy unreachable");
      await record(sent("5ig"));
      if (action.type === "deposit") throw new UnconfirmedError("5ig", "block height exceeded");
      throw new Error("socket hang up");
    }), LIMITS);
    const settle = (action: Action) => intents.submit(intent(action)).finally(() => db.query("UPDATE intents SET status = 'failed' WHERE status = 'pending'"));
    expect(await settle({ type: "withdraw", amount: "1" })).toMatchObject({ status: "failed", error: { code: "PROGRAM_ERROR", message: "InsufficientBalance" } });
    expect(await settle({ type: "blackjack_hit" })).toMatchObject({ status: "failed", error: { code: "NETWORK_ERROR" } });
    // Once its signature is recorded, a transaction may have been sent: never reported as failed.
    expect(await settle(deposit(1))).toMatchObject({ status: "pending", signature: "5ig", error: { code: "NETWORK_ERROR" } });
    expect(await settle({ type: "blackjack_stand" })).toMatchObject({ status: "pending", signature: "5ig" });
  });

  it("never sends an intent that was settled while it executed", async () => {
    let refused: unknown;
    const intents = new Intents(db, new FakeExecutor(async (_action, record) => {
      await db.query("UPDATE intents SET status = 'failed', error_code = 'NETWORK_ERROR' WHERE status = 'pending'");
      refused = await record(sent()).then(() => undefined, (e: unknown) => e);
      if (refused) throw refused;
      return "sig";
    }), LIMITS);
    expect(await intents.submit(intent(bet))).toMatchObject({ status: "failed" });
    expect(refused).toBeInstanceOf(Error);
  });

  it("settles interrupted intents from the chain", async () => {
    const statuses: Record<string, TransactionStatus> = {
      landed: { state: "landed" },
      refused: { state: "failed", reason: "InsufficientBalance" },
      expired: { state: "expired" },
      flying: { state: "in_flight" },
    };
    const insert = async (userId: string, signature: string | null, ageSecs = 0, network = "rollup") => {
      const intentId = randomUUID();
      await db.query(
        `INSERT INTO intents (intent_id, user_id, action, status, signature, network, last_valid_block_height, updated_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, 100, now() - make_interval(secs => $6))`,
        [intentId, userId, bet, signature, signature && network, ageSecs],
      );
      return intentId;
    };
    const ids = {
      landed: await insert("u1", "landed", 300),
      refused: await insert("u2", "refused", 300),
      expired: await insert("u3", "expired", 300, "solana"),
      // Not seen by the rollup is not proof it did not land there.
      unseenInRollup: await insert("u8", "expired", 300),
      flying: await insert("u4", "flying", 300),
      // Still within its own execution's confirmation window: left to it.
      justSent: await insert("u7", "landed"),
      crashedBeforeSend: await insert("u5", null, 600),
      justStarted: await insert("u6", null),
    };
    const intents = new Intents(db, new FakeExecutor(), LIMITS);
    expect(await intents.reconcile({ transactionStatus: async (tx) => statuses[tx.signature] })).toBe(4);
    expect(await intents.get(ids.landed)).toMatchObject({ status: "submitted", signature: "landed" });
    expect((await intents.get(ids.landed))?.error).toBeUndefined();
    expect(await intents.get(ids.refused)).toMatchObject({ status: "failed", error: { code: "PROGRAM_ERROR", message: "InsufficientBalance" } });
    expect(await intents.get(ids.expired)).toMatchObject({ status: "failed", error: { code: "NETWORK_ERROR" } });
    expect(await intents.get(ids.flying)).toMatchObject({ status: "pending" });
    expect(await intents.get(ids.unseenInRollup)).toMatchObject({ status: "pending" });
    expect(await intents.get(ids.justSent)).toMatchObject({ status: "pending" });
    expect(await intents.get(ids.crashedBeforeSend)).toMatchObject({ status: "failed", error: { message: "interrupted before sending" } });
    expect(await intents.get(ids.justStarted)).toMatchObject({ status: "pending" });
    // A settled player can play again.
    expect((await intents.submit(intent(bet, randomUUID(), "u1"))).status).toBe("submitted");
  });

  it("keeps reconciling past an intent whose status cannot be read", async () => {
    const insert = async (userId: string, signature: string) => {
      const intentId = randomUUID();
      await db.query(
        `INSERT INTO intents (intent_id, user_id, action, status, signature, network, last_valid_block_height, updated_at)
         VALUES ($1, $2, $3, 'pending', $4, 'rollup', 100, now() - interval '300 seconds')`,
        [intentId, userId, bet, signature],
      );
      return intentId;
    };
    const unreachable = await insert("u1", "unreachable");
    const landed = await insert("u2", "landed");
    const intents = new Intents(db, new FakeExecutor(), LIMITS);
    const chain = {
      transactionStatus: async (tx: SentTransaction): Promise<TransactionStatus> => {
        if (tx.signature === "unreachable") throw new Error("fetch failed");
        return { state: "landed" };
      },
    };
    expect(await intents.reconcile(chain)).toBe(1);
    expect(await intents.get(unreachable)).toMatchObject({ status: "pending" });
    expect(await intents.get(landed)).toMatchObject({ status: "submitted" });
  });

  it("sweeps players even when reconciliation fails", async () => {
    const intents = { reconcile: () => Promise.reject(new Error("database unreachable")) } as unknown as Intents;
    const chain = { fetchVault: async () => ({ config: { roundTimeoutSecs: 60 } }) } as unknown as TiltChain;
    expect(await sweep(db, chain, intents, { checkpointMinLoss: 1n, checkpointIntervalMs: 1 })).toEqual({ reconciled: 0, expired: 0, checkpointed: 0, failed: 1 });
  });

  it("lets an execution that saw its transaction land correct a reconciliation failure", async () => {
    const intents = new Intents(db, new FakeExecutor(async (_action, record) => {
      await record(sent("late"));
      await db.query("UPDATE intents SET status = 'failed', error_code = 'NETWORK_ERROR' WHERE signature = 'late'");
      return "late";
    }), LIMITS);
    expect(await intents.submit(intent(bet))).toMatchObject({ status: "submitted", signature: "late" });
  });

  it("caps deposits per transaction and per 24 h, not counting failed ones", async () => {
    const intents = new Intents(db, new FakeExecutor(), LIMITS);
    await expect(intents.submit(intent(deposit(100_000_001)))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await intents.submit(intent({ type: "open_account", amount: "100000000" }))).status).toBe("submitted");
    await db.query("INSERT INTO intents (intent_id, user_id, action, status) VALUES ($1, $2, $3, 'failed')", [randomUUID(), USER, deposit(50_000_000)]);
    expect((await intents.submit(intent(deposit(50_000_000)))).status).toBe("submitted");
    await expect(intents.submit(intent(deposit(1)))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await intents.submit(intent(deposit(1), randomUUID(), "did:privy:other"))).status).toBe("submitted");
    expect((await intents.submit(intent(bet))).status).toBe("submitted");
  });

  it("pays a prize while the player is mid-round, and lets them play meanwhile", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const intents = new Intents(db, new FakeExecutor(async (_action, record) => {
      await record(sent());
      await held;
      return "sig";
    }), LIMITS);
    // Both in flight at once for the same player; a second round still has to wait.
    const round = intents.submit(intent(bet));
    await sleep(50);
    const prize = intents.submit(promo(5_000_000));
    await sleep(50);
    await expect(intents.submit(intent(bet))).rejects.toMatchObject({ code: "PLAYER_BUSY" });
    release();
    expect((await round).status).toBe("submitted");
    expect((await prize).status).toBe("submitted");
  });

  it("migrates a database that still has the old one-pending index", async () => {
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS intents_one_pending_per_user ON intents (user_id) WHERE status = 'pending'");
    await migrate(db);
    await migrate(db);
    const { rows } = await db.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'intents' AND indexname LIKE 'intents_one_pending%'");
    expect(rows.map((r) => r.indexname)).toEqual(["intents_one_pending_play_per_user"]);
  });
});

describe("HTTP API", () => {
  const NEXT_KEY = "n".repeat(40);
  const app = (executor: Executor = new FakeExecutor()) =>
    createApp({ apiKeys: [API_KEY, NEXT_KEY], intents: new Intents(db, executor, LIMITS), players, chain: { isOpen: async () => true }, db });
  const call = (path: string, init: RequestInit = {}, key = API_KEY, executor?: Executor) =>
    app(executor).request(path, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers } });
  const post = (body: unknown, executor?: Executor) => call("/intents", { method: "POST", body: JSON.stringify(body) }, API_KEY, executor);

  it("requires one of the API keys", async () => {
    expect((await call("/users/x", {}, "wrong")).status).toBe(401);
    expect((await call(`/users/${USER}`, {}, NEXT_KEY)).status).toBe(200);
    expect((await app().request("/intents", { method: "POST" })).status).toBe(401);
    expect(await (await app().request("/health")).json()).toEqual({ ok: true });
  });

  it("validates requests before running them", async () => {
    const res = await post(intent({ type: "slots_spin", amount: "1.5" } as unknown as Action));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect((await call(`/intents/${"-".repeat(36)}`)).status).toBe(400);
  });

  it("returns users and intents", async () => {
    expect(await (await call(`/users/${USER}`)).json()).toEqual({ userId: USER, solanaAddress: ADDRESS.toBase58(), accountOpen: true });
    expect((await call("/users/did:privy:nobody")).status).toBe(404);
    const request = intent(bet);
    expect((await post(request)).status).toBe(200);
    expect(await (await call(`/intents/${request.intentId}`)).json()).toMatchObject({ status: "submitted" });
    expect((await call(`/intents/${randomUUID()}`)).status).toBe(404);
  });

  it("maps request refusals to 409 and 422", async () => {
    const request = intent(bet);
    await post(request);
    expect((await post({ ...request, action: { type: "blackjack_hit" } })).status).toBe(409);
    expect((await post(intent(deposit(100_000_001)))).status).toBe(422);
    const slow = new FakeExecutor(() => sleep(200).then(() => "sig"));
    const inFlight = post(intent(bet), slow);
    await sleep(50);
    const busy = await post(intent(bet), slow);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: "PLAYER_BUSY" } });
    await inFlight;
  });

  it("pays promo prizes once, keeps them apart from intents and refuses dust", async () => {
    const payout = { payoutId: randomUUID(), userId: USER, amount: "5000000", poolId: "weekly", reason: "1st place" };
    const pay = (body: unknown) => call("/payouts/promo", { method: "POST", body: JSON.stringify(body) });
    expect(await (await pay(payout)).json()).toMatchObject({ payoutId: payout.payoutId, status: "submitted" });
    // The same UUID in upper case is the same payout, not a conflict.
    expect((await pay({ ...payout, payoutId: payout.payoutId.toUpperCase() })).status).toBe(200);
    expect((await pay({ ...payout, amount: "6000000" })).status).toBe(409);
    expect(await (await call(`/payouts/promo/${payout.payoutId}`)).json()).toMatchObject({ payoutId: payout.payoutId, status: "submitted" });
    expect((await call(`/intents/${payout.payoutId}`)).status).toBe(404);
    const game = intent(bet);
    await post(game);
    expect((await call(`/payouts/promo/${game.intentId}`)).status).toBe(404);
    expect((await pay({ ...payout, payoutId: randomUUID(), amount: "999999" })).status).toBe(422);
  });
});
