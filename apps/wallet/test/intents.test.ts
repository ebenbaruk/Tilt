// Relay behaviour against a real Postgres (TEST_DATABASE_URL), with the on-chain executor
// replaced at its interface: idempotency, one intent in flight per player, crash recovery,
// deposit caps, auth and validation.
import anchor from "@coral-xyz/anchor";
import type { Action } from "@tilt/contract";
import { PublicKey, Transaction } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ConsentVerifier } from "../src/consent";
import { IntentError, type PlayerAccount, type RecordSend, type SentTransaction, type TiltChain, type TransactionStatus, UnconfirmedError } from "../src/chain";
import { createDb, migrate, type Db } from "../src/db";
import { Intents, type Executor, type RelayLimits } from "../src/intents";
import type { PlayerWallet, PlayerWallets } from "../src/players";
import { releasable, requiredReserve, sweep } from "../src/sweeper";

const { BN } = anchor;

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:tilt@127.0.0.1:55432/tilt_test";
const API_KEY = "k".repeat(40);
const USER = "did:privy:cm0testuser000000000000001";
const NOBODY = "did:privy:cm0nobody00000000000000001";
const ADDRESS = new PublicKey("6aEPgBvxq7QBzC4VZ8vL6epiXn24eHbPyq2sVZY93t2N");
const LIMITS: RelayLimits = {
  maxDeposit: 100_000_000n,
  dailyDepositLimit: 150_000_000n,
  dailyDepositLimitGlobal: 200_000_000n,
  minPromoPayout: 1_000_000n,
  maxPromoPayout: 10_000_000n,
  dailyPromoLimitPerPlayer: 15_000_000n,
  dailyPromoLimit: 20_000_000n,
};

let db: Db;
beforeAll(async () => {
  db = createDb(DATABASE_URL);
  await migrate(db);
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE intents, players, consents"));

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

  it("never returns raw internal error text", async () => {
    const intents = new Intents(db, new FakeExecutor(async (action) => {
      if (action.type === "withdraw") throw new IntentError("PROGRAM_ERROR", '{"InstructionError":[0,{"Custom":1}]}');
      throw new Error("connect ECONNREFUSED 10.0.3.7:8899 (postgres://relay:hunter2@db)");
    }), LIMITS);
    const network = await intents.submit(intent(bet));
    expect(network).toMatchObject({ status: "failed", error: { code: "NETWORK_ERROR" } });
    expect(network.error?.message).not.toMatch(/ECONNREFUSED|10\.0\.3\.7|hunter2/);
    const refused = await intents.submit(intent({ type: "withdraw", amount: "1" }));
    expect(refused.error).toEqual({ code: "PROGRAM_ERROR", message: "refused by the program" });
    expect(await intents.get(refused.intentId)).toEqual(refused);
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
    const insert = async (userId: string, signature: string | null, ageSecs = 0) => {
      const intentId = randomUUID();
      await db.query(
        `INSERT INTO intents (intent_id, user_id, action, status, signature, network, last_valid_block_height, updated_at)
         VALUES ($1, $2, $3, 'pending', $4, $5, 100, now() - make_interval(secs => $6))`,
        [intentId, userId, bet, signature, signature && "rollup", ageSecs],
      );
      return intentId;
    };
    const ids = {
      landed: await insert("u1", "landed", 300),
      refused: await insert("u2", "refused", 300),
      expired: await insert("u3", "expired", 300),
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
    expect(await intents.get(ids.justSent)).toMatchObject({ status: "pending" });
    expect(await intents.get(ids.crashedBeforeSend)).toMatchObject({ status: "failed", error: { code: "NETWORK_ERROR" } });
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

  const ABANDONED_SECS = 21_600;
  /** A chain whose risk pool has `left` of its line free once `open` rounds are held, in a vault
   *  holding `free` beyond what it reserves. */
  const pooled = (
    left: bigint,
    free: bigint,
    funded: bigint[] = [],
    { open = { gain: 0n, stake: 0n }, maxRoundGain = 100n, betsPaused = false } = {},
  ) => ({
    ensureRiskPool: async () => undefined,
    fetchRiskPool: async () => ({
      transferred: new BN(300),
      uncovered: new BN(200),
      gains: new BN(open.gain.toString()),
      stakes: new BN(open.stake.toString()),
      exposure: new BN((open.gain * open.stake).toString()),
    }),
    fetchVaultBalance: async () => 10_000n + free,
    fundRiskPool: async (amount: bigint) => {
      funded.push(amount);
      return "sig";
    },
    fetchVault: async () => ({
      config: { roundTimeoutSecs: 60, abandonedRoundSecs: ABANDONED_SECS, maxRoundGain: new BN(maxRoundGain.toString()), betsPaused },
      poolLine: new BN((500n + open.gain + left).toString()),
      reserved: new BN(10_000),
    }),
  });
  const SWEEP = { checkpointMinLoss: 1n, checkpointIntervalMs: 1, riskPoolTarget: 1_000n };

  it("sweeps players even when reconciliation fails", async () => {
    const intents = { reconcile: () => Promise.reject(new Error("database unreachable")) } as unknown as Intents;
    const chain = pooled(1_000n, 0n) as unknown as TiltChain;
    expect(await sweep(db, chain, intents, SWEEP)).toEqual({ reconciled: 0, funded: 0n, expired: 0, checkpointed: 0, failed: 1 });
  });

  it("grants the risk pool what its line lacks for new rounds, within the free bankroll", async () => {
    const intents = { reconcile: async () => 0 } as unknown as Intents;
    const funded: bigint[] = [];
    // 400 of the line left for a 1 000 target: 600 granted.
    expect(await sweep(db, pooled(400n, 5_000n, funded) as unknown as TiltChain, intents, SWEEP)).toMatchObject({ funded: 600n, failed: 0 });
    // Only 250 free in the vault: 250 granted.
    expect(await sweep(db, pooled(400n, 250n, funded) as unknown as TiltChain, intents, SWEEP)).toMatchObject({ funded: 250n });
    // At the target, nothing.
    expect(await sweep(db, pooled(1_000n, 5_000n, funded) as unknown as TiltChain, intents, SWEEP)).toMatchObject({ funded: 0n });
    expect(funded).toEqual([600n, 250n]);
  });

  it("counts what open rounds hold of the line, and keeps one largest round's worth free", async () => {
    const intents = { reconcile: async () => 0 } as unknown as Intents;
    const funded: bigint[] = [];
    // A lone round holds its whole worst case (800): the 1 000 left beside it is still the target.
    const parked = { open: { gain: 800n, stake: 1n }, maxRoundGain: 800n };
    expect(await sweep(db, pooled(1_000n, 5_000n, funded, parked) as unknown as TiltChain, intents, SWEEP)).toMatchObject({ funded: 0n });
    // A target below the largest round's gain is raised to it.
    expect(await sweep(db, pooled(1_000n, 5_000n, funded, { maxRoundGain: 2_500n }) as unknown as TiltChain, intents, SWEEP)).toMatchObject({ funded: 1_500n });
    // Nothing while bets are paused: the line could never be taken back.
    expect(await sweep(db, pooled(0n, 5_000n, funded, { betsPaused: true }) as unknown as TiltChain, intents, SWEEP)).toMatchObject({ funded: 0n, failed: 0 });
    expect(funded).toEqual([1_500n]);
  });

  it("computes the open rounds' reserve as the program does", () => {
    const USDC = 1_000_000n;
    const reserveFor = (n: bigint, stake: bigint, gain: bigint) => requiredReserve(n * gain, n * stake, n * gain * stake, gain);
    expect(requiredReserve(0n, 0n, 0n, 2_500n * USDC)).toBe(0n);
    // Values of `risk.rs` (a_few_rounds_hold_their_whole_worst_case, many_rounds_hold_far_less_than_their_worst_case).
    expect(reserveFor(1n, 10n * USDC, 2_500n * USDC)).toBe(2_500n * USDC);
    expect(reserveFor(1_000n, 10n * USDC, 2_500n * USDC)).toBe(63_558_059_855n);
  });

  it("counts both losses and secured wins lost again as what a checkpoint releases", () => {
    const account = (balance: number, secured: number) =>
      ({ balance: new BN(balance), withdrawn: new BN(0), credited: new BN(1_000), forfeited: new BN(0), winReserved: new BN(secured), winReleased: new BN(0) }) as unknown as PlayerAccount;
    expect(releasable(account(600, 0))).toBe(400n);
    expect(releasable(account(1_250, 400))).toBe(150n);
    expect(releasable(account(600, 400))).toBe(800n);
    expect(releasable(account(1_500, 400))).toBe(0n);
  });

  it("retries a draw that never arrived and closes a round the player abandoned (with the game it plays on), never one they are still thinking about", async () => {
    const TIMEOUT_SECS = 60;
    const now = Date.now();
    const longAgo = Math.floor(now / 1000) - ABANDONED_SECS;
    const stillThinking = longAgo + 1;
    const players = {
      thinking: { address: PublicKey.unique(), game: { blackjack: {} }, status: { playerTurn: {} }, lastAction: stillThinking },
      leftTable: { address: PublicKey.unique(), game: { blackjack: {} }, status: { playerTurn: {} } },
      stuckDraw: { address: PublicKey.unique(), game: { blackjack: {} }, status: { awaitingDraw: { 0: { deal: {} } } } },
      stuckSpin: { address: PublicKey.unique(), game: { roulette: {} }, roulette: { bet: { red: {} }, number: 0 }, status: { awaitingDraw: { 0: { spin: {} } } } },
      // A multi-chip spin: no bet in the round, its chips are on the roulette table.
      stuckChips: { address: PublicKey.unique(), game: { roulette: {} }, roulette: null, status: { awaitingDraw: { 0: { spin: {} } } } },
      minesThinking: { address: PublicKey.unique(), game: { mines: {} }, status: { playerTurn: {} }, lastAction: stillThinking },
      minesLeft: { address: PublicKey.unique(), game: { mines: {} }, status: { playerTurn: {} } },
      stuckReveal: { address: PublicKey.unique(), game: { mines: {} }, status: { awaitingDraw: { 0: { reveal: {} } } } },
      freshDraw: { address: PublicKey.unique(), game: { roulette: {} }, status: { awaitingDraw: { 0: { spin: {} } } }, lastAction: Math.floor(now / 1000) - 5 },
    };
    for (const [name, p] of Object.entries(players)) {
      const userId = `did:privy:cm0sweep${name.toLowerCase().padEnd(20, "0")}`;
      await db.query("INSERT INTO players (user_id, wallet_id, address) VALUES ($1, $2, $3)", [userId, `w-${name}`, p.address.toBase58()]);
      await db.query("INSERT INTO intents (intent_id, user_id, action, status) VALUES ($1, $2, $3, 'submitted')", [
        randomUUID(),
        userId,
        { type: "open_account", amount: "10000000" },
      ]);
    }
    const expired: [string, string, unknown][] = [];
    const accounts = new Map(Object.values(players).map((p) => [p.address.toBase58(), p]));
    const chain = {
      ...pooled(1_000n, 0n),
      fetchVault: async () => ({
        config: { roundTimeoutSecs: TIMEOUT_SECS, abandonedRoundSecs: ABANDONED_SECS, maxRoundGain: new BN(100), betsPaused: false },
        poolLine: new BN(1_500),
        reserved: new BN(10_000),
      }),
      fetchPlayerAccount: async (player: PublicKey) => {
        const p = accounts.get(player.toBase58())!;
        const roulette = "roulette" in p ? p.roulette : null;
        return { round: { game: p.game, roulette, status: p.status, lastAction: "lastAction" in p ? p.lastAction : longAgo } };
      },
      expireRound: async (player: PublicKey, round: { game: Record<string, object>; roulette: unknown }) => {
        expired.push([player.toBase58(), Object.keys(round.game)[0], round.roulette]);
        return "sig";
      },
    } as unknown as TiltChain;
    const intents = { reconcile: async () => 0 } as unknown as Intents;
    const report = await sweep(db, chain, intents, SWEEP, now);
    expect(Object.fromEntries(expired.map(([address, ...rest]) => [address, rest]))).toEqual({
      [players.leftTable.address.toBase58()]: ["blackjack", null],
      [players.stuckDraw.address.toBase58()]: ["blackjack", null],
      [players.stuckSpin.address.toBase58()]: ["roulette", players.stuckSpin.roulette],
      [players.stuckChips.address.toBase58()]: ["roulette", null],
      [players.minesLeft.address.toBase58()]: ["mines", null],
      [players.stuckReveal.address.toBase58()]: ["mines", null],
    });
    expect(report).toMatchObject({ expired: 6, failed: 0 });
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

  it("caps promo payouts per payout and for all players per 24 h, even when concurrent", async () => {
    const intents = new Intents(db, new FakeExecutor(), LIMITS);
    await expect(intents.submit(promo(10_000_001))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await db.query("INSERT INTO intents (intent_id, user_id, action, status) VALUES ($1, $2, $3, 'failed')", [randomUUID(), USER, promo(10_000_000).action]);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => intents.submit(promo(5_000_000, `did:privy:winner${i}`)).then((r) => r.status, (e: IntentError) => e.code)),
    );
    expect(results.filter((r) => r === "submitted")).toHaveLength(4);
    expect(results.filter((r) => r === "LIMIT_EXCEEDED")).toHaveLength(6);
  });

  it("caps promo payouts per player per 24 h, without affecting other players", async () => {
    const intents = new Intents(db, new FakeExecutor(), LIMITS);
    expect((await intents.submit(promo(10_000_000))).status).toBe("submitted");
    expect((await intents.submit(promo(5_000_000))).status).toBe("submitted");
    await expect(intents.submit(promo(1_000_000))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await intents.submit(promo(5_000_000, NOBODY))).status).toBe("submitted");
  });

  it("caps deposits of all players together per 24 h, even when concurrent", async () => {
    const intents = new Intents(db, new FakeExecutor(), { ...LIMITS, dailyDepositLimitGlobal: 120_000_000n });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => intents.submit(intent(deposit(50_000_000), randomUUID(), `did:privy:player${i}`)).then((r) => r.status, (e: IntentError) => e.code)),
    );
    expect(results.filter((r) => r === "submitted")).toHaveLength(2);
    expect(results.filter((r) => r === "LIMIT_EXCEEDED")).toHaveLength(3);
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

/** Stands in for Privy: "token|<user id>|<issued at, unix s>|<nonce>" is a valid identity token, anything else is not. */
const consent: ConsentVerifier = {
  async verify(identityToken) {
    const [kind, userId, issuedAt] = identityToken.split("|");
    if (kind !== "token") throw new Error("invalid signature");
    return { userId, issuedAt: Number(issuedAt) };
  },
};
const identityToken = (userId = USER, ageSecs = 0) => ({ identityToken: `token|${userId}|${Math.floor(Date.now() / 1000) - ageSecs}|${randomUUID()}` });

describe("HTTP API", () => {
  const NEXT_KEY = "n".repeat(40);
  const app = (executor: Executor = new FakeExecutor()) =>
    createApp({ apiKeys: [API_KEY, NEXT_KEY], intents: new Intents(db, executor, LIMITS), players, chain: { isOpen: async () => true }, db, consent });
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
    expect((await post(intent(bet, randomUUID(), "did:privy:test-user"))).status).toBe(400);
    const payout = { payoutId: randomUUID(), userId: "x".repeat(200), amount: "5000000", poolId: "weekly", reason: "1st place" };
    expect((await call("/payouts/promo", { method: "POST", body: JSON.stringify(payout) })).status).toBe(400);

    const huge = await post({ ...intent(bet), padding: "x".repeat(9 * 1024) });
    expect(huge.status).toBe(413);
    expect(await huge.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });

  it("returns users and intents", async () => {
    expect(await (await call(`/users/${USER}`)).json()).toEqual({ userId: USER, solanaAddress: ADDRESS.toBase58(), accountOpen: true });
    expect((await call(`/users/${NOBODY}`)).status).toBe(404);
    expect((await call("/users/did:privy:..%2Fadmin")).status).toBe(400);
    const request = intent(bet);
    expect((await post(request)).status).toBe(200);
    expect(await (await call(`/intents/${request.intentId}`)).json()).toMatchObject({ status: "submitted" });
    expect((await call(`/intents/${randomUUID()}`)).status).toBe(404);
  });

  it("moves a player's money only with their fresh identity token, and never stores it", async () => {
    const refusal = async (action: Action, token?: { identityToken: string }) => {
      const res = await post({ ...intent(action), consent: token });
      return [res.status, ((await res.json()) as { error?: { code: string } }).error?.code];
    };
    for (const action of [deposit(1), { type: "open_account", amount: "1" } as const, { type: "withdraw", amount: "1" } as const]) {
      expect(await refusal(action), action.type).toEqual([403, "CONSENT_REQUIRED"]);
    }
    expect(await refusal(deposit(1), { identityToken: "forged" })).toEqual([403, "CONSENT_REQUIRED"]);
    expect(await refusal(deposit(1), identityToken(NOBODY))).toEqual([403, "CONSENT_REQUIRED"]);
    expect(await refusal(deposit(1), identityToken(USER, 301))).toEqual([403, "CONSENT_REQUIRED"]);
    expect((await db.query("SELECT 1 FROM intents")).rowCount).toBe(0);

    const token = identityToken(USER, 240);
    const accepted = { ...intent(deposit(1)), consent: token };
    expect(await (await post(accepted)).json()).toMatchObject({ status: "submitted" });
    expect((await post(intent(bet))).status).toBe(200);
    const { rows } = await db.query<{ row: string }>("SELECT row_to_json(intents)::text AS row FROM intents");
    expect(rows).toHaveLength(2);
    for (const { row } of rows) expect(row).not.toContain(token.identityToken);
  });

  it("binds an identity token to one intent, which may replay it", async () => {
    const token = identityToken();
    const first = { ...intent(deposit(1)), consent: token };
    expect(await (await post(first)).json()).toMatchObject({ status: "submitted" });
    expect((await post(first)).status).toBe(200);
    const reused = await post({ ...intent(deposit(1)), consent: token });
    expect(reused.status).toBe(403);
    expect(await reused.json()).toMatchObject({ error: { code: "CONSENT_REQUIRED" } });
    expect(await (await post({ ...intent(deposit(1)), consent: identityToken() })).json()).toMatchObject({ status: "submitted" });

    // A refused intent records nothing, so its retry with the same token is checked again, not refused for consent.
    const capped = { ...intent(deposit(100_000_001)), consent: identityToken() };
    expect((await post(capped)).status).toBe(422);
    expect((await post(capped)).status).toBe(422);

    const shared = identityToken();
    const statuses = await Promise.all([1, 2, 3, 4].map(async () => (await post({ ...intent(deposit(1)), consent: shared })).status));
    expect(statuses.sort()).toEqual([200, 403, 403, 403]);
  });

  it("maps request refusals to 409 and 422", async () => {
    const request = intent(bet);
    await post(request);
    expect((await post({ ...request, action: { type: "blackjack_hit" } })).status).toBe(409);
    expect((await post({ ...intent(deposit(100_000_001)), consent: identityToken() })).status).toBe(422);
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
