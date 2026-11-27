// Devnet faucet: claims through the relay's HTTP API on a real Postgres (caps, idempotency,
// concurrency), the transaction it sends with both RPC calls stubbed, and its fail-closed guards.
import {
  ACCOUNT_SIZE,
  AccountLayout,
  AccountState,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { DEVNET_GENESIS_HASH } from "@tilt/contract";
import { type AccountInfo, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { IntentError, type RecordSend, TiltChain, type Vault } from "../src/chain";
import { loadConfig } from "../src/config";
import { createDb, migrate, type Db } from "../src/db";
import { ChainExecutor } from "../src/executor";
import { assertDevnet, type FaucetLimits, lowFaucetReserve } from "../src/faucet";
import { Intents, type Executor, type RelayAction, type RelayLimits } from "../src/intents";
import { evaluate } from "../src/monitor";
import type { PlayerWallet, PlayerWallets } from "../src/players";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:tilt@127.0.0.1:55432/tilt_test";
const API_KEY = "k".repeat(40);
const USER = "did:privy:cm0faucetuser0000000000001";
const user = (n: number) => `did:privy:cm0faucetuser${String(n).padStart(13, "0")}`;
const FAUCET: FaucetLimits = { amount: 100_000_000n, dailyLimit: 300_000_000n };
// Faucet claims read only the faucet's caps; the other limits never apply to them.
const LIMITS = { faucet: FAUCET } as RelayLimits;
const DAY_MS = 24 * 3_600_000;

let db: Db;
beforeAll(async () => {
  db = createDb(DATABASE_URL);
  await migrate(db);
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE intents, players"));
afterEach(() => vi.restoreAllMocks());

/** Records each action and lands it, unless `run` decides otherwise. */
class FakeExecutor implements Executor {
  calls: RelayAction[] = [];
  constructor(private readonly run?: (action: RelayAction) => Promise<string>) {}
  async execute(_userId: string, action: RelayAction, record: RecordSend): Promise<string> {
    this.calls.push(action);
    if (this.run) return this.run(action);
    const signature = `sig-${randomUUID()}`;
    await record({ network: "solana", signature, lastValidBlockHeight: 100 });
    return signature;
  }
}

const players: PlayerWallets = {
  async find() {
    return undefined;
  },
  async sign(_wallet: PlayerWallet, tx: Transaction) {
    return tx;
  },
};

function relay(executor: Executor = new FakeExecutor(), limits: RelayLimits = LIMITS) {
  const app = createApp({ apiKeys: [API_KEY], intents: new Intents(db, executor, limits), players, chain: { isOpen: async () => true }, db, consent: { verify: () => Promise.reject(new Error("unused")) } });
  const headers = { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" };
  const claim = async (body: Record<string, unknown>) => {
    const res = await app.request("/faucet/claims", { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string; retryAt?: string } } };
  };
  const status = async (userId: string) => (await app.request(`/faucet/${userId}`, { headers })).json();
  return { app, claim, status, headers };
}

const claimOf = (userId = USER, claimId = randomUUID()) => ({ claimId, userId });
/** Moves every claim back in time, as if made `ms` ago. */
const age = (ms: number) => db.query("UPDATE intents SET created_at = created_at - make_interval(secs => $1)", [ms / 1000]);
const createdAt = async (claimId: string) =>
  (await db.query<{ created_at: Date }>("SELECT created_at FROM intents WHERE intent_id = $1", [claimId])).rows[0].created_at;

describe("faucet claims", () => {
  it("pays the relay's amount once per claim id, whatever the caller asks for", async () => {
    const executor = new FakeExecutor();
    const { claim } = relay(executor);
    const request = claimOf();
    const first = await claim({ ...request, amount: "999000000" });
    expect(first).toMatchObject({ status: 200, body: { claimId: request.claimId, amount: "100000000", status: "submitted", signature: expect.any(String) } });
    // The same id, in any case, is the same claim: replayed, not paid again.
    expect(await claim({ ...request, claimId: request.claimId.toUpperCase() })).toEqual(first);
    expect(executor.calls).toEqual([{ type: "faucet", claimId: request.claimId, amount: "100000000" }]);
    const { rows } = await db.query("SELECT user_id, action, status FROM intents");
    expect(rows).toEqual([{ user_id: USER, action: { type: "faucet", claimId: request.claimId, amount: "100000000" }, status: "submitted" }]);
  });

  it("allows one claim per player per rolling 24 h, saying when the next one can succeed", async () => {
    const { claim, status } = relay();
    expect(await status(USER)).toEqual({ enabled: true, amount: "100000000", nextClaimAt: null });
    const first = claimOf();
    await claim(first);
    const retryAt = new Date((await createdAt(first.claimId)).getTime() + DAY_MS).toISOString();

    const refused = await claim(claimOf());
    expect(refused).toMatchObject({ status: 422, body: { error: { code: "LIMIT_EXCEEDED", retryAt } } });
    expect(refused.body.error?.message).toContain("already claimed");
    expect(await status(USER)).toEqual({ enabled: true, amount: "100000000", nextClaimAt: retryAt });
    expect((await status(user(2))).nextClaimAt).toBeNull();
    expect((await db.query("SELECT 1 FROM intents")).rowCount).toBe(1);

    await age(DAY_MS - 60_000);
    expect((await claim(claimOf())).status).toBe(422);
    await age(60_000);
    expect((await claim(claimOf())).body).toMatchObject({ status: "submitted" });
  });

  it("caps all players together per rolling 24 h, freeing room as the oldest claims age out", async () => {
    const { claim, status } = relay();
    const first = claimOf(user(1));
    await claim(first);
    await age(3_600_000);
    await claim(claimOf(user(2)));
    await claim(claimOf(user(3)));
    const retryAt = new Date((await createdAt(first.claimId)).getTime() + DAY_MS).toISOString();

    const refused = await claim(claimOf(user(4)));
    expect(refused).toMatchObject({ status: 422, body: { error: { code: "LIMIT_EXCEEDED", retryAt } } });
    expect(refused.body.error?.message).toContain("daily total");
    expect((await status(user(4))).nextClaimAt).toBe(retryAt);

    await age(DAY_MS - 3_600_000);
    expect((await claim(claimOf(user(4)))).body).toMatchObject({ status: "submitted" });
  });

  it("reports the later of the player's and the global window", async () => {
    const { claim, status } = relay();
    const mine = claimOf(user(1));
    await claim(mine);
    await age(3_600_000);
    await claim(claimOf(user(2)));
    await claim(claimOf(user(3)));
    // The global cap frees up when user 1's claim ages out, the same moment their own window ends.
    const playerRetry = new Date((await createdAt(mine.claimId)).getTime() + DAY_MS).toISOString();
    expect((await status(user(1))).nextClaimAt).toBe(playerRetry);
    // User 2's own window ends an hour later: that is the one that counts for them.
    const theirs = (await db.query<{ created_at: Date }>("SELECT created_at FROM intents WHERE user_id = $1", [user(2)])).rows[0].created_at;
    expect((await status(user(2))).nextClaimAt).toBe(new Date(theirs.getTime() + DAY_MS).toISOString());
  });

  it("does not count a failed claim, which records nothing sent", async () => {
    const empty = new FakeExecutor(() => Promise.reject(new IntentError("FAUCET_EMPTY", "faucet reserve holds 5, below 100000000")));
    const { claim } = relay(empty);
    const refused = await claim(claimOf());
    expect(refused).toMatchObject({ status: 200, body: { status: "failed", error: { code: "FAUCET_EMPTY", message: "the faucet's reserve is too low, nothing was sent" } } });
    expect(refused.body.error?.message).not.toContain("holds 5");
    expect((await relay().claim(claimOf())).body).toMatchObject({ status: "submitted" });
  });

  it("pays one claim per player under concurrent requests", async () => {
    const executor = new FakeExecutor();
    const { claim } = relay(executor);
    const results = await Promise.all(Array.from({ length: 20 }, () => claim(claimOf())));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.body.error?.code === "LIMIT_EXCEEDED")).toHaveLength(19);
    expect(executor.calls).toHaveLength(1);
  });

  it("never pays past the global cap under concurrent requests from many players", async () => {
    const executor = new FakeExecutor();
    const { claim } = relay(executor);
    const results = await Promise.all(Array.from({ length: 12 }, (_, n) => claim(claimOf(user(n)))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.body.error?.code === "LIMIT_EXCEEDED")).toHaveLength(9);
    const { rows } = await db.query<{ total: string }>("SELECT sum((action->>'amount')::numeric)::text AS total FROM intents");
    expect(rows[0].total).toBe("300000000");
  });

  it("refuses everything when disabled, and validates requests", async () => {
    const executor = new FakeExecutor();
    const { claim, status, app, headers } = relay(executor, { ...LIMITS, faucet: undefined });
    expect(await claim(claimOf())).toMatchObject({ status: 403, body: { error: { code: "FAUCET_DISABLED" } } });
    expect(await status(USER)).toEqual({ enabled: false, amount: null, nextClaimAt: null });
    // Fail closed below the HTTP API too.
    const intents = new Intents(db, executor, { ...LIMITS, faucet: undefined });
    const claimId = randomUUID();
    await expect(intents.submit({ intentId: claimId, userId: USER, action: { type: "faucet", claimId, amount: "100000000" } })).rejects.toMatchObject({ code: "FAUCET_DISABLED" });
    expect(executor.calls).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM intents")).rowCount).toBe(0);

    expect((await relay().claim({ claimId: "1", userId: USER })).status).toBe(400);
    expect((await relay().claim({ claimId: randomUUID(), userId: "did:privy:x" })).status).toBe(400);
    expect((await app.request("/faucet/did:privy:..%2Fadmin", { headers })).status).toBe(400);
    expect((await app.request(`/faucet/${USER}`)).status).toBe(401);
  });

  it("fails closed when a claim would not fit an empty window", async () => {
    const { claim } = relay(new FakeExecutor(), { ...LIMITS, faucet: { amount: 2n, dailyLimit: 1n } });
    expect((await claim(claimOf())).status).toBe(500);
    expect((await db.query("SELECT 1 FROM intents")).rowCount).toBe(0);
  });
});

describe("faucet guards", () => {
  it("runs on devnet only", async () => {
    await expect(assertDevnet({ getGenesisHash: async () => DEVNET_GENESIS_HASH })).resolves.toBeUndefined();
    const mainnet = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    await expect(assertDevnet({ getGenesisHash: async () => mainnet })).rejects.toThrow(mainnet);
    await expect(assertDevnet({ getGenesisHash: () => Promise.reject(new Error("fetch failed")) })).rejects.toThrow("fetch failed");
  });

  const env = {
    DATABASE_URL: "postgres://x",
    RELAY_API_KEYS: API_KEY,
    SOLANA_RPC_URL: "http://127.0.0.1:8899",
    ROLLUP_RPC_URL: "http://127.0.0.1:7799",
    ROLLUP_WS_URL: "ws://127.0.0.1:7800",
    VRF_QUEUE: Keypair.generate().publicKey.toBase58(),
    RELAYER_SECRET_KEY: JSON.stringify(Array.from(Keypair.generate().secretKey)),
    PRIVY_APP_ID: "app",
    PRIVY_APP_SECRET: "secret",
    PRIVY_AUTHORIZATION_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };

  it("is off unless enabled, with 100 test USDC per claim and 10 000 per day by default", () => {
    expect(loadConfig(env)).toMatchObject({ FAUCET_ENABLED: false, FAUCET_AMOUNT: 100_000_000n, FAUCET_DAILY_LIMIT: 10_000_000_000n });
    expect(loadConfig({ ...env, FAUCET_ENABLED: "true" }).FAUCET_ENABLED).toBe(true);
    expect(() => loadConfig({ ...env, FAUCET_ENABLED: "yes" })).toThrow("FAUCET_ENABLED");
    expect(() => loadConfig({ ...env, FAUCET_AMOUNT: "1.5" })).toThrow("FAUCET_AMOUNT");
    expect(() => loadConfig({ ...env, FAUCET_AMOUNT: "20000000000" })).toThrow("FAUCET_AMOUNT: must not exceed FAUCET_DAILY_LIMIT");
  });

  it("alerts on a low reserve once half a day of claims is handed out, not right after a refill", () => {
    const config = loadConfig({ ...env, FAUCET_ENABLED: "true" });
    const limits = { amount: config.FAUCET_AMOUNT, dailyLimit: config.FAUCET_DAILY_LIMIT };
    const thresholds = { minRelayerLamports: 0n, minEscrowLamports: 0n, minFreeBankroll: 0n, minFaucetReserve: lowFaucetReserve(limits) };
    const paused = { deposits: false, bets: false, payouts: false };
    const alerts = (faucetReserve: bigint) =>
      evaluate({ vaultBalance: 0n, reserved: 0n, relayerLamports: 0n, escrowLamports: 0n, stuckIntents: 0, paused, faucetReserve }, thresholds).map((a) => a.code);
    // The largest `pnpm admin mint-test` (10 000 USDC), then claims.
    const refill = 10_000_000_000n;
    expect(alerts(refill - limits.amount)).toEqual([]);
    expect(alerts(refill / 2n)).toEqual([]);
    expect(alerts(refill / 2n - limits.amount)).toEqual(["LOW_FAUCET_RESERVE"]);
  });
});

/** A token account as RPC returns it. */
function tokenAccount(mint: PublicKey, owner: PublicKey, amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: AccountState.Initialized,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { owner: TOKEN_PROGRAM_ID, data, executable: false, lamports: 1 };
}

describe("faucet transaction", () => {
  function stubbedChain(reserveHolds: bigint | null) {
    const relayer = Keypair.generate();
    const mint = Keypair.generate().publicKey;
    const chain = new TiltChain({ solanaRpcUrl: "http://127.0.0.1:1", rollupRpcUrl: "http://127.0.0.1:2", rollupWsUrl: "ws://127.0.0.1:2", vrfQueue: Keypair.generate().publicKey, relayer });
    const reserve = getAssociatedTokenAddressSync(mint, relayer.publicKey);
    const simulated: Transaction[] = [];
    vi.spyOn(chain, "fetchVault").mockResolvedValue({ mint } as unknown as Vault);
    vi.spyOn(chain.base, "getAccountInfo").mockImplementation(async (address) =>
      address.equals(reserve) && reserveHolds !== null ? tokenAccount(mint, relayer.publicKey, reserveHolds) : null,
    );
    vi.spyOn(chain.base, "getLatestBlockhash").mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 });
    vi.spyOn(chain.base, "simulateTransaction").mockImplementation(async (tx) => {
      if (!("version" in tx)) simulated.push(tx);
      return { context: { slot: 1 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 0, returnData: null } };
    });
    const send = vi.spyOn(chain.base, "sendRawTransaction").mockResolvedValue("solana-sig");
    vi.spyOn(chain.base, "confirmTransaction").mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
    return { chain, relayer, mint, reserve, simulated, send };
  }

  it("creates the player's token account if needed and transfers the full amount from the reserve", async () => {
    const { chain, relayer, mint, reserve, simulated } = stubbedChain(100_000_000n);
    const player = Keypair.generate().publicKey;
    const recorded: string[] = [];
    await chain.payFaucet(player, 100_000_000n, async (tx) => void recorded.push(tx.signature));

    expect(recorded).toHaveLength(1);
    const [tx] = simulated;
    expect(tx.feePayer?.equals(relayer.publicKey)).toBe(true);
    const [create, transfer] = tx.instructions;
    expect(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(create.keys[0].pubkey.equals(relayer.publicKey)).toBe(true);
    const playerToken = getAssociatedTokenAddressSync(mint, player);
    const decoded = decodeTransferCheckedInstruction(transfer);
    expect(decoded.keys.source.pubkey.equals(reserve)).toBe(true);
    expect(decoded.keys.destination.pubkey.equals(playerToken)).toBe(true);
    expect(decoded.keys.owner.pubkey.equals(relayer.publicKey)).toBe(true);
    expect(decoded.data).toMatchObject({ amount: 100_000_000n, decimals: 6 });
    expect(await chain.fetchFaucetReserve()).toBe(100_000_000n);
  });

  it("sends nothing and raises an alert when the reserve cannot pay the full amount", async () => {
    const alerts = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const holds of [99_999_999n, null]) {
      const { chain, simulated, send } = stubbedChain(holds);
      await expect(chain.payFaucet(Keypair.generate().publicKey, 100_000_000n, async () => undefined)).rejects.toMatchObject({ code: "FAUCET_EMPTY" });
      expect(simulated).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
    }
    expect(alerts.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      expect.objectContaining({ level: "alert", code: "LOW_FAUCET_RESERVE", severity: "warning", message: expect.stringContaining("holds 99999999") }),
      expect.objectContaining({ level: "alert", code: "LOW_FAUCET_RESERVE", message: expect.stringContaining("holds 0") }),
    ]);
  });

  it("is what the executor runs for a faucet claim", async () => {
    const address = Keypair.generate().publicKey;
    const payFaucet = vi.fn(async () => "sig");
    const wallets: PlayerWallets = { ...players, find: async (userId) => ({ userId, walletId: "w", address }) };
    const executor = new ChainExecutor({ payFaucet } as unknown as TiltChain, wallets, db);
    const record: RecordSend = async () => undefined;
    expect(await executor.execute(USER, { type: "faucet", claimId: randomUUID(), amount: "100000000" }, record)).toBe("sig");
    expect(payFaucet).toHaveBeenCalledWith(address, 100_000_000n, record);
  });
});
