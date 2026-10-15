// Turns intents into Tilt program transactions, on Solana or in the rollup, signed and paid
// by the relayer. The program stays the arbiter: everything is re-checked on-chain.
import anchor from "@coral-xyz/anchor";
import type { IdlAccounts, IdlTypes, Program as ProgramT } from "@coral-xyz/anchor";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  type Action,
  type ErrorCode,
  idl,
  ledgerAddress,
  playerAccountAddress,
  PROGRAM_ID,
  promoAddress,
  promoPayoutAddress,
  promoTokenAddress,
  tableAddress,
  type Tilt,
  vaultAddress,
  vaultTokenAddress,
} from "@tilt/contract";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PlayerWallet, PlayerWallets } from "./players";

const { BN, Program } = anchor;
const { bs58 } = anchor.utils.bytes;
export type PlayerAccount = IdlAccounts<Tilt>["playerAccount"];
type Vault = IdlAccounts<Tilt>["vault"];
export type Ledger = IdlAccounts<Tilt>["ledger"];
type ProgramRouletteBet = IdlTypes<Tilt>["rouletteBet"];
type ProgramBaccaratBet = IdlTypes<Tilt>["baccaratBet"];
type RollupAction = Exclude<Action, { type: "open_account" | "deposit" }>;

const isBlackjack = (action: RollupAction) => action.type.startsWith("blackjack_");

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

/** By how much a move refused `WinCapReached` passes the player's cap, as the program logs it. */
export function winCapShortfall(logs: readonly string[]): bigint | undefined {
  for (const line of logs) {
    const match = /Win cap short by (\d+)/.exec(line);
    if (match) return BigInt(match[1]);
  }
  return undefined;
}

/** Anchor's error name from transaction logs ("Error Code: InsufficientBalance."). */
export function programErrorName(logs: readonly string[] | null | undefined): string | undefined {
  for (const line of logs ?? []) {
    const match = /Error Code: (\w+)/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

function rouletteBet(bet: Extract<Action, { type: "roulette_spin" }>["bet"]): ProgramRouletteBet {
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
/** How long the rollup gets to see a win cap just raised on Solana. */
const WIN_CAP_READY_MS = 20_000;
/** How long the rollup gets to see a table just opened and delegated on Solana. */
const TABLE_READY_MS = 20_000;
const TABLE_POLL_MS = 250;

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
  /** Players whose table the rollup already holds: tables are never closed, so no need to look again. */
  private readonly tablesReady = new Set<string>();

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

  /** First deposit: opens the account and the blackjack table and moves both into the rollup,
   *  in one transaction. */
  async openAccount(wallet: PlayerWallet, amount: bigint, players: PlayerWallets, record: RecordSend): Promise<string> {
    if (await this.isOpen(wallet.address)) throw new IntentError("ACCOUNT_ALREADY_OPEN", "account already open");
    const vault = await this.fetchVault();
    const config = vault.config;
    const credited = amount - BigInt(config.onboardingFee.toString());
    // The largest win cap the program accepts for this deposit.
    const maxWin = credited > 0n
      ? [BigInt(config.maxPlayerWin.toString()), credited * BigInt(config.maxWinMultiple.toString())].reduce((a, b) => (a < b ? a : b))
      : 0n;
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
    const open = await this.program.methods.openAccount(new BN(amount.toString()), new BN(maxWin.toString())).accountsPartial(accounts).instruction();
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

  /** A round action or a withdrawal, in the rollup. Blackjack needs the player's table, opened
   *  first for players who joined before tables existed. A move past the player's win cap is
   *  sent again once Solana has raised the cap from the free bankroll (the rolling win cap). */
  async play(player: PublicKey, action: RollupAction, record: RecordSend): Promise<string> {
    if (!(await this.isOpen(player))) throw new IntentError("ACCOUNT_NOT_OPEN", "no account yet: deposit first");
    if (isBlackjack(action)) await this.ensureTable(player);
    try {
      return await this.sendRollup(await this.playTransaction(player, action), record);
    } catch (e) {
      // A program refusal comes from the simulation: nothing was sent, so sending again is safe.
      const short = e instanceof IntentError && e.message === "WinCapReached" ? winCapShortfall(e.logs) : undefined;
      if (short === undefined) throw e;
      await this.raiseWinCap(player, short);
      return this.sendRollup(await this.playTransaction(player, action), record);
    }
  }

  /** Raises the player's win cap on Solana by `amount`, then waits for the rollup to see it.
   *  A bankroll too small to cover it is the program's VaultTooSmall. */
  private async raiseWinCap(player: PublicKey, amount: bigint): Promise<void> {
    const ledger = await this.fetchLedger(player);
    if (!ledger) throw new IntentError("ACCOUNT_NOT_OPEN", "no account yet: deposit first");
    const target = BigInt(ledger.maxWin.toString()) + amount;
    const tx = await this.program.methods.raiseWinCap(new BN(amount.toString()))
      .accountsPartial({ relayer: this.relayer.publicKey, vault: this.vault, vaultToken: vaultTokenAddress(), ledger: ledgerAddress(player) })
      .transaction();
    try {
      await this.sendBase(tx, withoutRecord);
    } catch (e) {
      // Nothing of the player's move went out; a raise that landed anyway only reserves bankroll.
      if (e instanceof UnconfirmedError) throw new IntentError("NETWORK_ERROR", `win cap raise unconfirmed: ${e.message}`);
      throw e;
    }
    for (const end = Date.now() + WIN_CAP_READY_MS; Date.now() < end; await sleep(TABLE_POLL_MS)) {
      const seen = await this.rollupProgram.account.ledger.fetchNullable(ledgerAddress(player));
      if (seen && BigInt(seen.maxWin.toString()) >= target) return;
    }
  }

  /** Relay cron: requests again the draw of a round stuck waiting for it; a blackjack draw
   *  writes to the table, so it is passed along. */
  async expireRound(player: PublicKey, blackjack: boolean): Promise<string> {
    const tx = await this.rollupProgram.methods.expireRound(seed()).accountsPartial(this.playAccounts(player, blackjack)).transaction();
    return this.sendRollup(tx, withoutRecord);
  }

  /** Makes sure the rollup holds the player's blackjack table. Idempotent: a table already on
   *  Solana is not opened again, only waited for. Nothing of the player's moves in here, so
   *  any failure is TABLE_NOT_READY and the action can simply be sent again. */
  async ensureTable(player: PublicKey): Promise<void> {
    const key = player.toBase58();
    if (this.tablesReady.has(key)) return;
    try {
      if (!(await this.rollupHasTable(player))) {
        if ((await this.base.getAccountInfo(tableAddress(player))) === null) {
          await this.sendBase(new Transaction().add(...(await this.tableInstructions(player))), withoutRecord);
        }
        await this.waitForRollupTable(player);
      }
    } catch (e) {
      throw new IntentError("TABLE_NOT_READY", `blackjack table not ready: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.tablesReady.add(key);
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

  /** The rollup holds a delegated account as owned by the program again. */
  private async rollupHasTable(player: PublicKey): Promise<boolean> {
    const info = await this.rollup.getAccountInfo(tableAddress(player));
    return info !== null && info.owner.equals(PROGRAM_ID);
  }

  private async waitForRollupTable(player: PublicKey): Promise<void> {
    for (const end = Date.now() + TABLE_READY_MS; Date.now() < end; await sleep(TABLE_POLL_MS)) {
      if (await this.rollupHasTable(player)) return;
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
      case "baccarat_deal":
        return m.baccaratDeal(new BN(action.amount), baccaratBet(action.bet), seed()).accountsPartial(accounts).transaction();
      case "slots_spin":
        return m.slotsSpin(new BN(action.amount), seed()).accountsPartial(accounts).transaction();
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
