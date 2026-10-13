// Live check of the Privy side of the relay, with real Privy credentials (a development app):
// creates a test user whose embedded Solana wallet has the relay's key quorum as a signer,
// restricted by the Tilt-only policy, then runs the relay's real PrivyPlayerWallets through the
// HTTP API: lookup, first deposit (the player's signature comes from Privy), a deposit and a
// round; and checks the relay's key cannot sign anything else. Needs the local stack (or
// devnet) with the vault set up by `chain/scripts/e2e.ts`. Credentials: `scripts/privy-setup.ts`.
//
// Env: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY, PRIVY_KEY_QUORUM_ID,
//      PRIVY_POLICY_ID, BASE_RPC, ER_RPC, ER_WS, VRF_ER_QUEUE, TEST_DATABASE_URL.
import anchor from "@coral-xyz/anchor";
import { PrivyClient } from "@privy-io/node";
import { createAssociatedTokenAccountIdempotent, createTransferInstruction, getAccount, mintTo } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { type Action, idl, type IntentResponse, ledgerAddress, type Tilt, type UserResponse, vaultAddress, vaultTokenAddress } from "@tilt/contract";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app";
import { TiltChain } from "../src/chain";
import { createDb, migrate } from "../src/db";
import { ChainExecutor } from "../src/executor";
import { Intents } from "../src/intents";
import { PrivyPlayerWallets } from "../src/players";

const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
};
const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const usdc = (x: number) => Math.round(x * 1_000_000);
const API_KEY = "live".repeat(10);
const loadKeypair = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));

const admin = loadKeypair(env("ANCHOR_WALLET", `${os.homedir()}/.config/solana/id.json`));
const relayer = loadKeypair(new URL("../../../chain/.anchor/e2e-relayer.json", import.meta.url).pathname);

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name} ${detail}`);
}

async function main() {
  const privy = new PrivyClient({ appId: required("PRIVY_APP_ID"), appSecret: required("PRIVY_APP_SECRET") });
  const db = createDb(env("TEST_DATABASE_URL", "postgres://postgres:tilt@127.0.0.1:55432/tilt_test"));
  await migrate(db);
  const chain = new TiltChain({
    solanaRpcUrl: env("BASE_RPC", "http://localhost:8899"),
    rollupRpcUrl: env("ER_RPC", "http://localhost:7799"),
    rollupWsUrl: env("ER_WS", "ws://localhost:7800"),
    vrfQueue: new PublicKey(env("VRF_ER_QUEUE", "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT")),
    relayer,
  });
  const players = new PrivyPlayerWallets(privy, required("PRIVY_AUTHORIZATION_KEY"), db);
  const intents = new Intents(db, new ChainExecutor(chain, players, db), { maxDeposit: BigInt(usdc(50)), dailyDepositLimit: BigInt(usdc(100)), minPromoPayout: BigInt(usdc(1)) });
  const app = createApp({ apiKeys: [API_KEY], intents, players, chain, db });
  const api = async <T>(path: string, body?: unknown) => {
    const res = await app.request(path, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as T };
  };
  const submit = (userId: string, action: Action) => api<IntentResponse>("/intents", { intentId: randomUUID(), userId, action }).then((r) => r.json);

  // A Privy user like the web would create, with the relay's key quorum as wallet signer.
  const user = await privy.users().create({
    linked_accounts: [{ type: "email", address: `tilt-e2e-${randomUUID()}@example.com` }],
    wallets: [{ chain_type: "solana", additional_signers: [{ signer_id: required("PRIVY_KEY_QUORUM_ID"), override_policy_ids: [required("PRIVY_POLICY_ID")] }] }],
  });
  const found = await api<UserResponse>(`/users/${user.id}`);
  check("wallet Solana du joueur retrouvé via Privy", found.status === 200 && !found.json.accountOpen, found.json.solanaAddress);
  const address = new PublicKey(found.json.solanaAddress);

  const vault = await chain.fetchVault();
  const token = await createAssociatedTokenAccountIdempotent(chain.base, admin, vault.mint, address);
  await mintTo(chain.base, admin, vault.mint, token, admin, usdc(50));
  const opened = await submit(user.id, { type: "open_account", amount: String(usdc(20)) });
  check("premier dépôt signé par le wallet Privy du joueur", opened.status === "submitted", opened.error?.message ?? opened.signature ?? "");
  check("USDC débités du wallet du joueur", (await getAccount(chain.base, token)).amount === BigInt(usdc(30)));
  const deposited = await submit(user.id, { type: "deposit", amount: String(usdc(5)) });
  check("dépôt suivant signé par Privy", deposited.status === "submitted", deposited.error?.message ?? "");
  for (let i = 0; i < 100 && !(await chain.fetchPlayerAccount(address)); i++) await sleep(100);
  const spin = await submit(user.id, { type: "slots_spin", amount: String(usdc(1)) });
  check("manche jouée pour le joueur Privy", spin.status === "submitted", spin.error?.message ?? "");

  // The relay's key must not be able to move the player's USDC anywhere else.
  const wallet = (await players.find(user.id))!;
  const thief = await createAssociatedTokenAccountIdempotent(chain.base, admin, vault.mint, admin.publicKey);
  const refusedToSign = async (...instructions: TransactionInstruction[]) => {
    const tx = new Transaction().add(...instructions);
    tx.feePayer = relayer.publicKey;
    tx.recentBlockhash = (await chain.base.getLatestBlockhash()).blockhash;
    return players.sign(wallet, tx).then(() => undefined, (e: unknown) => (e instanceof Error ? e.message : String(e)));
  };
  const transfer = createTransferInstruction(token, thief, address, usdc(1));
  const alone = await refusedToSign(transfer);
  check("Privy refuse de signer un transfert USDC hors du programme Tilt", alone !== undefined, alone?.slice(0, 120) ?? "SIGNÉ !");
  const deposit = await new anchor.Program<Tilt>(idl, new anchor.AnchorProvider(chain.base, new anchor.Wallet(relayer), {})).methods
    .deposit(new anchor.BN(usdc(1)))
    .accountsPartial({ player: address, vault: vaultAddress(), vaultToken: vaultTokenAddress(), playerToken: token, mint: vault.mint, ledger: ledgerAddress(address) })
    .instruction();
  const mixed = await refusedToSign(deposit, transfer);
  check("… même glissé à côté d'une instruction Tilt", mixed !== undefined, mixed?.slice(0, 120) ?? "SIGNÉ !");
  const tamper = await privy.policies()
    .update(required("PRIVY_POLICY_ID"), { name: "hijacked", authorization_context: { authorization_private_keys: [required("PRIVY_AUTHORIZATION_KEY")] } })
    .then(() => undefined, (e: unknown) => (e instanceof Error ? e.message : String(e)));
  check("la clé du relais ne peut pas modifier la policy", tamper !== undefined, tamper?.slice(0, 80) ?? "MODIFIÉE !");

  await db.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications OK (utilisateur Privy de test : ${user.id})`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
