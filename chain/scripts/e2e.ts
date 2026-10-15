// End-to-end check of the Tilt program against a real Solana + MagicBlock rollup:
// USDC vault, first deposit, the four games (multi-hand blackjack with splits included; outcomes recomputed here from the drawn
// cards / numbers), deposits, withdrawals, loss checkpoints and the attack / recovery
// scenarios. Runs against the local MagicBlock stack by default (README), or devnet with
// BASE_RPC / ER_RPC / ER_WS / VALIDATOR / VRF_ER_QUEUE.
//
// Uses its own test USDC mint, so it never touches real funds. The admin is the wallet
// (ANCHOR_WALLET, must be the program's upgrade authority); the relayer is a separate key
// kept in .anchor/e2e-relayer.json.
//
// The scenario sets test limits (e.g. a 3 s round timeout) on the vault. On a vault others
// use (any non-local RPC), it only runs with --shared-vault, and the config and roles it found
// are put back at the end, on failure and on Ctrl-C.
import anchor from "@coral-xyz/anchor";
import type { IdlAccounts, IdlTypes, Program as ProgramT } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { idl, type Tilt } from "@tilt/contract";

const { BN, Program } = anchor;
type BN = InstanceType<typeof BN>;
type PlayerAccount = IdlAccounts<Tilt>["playerAccount"];
type Round = PlayerAccount["round"];
type BlackjackTable = IdlAccounts<Tilt>["blackjackTable"];
type TableHand = BlackjackTable["hands"][number];
type Config = IdlTypes<Tilt>["config"];
type RouletteBet = IdlTypes<Tilt>["rouletteBet"];
type BaccaratBet = IdlTypes<Tilt>["baccaratBet"];

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const BASE_RPC = env("BASE_RPC", "http://localhost:8899");
const ER_RPC = env("ER_RPC", "http://localhost:7799");
const ER_WS = env("ER_WS", "ws://localhost:7800");
const VRF_ER_QUEUE = new PublicKey(env("VRF_ER_QUEUE", "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT"));
const VALIDATOR = new PublicKey(env("VALIDATOR", "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"));
const POLL_MS = Number(env("POLL_MS", "25"));
const WALLET = env("ANCHOR_WALLET", `${os.homedir()}/.config/solana/id.json`);
const RELAYER_FILE = new URL("../.anchor/e2e-relayer.json", import.meta.url);
const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SHARED_VAULT_FLAG = "--shared-vault";
const LOCAL_RPC = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/;

const usdc = (x: number) => Math.round(x * 1_000_000);
const ROUND_TIMEOUT_SECS = 3;
const CONFIG: Config = {
  minBet: new BN(usdc(0.1)),
  maxBet: new BN(usdc(10)),
  maxRoundGain: new BN(usdc(2_500)),
  maxPlayerWin: new BN(usdc(3_000)),
  maxWinMultiple: new BN(20),
  onboardingFee: new BN(usdc(1.3)),
  minDeposit: new BN(usdc(1)),
  minWithdrawal: new BN(usdc(1)),
  maxWithdrawal: new BN(usdc(200)),
  playerDailyCap: new BN(usdc(1_000)),
  dailyCap: new BN(usdc(10_000)),
  roundTimeoutSecs: new BN(ROUND_TIMEOUT_SECS),
  validator: VALIDATOR,
  vrfQueue: VRF_ER_QUEUE,
  depositsPaused: false,
  betsPaused: false,
  payoutsPaused: false,
};
const SLOTS_THREE_OF_A_KIND = [250, 100, 40, 20, 12, 5, 10];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const loadKeypair = (path: string | URL) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
const admin = loadKeypair(WALLET);

const base = new Connection(BASE_RPC, "confirmed");
const er = new Connection(ER_RPC, { commitment: "confirmed", wsEndpoint: ER_WS });
const adminProvider = new anchor.AnchorProvider(base, new anchor.Wallet(admin), { commitment: "confirmed" });
const program = new Program(idl, adminProvider) as ProgramT<Tilt>;

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const vault = pda(Buffer.from("vault"));
const vaultToken = pda(Buffer.from("vault_token"));
const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], BPF_UPGRADEABLE_LOADER)[0];
const player = Keypair.generate();
const account = pda(Buffer.from("account"), player.publicKey.toBuffer());
const ledger = pda(Buffer.from("ledger"), player.publicKey.toBuffer());
const table = pda(Buffer.from("bjtable"), player.publicKey.toBuffer());
const MAX_HANDS = 6;
const MAX_SPLITS = 4;

let relayer: Keypair;
let relayerProvider: anchor.AnchorProvider;
let erProgram: ProgramT<Tilt>;
let mint: PublicKey;
let playerToken: PublicKey;

// ---------- reporting ----------

const timings: Record<string, number[]> = {};
async function time<T>(label: string, f: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await f();
  (timings[label] ??= []).push(performance.now() - start);
  return result;
}
const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name} ${detail}`);
}
async function rejects(name: string, f: () => Promise<unknown>, expected: RegExp) {
  const error = await f().then(
    () => undefined,
    (e: unknown) => {
      const logs = e && typeof e === "object" && "logs" in e && Array.isArray(e.logs) ? e.logs.join(" ") : "";
      return `${e instanceof Error ? e.message : String(e)} ${logs}`;
    },
  );
  const ok = error !== undefined && expected.test(error);
  check(name, ok, error === undefined ? "(accepté !)" : `(${error.match(expected)?.[0] ?? error.slice(0, 200)})`);
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

// ---------- rollup helpers ----------

const fetchAccount = () => erProgram.account.playerAccount.fetch(account);
const fetchTable = () => erProgram.account.blackjackTable.fetch(table);
const fetchLedger = () => program.account.ledger.fetch(ledger);
const seed = () => Array.from(randomBytes(32));
const isIdle = (round: Round) => "idle" in round.status;
const isPlayerTurn = (round: Round) => "playerTurn" in round.status;
const isAwaiting = (round: Round) => "awaitingDraw" in round.status;

/** Fire and observe: the relay only needs the resulting state, which is polled. */
async function erSend(tx: Transaction, signer = relayer, simulateFirst = false, coSigners: Keypair[] = []) {
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(signer, ...coSigners);
  if (simulateFirst) {
    const sim = await er.simulateTransaction(tx);
    if (sim.value.err) throw new Error(`${JSON.stringify(sim.value.err)} ${sim.value.logs?.join(" ")}`);
  }
  return er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
}

// Blackjack needs the player's table; the other games pass none (Anchor sends the program id).
const playAccounts = () => ({ vault, payer: relayer.publicKey, account, ledger, table: null, oracleQueue: VRF_ER_QUEUE });
const blackjackAccounts = () => ({ ...playAccounts(), table });

async function act(label: string, tx: Promise<Transaction>, accept: (a: PlayerAccount) => boolean | Promise<boolean>) {
  const transaction = await tx;
  return time(`${label} (rollup, tx → résultat)`, async () => {
    await erSend(transaction);
    return until(async () => {
      const a = await fetchAccount();
      return (await accept(a)) ? a : undefined;
    }, label);
  });
}

const feeOn = (stake: number, gross: number) => (gross > stake ? Math.floor((gross - stake) / 100) : 0);

/** Runs one round to the end; checks the balance moved by payout - stake and the payout matches `expectedGross`. */
async function round(
  label: string,
  start: () => Promise<Transaction>,
  play: (a: PlayerAccount) => Promise<PlayerAccount>,
  expectedGross: (r: Round) => number | Promise<number>,
) {
  const before = await fetchAccount();
  const credited = (await fetchLedger()).deposited.sub(before.credited);
  let a = await act(label, start(), (x) => x.rounds > before.rounds || isPlayerTurn(x.round));
  a = await play(a);
  const stake = a.round.stake.toNumber();
  const gross = await expectedGross(a.round);
  const expectedPayout = gross - feeOn(stake, gross);
  const balanceOk = a.balance.eq(before.balance.add(credited).sub(a.round.stake).add(a.round.payout));
  if (!balanceOk || !a.round.payout.eq(new BN(expectedPayout))) {
    throw new Error(`${label}: payout ${a.round.payout} (attendu ${expectedPayout}), solde ${a.balance}`);
  }
  return a;
}

// Reference implementations of the game rules, independent of the program.
const total = (cards: number[]) => {
  const hard = cards.reduce((s, c) => s + Math.min(c, 10), 0);
  return cards.includes(1) && hard + 10 <= 21 ? hard + 10 : hard;
};

/** One hand against the dealer, for its base bet (twice the bet once doubled). */
function handGross(hand: TableHand, dealer: number[], bet: number) {
  const p = hand.cards.slice(0, hand.nCards);
  const stake = hand.doubled ? bet * 2 : bet;
  const [pt, dt] = [total(p), total(dealer)];
  // A split hand's 21 is not a blackjack.
  const pbj = p.length === 2 && pt === 21 && !hand.doubled && !hand.split;
  const dbj = dealer.length === 2 && dt === 21;
  if (pt > 21) return 0;
  if (pbj && dbj) return stake;
  if (pbj) return Math.floor((stake * 5) / 2);
  if (dbj) return 0;
  if (dt > 21 || pt > dt) return stake * 2;
  return pt === dt ? stake : 0;
}

/** Every hand settled against the same dealer; also checks the round staked each hand's bet. */
function blackjackGross(t: BlackjackTable, roundStake: number) {
  const bet = t.bet.toNumber();
  const hands = t.hands.slice(0, t.nHands);
  const dealer = t.dealer.slice(0, t.nDealer);
  const stake = hands.reduce((s, h) => s + (h.doubled ? bet * 2 : bet), 0);
  if (stake !== roundStake) throw new Error(`blackjack: mise de la manche ${roundStake}, mains ${stake}`);
  return hands.reduce((s, h) => s + handGross(h, dealer, bet), 0);
}

let standsWithoutDraw = 0;

/** The active hand may be split: same-value first two cards (ace only with ace), never split aces again, a split left. */
function canSplit(t: BlackjackTable, hand: TableHand) {
  const [first, second] = hand.cards.map((c: number) => Math.min(c, 10));
  const splitAces = hand.split && first === 1;
  return t.splits < MAX_SPLITS && hand.nCards === 2 && !hand.doubled && !splitAces && first === second;
}

/** Plays `hands` hands of `bet` left to right: with `extraBets`, split every pair and double on 10/11; hit below 17, else stand. */
async function playBlackjack(bet: number, hands: number, extraBets: boolean) {
  const a = await round(
    "blackjack",
    () => erProgram.methods.blackjackBet(new BN(bet), hands, seed()).accountsPartial(blackjackAccounts()).transaction(),
    async (a) => {
      while (isPlayerTurn(a.round)) {
        const t = await fetchTable();
        const hand = t.hands[t.active];
        const cards = hand.cards.slice(0, hand.nCards);
        const value = total(cards);
        // Done once the draw (if any) is played: a new request id, a settled round, or the next hand.
        const prev = a;
        const moved = async (x: PlayerAccount) =>
          !isAwaiting(x.round) &&
          (x.round.requestId.gt(prev.round.requestId) || x.rounds > prev.rounds || (await fetchTable()).active !== t.active);
        if (extraBets && canSplit(t, hand)) {
          a = await act("split", erProgram.methods.blackjackSplit(seed()).accountsPartial(blackjackAccounts()).transaction(), moved);
        } else if (extraBets && cards.length === 2 && (value === 10 || value === 11)) {
          a = await act("double", erProgram.methods.blackjackDouble(seed()).accountsPartial(blackjackAccounts()).transaction(), moved);
        } else if (value < 17) {
          a = await act("carte", erProgram.methods.blackjackHit(seed()).accountsPartial(blackjackAccounts()).transaction(), moved);
        } else {
          a = await act("stand", erProgram.methods.blackjackStand(seed()).accountsPartial(blackjackAccounts()).transaction(), moved);
          if (a.round.requestId.eq(prev.round.requestId)) standsWithoutDraw++;
        }
      }
      return a;
    },
    async (r) => blackjackGross(await fetchTable(), r.stake.toNumber()),
  );
  return { account: a, table: await fetchTable() };
}

const withdrawTx = (amount: number, signer = relayer) =>
  erProgram.methods.withdraw(new BN(amount))
    .accountsPartial({ vault, payer: signer.publicKey, account, ledger, vaultToken, playerToken, mint, tokenProgram: TOKEN_PROGRAM_ID })
    .transaction();

const playerUsdc = async () => (await getAccount(base, playerToken)).amount;

async function withdraw(amount: number, expectPaid: boolean) {
  const tx = await withdrawTx(amount);
  const before = await playerUsdc();
  const target = (await fetchAccount()).withdrawn.add(new BN(amount));
  if (expectPaid) {
    await time("retrait : demande → USDC reçus sur Solana", async () => {
      await erSend(tx, relayer, true);
      await until(async () => ((await playerUsdc()) - before === BigInt(amount) ? true : undefined), "withdrawal paid");
    });
    return true;
  }
  await erSend(tx, relayer, true);
  // Wait for the commit (and its action) to land on Solana, then check nothing was paid.
  await until(async () => {
    const info = await base.getAccountInfo(account);
    const committed = info && program.coder.accounts.decode<PlayerAccount>("playerAccount", info.data);
    return committed && committed.withdrawn.eq(target) ? true : undefined;
  }, "commit on Solana");
  await sleep(1_500);
  return (await playerUsdc()) !== before;
}

async function release() {
  const before = await playerUsdc();
  await program.methods.releaseWithdrawals()
    .accountsPartial({ admin: admin.publicKey, vault, account, vaultToken, playerToken, mint, ledger })
    .rpc();
  return Number((await playerUsdc()) - before);
}

/** Updates the config on Solana and waits until the rollup's copy of the vault shows it. */
async function applyConfig(config: Config) {
  await program.methods.setConfig(config).accountsPartial({ admin: admin.publicKey, vault }).rpc();
  const expected = JSON.stringify((await program.account.vault.fetch(vault)).config);
  await until(async () => {
    if (!erProgram) return true;
    const copy = await erProgram.account.vault.fetch(vault);
    return JSON.stringify(copy.config) === expected ? true : undefined;
  }, "config in rollup");
}

const setConfig = (overrides: Partial<Config> = {}) => applyConfig({ ...CONFIG, ...overrides });

/** What the vault looked like before the scenario, to put back once it is over. */
let original: { config: Config; relayer: PublicKey } | undefined;

async function restoreVault() {
  if (!original) return;
  const { config, relayer: originalRelayer } = original;
  original = undefined;
  await applyConfig(config);
  const current = await program.account.vault.fetch(vault);
  if (!current.relayer.equals(originalRelayer)) {
    await program.methods.setRoles(current.admin, originalRelayer).accountsPartial({ admin: admin.publicKey, vault }).rpc();
  }
  console.log(`Config et rôles d'origine du coffre restaurés (round_timeout_secs = ${config.roundTimeoutSecs}).`);
}

async function fundSol(to: PublicKey, sol: number) {
  if ((await base.getBalance(to)) >= sol * LAMPORTS_PER_SOL) return;
  await adminProvider.sendAndConfirm(new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) })));
}

// ---------- scenario ----------

async function setUpHouse() {
  fs.mkdirSync(new URL("../.anchor/", import.meta.url), { recursive: true });
  if (!fs.existsSync(RELAYER_FILE)) fs.writeFileSync(RELAYER_FILE, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  relayer = loadKeypair(RELAYER_FILE);
  relayerProvider = new anchor.AnchorProvider(base, new anchor.Wallet(relayer), { commitment: "confirmed" });
  erProgram = new Program(idl, new anchor.AnchorProvider(er, new anchor.Wallet(relayer), { commitment: "confirmed" })) as ProgramT<Tilt>;
  await fundSol(relayer.publicKey, 0.3);

  const existing = (await base.getAccountInfo(vault)) ? await program.account.vault.fetch(vault) : undefined;
  if (existing) {
    mint = existing.mint;
    original = { config: existing.config, relayer: existing.relayer };
    await setConfig();
    if (!existing.relayer.equals(relayer.publicKey)) {
      await program.methods.setRoles(admin.publicKey, relayer.publicKey).accountsPartial({ admin: admin.publicKey, vault }).rpc();
    }
  } else {
    mint = await createMint(base, admin, admin.publicKey, null, 6);
    const treasury = await createAssociatedTokenAccountIdempotent(base, admin, mint, admin.publicKey);
    const intruder = Keypair.generate();
    await fundSol(intruder.publicKey, 0.05);
    await rejects("initialisation par une autre clé que l'autorité de mise à jour refusée", () =>
      program.methods.initialize(intruder.publicKey, CONFIG)
        .accountsPartial({ admin: intruder.publicKey, programData, vault, vaultToken, mint, treasury })
        .signers([intruder]).rpc(), /Unauthorized|2003|ConstraintRaw/);
    await program.methods.initialize(relayer.publicKey, CONFIG)
      .accountsPartial({ admin: admin.publicKey, programData, vault, vaultToken, mint, treasury }).rpc();
  }
  const houseToken = await createAssociatedTokenAccountIdempotent(base, admin, mint, admin.publicKey);
  await mintTo(base, admin, mint, houseToken, admin, usdc(10_000));
  await program.methods.fundVault(new BN(usdc(10_000)))
    .accountsPartial({ funder: admin.publicKey, vault, vaultToken, source: houseToken, mint }).rpc();
  await relayerProvider.sendAndConfirm(new Transaction().add(
    createTopUpEscrowInstruction(escrowPdaFromEscrowAuthority(relayer.publicKey), relayer.publicKey, relayer.publicKey, 0.005 * LAMPORTS_PER_SOL)));
}

async function run(): Promise<number> {
  if (!LOCAL_RPC.test(BASE_RPC) && !process.argv.includes(SHARED_VAULT_FLAG)) {
    throw new Error(`${BASE_RPC} is not a local stack: this scenario rewrites the vault's config for its duration. Pass ${SHARED_VAULT_FLAG} to run it anyway (the config is restored afterwards).`);
  }
  console.log(`base=${BASE_RPC} rollup=${ER_RPC} programme=${program.programId.toBase58()}`);
  await setUpHouse();
  const treasury = (await program.account.vault.fetch(vault)).treasury;

  // Player: USDC only, no SOL at all.
  playerToken = await createAssociatedTokenAccountIdempotent(base, admin, mint, player.publicKey);
  await mintTo(base, admin, mint, playerToken, admin, usdc(500));

  console.log("\n--- 1. Ouverture : pas de dépôt, pas de compte dans le rollup ---");
  const delegate = () => program.methods.delegateAccount()
    .accountsPartial({ vault, payer: relayer.publicKey, player: player.publicKey, ledger, account });
  await rejects("entrée dans le rollup sans dépôt refusée", () => delegate().signers([relayer]).rpc(), /AccountNotInitialized|ledger/);
  const open = (amount: number, maxWin = usdc(3_000)) => program.methods.openAccount(new BN(amount), new BN(maxWin))
    .accountsPartial({ vault, payer: relayer.publicKey, player: player.publicKey, vaultToken, treasury, playerToken, mint, account, ledger });
  await rejects("premier dépôt ≤ frais d'ouverture refusé", () => open(usdc(1.3)).signers([relayer, player]).rpc(), /DepositTooSmall/);
  await rejects("plafond de gains disproportionné par rapport au dépôt refusé", () =>
    open(usdc(10), usdc(3_000)).signers([relayer, player]).rpc(), /MaxWinTooHigh/);

  const treasuryBefore = (await getAccount(base, treasury)).amount;
  // The vault may already hold other players (earlier runs): compare this player's share only.
  const reservedBefore = (await program.account.vault.fetch(vault)).reserved;
  const tableAccounts = { vault, payer: relayer.publicKey, player: player.publicKey, ledger, table };
  await time("premier dépôt + entrée dans le rollup, compte et table (Solana)", async () =>
    relayerProvider.sendAndConfirm(new Transaction().add(
      await open(usdc(300)).instruction(),
      await delegate().instruction(),
      await program.methods.openTable().accountsPartial(tableAccounts).instruction(),
      await program.methods.delegateTable().accountsPartial(tableAccounts).instruction(),
    ), [player]));
  check("frais d'ouverture (1,30 USDC) versés à la trésorerie Tilt", (await getAccount(base, treasury)).amount - treasuryBefore === BigInt(usdc(1.3)));
  check("298,70 USDC crédités au joueur", (await fetchLedger()).deposited.eq(new BN(usdc(298.7))));
  check("le joueur n'a besoin d'aucun SOL", (await base.getBalance(player.publicKey)) === 0);
  await time("compte visible dans le rollup", () => until(() => fetchAccount(), "account in rollup"));
  await time("table visible dans le rollup", () => until(() => fetchTable(), "table in rollup"));

  const rejectsInRollup = (name: string, tx: () => Promise<Transaction>, expected: RegExp, signer?: Keypair) =>
    rejects(name, async () => erSend(await tx(), signer ?? relayer, true), expected);

  console.log("\n--- 2. Blackjack multi-mains et splits (gains recalculés depuis les cartes) ---");
  await rejectsInRollup("blackjack sans table refusé", () =>
    erProgram.methods.blackjackBet(new BN(usdc(1)), 1, seed()).accountsPartial(playAccounts()).transaction(), /MissingTable|6020/);
  await rejectsInRollup("plus de 6 mains refusé", () =>
    erProgram.methods.blackjackBet(new BN(usdc(1)), MAX_HANDS + 1, seed()).accountsPartial(blackjackAccounts()).transaction(), /InvalidBet|6010/);
  await rejectsInRollup("mise par main au-dessus du maximum refusée", () =>
    erProgram.methods.blackjackBet(new BN(usdc(11)), 2, seed()).accountsPartial(blackjackAccounts()).transaction(), /AmountOutOfRange|6000/);
  let doubles = 0;
  let multiHand = 0;
  let splits = 0;
  for (let i = 0; i < 60 && (i < 12 || doubles === 0 || splits === 0 || standsWithoutDraw === 0); i++) {
    const hands = 1 + (i % MAX_HANDS);
    const { table: t } = await playBlackjack(usdc(2), hands, true);
    if (t.nHands !== hands + t.splits) throw new Error(`blackjack: ${t.nHands} mains jouées, ${hands} demandées + ${t.splits} splits`);
    const played = t.hands.slice(0, t.nHands);
    if (t.splits > 0 && played.filter((h) => h.split).length < t.splits + 1) throw new Error("blackjack: mains issues d'un split non marquées");
    if (hands > 1) multiHand++;
    if (played.some((h) => h.doubled)) doubles++;
    if (t.splits > 0) splits++;
  }
  check("mains de blackjack payées selon les cartes (3:2, push, double, split, croupier), une à six mains", multiHand > 0, "(chaque main vérifiée)");
  check("au moins un double joué et réglé sur une mise de main en plus", doubles > 0, `(${doubles} manches avec double)`);
  check("au moins un split joué, une mise de main en plus par split", splits > 0, `(${splits} manches avec split)`);
  check("stand avec une main suivante : sans tirage", standsWithoutDraw > 0, `(${standsWithoutDraw})`);

  console.log("\n--- 3. Roulette ---");
  const roulette = (bet: RouletteBet, wins: (n: number) => boolean, multiple: number) =>
    round("roulette", () => erProgram.methods.rouletteSpin(new BN(usdc(2)), bet, seed()).accountsPartial(playAccounts()).transaction(),
      async (x) => x, (r) => (wins(r.roulette!.number) ? usdc(2) * multiple : 0));
  for (let i = 0; i < 4; i++) {
    await roulette({ straight: { 0: 17 } }, (n) => n === 17, 36);
    await roulette({ red: {} }, (n) => RED.has(n), 2);
    await roulette({ dozen: { 0: 2 } }, (n) => n >= 13 && n <= 24, 3);
  }
  check("12 tours de roulette payés selon le numéro tiré", true, "(chaque tour vérifié)");
  await rejectsInRollup("pari invalide refusé (numéro 37)", () =>
    erProgram.methods.rouletteSpin(new BN(usdc(1)), { straight: { 0: 37 } }, seed()).accountsPartial(playAccounts()).transaction(), /InvalidBet|6010/);
  await rejectsInRollup("plein à 10 USDC refusé (gain possible > plafond par manche)", async () => {
    await setConfig({ maxRoundGain: new BN(usdc(300)) });
    return erProgram.methods.rouletteSpin(new BN(usdc(10)), { straight: { 0: 1 } }, seed()).accountsPartial(playAccounts()).transaction();
  }, /RoundGainTooHigh|6009/);
  await setConfig();

  console.log("\n--- 4. Baccarat ---");
  const points = (c: number[]) => c.reduce((s, x) => s + (x >= 10 ? 0 : x), 0) % 10;
  const baccaratBets: [BaccaratBet, "player" | "banker" | "tie"][] = [[{ player: {} }, "player"], [{ banker: {} }, "banker"], [{ tie: {} }, "tie"]];
  for (const [bet, name] of baccaratBets) {
    for (let i = 0; i < 3; i++) {
      await round("baccarat", () => erProgram.methods.baccaratDeal(new BN(usdc(2)), bet, seed()).accountsPartial(playAccounts()).transaction(), async (x) => x, (r) => {
        const [p, b] = [points(r.baccarat!.player), points(r.baccarat!.banker)];
        const stake = usdc(2);
        if (name === "tie") return p === b ? stake * 9 : 0;
        if (p === b) return stake;
        if (name === "player") return p > b ? stake * 2 : 0;
        return b > p ? stake + Math.floor((stake * 95) / 100) : 0;
      });
    }
  }
  check("9 coups de baccarat (joueur, banque, égalité) payés selon les cartes", true, "(chaque coup vérifié)");

  console.log("\n--- 5. Slots ---");
  for (let i = 0; i < 10; i++) {
    await round("slots", () => erProgram.methods.slotsSpin(new BN(usdc(1)), seed()).accountsPartial(playAccounts()).transaction(), async (x) => x, (r) => {
      const [r1, r2, r3] = r.slots.reels;
      const multiple = r1 === r2 && r2 === r3 ? SLOTS_THREE_OF_A_KIND[r1] : [r1, r2, r3].filter((s) => s === 6).length === 2 ? 4 : 0;
      return usdc(1) * multiple;
    });
  }
  check("10 tours de slots payés selon la table de gains", true, "(chaque tour vérifié)");
  await rejectsInRollup("mise au-dessus du maximum refusée", () =>
    erProgram.methods.slotsSpin(new BN(usdc(11)), seed()).accountsPartial(playAccounts()).transaction(), /AmountOutOfRange|6000/);
  await rejectsInRollup("mise sous le minimum refusée", () =>
    erProgram.methods.slotsSpin(new BN(usdc(0.05)), seed()).accountsPartial(playAccounts()).transaction(), /AmountOutOfRange|6000/);
  const outsider = Keypair.generate();
  await rejects("une autre clé que le relais ne peut pas jouer pour le joueur", async () => {
    // The relay pays the fee, so only the program's relayer check can refuse it.
    const tx = await erProgram.methods.slotsSpin(new BN(usdc(1)), seed()).accountsPartial({ ...playAccounts(), payer: outsider.publicKey }).transaction();
    return erSend(tx, relayer, true, [outsider]);
  }, /Unauthorized|6006/);
  await setConfig({ betsPaused: true });
  await rejectsInRollup("mises refusées pendant la pause des mises", () =>
    erProgram.methods.slotsSpin(new BN(usdc(1)), seed()).accountsPartial(playAccounts()).transaction(), /Paused|6013/);
  await setConfig();

  console.log("\n--- 6. Dépôt pendant que le compte est dans le rollup ---");
  await setConfig({ depositsPaused: true });
  await rejects("dépôts refusés pendant la pause des dépôts", () =>
    program.methods.deposit(new BN(usdc(50)))
      .accountsPartial({ player: player.publicKey, vault, vaultToken, playerToken, mint, ledger }).signers([player]).rpc(), /Paused|6013/);
  await setConfig();
  await program.methods.deposit(new BN(usdc(50)))
    .accountsPartial({ player: player.publicKey, vault, vaultToken, playerToken, mint, ledger }).signers([player]).rpc();
  await time("dépôt visible depuis le rollup", () => until(async () => ((await erProgram.account.ledger.fetch(ledger)).deposited.eq(new BN(usdc(348.7))) ? true : undefined), "deposit in rollup"));
  await playBlackjack(usdc(1), 1, false);
  check("dépôt crédité à la manche suivante", (await fetchAccount()).credited.eq(new BN(usdc(348.7))));

  console.log("\n--- 7. Manche abandonnée ---");
  let a = await fetchAccount();
  for (let i = 0; i < 10 && !isPlayerTurn(a.round); i++) {
    a = await act("mise blackjack", erProgram.methods.blackjackBet(new BN(usdc(1)), 1, seed()).accountsPartial(blackjackAccounts()).transaction(), (x) => !isAwaiting(x.round));
  }
  check("main ouverte obtenue", isPlayerTurn(a.round));
  check("retrait pendant une main ouverte payé", await withdraw(usdc(20), true));
  await rejectsInRollup("nouvelle manche refusée tant que la main est ouverte", () =>
    erProgram.methods.slotsSpin(new BN(usdc(1)), seed()).accountsPartial(playAccounts()).transaction(), /RoundInProgress|6004/);
  await rejectsInRollup("expiration refusée avant le délai", () =>
    erProgram.methods.expireRound(seed()).accountsPartial(blackjackAccounts()).transaction(), /RoundNotExpired|6011/);
  await sleep((ROUND_TIMEOUT_SECS + 1) * 1_000);
  await rejectsInRollup("main en attente du joueur jamais clôturée à sa place, même après le délai", () =>
    erProgram.methods.expireRound(seed()).accountsPartial(blackjackAccounts()).transaction(), /WrongState|6005/);
  const roundsBefore = a.rounds;
  a = await act("stand du joueur après le délai", erProgram.methods.blackjackStand(seed()).accountsPartial(blackjackAccounts()).transaction(), (x) => x.rounds === roundsBefore + 1);
  check("le joueur reprend sa main quand il veut", isIdle(a.round) && (await fetchTable()).nDealer >= 2);
  check("chaque tirage porte un identifiant de requête qui ne fait que croître", a.round.requestId.gtn(0));

  console.log("\n--- 8. Retraits vérifiés, plafonnés, mis en attente ---");
  await rejectsInRollup("retrait supérieur au solde refusé", async () => withdrawTx((await fetchAccount()).balance.toNumber() + 1), /InsufficientBalance|6007/);
  await rejectsInRollup("retrait sous le minimum refusé", () => withdrawTx(usdc(0.5)), /WithdrawalTooSmall|6015/);
  await setConfig({ maxWithdrawal: new BN(usdc(20)) });
  check("retrait au-dessus du plafond par retrait (25 > 20) mis en attente", !(await withdraw(usdc(25), false)));
  await rejects("libération par quelqu'un d'autre que l'admin refusée", () =>
    program.methods.releaseWithdrawals()
      .accountsPartial({ admin: player.publicKey, vault, account, vaultToken, playerToken, mint, ledger })
      .signers([player]).rpc(), /Unauthorized|ConstraintHasOne|2001/);
  check("libération après revue par l'admin", (await release()) === usdc(25));
  await setConfig({ playerDailyCap: new BN(usdc(25)), maxWithdrawal: new BN(usdc(25)) }); // 20 already paid automatically today
  check("plafond journalier par joueur : retrait mis en attente", !(await withdraw(usdc(10), false)));
  check("libéré par l'admin", (await release()) === usdc(10));
  // Built by hand so the program, not the client, has to reject the missing escrow signature.
  const payIx = await program.methods.payWithdrawals()
    .accountsPartial({ vault, account, vaultToken, playerToken, mint, ledger, thisProgram: program.programId,
      escrowAuth: relayer.publicKey, escrow: escrowPdaFromEscrowAuthority(relayer.publicKey) })
    .instruction();
  const unsigned = new TransactionInstruction({ programId: payIx.programId, data: payIx.data, keys: payIx.keys.map((k) => ({ ...k, isSigner: false })) });
  await rejects("paiement direct sans passer par le rollup refusé par le programme", async () => {
    const tx = new Transaction().add(unsigned);
    tx.feePayer = admin.publicKey;
    tx.recentBlockhash = (await base.getLatestBlockhash()).blockhash;
    tx.sign(admin);
    const signature = await base.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await base.confirmTransaction(signature, "confirmed");
    const landed = await base.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (landed?.meta?.err) throw new Error(`${JSON.stringify(landed.meta.err)} ${landed.meta.logMessages?.join(" ")}`);
  }, /ConstraintSigner|2002/);
  await setConfig({ payoutsPaused: true });
  check("retrait mis en attente pendant la pause des paiements", !(await withdraw(usdc(5), false)));
  await setConfig();
  check("libéré après la pause", (await release()) === usdc(5));

  console.log("\n--- 8b. Plafond de gains glissant ---");
  const raise = (amount: number, signer = relayer) => program.methods.raiseWinCap(new BN(amount))
    .accountsPartial({ relayer: signer.publicKey, vault, vaultToken, ledger }).signers([signer]);
  await rejects("relèvement du plafond par un autre que le relais refusé", () => raise(usdc(1), player).rpc(), /Unauthorized|6006/);
  await rejects("relèvement au-delà du gain max d'une manche refusé", () => raise(usdc(2_500) + 1).rpc(), /AmountOutOfRange|6000/);
  await setConfig({ betsPaused: true });
  await rejects("relèvement refusé pendant la pause des mises", () => raise(usdc(1)).rpc(), /Paused|6013/);
  await setConfig();
  const capBefore = (await fetchLedger()).maxWin;
  const reservedBeforeRaise = (await program.account.vault.fetch(vault)).reserved;
  await raise(usdc(100)).rpc();
  const raisedBy = (await fetchLedger()).maxWin.sub(capBefore);
  const reservedBy = (await program.account.vault.fetch(vault)).reserved.sub(reservedBeforeRaise);
  check("plafond relevé et réservé du même montant", raisedBy.eq(new BN(usdc(100))) && reservedBy.eq(raisedBy), `(+${raisedBy}, réservé +${reservedBy})`);
  await until(async () => ((await erProgram.account.ledger.fetch(ledger)).maxWin.gt(capBefore) ? true : undefined), "raised cap in rollup");
  await playBlackjack(usdc(1), 1, false);
  check("le rollup prend le plafond relevé au coup suivant", (await fetchAccount()).maxWin.eq(capBefore.add(raisedBy)));

  console.log("\n--- 9. Pertes rendues à la maison (checkpoint) ---");
  const netWinOf = (x: PlayerAccount) => x.balance.add(x.withdrawn).sub(x.credited.sub(x.forfeited));
  if (!netWinOf(await fetchAccount()).isNeg()) {
    await rejectsInRollup("checkpoint refusé tant que le joueur n'a pas perdu", () =>
      erProgram.methods.checkpoint().accountsPartial({ vault, payer: relayer.publicKey, account, ledger }).transaction(), /NothingToCheckpoint|6016/);
  }
  // Tie bets lose about 90% of the time: play them until the player is down overall.
  for (let i = 0; i < 60; i++) {
    const before = await fetchAccount();
    if (netWinOf(before).isNeg()) break;
    await act("baccarat égalité", erProgram.methods.baccaratDeal(new BN(usdc(10)), { tie: {} }, seed()).accountsPartial(playAccounts()).transaction(), (x) => x.rounds > before.rounds);
  }
  const netWin = netWinOf(await fetchAccount());
  check("joueur en perte avant le checkpoint", netWin.isNeg(), `(${netWin})`);
  const reservedPre = (await program.account.vault.fetch(vault)).reserved;
  const forfeitedPre = (await fetchLedger()).forfeited;
  await erSend(await erProgram.methods.checkpoint().accountsPartial({ vault, payer: relayer.publicKey, account, ledger }).transaction(), relayer, true);
  const forfeited = await until(async () => {
    const l = await fetchLedger();
    return l.forfeited.gt(forfeitedPre) ? l.forfeited : undefined;
  }, "checkpoint on Solana");
  const released = reservedPre.sub((await program.account.vault.fetch(vault)).reserved);
  check("pertes du joueur libérées de la réserve", released.eq(netWin.neg()) && forfeited.sub(forfeitedPre).eq(netWin.neg()), `(${released} libérés)`);
  // The rollup may still read the old ledger for a moment, and then rightly lets the relayer
  // push the same checkpoint again (Solana releases nothing twice): wait for its copy first.
  await until(async () => ((await erProgram.account.ledger.fetch(ledger)).forfeited.eq(forfeited) ? true : undefined), "ledger copy in rollup");
  await rejectsInRollup("deuxième checkpoint sans nouvelle perte refusé", () =>
    erProgram.methods.checkpoint().accountsPartial({ vault, payer: relayer.publicKey, account, ledger }).transaction(), /NothingToCheckpoint|6016/);
  const v = await program.account.vault.fetch(vault);
  const free = BigInt((await getAccount(base, vaultToken)).amount) - BigInt(v.reserved.toString());
  await rejects("l'admin ne peut pas sortir plus que l'argent non réservé", () =>
    program.methods.withdrawHouse(new BN((free + 1n).toString()))
      .accountsPartial({ admin: admin.publicKey, vault, vaultToken, treasury, mint }).rpc(), /VaultTooSmall|6003/);

  console.log("\n--- 10. Solde final ---");
  const rest = (await fetchAccount()).balance.toNumber();
  await setConfig({ maxWithdrawal: new BN(usdc(1_000)) });
  check("retrait du solde restant", rest === 0 || (await withdraw(rest, true)));
  const end = await fetchAccount();
  const l = await fetchLedger();
  const vEnd = await program.account.vault.fetch(vault);
  check("comptes justes : tout ce qui a été retiré a été payé", l.withdrawnPaid.eq(end.withdrawn) && end.balance.isZero());
  check("le joueur a reçu exactement ses retraits", (await playerUsdc()) === BigInt(usdc(500 - 300 - 50) + end.withdrawn.toNumber()));
  const reservedForPlayer = vEnd.reserved.sub(reservedBefore);
  check("réserve de la trésorerie cohérente", reservedForPlayer.eq(l.deposited.add(l.maxWin).sub(l.withdrawnPaid).sub(l.forfeited)),
    `(réservé pour ce joueur ${reservedForPlayer}, frais Tilt ${end.fees}, manches ${end.rounds})`);
  await setConfig();

  console.log("\n--- 11. Gains promo (pool sponsor) ---");
  const promo = pda(Buffer.from("promo"));
  const promoToken = pda(Buffer.from("promo_token"));
  const PROMO = { maxPayout: new BN(usdc(20)), dailyCap: new BN(usdc(1_000)), paused: false };
  if (!(await base.getAccountInfo(promo))) {
    await program.methods.initPromo(PROMO).accountsPartial({ admin: admin.publicKey, vault, promo, promoToken, mint }).rpc();
  }
  await program.methods.setPromo(PROMO).accountsPartial({ admin: admin.publicKey, vault, promo }).rpc();
  const sponsorToken = await createAssociatedTokenAccountIdempotent(base, admin, mint, admin.publicKey);
  await mintTo(base, admin, mint, sponsorToken, admin, usdc(100));
  await program.methods.fundPromo(new BN(usdc(100))).accountsPartial({ funder: admin.publicKey, vault, promo, promoToken, source: sponsorToken, mint }).rpc();
  const payPromo = (payoutId: Buffer, amount: number, signer = relayer) =>
    new Program(idl, new anchor.AnchorProvider(base, new anchor.Wallet(signer), { commitment: "confirmed" })).methods
      .payPromo(Array.from(payoutId), new BN(amount))
      .accountsPartial({ relayer: signer.publicKey, vault, promo, promoToken, payout: pda(Buffer.from("payout"), payoutId), playerToken, mint })
      .rpc();
  const winnings = await playerUsdc();
  const payoutId = randomBytes(16);
  await payPromo(payoutId, usdc(15));
  check("gain promo versé dans le wallet du joueur", (await playerUsdc()) - winnings === BigInt(usdc(15)));
  await rejects("même gain promo payé deux fois refusé", () => payPromo(payoutId, usdc(15)), /already in use|0x0/);
  await rejects("gain promo au-delà du plafond par gain refusé", () => payPromo(randomBytes(16), usdc(21)), /PromoCapReached|6019/);
  const stranger = Keypair.generate();
  await fundSol(stranger.publicKey, 0.05);
  await rejects("gain promo payé par une autre clé que le relais refusé", () => payPromo(randomBytes(16), usdc(1), stranger), /Unauthorized|6006/);
  await program.methods.setPromo({ ...PROMO, paused: true }).accountsPartial({ admin: admin.publicKey, vault, promo }).rpc();
  await rejects("pool promo en pause : rien n'est versé", () => payPromo(randomBytes(16), usdc(1)), /Paused|6013/);
  await program.methods.setPromo(PROMO).accountsPartial({ admin: admin.publicKey, vault, promo }).rpc();
  const treasuryBeforePromo = (await getAccount(base, treasury)).amount;
  const left = (await getAccount(base, promoToken)).amount;
  await program.methods.withdrawPromo(new BN(left.toString())).accountsPartial({ admin: admin.publicKey, vault, promo, promoToken, treasury, mint }).rpc();
  check("reste du pool rendu à la trésorerie par l'admin", (await getAccount(base, treasury)).amount - treasuryBeforePromo === left && (await getAccount(base, promoToken)).amount === 0n);

  console.log("\n--- Latences ---");
  for (const [label, values] of Object.entries(timings)) {
    const s = [...values].sort((x, y) => x - y);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(0);
    console.log(`${label}: n=${s.length} médiane=${q(0.5)} ms p90=${q(0.9)} ms`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications OK`);
  return failed ? 1 : 0;
}

async function main() {
  // Interrupted (Ctrl-C, kill, closed terminal) or piped into something that stopped reading
  // (e.g. `| head`): still put the shared vault back before exiting.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      void restoreVault().finally(() => process.exit(130));
    });
  }
  for (const stream of [process.stdout, process.stderr]) stream.on("error", () => undefined);
  let code = 1;
  try {
    code = await run();
  } catch (e) {
    console.error(e);
  } finally {
    await restoreVault().catch((e: unknown) => {
      console.error("Could not restore the vault's original config:", e);
      code = 1;
    });
  }
  process.exit(code);
}

main();
