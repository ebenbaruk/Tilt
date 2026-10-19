// End-to-end check of the relay against a real Solana + MagicBlock rollup and Postgres:
// HTTP API → intents → Tilt program, plus the sweeper. Player signatures come from local
// keys through the PlayerWallets interface (Privy is exercised separately with real
// credentials). Needs the vault set up by `chain/scripts/e2e.ts` (same admin, relayer and mint).
//
// Run: pnpm --filter @tilt/wallet e2e (env: BASE_RPC, ER_RPC, ER_WS, TEST_DATABASE_URL, POLL_MS)
import anchor from "@coral-xyz/anchor";
import { createAssociatedTokenAccountIdempotent, getAccount, mintTo } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  type Action,
  idl,
  type IntentResponse,
  ledgerAddress,
  playerAccountAddress,
  type PromoPayoutResponse,
  promoAddress,
  promoTokenAddress,
  tableAddress,
  type Tilt,
  type UserResponse,
  vaultAddress,
  vaultTokenAddress,
} from "@tilt/contract";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app";
import { TiltChain, type PlayerAccount } from "../src/chain";
import { createDb, migrate } from "../src/db";
import { ChainExecutor } from "../src/executor";
import { Intents } from "../src/intents";
import type { PlayerWallet, PlayerWallets } from "../src/players";
import { sweep } from "../src/sweeper";

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const POLL_MS = Number(env("POLL_MS", "25"));
const API_KEY = "e2e".repeat(12);
const usdc = (x: number) => Math.round(x * 1_000_000);
const loadKeypair = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));

const admin = loadKeypair(env("ANCHOR_WALLET", `${os.homedir()}/.config/solana/id.json`));
const relayer = loadKeypair(new URL("../../../chain/.anchor/e2e-relayer.json", import.meta.url).pathname);
const chain = new TiltChain({
  solanaRpcUrl: env("BASE_RPC", "http://localhost:8899"),
  rollupRpcUrl: env("ER_RPC", "http://localhost:7799"),
  rollupWsUrl: env("ER_WS", "ws://localhost:7800"),
  vrfQueue: new PublicKey(env("VRF_ER_QUEUE", "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT")),
  relayer,
});
const rollupProgram = new anchor.Program<Tilt>(idl, new anchor.AnchorProvider(chain.rollup, new anchor.Wallet(relayer), { commitment: "confirmed" }));

/** Test players: signs with local keys, as Privy does with the player's embedded wallet. */
class LocalPlayerWallets implements PlayerWallets {
  readonly keys = new Map<string, Keypair>();
  async find(userId: string): Promise<PlayerWallet | undefined> {
    const key = this.keys.get(userId);
    return key && { userId, walletId: `local-${userId}`, address: key.publicKey };
  }
  async sign(wallet: PlayerWallet, tx: Transaction): Promise<Transaction> {
    tx.partialSign(this.keys.get(wallet.userId)!);
    return tx;
  }
}

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name} ${detail}`);
}
async function until<T>(f: () => Promise<T | undefined>, what: string, timeoutMs = 60_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await f().catch(() => undefined);
    if (value !== undefined) return value;
    await sleep(POLL_MS);
  }
  throw new Error(`timeout waiting for ${what}`);
}

async function main() {
  const db = createDb(env("TEST_DATABASE_URL", "postgres://postgres:tilt@127.0.0.1:55432/tilt_test"));
  await migrate(db);
  await db.query("TRUNCATE intents, players");
  const players = new LocalPlayerWallets();
  const intents = new Intents(db, new ChainExecutor(chain, players, db), { maxDeposit: BigInt(usdc(50)), dailyDepositLimit: BigInt(usdc(100)), dailyDepositLimitGlobal: BigInt(usdc(1000)), minPromoPayout: BigInt(usdc(1)), maxPromoPayout: BigInt(usdc(50)), dailyPromoLimit: BigInt(usdc(100)) });
  // Stands in for Privy's identity tokens (checked by the HTTP tests): the token is the user id.
  const consent = { verify: async (identityToken: string) => ({ userId: identityToken, issuedAt: Date.now() / 1000 }) };
  const app = createApp({ apiKeys: [API_KEY], intents, players, chain, db, consent });
  const api = async <T>(path: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const res = await app.request(path, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as T };
  };
  const submit = (userId: string, action: Action, intentId = randomUUID()) =>
    api<IntentResponse>("/intents", { intentId, userId, action, consent: { identityToken: userId } }).then((r) => r.json);

  const vault = await chain.fetchVault();
  console.log(`base=${chain.base.rpcEndpoint} rollup=${chain.rollup.rpcEndpoint}`);
  check("le relais est bien le relayer du coffre", vault.relayer.equals(relayer.publicKey));
  const user = `did:privy:e2e${randomUUID().replaceAll("-", "")}`;
  const key = Keypair.generate();
  players.keys.set(user, key);
  const playerToken = await createAssociatedTokenAccountIdempotent(chain.base, admin, vault.mint, key.publicKey);
  await mintTo(chain.base, admin, vault.mint, playerToken, admin, usdc(100));
  const usdcBalance = async () => (await getAccount(chain.base, playerToken)).amount;
  const account = () => chain.fetchPlayerAccount(key.publicKey) as Promise<PlayerAccount>;
  const table = () => rollupProgram.account.blackjackTable.fetch(tableAddress(key.publicKey));

  console.log("\n--- Utilisateur et ouverture ---");
  check("utilisateur inconnu → 404", (await api(`/users/did:privy:${"0".repeat(25)}`)).status === 404);
  const before = await api<UserResponse>(`/users/${user}`);
  check("utilisateur connu, compte pas encore ouvert", before.status === 200 && !before.json.accountOpen && before.json.solanaAddress === key.publicKey.toBase58());
  check("dépôt avant ouverture refusé", (await submit(user, { type: "deposit", amount: String(usdc(5)) })).error?.code === "ACCOUNT_NOT_OPEN");
  check("mise avant ouverture refusée", (await submit(user, { type: "slots_spin", amount: String(usdc(1)) })).error?.code === "ACCOUNT_NOT_OPEN");
  const openId = randomUUID();
  const opened = await submit(user, { type: "open_account", amount: String(usdc(30)) }, openId);
  check("premier dépôt via le relais", opened.status === "submitted" && !!opened.signature, opened.error?.message ?? "");
  const replay = await submit(user, { type: "open_account", amount: String(usdc(30)) }, openId);
  check("même intention rejouée : même résultat, rien de plus", replay.signature === opened.signature && (await usdcBalance()) === BigInt(usdc(70)));
  check("compte ouvert", (await api<UserResponse>(`/users/${user}`)).json.accountOpen);
  check("deuxième ouverture refusée", (await submit(user, { type: "open_account", amount: String(usdc(5)) })).error?.code === "ACCOUNT_ALREADY_OPEN");
  await until(() => account(), "account in rollup");
  await until(() => rollupProgram.account.blackjackTable.fetchNullable(tableAddress(key.publicKey)), "table in rollup");
  check("dépôt via le relais", (await submit(user, { type: "deposit", amount: String(usdc(10)) })).status === "submitted");

  console.log("\n--- Pool de risque ---");
  const RISK_POOL_TARGET = BigInt(usdc(500));
  const funding = await sweep(db, chain, intents, { checkpointMinLoss: 1n << 62n, checkpointIntervalMs: 0, riskPoolTarget: RISK_POOL_TARGET });
  const poolLeft = async () => {
    const [v, pool] = await Promise.all([chain.fetchVault(), chain.fetchRiskPool()]);
    return BigInt(v.poolLine.toString()) - BigInt(pool.transferred.toString()) - BigInt(pool.uncovered.toString());
  };
  check("le sweeper ouvre le pool de risque et lui accorde sa ligne", funding.failed === 0 && (await poolLeft()) >= RISK_POOL_TARGET, `(${funding.funded} accordés)`);

  console.log("\n--- Manches via le relais ---");
  const playRound = async (action: Action) => {
    const startRounds = (await account()).rounds;
    const res = await submit(user, action);
    if (res.status !== "submitted") throw new Error(`${action.type}: ${JSON.stringify(res)}`);
    return until(async () => {
      const a = await account();
      return a.rounds > startRounds || "playerTurn" in a.round.status ? a : undefined;
    }, action.type);
  };
  await playRound({ type: "slots_spin", amount: String(usdc(1)) });
  await playRound({ type: "roulette_spin", amount: String(usdc(1)), bet: { kind: "red" } });
  await playRound({ type: "baccarat_deal", amount: String(usdc(1)), bet: "banker" });
  // Two hands: standing on the first moves to the second without a draw, the last one calls the dealer.
  let a = await playRound({ type: "blackjack_bet", amount: String(usdc(1)), hands: 2 });
  while ("playerTurn" in a.round.status) {
    const active = (await table()).active;
    await submit(user, { type: "blackjack_stand" });
    a = await until(async () => {
      const x = await account();
      return "idle" in x.round.status || ("playerTurn" in x.round.status && (await table()).active > active) ? x : undefined;
    }, "stand");
  }
  check("slots, roulette, baccarat et blackjack joués via le relais", a.rounds >= 4, `(${a.rounds} manches)`);
  const refused = await submit(user, { type: "slots_spin", amount: String(usdc(0.01)) });
  check("refus du programme remonté tel quel", refused.status === "failed" && refused.error?.code === "PROGRAM_ERROR" && refused.error.message === "AmountOutOfRange", refused.error?.message ?? "");
  const conflict = await api("/intents", { intentId: openId, userId: user, action: { type: "blackjack_hit" } });
  check("identifiant d'intention réutilisé pour autre chose → 409", conflict.status === 409);
  const capped = await api("/intents", { intentId: randomUUID(), userId: user, action: { type: "deposit", amount: String(usdc(60)) }, consent: { identityToken: user } });
  check("dépôt au-delà du plafond du relais refusé (422)", capped.status === 422);
  const unconsented = await api("/intents", { intentId: randomUUID(), userId: user, action: { type: "deposit", amount: String(usdc(1)) } });
  check("dépôt sans jeton d'identité du joueur refusé (403)", unconsented.status === 403);

  console.log("\n--- Joueur ouvert avant les tables de blackjack ---");
  // Opened like before multi-hand: open_account + delegate_account only, no table.
  const legacyUser = `did:privy:e2e${randomUUID().replaceAll("-", "")}`;
  const legacyKey = Keypair.generate();
  players.keys.set(legacyUser, legacyKey);
  const legacyToken = await createAssociatedTokenAccountIdempotent(chain.base, admin, vault.mint, legacyKey.publicKey);
  await mintTo(chain.base, admin, vault.mint, legacyToken, admin, usdc(20));
  const baseProgram = new anchor.Program<Tilt>(idl, new anchor.AnchorProvider(chain.base, new anchor.Wallet(relayer), { commitment: "confirmed" }));
  const legacyDeposit = BigInt(usdc(20));
  const legacyAccounts = {
    vault: vaultAddress(),
    payer: relayer.publicKey,
    player: legacyKey.publicKey,
    vaultToken: vaultTokenAddress(),
    treasury: vault.treasury,
    playerToken: legacyToken,
    mint: vault.mint,
    account: playerAccountAddress(legacyKey.publicKey),
    ledger: ledgerAddress(legacyKey.publicKey),
  };
  await baseProgram.methods
    .openAccount(new anchor.BN(legacyDeposit.toString()))
    .accountsPartial(legacyAccounts)
    .postInstructions([await baseProgram.methods.delegateAccount().accountsPartial(legacyAccounts).instruction()])
    .signers([legacyKey])
    .rpc();
  check("joueur existant sans table", (await chain.base.getAccountInfo(tableAddress(legacyKey.publicKey))) === null);
  await until(() => chain.fetchPlayerAccount(legacyKey.publicKey).then((x) => x ?? undefined), "legacy account in rollup");
  const legacyBet = await submit(legacyUser, { type: "blackjack_bet", amount: String(usdc(1)), hands: 1 });
  const legacyAccount = await until(async () => {
    const x = await chain.fetchPlayerAccount(legacyKey.publicKey);
    return x && (x.rounds > 0 || "playerTurn" in x.round.status) ? x : undefined;
  }, "legacy blackjack round");
  const legacyTable = await rollupProgram.account.blackjackTable.fetch(tableAddress(legacyKey.publicKey));
  check(
    "1re mise de blackjack : table ouverte, déléguée, vue par le rollup, puis main jouée",
    legacyBet.status === "submitted" && (await chain.base.getAccountInfo(tableAddress(legacyKey.publicKey))) !== null && legacyTable.nHands === 1,
    `(statut ${JSON.stringify(legacyAccount.round.status)})`,
  );

  console.log("\n--- Pool de risque après les manches ---");
  const pool = await chain.fetchRiskPool();
  check(
    "toute manche réglée a rendu ce qu'elle tenait au pool",
    BigInt(pool.gains.toString()) === 0n && BigInt(pool.stakes.toString()) === 0n,
    `(gains ${pool.gains}, mises ${pool.stakes})`,
  );

  console.log("\n--- Reprise après interruption ---");
  // Pretend the relay died before seeing the outcome (minutes ago): reconciliation must find it on-chain.
  const LONG_AGO = "now() - interval '10 minutes'";
  for (const network of ["solana", "rollup"] as const) {
    const { rows } = await db.query<{ intent_id: string }>(
      `UPDATE intents SET status = 'pending', updated_at = ${LONG_AGO} WHERE intent_id = (SELECT intent_id FROM intents WHERE user_id = $1 AND network = $2 AND status = 'submitted' ORDER BY created_at DESC LIMIT 1) RETURNING intent_id`,
      [user, network],
    );
    await intents.reconcile(chain);
    check(`intention ${network} interrompue retrouvée comme réussie`, (await intents.get(rows[0].intent_id))?.status === "submitted");
  }
  const ghost = randomUUID();
  await db.query(
    `INSERT INTO intents (intent_id, user_id, action, status, signature, network, last_valid_block_height, updated_at) VALUES ($1, $2, $3, 'pending', $4, 'rollup', 0, ${LONG_AGO})`,
    [ghost, user, { type: "slots_spin", amount: "1000000" }, "1111111111111111111111111111111111111111111111111111111111111111"],
  );
  check("joueur occupé tant qu'une intention est en vol (409)", (await api("/intents", { intentId: randomUUID(), userId: user, action: { type: "blackjack_hit" } })).status === 409);
  await intents.reconcile(chain);
  check("transaction jamais arrivée et expirée → échec", (await intents.get(ghost))?.status === "failed");

  console.log("\n--- Retrait via le relais ---");
  const usdcBefore = await usdcBalance();
  check("retrait demandé", (await submit(user, { type: "withdraw", amount: String(usdc(5)) })).status === "submitted");
  await until(async () => ((await usdcBalance()) - usdcBefore === BigInt(usdc(5)) ? true : undefined), "withdrawal paid");
  check("retrait reçu dans le wallet du joueur", true);

  console.log("\n--- Tâche planifiée (sweeper) ---");
  const timeoutSecs = Number(vault.config.roundTimeoutSecs.toString());
  for (let i = 0; i < 10 && !("playerTurn" in a.round.status); i++) a = await playRound({ type: "blackjack_bet", amount: String(usdc(1)), hands: 1 });
  check("main laissée ouverte", "playerTurn" in a.round.status);
  await sleep((timeoutSecs + 1) * 1_000);
  const sweepOptions = { checkpointMinLoss: 1n, checkpointIntervalMs: 0, riskPoolTarget: RISK_POOL_TARGET };
  const swept = await sweep(db, chain, intents, { ...sweepOptions, checkpointMinLoss: 1n << 62n });
  const stillOpen = await account();
  check("le sweeper ne joue jamais à la place du joueur", swept.expired === 0 && "playerTurn" in stillOpen.round.status, JSON.stringify(swept));
  await submit(user, { type: "blackjack_stand" });
  await until(async () => {
    const x = await account();
    return "idle" in x.round.status ? x : undefined;
  }, "stand after timeout");
  check("le joueur reprend sa main après le délai", (await table()).nDealer >= 2);

  const netWin = (x: PlayerAccount) => BigInt(x.balance.toString()) + BigInt(x.withdrawn.toString()) - BigInt(x.credited.toString()) + BigInt(x.forfeited.toString());
  for (let i = 0; i < 40 && netWin(await account()) >= 0n; i++) await playRound({ type: "baccarat_deal", amount: String(usdc(2)), bet: "tie" });
  const loss = -netWin(await account());
  const checkpointed = await sweep(db, chain, intents, sweepOptions);
  const forfeited = await until(async () => {
    const l = await chain.fetchLedger(key.publicKey);
    return l && l.forfeited.gtn(0) ? BigInt(l.forfeited.toString()) : undefined;
  }, "checkpoint applied");
  check("le sweeper rend les pertes du joueur à la maison", checkpointed.checkpointed === 1 && forfeited === loss, `(${forfeited} libérés)`);
  const again = await sweep(db, chain, intents, sweepOptions);
  check("pas de checkpoint en double", again.checkpointed === 0 && again.failed === 0, JSON.stringify(again));

  console.log("\n--- Gains promo via le relais ---");
  // The pool is set up by chain/scripts/e2e.ts; refill it from a sponsor.
  const sponsor = await createAssociatedTokenAccountIdempotent(chain.base, admin, vault.mint, admin.publicKey);
  await mintTo(chain.base, admin, vault.mint, sponsor, admin, usdc(30));
  await new anchor.Program<Tilt>(idl, new anchor.AnchorProvider(chain.base, new anchor.Wallet(admin), { commitment: "confirmed" })).methods
    .fundPromo(new anchor.BN(usdc(30)))
    .accountsPartial({ funder: admin.publicKey, vault: vaultAddress(), promo: promoAddress(), promoToken: promoTokenAddress(), source: sponsor, mint: vault.mint })
    .rpc();
  const payout = { payoutId: randomUUID(), userId: user, amount: String(usdc(12)), poolId: "e2e-competition", reason: "1st place" };
  const beforePrize = await usdcBalance();
  const paid = await api<PromoPayoutResponse>("/payouts/promo", payout);
  check("gain promo versé au joueur via le relais", paid.json.status === "submitted" && (await usdcBalance()) - beforePrize === BigInt(usdc(12)), paid.json.error?.message ?? "");
  const paidAgain = await api<PromoPayoutResponse>("/payouts/promo", payout);
  check("même gain renvoyé : même réponse, rien de plus", paidAgain.json.signature === paid.json.signature && (await usdcBalance()) - beforePrize === BigInt(usdc(12)));
  check("gain promo consultable", (await api<PromoPayoutResponse>(`/payouts/promo/${payout.payoutId}`)).json.status === "submitted");
  const tooBig = await api<PromoPayoutResponse>("/payouts/promo", { ...payout, payoutId: randomUUID(), amount: String(usdc(25)) });
  check("gain au-delà du plafond du pool refusé par le programme", tooBig.json.status === "failed" && tooBig.json.error?.message === "PromoCapReached", tooBig.json.error?.message ?? "");

  const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM intents WHERE user_id = $1", [user]);
  check("chaque intention est tracée en base", Number(rows[0].n) >= 10, `(${rows[0].n} intentions)`);
  await db.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications OK`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
