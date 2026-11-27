// Turns intents into Tilt program transactions, on Solana or in the rollup, signed and paid
// by the relayer. The program stays the arbiter: everything is re-checked on-chain.
import anchor from "@coral-xyz/anchor";
import type { IdlAccounts, IdlTypes, Program as ProgramT } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  type Action,
  type ErrorCode,
  type FlipSide,
  hiloBoardAddress,
  type HiloGuess,
  idl,
  ledgerAddress,
  minesBoardAddress,
  playerAccountAddress,
  PROGRAM_ID,
  promoAddress,
  promoPayoutAddress,
  promoTokenAddress,
  quickTableAddress,
  riskPoolAddress,
  type RouletteBet,
  rouletteTableAddress,
  tableAddress,
  type Tilt,
  towerBoardAddress,
  type TowerDifficulty,
  vaultAddress,
  vaultTokenAddress,
  type WheelRisk,
} from "@tilt/contract";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { logAlert } from "./monitor";
import type { PlayerWallet, PlayerWallets } from "./players";

const { BN, Program } = anchor;
const { bs58 } = anchor.utils.bytes;
export type PlayerAccount = IdlAccounts<Tilt>["playerAccount"];
export type Vault = IdlAccounts<Tilt>["vault"];
export type RiskPool = IdlAccounts<Tilt>["riskPool"];
export type Ledger = IdlAccounts<Tilt>["ledger"];
type ProgramRouletteBet = IdlTypes<Tilt>["rouletteBet"];
type ProgramBaccaratBet = IdlTypes<Tilt>["baccaratBet"];
type RollupAction = Exclude<Action, { type: "open_account" | "deposit" }>;

const isBlackjack = (action: RollupAction) => action.type.startsWith("blackjack_");

/** Per-player game accounts the rollup must hold before that game's first move: opened and
 *  delegated on Solana by the relayer, never closed. */
type GameAccount = "table" | "quick" | "roulette" | "mines" | "hilo" | "tower";
const GAME_ACCOUNTS: Record<GameAccount, { label: string; address: (player: PublicKey) => PublicKey }> = {
  table: { label: "blackjack table", address: tableAddress },
  quick: { label: "one-draw table", address: quickTableAddress },
  roulette: { label: "roulette table", address: rouletteTableAddress },
  mines: { label: "mines board", address: minesBoardAddress },
  hilo: { label: "hilo board", address: hiloBoardAddress },
  tower: { label: "tower board", address: towerBoardAddress },
};

/** The account each game plays on, by game name (the program's `Game` variant, and the prefix of
 *  its actions). Baccarat, slots and single-bet roulette spins play on the player account alone;
 *  multi-chip roulette spins on the roulette table (see `play` and `expireRound`). */
const GAME_ACCOUNT_OF: Partial<Record<string, GameAccount>> = {
  blackjack: "table",
  dice: "quick",
  limbo: "quick",
  flip: "quick",
  keno: "quick",
  wheel: "quick",
  mines: "mines",
  hilo: "hilo",
  tower: "tower",
};

const FLIP_SIDE: Record<FlipSide, IdlTypes<Tilt>["coinSide"]> = { heads: { heads: {} }, tails: { tails: {} } };
const WHEEL_RISK: Record<WheelRisk, IdlTypes<Tilt>["wheelRisk"]> = { low: { low: {} }, medium: { medium: {} }, high: { high: {} } };
const HILO_MOVE: Record<HiloGuess, IdlTypes<Tilt>["hiloMove"]> = { higher: { higher: {} }, lower: { lower: {} }, skip: { skip: {} } };
const TOWER_DIFFICULTY: Record<TowerDifficulty, IdlTypes<Tilt>["towerDifficulty"]> = {
  easy: { easy: {} },
  medium: { medium: {} },
  hard: { hard: {} },
  expert: { expert: {} },
  master: { master: {} },
};

/** A refusal the API can show to the player, e.g. the program's "InsufficientBalance". */
export class IntentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** The simulation's logs, for a program refusal. */
    readonly logs: readonly string[] = [],
  ) {
    super(message);
  }
}

/** The transaction was sent but its confirmation could not be observed: outcome unknown. */
export class UnconfirmedError extends Error {
  constructor(
    readonly signature: string,
    message: string,
  ) {
    super(message);
  }
}

/** The bets a move opening a round puts down; undefined for a move playing on an open round
 *  (a blackjack split adds a hand to a round its table already holds). */
function newRoundBets(action: RollupAction): bigint[] | undefined {
  switch (action.type) {
    case "blackjack_bet":
      return Array.from({ length: action.hands }, () => BigInt(action.amount));
    case "roulette_chips":
      return action.chips.map((chip) => BigInt(chip.amount));
    case "withdraw":
      return undefined;
    default:
      return "amount" in action ? [BigInt(action.amount)] : undefined;
  }
}

/** Anchor's error name from transaction logs ("Error Code: InsufficientBalance."). */
export function programErrorName(logs: readonly string[] | null | undefined): string | undefined {
  for (const line of logs ?? []) {
    const match = /Error Code: (\w+)/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

function rouletteBet(bet: RouletteBet): ProgramRouletteBet {
  switch (bet.kind) {
    case "straight":
      return { straight: { 0: bet.number } };
    case "dozen":
      return { dozen: { 0: bet.dozen } };
    case "column":
      return { column: { 0: bet.column } };
    case "red":
      return { red: {} };
    case "black":
      return { black: {} };
    case "odd":
      return { odd: {} };
    case "even":
      return { even: {} };
    case "low":
      return { low: {} };
    case "high":
      return { high: {} };
  }
}

const baccaratBet = (bet: "player" | "banker" | "tie"): ProgramBaccaratBet =>
  bet === "player" ? { player: {} } : bet === "banker" ? { banker: {} } : { tie: {} };

const seed = () => Array.from(randomBytes(32));

/** How long a rollup transaction gets to confirm before its outcome is left to reconciliation. */
const ROLLUP_CONFIRM_MS = 5_000;
const ROLLUP_POLL_MS = 50;
/** Blocks past a transaction's last valid height before calling it expired: absorbs RPC nodes
 *  that lag each other behind a load balancer (height read on one, status on another). */
const EXPIRY_MARGIN_BLOCKS = 150;
const RPC_TIMEOUT_MS = 30_000;
/** How long the rollup gets to see a table or board just opened and delegated on Solana. */
const TABLE_READY_MS = 20_000;
const TABLE_POLL_MS = 250;
/** The vault mint's decimals: amounts are USDC base units everywhere. A mismatch fails the transfer. */
const USDC_DECIMALS = 6;

export type Network = "solana" | "rollup";

/** A signed transaction about to be sent: enough to find out later whether it landed. */
export interface SentTransaction {
  network: Network;
  signature: string;
  lastValidBlockHeight: number;
}

/** Called with each transaction before it is sent; sending only happens once it resolves. */
export type RecordSend = (tx: SentTransaction) => Promise<void>;

/** Where a sent transaction stands, as far as the chain can tell. */
export type TransactionStatus = { state: "landed" } | { state: "failed"; reason: string } | { state: "in_flight" } | { state: "expired" };

export interface ChainOptions {
  solanaRpcUrl: string;
  rollupRpcUrl: string;
  rollupWsUrl: string;
  vrfQueue: PublicKey;
  relayer: Keypair;
}

const withoutRecord: RecordSend = async () => undefined;

/** The program's error name for a transaction that landed with an error. */
async function failureReason(connection: Connection, signature: string, err: unknown): Promise<string> {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
  return programErrorName(tx?.meta?.logMessages) ?? JSON.stringify(err);
}

export class TiltChain {
  readonly base: Connection;
  readonly rollup: Connection;
  private readonly program: ProgramT<Tilt>;
  private readonly rollupProgram: ProgramT<Tilt>;
  private readonly relayer: Keypair;
  private readonly vrfQueue: PublicKey;
  private readonly vault = vaultAddress();
  /** Game accounts (`kind:player`) the rollup already holds: never closed, so no need to look again. */
  private readonly gameAccountsReady = new Set<string>();
  /** The rollup holds the risk pool: delegated once, never closed. */
  private riskPoolReady = false;

  constructor(options: ChainOptions) {
    this.relayer = options.relayer;
    this.vrfQueue = options.vrfQueue;
    // Every RPC call is bounded, so a hung node cannot stall an intent or the sweeper forever.
    const fetchWithTimeout = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    this.base = new Connection(options.solanaRpcUrl, { commitment: "confirmed", fetch: fetchWithTimeout });
    this.rollup = new Connection(options.rollupRpcUrl, { commitment: "confirmed", wsEndpoint: options.rollupWsUrl, fetch: fetchWithTimeout });
    const wallet = new anchor.Wallet(options.relayer);
    this.program = new Program(idl, new anchor.AnchorProvider(this.base, wallet, { commitment: "confirmed" })) as ProgramT<Tilt>;
    this.rollupProgram = new Program(idl, new anchor.AnchorProvider(this.rollup, wallet, { commitment: "confirmed" })) as ProgramT<Tilt>;
  }

  fetchVault(): Promise<Vault> {
    return this.program.account.vault.fetch(this.vault);
  }

  async isOpen(player: PublicKey): Promise<boolean> {
    return (await this.base.getAccountInfo(ledgerAddress(player))) !== null;
  }

  /** Solana's record of the player's deposits, paid withdrawals and released losses. */
  fetchLedger(player: PublicKey): Promise<Ledger | null> {
    return this.program.account.ledger.fetchNullable(ledgerAddress(player));
  }

  /** The player's account as the rollup sees it, or undefined before the first deposit. */
  fetchPlayerAccount(player: PublicKey): Promise<PlayerAccount | null> {
    return this.rollupProgram.account.playerAccount.fetchNullable(playerAccountAddress(player));
  }

  /** The house's risk pool as the rollup holds it. */
  fetchRiskPool(): Promise<RiskPool> {
    return this.rollupProgram.account.riskPool.fetch(riskPoolAddress());
  }

  /** USDC the vault holds on Solana. */
  async fetchVaultBalance(): Promise<bigint> {
    return (await getAccount(this.base, vaultTokenAddress())).amount;
  }

  /** Makes sure the rollup holds the risk pool: opened and delegated once, by the relayer, on
   *  a fresh deployment. Idempotent, like `ensureGameAccount`. */
  async ensureRiskPool(): Promise<void> {
    const address = riskPoolAddress();
    if (this.riskPoolReady || (await this.rollupHolds(address))) {
      this.riskPoolReady = true;
      return;
    }
    if ((await this.base.getAccountInfo(address)) === null) {
      const accounts = { vault: this.vault, payer: this.relayer.publicKey, riskPool: address };
      const open = await this.program.methods.openRiskPool().accountsPartial(accounts).instruction();
      const delegate = await this.program.methods.delegateRiskPool().accountsPartial(accounts).instruction();
      await this.sendBase(new Transaction().add(open, delegate), withoutRecord);
    }
    await this.waitForRollup(address);
    this.riskPoolReady = true;
  }

  /** Solana, relay cron: grants the risk pool `amount` more of the free bankroll. */
  async fundRiskPool(amount: bigint): Promise<string> {
    const tx = await this.program.methods.fundRiskPool(new BN(amount.toString()))
      .accountsPartial({ relayer: this.relayer.publicKey, vault: this.vault, vaultToken: vaultTokenAddress() })
      .transaction();
    return this.sendBase(tx, withoutRecord);
  }

  /** First deposit: opens the account and the blackjack table and moves both into the rollup,
   *  in one transaction. */
  async openAccount(wallet: PlayerWallet, amount: bigint, players: PlayerWallets, record: RecordSend): Promise<string> {
    if (await this.isOpen(wallet.address)) throw new IntentError("ACCOUNT_ALREADY_OPEN", "account already open");
    const vault = await this.fetchVault();
    const player = wallet.address;
    const accounts = {
      vault: this.vault,
      payer: this.relayer.publicKey,
      player,
      vaultToken: vaultTokenAddress(),
      treasury: vault.treasury,
      playerToken: getAssociatedTokenAddressSync(vault.mint, player),
      mint: vault.mint,
      account: playerAccountAddress(player),
      ledger: ledgerAddress(player),
    };
    const open = await this.program.methods.openAccount(new BN(amount.toString())).accountsPartial(accounts).instruction();
    const delegate = await this.program.methods.delegateAccount()
      .accountsPartial({ vault: this.vault, payer: this.relayer.publicKey, player, ledger: accounts.ledger, account: accounts.account })
      .instruction();
    const transaction = new Transaction().add(open, delegate, ...(await this.tableInstructions(player)));
    return this.sendBase(transaction, record, { wallet, players });
  }

  async deposit(wallet: PlayerWallet, amount: bigint, players: PlayerWallets, record: RecordSend): Promise<string> {
    if (!(await this.isOpen(wallet.address))) throw new IntentError("ACCOUNT_NOT_OPEN", "first deposit must open the account");
    const vault = await this.fetchVault();
    const player = wallet.address;
    const ix = await this.program.methods.deposit(new BN(amount.toString()))
      .accountsPartial({
        player,
        vault: this.vault,
        vaultToken: vaultTokenAddress(),
        playerToken: getAssociatedTokenAddressSync(vault.mint, player),
        mint: vault.mint,
        ledger: ledgerAddress(player),
      })
      .instruction();
    return this.sendBase(new Transaction().add(ix), record, { wallet, players });
  }

  /** A round action or a withdrawal, in the rollup. Blackjack needs the player's table and the
   *  other games but baccarat, slots and single-bet roulette their own account (one-draw or
   *  roulette table, Mines, Hilo or Tower board), opened first on the player's first staking move
   *  of that game. A bet the risk pool cannot cover right now is the program's RiskPoolFull: the
   *  cron grants the pool more of the free bankroll (`sweep`). */
  async play(player: PublicKey, action: RollupAction, record: RecordSend): Promise<string> {
    if (!(await this.isOpen(player))) throw new IntentError("ACCOUNT_NOT_OPEN", "no account yet: deposit first");
    const gameAccount = action.type === "roulette_chips" ? "roulette" : GAME_ACCOUNT_OF[action.type.split("_")[0]];
    const bets = newRoundBets(action);
    if (gameAccount && bets) await this.ensureGameAccount(player, gameAccount, bets);
    else if (gameAccount) await this.requireGameAccount(player, gameAccount);
    return this.sendRollup(await this.playTransaction(player, action), record);
  }

  /** Relay cron: requests again the draw of a round stuck waiting for it. A blackjack draw
   *  writes to the table and the games with their own account call back with it, so it is
   *  passed along. A roulette round without its bet in `roulette` is a multi-chip spin, whose
   *  chips are on the roulette table. */
  async expireRound(player: PublicKey, round: Pick<PlayerAccount["round"], "game" | "roulette">): Promise<string> {
    const m = this.rollupProgram.methods;
    const game = Object.keys(round.game)[0];
    const kind = game === "roulette" && !round.roulette ? "roulette" : GAME_ACCOUNT_OF[game];
    let tx: Transaction;
    switch (kind) {
      case "roulette":
        tx = await m.expireRouletteRound(seed()).accountsPartial(this.rouletteAccounts(player)).transaction();
        break;
      case "quick":
        tx = await m.expireQuickRound(seed()).accountsPartial(this.quickAccounts(player)).transaction();
        break;
      case "mines":
        tx = await m.expireMinesRound(seed()).accountsPartial(this.boardAccounts(player, "mines")).transaction();
        break;
      case "hilo":
        tx = await m.expireHiloRound(seed()).accountsPartial(this.boardAccounts(player, "hilo")).transaction();
        break;
      case "tower":
        tx = await m.expireTowerRound(seed()).accountsPartial(this.boardAccounts(player, "tower")).transaction();
        break;
      default:
        tx = await m.expireRound(seed()).accountsPartial(this.playAccounts(player, kind === "table")).transaction();
    }
    return this.sendRollup(tx, withoutRecord);
  }

  /** Makes sure the rollup holds the player's game account, for a move opening a round of
   *  `bets`. Idempotent: an account already on Solana is not opened again, only waited for.
   *  The move is checked first, so the relayer never pays an account's rent for a move the
   *  program would refuse anyway. Past that, nothing of the player's moves in here, so any
   *  failure is TABLE_NOT_READY and the action can simply be sent again. */
  async ensureGameAccount(player: PublicKey, kind: GameAccount, bets: readonly bigint[]): Promise<void> {
    const key = `${kind}:${player.toBase58()}`;
    if (this.gameAccountsReady.has(key)) return;
    await this.checkCanStart(player, bets);
    const address = GAME_ACCOUNTS[kind].address(player);
    try {
      if (!(await this.rollupHolds(address))) {
        if ((await this.base.getAccountInfo(address)) === null) {
          const instructions = await this.gameAccountInstructions(player, kind);
          await this.sendBase(new Transaction().add(...instructions), withoutRecord);
        }
        await this.waitForRollup(address);
      }
    } catch (e) {
      throw new IntentError("TABLE_NOT_READY", `${GAME_ACCOUNTS[kind].label} not ready: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.gameAccountsReady.add(key);
  }

  /** The program's own refusals of a new round (`start_round`), from the accounts as they
   *  stand: pause, a round already open, bet limits, balance. Deposits Solana recorded count
   *  even before the rollup credits them, so a player who can play is never refused here; the
   *  program checks everything again. */
  private async checkCanStart(player: PublicKey, bets: readonly bigint[]): Promise<void> {
    const [vault, account, ledger] = await Promise.all([this.fetchVault(), this.fetchPlayerAccount(player), this.fetchLedger(player)]);
    if (!account || !ledger) throw new IntentError("ACCOUNT_NOT_OPEN", "no account yet: deposit first");
    const { config } = vault;
    if (config.betsPaused) throw new IntentError("PROGRAM_ERROR", "Paused");
    if (!("idle" in account.round.status)) throw new IntentError("PROGRAM_ERROR", "RoundInProgress");
    const [minBet, maxBet] = [BigInt(config.minBet.toString()), BigInt(config.maxBet.toString())];
    if (bets.length === 0 || bets.some((bet) => bet < minBet || bet > maxBet)) throw new IntentError("PROGRAM_ERROR", "AmountOutOfRange");
    const uncredited = BigInt(ledger.deposited.toString()) - BigInt(account.credited.toString());
    const balance = BigInt(account.balance.toString()) + (uncredited > 0n ? uncredited : 0n);
    if (bets.reduce((stake, bet) => stake + bet, 0n) > balance) throw new IntentError("PROGRAM_ERROR", "InsufficientBalance");
  }

  /** A move staking nothing plays on a round a staking move started, so on an account the rollup
   *  already holds: it never opens one, whose rent the relayer would pay for nothing. Without
   *  the account there is no round, the program's WrongState. */
  private async requireGameAccount(player: PublicKey, kind: GameAccount): Promise<void> {
    const key = `${kind}:${player.toBase58()}`;
    if (this.gameAccountsReady.has(key)) return;
    if (!(await this.rollupHolds(GAME_ACCOUNTS[kind].address(player)))) throw new IntentError("PROGRAM_ERROR", "WrongState");
    this.gameAccountsReady.add(key);
  }

  /** Sponsor prize from the promo pool to the player's wallet (token account created if needed). */
  async payPromo(player: PublicKey, payoutId: string, amount: bigint, record: RecordSend): Promise<string> {
    const vault = await this.fetchVault();
    const playerToken = getAssociatedTokenAddressSync(vault.mint, player);
    const id = Buffer.from(payoutId.replaceAll("-", ""), "hex");
    const pay = await this.program.methods.payPromo(Array.from(id), new BN(amount.toString()))
      .accountsPartial({
        relayer: this.relayer.publicKey,
        vault: this.vault,
        promo: promoAddress(),
        promoToken: promoTokenAddress(),
        payout: promoPayoutAddress(id),
        playerToken,
        mint: vault.mint,
      })
      .instruction();
    const createToken = createAssociatedTokenAccountIdempotentInstruction(this.relayer.publicKey, playerToken, player, vault.mint);
    return this.sendBase(new Transaction().add(createToken, pay), record);
  }

  /** Test USDC left in the devnet faucet's reserve: the relayer's own token account for the vault mint. */
  async fetchFaucetReserve(): Promise<bigint> {
    const vault = await this.fetchVault();
    return this.tokenBalance(getAssociatedTokenAddressSync(vault.mint, this.relayer.publicKey));
  }

  /** Devnet faucet: `amount` from the reserve to the player's wallet (token account created if
   *  needed, the relayer pays the rent). A reserve short of the full amount sends nothing. */
  async payFaucet(player: PublicKey, amount: bigint, record: RecordSend): Promise<string> {
    const vault = await this.fetchVault();
    const reserve = getAssociatedTokenAddressSync(vault.mint, this.relayer.publicKey);
    const held = await this.tokenBalance(reserve);
    if (held < amount) {
      logAlert({ code: "LOW_FAUCET_RESERVE", severity: "warning", message: `faucet reserve ${reserve.toBase58()} holds ${held}, a claim needs ${amount}: refill it` });
      throw new IntentError("FAUCET_EMPTY", `faucet reserve holds ${held}, below ${amount}`);
    }
    const playerToken = getAssociatedTokenAddressSync(vault.mint, player);
    const createToken = createAssociatedTokenAccountIdempotentInstruction(this.relayer.publicKey, playerToken, player, vault.mint);
    const transfer = createTransferCheckedInstruction(reserve, vault.mint, playerToken, this.relayer.publicKey, amount, USDC_DECIMALS);
    return this.sendBase(new Transaction().add(createToken, transfer), record);
  }

  /** A token account's balance; 0 while it does not exist. */
  private async tokenBalance(address: PublicKey): Promise<bigint> {
    const info = await this.base.getAccountInfo(address);
    return info ? unpackAccount(address, info).amount : 0n;
  }

  /** Relay cron: releases the player's losses from the vault reservation. */
  async checkpoint(player: PublicKey): Promise<string> {
    const tx = await this.rollupProgram.methods.checkpoint()
      .accountsPartial({ vault: this.vault, payer: this.relayer.publicKey, account: playerAccountAddress(player), ledger: ledgerAddress(player) })
      .transaction();
    return this.sendRollup(tx, withoutRecord);
  }

  /** Whether a transaction sent earlier landed. The block height is read before the status so
   *  that "expired" is final: past its last valid height, a transaction can no longer land. */
  async transactionStatus(tx: SentTransaction): Promise<TransactionStatus> {
    const connection = tx.network === "solana" ? this.base : this.rollup;
    const height = await connection.getBlockHeight("confirmed");
    const { value } = await connection.getSignatureStatuses([tx.signature], { searchTransactionHistory: true });
    const status = value[0];
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return status.err ? { state: "failed", reason: await failureReason(connection, tx.signature, status.err) } : { state: "landed" };
    }
    return height > tx.lastValidBlockHeight + EXPIRY_MARGIN_BLOCKS ? { state: "expired" } : { state: "in_flight" };
  }

  private playAccounts(player: PublicKey, blackjack: boolean) {
    return {
      vault: this.vault,
      payer: this.relayer.publicKey,
      account: playerAccountAddress(player),
      ledger: ledgerAddress(player),
      // Other games pass no table (Anchor puts the program id in the optional slot).
      table: blackjack ? tableAddress(player) : null,
      riskPool: riskPoolAddress(),
      oracleQueue: this.vrfQueue,
    };
  }

  /** Moves of the games with their own board (Mines, Hilo, Tower): the board instead of the
   *  optional table. */
  private boardAccounts(player: PublicKey, kind: "mines" | "hilo" | "tower") {
    return {
      vault: this.vault,
      payer: this.relayer.publicKey,
      account: playerAccountAddress(player),
      ledger: ledgerAddress(player),
      board: GAME_ACCOUNTS[kind].address(player),
      riskPool: riskPoolAddress(),
      oracleQueue: this.vrfQueue,
    };
  }

  /** One-draw games: the player's one-draw table instead of the optional blackjack table. */
  private quickAccounts(player: PublicKey) {
    return {
      vault: this.vault,
      payer: this.relayer.publicKey,
      account: playerAccountAddress(player),
      ledger: ledgerAddress(player),
      quick: quickTableAddress(player),
      riskPool: riskPoolAddress(),
      oracleQueue: this.vrfQueue,
    };
  }

  /** Multi-chip roulette spins: the player's roulette table instead of the optional blackjack table. */
  private rouletteAccounts(player: PublicKey) {
    return {
      vault: this.vault,
      payer: this.relayer.publicKey,
      account: playerAccountAddress(player),
      ledger: ledgerAddress(player),
      roulette: rouletteTableAddress(player),
      riskPool: riskPoolAddress(),
      oracleQueue: this.vrfQueue,
    };
  }

  /** open_table + delegate_table: the relayer pays the table's rent, like the account's. */
  private async tableInstructions(player: PublicKey) {
    const accounts = { vault: this.vault, payer: this.relayer.publicKey, player, ledger: ledgerAddress(player), table: tableAddress(player) };
    return [
      await this.program.methods.openTable().accountsPartial(accounts).instruction(),
      await this.program.methods.delegateTable().accountsPartial(accounts).instruction(),
    ];
  }

  /** open_* + delegate_* of a game account, paid by the relayer like the table. */
  private async gameAccountInstructions(player: PublicKey, kind: GameAccount): Promise<TransactionInstruction[]> {
    const m = this.program.methods;
    const base = { vault: this.vault, payer: this.relayer.publicKey, player, ledger: ledgerAddress(player) };
    const board = { ...base, board: GAME_ACCOUNTS[kind].address(player) };
    switch (kind) {
      case "table":
        return this.tableInstructions(player);
      case "quick": {
        const quick = { ...base, quick: quickTableAddress(player) };
        return [await m.openQuickTable().accountsPartial(quick).instruction(), await m.delegateQuickTable().accountsPartial(quick).instruction()];
      }
      case "roulette": {
        const roulette = { ...base, roulette: rouletteTableAddress(player) };
        return [await m.openRouletteTable().accountsPartial(roulette).instruction(), await m.delegateRouletteTable().accountsPartial(roulette).instruction()];
      }
      case "mines":
        return [await m.openMinesBoard().accountsPartial(board).instruction(), await m.delegateMinesBoard().accountsPartial(board).instruction()];
      case "hilo":
        return [await m.openHiloBoard().accountsPartial(board).instruction(), await m.delegateHiloBoard().accountsPartial(board).instruction()];
      case "tower":
        return [await m.openTowerBoard().accountsPartial(board).instruction(), await m.delegateTowerBoard().accountsPartial(board).instruction()];
    }
  }

  /** The rollup holds a delegated account as owned by the program again. */
  private async rollupHolds(address: PublicKey): Promise<boolean> {
    const info = await this.rollup.getAccountInfo(address);
    return info !== null && info.owner.equals(PROGRAM_ID);
  }

  private async waitForRollup(address: PublicKey): Promise<void> {
    for (const end = Date.now() + TABLE_READY_MS; Date.now() < end; await sleep(TABLE_POLL_MS)) {
      if (await this.rollupHolds(address)) return;
    }
    throw new Error(`not in the rollup within ${TABLE_READY_MS} ms`);
  }

  /** The program's transaction for a round action or a withdrawal. */
  async playTransaction(player: PublicKey, action: RollupAction): Promise<Transaction> {
    const m = this.rollupProgram.methods;
    const accounts = this.playAccounts(player, isBlackjack(action));
    switch (action.type) {
      case "blackjack_bet":
        return m.blackjackBet(new BN(action.amount), action.hands, seed()).accountsPartial(accounts).transaction();
      case "blackjack_hit":
        return m.blackjackHit(seed()).accountsPartial(accounts).transaction();
      case "blackjack_stand":
        return m.blackjackStand(seed()).accountsPartial(accounts).transaction();
      case "blackjack_double":
        return m.blackjackDouble(seed()).accountsPartial(accounts).transaction();
      case "blackjack_split":
        return m.blackjackSplit(seed()).accountsPartial(accounts).transaction();
      case "roulette_spin":
        return m.rouletteSpin(new BN(action.amount), rouletteBet(action.bet), seed()).accountsPartial(accounts).transaction();
      case "roulette_chips": {
        const chips = action.chips.map((chip) => ({ bet: rouletteBet(chip.bet), amount: new BN(chip.amount) }));
        return m.rouletteChips(chips, seed()).accountsPartial(this.rouletteAccounts(player)).transaction();
      }
      case "baccarat_deal":
        return m.baccaratDeal(new BN(action.amount), baccaratBet(action.bet), seed()).accountsPartial(accounts).transaction();
      case "slots_spin":
        return m.slotsSpin(new BN(action.amount), seed()).accountsPartial(accounts).transaction();
      case "mines_bet":
        return m.minesBet(new BN(action.amount), action.mines).accountsPartial(this.boardAccounts(player, "mines")).transaction();
      case "mines_reveal":
        return m.minesReveal(action.tile, seed()).accountsPartial(this.boardAccounts(player, "mines")).transaction();
      case "mines_cashout":
        return m.minesCashout().accountsPartial(this.boardAccounts(player, "mines")).transaction();
      case "dice_roll":
        return m.diceRoll(new BN(action.amount), action.target, action.over, seed()).accountsPartial(this.quickAccounts(player)).transaction();
      case "limbo_play":
        return m.limboPlay(new BN(action.amount), action.target, seed()).accountsPartial(this.quickAccounts(player)).transaction();
      case "flip_play":
        return m.flipPlay(new BN(action.amount), FLIP_SIDE[action.side], action.flips, seed()).accountsPartial(this.quickAccounts(player)).transaction();
      case "keno_play":
        return m.kenoPlay(new BN(action.amount), Buffer.from(action.picks), seed()).accountsPartial(this.quickAccounts(player)).transaction();
      case "wheel_spin":
        return m.wheelSpin(new BN(action.amount), action.segments, WHEEL_RISK[action.risk], seed()).accountsPartial(this.quickAccounts(player)).transaction();
      case "hilo_bet":
        return m.hiloBet(new BN(action.amount), seed()).accountsPartial(this.boardAccounts(player, "hilo")).transaction();
      case "hilo_guess":
        return m.hiloGuess(HILO_MOVE[action.guess], seed()).accountsPartial(this.boardAccounts(player, "hilo")).transaction();
      case "hilo_cashout":
        return m.hiloCashout().accountsPartial(this.boardAccounts(player, "hilo")).transaction();
      case "tower_bet":
        return m.towerBet(new BN(action.amount), TOWER_DIFFICULTY[action.difficulty]).accountsPartial(this.boardAccounts(player, "tower")).transaction();
      case "tower_climb":
        return m.towerClimb(action.tile, seed()).accountsPartial(this.boardAccounts(player, "tower")).transaction();
      case "tower_cashout":
        return m.towerCashout().accountsPartial(this.boardAccounts(player, "tower")).transaction();
      case "withdraw": {
        const vault = await this.fetchVault();
        return m.withdraw(new BN(action.amount))
          .accountsPartial({
            vault: this.vault,
            payer: this.relayer.publicKey,
            account: accounts.account,
            ledger: accounts.ledger,
            vaultToken: vaultTokenAddress(),
            playerToken: getAssociatedTokenAddressSync(vault.mint, player),
            mint: vault.mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            riskPool: riskPoolAddress(),
          })
          .transaction();
      }
    }
  }

  /** Simulates (program refusals come back as IntentError, nothing sent), records, then sends.
   *  Any failure from the send on leaves the outcome unknown: UnconfirmedError. */
  private async simulateRecordSend(connection: Connection, network: Network, tx: Transaction, lastValidBlockHeight: number, record: RecordSend): Promise<string> {
    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err) {
      const logs = simulation.value.logs ?? [];
      throw new IntentError("PROGRAM_ERROR", programErrorName(logs) ?? JSON.stringify(simulation.value.err), logs);
    }
    if (!tx.signature) throw new Error("transaction is not signed by its fee payer");
    const signature = bs58.encode(tx.signature);
    await record({ network, signature, lastValidBlockHeight });
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }).catch((e: unknown) => {
      throw new UnconfirmedError(signature, e instanceof Error ? e.message : String(e));
    });
    return signature;
  }

  /** Rollup transactions: signed and paid by the relayer; the rollup confirms in tens of ms. */
  private async sendRollup(tx: Transaction, record: RecordSend): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.rollup.getLatestBlockhash();
    tx.feePayer = this.relayer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(this.relayer);
    const signature = await this.simulateRecordSend(this.rollup, "rollup", tx, lastValidBlockHeight, record);
    // Polled rather than web3.js confirmTransaction, whose rollup subscription can stall ~30 s.
    for (const end = Date.now() + ROLLUP_CONFIRM_MS; Date.now() < end; await sleep(ROLLUP_POLL_MS)) {
      const status = (await this.rollup.getSignatureStatuses([signature])).value[0];
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        if (status.err) throw new IntentError("PROGRAM_ERROR", await failureReason(this.rollup, signature, status.err));
        return signature;
      }
    }
    throw new UnconfirmedError(signature, `not confirmed within ${ROLLUP_CONFIRM_MS} ms`);
  }

  /** Solana transactions, paid by the relayer. Those that move the player's USDC are also
   *  signed by the player's wallet. */
  private async sendBase(tx: Transaction, record: RecordSend, player?: { wallet: PlayerWallet; players: PlayerWallets }): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.base.getLatestBlockhash();
    tx.feePayer = this.relayer.publicKey;
    tx.recentBlockhash = blockhash;
    const signed = player ? await player.players.sign(player.wallet, tx) : tx;
    signed.partialSign(this.relayer);
    const signature = await this.simulateRecordSend(this.base, "solana", signed, lastValidBlockHeight, record);
    const confirmation = await this.base
      .confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")
      .catch((e: unknown) => {
        throw new UnconfirmedError(signature, e instanceof Error ? e.message : String(e));
      });
    if (confirmation.value.err) throw new IntentError("PROGRAM_ERROR", await failureReason(this.base, signature, confirmation.value.err));
    return signature;
  }
}
