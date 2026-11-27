// Full-stack end-to-end check: api → relay (apps/wallet) → Tilt program, against a running local
// Solana + MagicBlock rollup + VRF oracle and Postgres. Both services boot in-process on random
// ports with their real code; only Privy is faked (tokens below) and player signatures come from
// local keys, as in the relay's own e2e. Needs the vault set up by `chain/scripts/e2e.ts`.
//
// Run: pnpm --filter @tilt/api e2e
// env: ANCHOR_WALLET (vault admin, mint authority), RELAYER_KEYPAIR (vault relayer), BASE_RPC,
//      ER_RPC, ER_WS, VRF_ER_QUEUE, API_DATABASE_URL, RELAY_DATABASE_URL
import anchor from "@coral-xyz/anchor";
import { serve, type ServerType } from "@hono/node-server";
import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { idl, promoAddress, promoTokenAddress, type Tilt, vaultAddress } from "@tilt/contract";
import type {
  BlackjackView,
  DeviceStartResponse,
  DeviceTokenResponse,
  HiloView,
  IntentResponse as PlayResponse,
  MinesView,
  PlayAction,
  RouletteChip,
  RouletteView,
  RoundView,
  StateResponse,
  TowerView,
} from "@tilt/mod/protocol";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp as createRelayApp } from "../../wallet/src/app";
import { TiltChain } from "../../wallet/src/chain";
import { createDb as createRelayDb, migrate as migrateRelay } from "../../wallet/src/db";
import { ChainExecutor } from "../../wallet/src/executor";
import { Intents as RelayIntents } from "../../wallet/src/intents";
import type { PlayerWallet, PlayerWallets } from "../../wallet/src/players";
import { createApp } from "../src/app";
import { associatedTokenAddress, RpcChainReader } from "../src/chain";
import { approvePrizes, listPrizes, payPrizes } from "../src/competitions/payouts";
import { closeCompetition, createCampaign, handle, openCompetition } from "../src/competitions/store";
import { createDb, migrate } from "../src/db";
import { ConnectionSource, indexedThrough, Indexer } from "../src/indexer";
import { Intents } from "../src/intents";
import type { LeaderboardResponse, MoneyIntentResponse, VerifyResponse } from "../src/public";
import { HttpRelay } from "../src/relay";
import { EDGE, EDGE_SECRET, FakePrivy, generousLimits } from "./helpers";

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const usdc = (x: number) => BigInt(Math.round(x * 1_000_000));
const loadKeypair = (path: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8")) as number[]));
const POLL_MS = 100;
const RELAY_KEY = "s".repeat(40);
const COUNTRY = { ...EDGE, "x-country": "DE" };
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const FEE_BPS = 100n;
const BPS = 10_000n;

const admin = loadKeypair(env("ANCHOR_WALLET", `${os.homedir()}/.config/solana/id.json`));
const relayer = loadKeypair(
  env("RELAYER_KEYPAIR", new URL("../../../chain/.anchor/e2e-relayer.json", import.meta.url).pathname),
);
const rpc = {
  solanaRpcUrl: env("BASE_RPC", "http://127.0.0.1:8899"),
  rollupRpcUrl: env("ER_RPC", "http://127.0.0.1:7799"),
  rollupWsUrl: env("ER_WS", "ws://127.0.0.1:7800"),
};

/** Test players sign with local keys, as Privy does with the embedded wallet. */
class LocalPlayerWallets implements PlayerWallets {
  readonly keys = new Map<string, Keypair>();
  async find(userId: string): Promise<PlayerWallet | undefined> {
    const key = this.keys.get(userId);
    return key && { userId, walletId: `local-${userId}`, address: key.publicKey };
  }
  async sign(wallet: PlayerWallet, tx: Transaction): Promise<Transaction> {
    const key = this.keys.get(wallet.userId);
    if (!key) throw new Error(`no local key for ${wallet.userId}`);
    tx.partialSign(key);
    return tx;
  }
}

/** Same token format as the api's FakePrivy identity tokens: "identity:<did>:<iat seconds>". */
const fakeConsent = {
  async verify(token: string) {
    const match = /^identity:(.+):(\d+)$/.exec(token);
    if (!match) throw new Error("invalid identity token");
    return { userId: match[1], issuedAt: Number(match[2]) };
  },
};

/** Report lines; console.info is muted below (request logs of both services). */
const say = (line: string) => process.stdout.write(`${line}\n`);
const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail = ""): boolean {
  results.push({ name, ok });
  say(`${ok ? "OK    " : "ÉCHEC "} ${name} ${detail}`);
  return ok;
}

async function until<T>(f: () => Promise<T | undefined>, what: string, timeoutMs = 60_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const value = await f();
      if (value !== undefined) return value;
    } catch (e) {
      last = e;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`timeout waiting for ${what}${last ? ` (last error: ${String(last)})` : ""}`);
}

function listen(fetch: (req: Request) => Response | Promise<Response>): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch, hostname: "127.0.0.1", port: 0 }, (info: AddressInfo) =>
      resolve({ server, url: `http://127.0.0.1:${info.port}` }),
    );
  });
}

// ---- SPL token, by hand (the api has no spl-token dependency) ----

function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function mintTo(mint: PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function main() {
  console.info = () => undefined; // request logs of both services: noise here, errors still show

  // ---- Relay (apps/wallet), real code with local player keys ----
  const relayDb = createRelayDb(env("RELAY_DATABASE_URL", "postgres://postgres:tilt@127.0.0.1:55432/tilt_stack_relay"));
  await migrateRelay(relayDb);
  const tiltChain = new TiltChain({
    ...rpc,
    vrfQueue: new PublicKey(env("VRF_ER_QUEUE", "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT")),
    relayer,
  });
  const vault = await tiltChain.fetchVault();
  if (!vault.relayer.equals(relayer.publicKey)) throw new Error("RELAYER_KEYPAIR is not the vault relayer");
  const players = new LocalPlayerWallets();
  const relayIntents = new RelayIntents(relayDb, new ChainExecutor(tiltChain, players, relayDb), {
    maxDeposit: usdc(50),
    dailyDepositLimit: usdc(100),
    dailyDepositLimitGlobal: usdc(10_000),
    minPromoPayout: usdc(0.01),
    maxPromoPayout: usdc(20),
    dailyPromoLimitPerPlayer: usdc(100),
    dailyPromoLimit: usdc(100),
  });
  const relayApp = createRelayApp({
    apiKeys: [RELAY_KEY],
    intents: relayIntents,
    players,
    chain: tiltChain,
    db: relayDb,
    consent: fakeConsent,
  });
  const relayServer = await listen(relayApp.fetch);

  // ---- api, real code paths except Privy ----
  const db = createDb(env("API_DATABASE_URL", "postgres://postgres:tilt@127.0.0.1:55432/tilt_stack_api"));
  await migrate(db);
  const relay = new HttpRelay(relayServer.url, RELAY_KEY, 30_000);
  const chain = new RpcChainReader(rpc);
  const app = createApp({
    db,
    relay,
    chain,
    privy: new FakePrivy(),
    intents: new Intents(db, relay),
    limiters: generousLimits(),
    geo: { header: "x-country", blocked: ["US"], allowUnknown: false, edgeSecret: EDGE_SECRET },
    config: {
      WEB_ORIGIN: "https://tilt.test",
      WEB_URL: "https://tilt.test",
      TRUST_PROXY: false,
      TRUSTED_PROXY_HOPS: 1,
      PRIVY_KEY_QUORUM_ID: "quorum-1",
      PRIVY_POLICY_ID: "policy-1",
    },
    now: Date.now,
  });
  const indexer = new Indexer(db, new ConnectionSource(chain.rollup), chain, 2_000);
  await indexer.start();
  const apiServer = await listen(app.fetch);

  const call = async <T>(method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const res = await fetch(`${apiServer.url}${path}`, {
      method,
      headers: { ...COUNTRY, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => undefined)) as T };
  };

  // ---- Player: Privy-style DID, local key, USDC in the wallet (no SOL needed) ----
  const userId = `did:privy:stack${randomUUID().replaceAll("-", "").slice(0, 25)}`;
  const key = Keypair.generate();
  players.keys.set(userId, key);
  const access = { authorization: `Bearer access:${userId}` };
  const identity = () => ({ "x-privy-identity-token": `identity:${userId}:${Math.floor(Date.now() / 1000) - 5}` });
  const config = await chain.config();
  await sendAndConfirmTransaction(
    tiltChain.base,
    new Transaction().add(
      createAtaIdempotent(admin.publicKey, key.publicKey, config.mint),
      mintTo(config.mint, associatedTokenAddress(key.publicKey, config.mint), admin.publicKey, usdc(100)),
    ),
    [admin],
  );
  say(`api=${apiServer.url} relay=${relayServer.url} player=${key.publicKey.toBase58()}`);

  say("\n--- 1. Connexion du mod (code d'appareil) ---");
  const started = await call<DeviceStartResponse>("POST", "/v1/auth/device");
  check("code d'appareil créé", started.status === 200 && !!started.json.userCode);
  const approved = await call("POST", "/v1/auth/device/approve", access, { userCode: started.json.userCode });
  check("code approuvé sur le web avec le jeton Privy", approved.status === 200, `(${approved.status})`);
  const polled = await call<DeviceTokenResponse>(
    "POST",
    "/v1/auth/device/token",
    {},
    {
      deviceCode: started.json.deviceCode,
    },
  );
  const modToken = polled.json.status === "approved" ? polled.json.token : "";
  check("le mod reçoit son jeton de jeu", !!modToken, JSON.stringify(polled.json).slice(0, 60));
  const mod = { authorization: `Bearer ${modToken}` };
  const modDeposit = await call(
    "POST",
    "/v1/account/deposit",
    { ...mod, ...identity() },
    {
      intentId: randomUUID(),
      amount: usdc(10).toString(),
    },
  );
  check("jeton du mod refusé pour un dépôt (401)", modDeposit.status === 401, `(${modDeposit.status})`);
  const before = await call<StateResponse>("GET", "/v1/state", mod);
  check("état avant dépôt : pas de compte", before.status === 200 && !before.json.accountOpen);

  say("\n--- 2. Premier dépôt via l'api ---");
  const firstDeposit = usdc(40);
  const noIdentity = await call("POST", "/v1/account/deposit", access, {
    intentId: randomUUID(),
    amount: firstDeposit.toString(),
  });
  check("dépôt sans jeton d'identité → 401", noIdentity.status === 401, `(${noIdentity.status})`);
  const relayNoConsent = await fetch(`${relayServer.url}/intents`, {
    method: "POST",
    headers: { authorization: `Bearer ${RELAY_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ intentId: randomUUID(), userId, action: { type: "open_account", amount: "40000000" } }),
  });
  const relayNoConsentBody = (await relayNoConsent.json()) as { error?: { code?: string } };
  check(
    "le relais refuse un dépôt sans consentement (403 CONSENT_REQUIRED)",
    relayNoConsent.status === 403 && relayNoConsentBody.error?.code === "CONSENT_REQUIRED",
    `(${relayNoConsent.status})`,
  );
  const depositId = randomUUID();
  const deposit = await call<MoneyIntentResponse>(
    "POST",
    "/v1/account/deposit",
    { ...access, ...identity() },
    {
      intentId: depositId,
      amount: firstDeposit.toString(),
    },
  );
  check(
    "ouverture de compte soumise",
    deposit.status === 200 && deposit.json.status !== "failed",
    JSON.stringify(deposit.json),
  );
  const settledDeposit = await until(async () => {
    const r = await call<MoneyIntentResponse>("GET", `/v1/account/intents/${depositId}`, access);
    return r.json.status === "pending" ? undefined : r.json;
  }, "deposit intent");
  check("intention de dépôt suivie jusqu'au bout", settledDeposit.status === "submitted", settledDeposit.status);
  const opened = await until(async () => {
    const s = (await call<StateResponse>("GET", "/v1/state", mod)).json;
    return s.accountOpen ? s : undefined;
  }, "account open");
  const expectedBalance = firstDeposit - config.onboardingFee;
  check(
    "état du mod : compte ouvert, solde = dépôt − frais d'ouverture",
    BigInt(opened.balance) === expectedBalance,
    `(${opened.balance} vs ${expectedBalance})`,
  );

  say("\n--- 3. Parties via /v1/play, comme le mod ---");
  const latencies: { action: string; ms: number }[] = [];
  const state = async () => (await call<StateResponse>("GET", "/v1/state", mod)).json;
  const play = async (action: PlayAction, intentId = randomUUID()) =>
    call<PlayResponse>("POST", "/v1/play", mod, { intentId, action });
  /** Plays one move and waits until the panel shows it resolved (not drawing, nothing pending). */
  const move = async (action: PlayAction, resolved: (s: StateResponse) => boolean): Promise<StateResponse> => {
    const t0 = performance.now();
    const res = await play(action);
    if (res.status !== 200 || res.json.status === "failed") throw new Error(`${action.type}: ${JSON.stringify(res)}`);
    const s = await until(async () => {
      const x = await state();
      return x.pendingIntentId === null && x.round && x.round.phase !== "drawing" && resolved(x) ? x : undefined;
    }, action.type);
    latencies.push({ action: action.type, ms: Math.round(performance.now() - t0) });
    return s;
  };
  const settledRounds: { game: string; round: RoundView }[] = [];
  const checkRound = (game: string, balanceBefore: bigint, s: StateResponse) => {
    const r = s.round;
    if (!r) return check(`${game} : manche visible`, false);
    const stake = BigInt(r.stake);
    const payout = BigInt(r.payout);
    const fee = BigInt(r.fee);
    const expectedFee = payout > stake ? ((payout - stake) * FEE_BPS) / BPS : 0n;
    const delta = BigInt(s.balance) - balanceBefore;
    settledRounds.push({ game, round: r });
    return check(
      `${game} : solde cohérent (mise ${stake}, gain ${payout}, frais ${fee})`,
      delta === payout - fee - stake && BigInt(r.net) === delta && fee === expectedFee,
      `(Δ ${delta}, net ${r.net}, frais attendus ${expectedFee})`,
    );
  };

  // Competition window starts here: earlier runs' rounds (other players) stay out of it.
  const playStart = Date.now() - 2_000;
  // Blackjack, two hands: bet, then hit / double / stand on the active hand from what the panel
  // allows, until settled. A move shows as a card on the active hand or the next hand's turn.
  let s = await state();
  let balance = BigInt(s.balance);
  const bjRound = (s.round?.number ?? 0) + 1;
  s = await move({ type: "blackjack_bet", amount: usdc(1).toString(), hands: 2 }, (x) => x.round?.number === bjRound);
  const moves: string[] = [];
  const progress = (bj: BlackjackView) => `${bj.activeHand}:${bj.hands.map((h) => h.cards.length).join(",")}`;
  while (s.round?.phase === "player_turn") {
    const bj = s.round.detail as BlackjackView;
    const before = progress(bj);
    const total = bj.hands[bj.activeHand ?? 0].total;
    let action: PlayAction;
    if (bj.canDouble && total >= 9 && total <= 11) action = { type: "blackjack_double" };
    else if (bj.canHit && total < 17) action = { type: "blackjack_hit" };
    else action = { type: "blackjack_stand" };
    moves.push(`${action.type.replace("blackjack_", "")}#${bj.activeHand}`);
    s = await move(action, (x) => x.round?.phase === "idle" || progress(x.round?.detail as BlackjackView) !== before);
  }
  check(
    "blackjack : main jouée jusqu'au bout",
    s.round?.phase === "idle",
    `(bet${moves.map((m) => " → " + m).join("")})`,
  );
  checkRound("blackjack", balance, s);

  balance = BigInt(s.balance);
  let next = (s.round?.number ?? 0) + 1;
  const rouletteId = randomUUID();
  const t0 = performance.now();
  const roulette = await play({ type: "roulette_spin", amount: usdc(1).toString(), bet: { kind: "red" } }, rouletteId);
  if (roulette.json.status === "failed") throw new Error(`roulette: ${JSON.stringify(roulette.json)}`);
  s = await until(async () => {
    const x = await state();
    return x.pendingIntentId === null && x.round?.number === next && x.round.phase === "idle" ? x : undefined;
  }, "roulette");
  latencies.push({ action: "roulette_spin", ms: Math.round(performance.now() - t0) });
  checkRound("roulette", balance, s);
  const roundsAfterRoulette = s.round?.number;
  const replayed = await play({ type: "roulette_spin", amount: usdc(1).toString(), bet: { kind: "red" } }, rouletteId);
  await sleep(2_000);
  const afterReplay = await state();
  check(
    "même intentId rejoué : même issue, pas de deuxième manche",
    replayed.status === 200 &&
      replayed.json.status === roulette.json.status &&
      afterReplay.round?.number === roundsAfterRoulette &&
      afterReplay.balance === s.balance,
    `(${replayed.json.status}, manche ${afterReplay.round?.number})`,
  );

  // Roulette table: several chips on one spin, each its own bet and size; the stake is their sum.
  balance = BigInt(s.balance);
  next = (s.round?.number ?? 0) + 1;
  const chips: RouletteChip[] = [
    { bet: { kind: "red" }, amount: usdc(1).toString() },
    { bet: { kind: "straight", number: 17 }, amount: usdc(0.5).toString() },
    { bet: { kind: "dozen", dozen: 2 }, amount: usdc(0.25).toString() },
  ];
  s = await move({ type: "roulette_chips", chips }, (x) => x.round?.number === next && x.round.phase === "idle");
  const table = s.round?.detail as RouletteView;
  check(
    "roulette (jetons) : la manche montre chaque jeton, mise = leur somme",
    JSON.stringify(table.chips) === JSON.stringify(chips) && s.round?.stake === usdc(1.75).toString(),
    `(${JSON.stringify(table.chips)}, mise ${s.round?.stake}, numéro ${table.number})`,
  );
  checkRound("roulette (jetons)", balance, s);

  balance = BigInt(s.balance);
  next = (s.round?.number ?? 0) + 1;
  s = await move(
    { type: "baccarat_deal", amount: usdc(1).toString(), bet: "banker" },
    (x) => x.round?.number === next && x.round.phase === "idle",
  );
  checkRound("baccarat", balance, s);

  balance = BigInt(s.balance);
  next = (s.round?.number ?? 0) + 1;
  s = await move(
    { type: "slots_spin", amount: usdc(1).toString() },
    (x) => x.round?.number === next && x.round.phase === "idle",
  );
  checkRound("slots", balance, s);

  // Mines, 1 mine: reveal tiles 0, 1, 2 (one draw each), then cash out (no draw) unless a mine
  // ended the round first.
  balance = BigInt(s.balance);
  next = (s.round?.number ?? 0) + 1;
  s = await move({ type: "mines_bet", amount: usdc(1).toString(), mines: 1 }, (x) => x.round?.number === next);
  const safeTiles = (x: StateResponse) => (x.round?.detail as MinesView).revealed.length;
  while (s.round?.phase === "player_turn" && safeTiles(s) < 3) {
    const before = safeTiles(s);
    s = await move({ type: "mines_reveal", tile: before }, (x) => x.round?.phase === "idle" || safeTiles(x) > before);
  }
  const minesEnd = s.round?.phase === "idle" ? "mine" : "encaissement";
  if (s.round?.phase === "player_turn") s = await move({ type: "mines_cashout" }, (x) => x.round?.phase === "idle");
  const minesBoard = s.round?.detail as MinesView;
  check(
    "mines : manche terminée",
    s.round?.phase === "idle" && (minesBoard.busted !== null || safeTiles(s) === 3),
    `(${minesEnd}, cases ${minesBoard.revealed.join(",")}, mine ${minesBoard.busted}, ×${minesBoard.multiplier})`,
  );
  checkRound("mines", balance, s);

  // One-draw games: one round each, settled by its single draw.
  const oneDraw: PlayAction[] = [
    { type: "dice_roll", amount: usdc(1).toString(), target: 5_000, over: true },
    { type: "limbo_play", amount: usdc(1).toString(), target: 200 },
    { type: "flip_play", amount: usdc(1).toString(), side: "heads", flips: 2 },
    { type: "keno_play", amount: usdc(1).toString(), picks: [3, 11, 17, 25, 38] },
    { type: "wheel_spin", amount: usdc(1).toString(), segments: 20, risk: "medium" },
  ];
  for (const action of oneDraw) {
    balance = BigInt(s.balance);
    next = (s.round?.number ?? 0) + 1;
    s = await move(action, (x) => x.round?.number === next && x.round.phase === "idle");
    const game = action.type.split("_")[0];
    check(`${game} : manche jouée`, s.round?.detail.game === game, JSON.stringify(s.round?.detail));
    checkRound(game, balance, s);
  }

  // Hilo: the bet draws the first card; then guess the likelier side (the smaller multiplier)
  // until two right guesses, then cash out (no draw) unless a wrong guess ended the round.
  balance = BigInt(s.balance);
  next = (s.round?.number ?? 0) + 1;
  const hiloOf = (x: StateResponse) => x.round?.detail as HiloView;
  s = await move({ type: "hilo_bet", amount: usdc(1).toString() }, (x) => x.round?.number === next);
  let guesses = 0;
  while (s.round?.phase === "player_turn" && guesses < 2) {
    const hilo = hiloOf(s);
    const higher = Number(hilo.higherMultiplier ?? Infinity);
    const lower = Number(hilo.lowerMultiplier ?? Infinity);
    const cards = hilo.cards.length;
    s = await move(
      { type: "hilo_guess", guess: higher <= lower ? "higher" : "lower" },
      (x) => x.round?.phase === "idle" || hiloOf(x).cards.length > cards,
    );
    guesses++;
  }
  if (s.round?.phase === "player_turn") s = await move({ type: "hilo_cashout" }, (x) => x.round?.phase === "idle");
  const hiloEnd = hiloOf(s);
  check(
    "hilo : manche terminée",
    s.round?.phase === "idle" && hiloEnd.cards.length >= 2,
    `(${hiloEnd.busted ? "perdu" : "encaissement"}, cartes ${hiloEnd.cards.map((c) => c.rank).join(",")}, ×${hiloEnd.multiplier})`,
  );
  checkRound("hilo", balance, s);

  // Tower, easy: climb tile 0 on two levels (one draw each), then cash out unless a bad tile
  // ended the round first.
  balance = BigInt(s.balance);
  next = (s.round?.number ?? 0) + 1;
  const towerOf = (x: StateResponse) => x.round?.detail as TowerView;
  s = await move(
    { type: "tower_bet", amount: usdc(1).toString(), difficulty: "easy" },
    (x) => x.round?.number === next,
  );
  while (s.round?.phase === "player_turn" && towerOf(s).climbed.length < 2) {
    const levels = towerOf(s).climbed.length;
    s = await move(
      { type: "tower_climb", tile: 0 },
      (x) => x.round?.phase === "idle" || towerOf(x).climbed.length > levels,
    );
  }
  if (s.round?.phase === "player_turn") s = await move({ type: "tower_cashout" }, (x) => x.round?.phase === "idle");
  const towerEnd = towerOf(s);
  check(
    "tower : manche terminée",
    s.round?.phase === "idle" && (towerEnd.busted !== null || towerEnd.climbed.length === 2),
    `(niveaux ${towerEnd.climbed.length}, perdu sur ${towerEnd.busted}, ×${towerEnd.multiplier})`,
  );
  checkRound("tower", balance, s);

  const money = await call("POST", "/v1/play", mod, {
    intentId: randomUUID(),
    action: { type: "withdraw", amount: "1000000" },
  });
  check("action d'argent sur /v1/play → 400", money.status === 400, `(${money.status})`);

  say("\n--- 4. Indexeur et vérification ---");
  for (const { game, round } of settledRounds) {
    const signature = await until(
      async () => {
        const x = await state();
        if (x.round?.number === round.number && x.round.settledSignature) return x.round.settledSignature;
        const { rows } = await db.query<{ signature: string }>(
          "SELECT signature FROM rounds WHERE player = $1 AND round = $2",
          [key.publicKey.toBase58(), round.number],
        );
        return rows[0]?.signature;
      },
      `${game} indexed`,
      30_000,
    ).catch(() => null);
    if (!check(`${game} : manche ${round.number} indexée`, signature !== null)) continue;
    const verified = await call<VerifyResponse>("GET", `/v1/rounds/${signature}/verify`);
    check(
      `${game} : /verify rejoue la manche (matches=true)`,
      verified.status === 200 && verified.json.matches,
      verified.json.matches
        ? ""
        : `(status ${verified.status}, rejoué ${JSON.stringify(verified.json.replayed?.payout)} vs on-chain ${JSON.stringify(verified.json.onChain)})`,
    );
  }

  say("\n--- 5. Retrait via l'api ---");
  const usdcBefore = await chain.walletUsdc(key.publicKey);
  const withdrawId = randomUUID();
  const withdrawAmount = usdc(5);
  const withdraw = await call<MoneyIntentResponse>(
    "POST",
    "/v1/account/withdraw",
    { ...access, ...identity() },
    {
      intentId: withdrawId,
      amount: withdrawAmount.toString(),
    },
  );
  check("retrait soumis", withdraw.status === 200 && withdraw.json.status !== "failed", JSON.stringify(withdraw.json));
  const tw = performance.now();
  const arrived = await until(
    async () => ((await chain.walletUsdc(key.publicKey)) - usdcBefore === withdrawAmount ? true : undefined),
    "withdrawal",
    120_000,
  ).catch(() => false);
  check("USDC reçus dans le wallet du joueur", arrived, `(${Math.round(performance.now() - tw)} ms)`);

  say("\n--- 6. Compétition et gains promo ---");
  // Fund the promo pool (set up by chain/scripts/e2e.ts) from the admin.
  const program = new anchor.Program<Tilt>(
    idl,
    new anchor.AnchorProvider(tiltChain.base, new anchor.Wallet(admin), { commitment: "confirmed" }),
  );
  const sponsorToken = associatedTokenAddress(admin.publicKey, config.mint);
  await sendAndConfirmTransaction(
    tiltChain.base,
    new Transaction().add(
      createAtaIdempotent(admin.publicKey, admin.publicKey, config.mint),
      mintTo(config.mint, sponsorToken, admin.publicKey, usdc(10)),
    ),
    [admin],
  );
  await program.methods
    .fundPromo(new anchor.BN(usdc(10).toString()))
    .accountsPartial({
      funder: admin.publicKey,
      vault: vaultAddress(),
      promo: promoAddress(),
      promoToken: promoTokenAddress(),
      source: sponsorToken,
      mint: config.mint,
    })
    .rpc();

  const actor = "stack-e2e";
  const campaign = await createCampaign(
    db,
    { sponsor: `Stack ${randomUUID().slice(0, 8)}`, tagline: null, budget: usdc(10), commissionBps: 4000 },
    actor,
  );
  // Window: from just before the first round to a moment from now (so it can be closed).
  const endsAt = new Date(Date.now() + 3_000);
  const competitionId = await openCompetition(
    db,
    {
      campaign,
      name: "stack e2e",
      startsAt: new Date(playStart),
      endsAt,
      pool: usdc(3),
      splitBps: [5000, 2500, 1000],
      sharedRanks: 7,
      minStake: 0n,
      dropPool: usdc(2),
      dropCount: 1,
      ticketsPerHour: 20,
    },
    actor,
  );
  const running = await call<LeaderboardResponse>("GET", "/v1/leaderboard");
  const you = handle(key.publicKey.toBase58());
  check(
    "classement : le joueur y figure",
    running.json.competition?.id === competitionId && running.json.entries.some((e) => e.handle === you),
    JSON.stringify(running.json.entries),
  );
  // Closing waits for the indexer to vouch for the whole window (one backfill after the end).
  await until(
    async () => ((await indexedThrough(db)) ?? new Date(0)) >= endsAt || undefined,
    "indexer past the end of the competition",
  );
  const closed = await closeCompetition(db, competitionId, actor);
  const prizes = (await listPrizes(db)).filter((p) => p.competitionId === competitionId);
  check(
    "compétition close : prix en attente de revue pour le joueur",
    prizes.length > 0 && prizes.every((p) => p.player === key.publicKey.toBase58() && p.userId === userId),
    `(${closed.rankPrizes} classement, ${closed.dropPrizes} drop)`,
  );
  const approvedCount = await approvePrizes(db, { competitionId }, actor);
  check("prix approuvés", approvedCount === prizes.length, `(${approvedCount})`);
  const total = prizes.reduce((a, p) => a + BigInt(p.amount), 0n);
  const beforePrize = await chain.walletUsdc(key.publicKey);
  const paid = await payPrizes(db, relay, actor);
  const afterPrize = await until(
    async () => {
      const b = await chain.walletUsdc(key.publicKey);
      return b - beforePrize === total ? b : undefined;
    },
    "prize USDC",
    30_000,
  ).catch(() => null);
  check(
    "prix payés via le relais (pool promo)",
    paid.paid === prizes.length && afterPrize !== null,
    `(${JSON.stringify(paid)}, ${total} attendus)`,
  );
  const again = await payPrizes(db, relay, actor);
  const replayedPrizes = await Promise.all(prizes.map((p) => relay.getPromo(p.id)));
  await sleep(2_000);
  check(
    "deuxième paiement : rien payé deux fois",
    again.paid === 0 &&
      again.failed === 0 &&
      (await chain.walletUsdc(key.publicKey)) - beforePrize === total &&
      replayedPrizes.every((r) => r?.status === "submitted"),
    JSON.stringify(again),
  );
  const replayOne =
    prizes[0] &&
    (await relay
      .payPromo({
        payoutId: prizes[0].id,
        userId,
        amount: prizes[0].amount,
        poolId: competitionId,
        reason: `${prizes[0].kind} #${prizes[0].rank}`,
      })
      .catch((e: unknown) => String(e)));
  check(
    "même payoutId renvoyé au relais : rien de plus",
    (await chain.walletUsdc(key.publicKey)) - beforePrize === total,
    typeof replayOne === "string" ? replayOne : (replayOne?.status ?? ""),
  );
  const board = await call<LeaderboardResponse>("GET", "/v1/leaderboard");
  check(
    "GET /v1/leaderboard montre le joueur (compétition terminée)",
    board.json.competition?.id === competitionId &&
      board.json.entries.some((e) => e.handle === you) &&
      !!board.json.dropSeed,
    JSON.stringify(board.json.entries),
  );

  say("\n--- Latences (POST /v1/play → état réglé vu par /v1/state) ---");
  for (const l of latencies) say(`  ${l.action.padEnd(18)} ${l.ms} ms`);

  await indexer.stop();
  await new Promise<void>((r) => apiServer.server.close(() => r()));
  await new Promise<void>((r) => relayServer.server.close(() => r()));
  await db.end();
  await relayDb.end();
  const failed = results.filter((r) => !r.ok).length;
  say(`\n${results.length - failed}/${results.length} vérifications OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
