// Read-only view of the Tilt program: player accounts in the rollup, vault and ledgers on
// Solana, and the player's own USDC. The api never signs anything (spec §7).
import anchor from "@coral-xyz/anchor";
import type { IdlAccounts, IdlTypes, Program as ProgramT } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { idl, ledgerAddress, playerAccountAddress, tableAddress, type Tilt, vaultAddress } from "@tilt/contract";
import type { BaccaratBet, RouletteBet } from "@tilt/mod/protocol";
import type { ChainRound, Draw, Outcome, RoundStatus } from "./games/round";
import type { Reels } from "./games/slots";

const { Program } = anchor;
type PlayerAccountData = IdlAccounts<Tilt>["playerAccount"];
type TableData = IdlAccounts<Tilt>["blackjackTable"];
type RoundData = IdlTypes<Tilt>["round"];

export interface PlayerState {
  balance: bigint;
  /** Deposits credited in the rollup (onboarding fee already deducted). */
  credited: bigint;
  withdrawn: bigint;
  fees: bigint;
  /** Settled rounds so far; also the number of the last settled round. */
  rounds: number;
  round: ChainRound;
}

export interface ChainConfig {
  minBet: bigint;
  maxBet: bigint;
  onboardingFee: bigint;
  minDeposit: bigint;
  mint: PublicKey;
}

export interface ChainReader {
  /** null before the first deposit. */
  playerAccount(player: PublicKey): Promise<PlayerState | null>;
  /** Solana's total of the player's deposits (credited in the rollup at their next move). */
  deposited(player: PublicKey): Promise<bigint | null>;
  config(): Promise<ChainConfig>;
  /** USDC in the player's own wallet (0 without a token account). */
  walletUsdc(player: PublicKey): Promise<bigint>;
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** SPL token account layout: mint (32), owner (32), amount (u64 LE), … */
const TOKEN_AMOUNT_OFFSET = 64;
const TOKEN_ACCOUNT_SIZE = 165;
const RPC_TIMEOUT_MS = 10_000;
/** The vault config changes only by admin action; a minute of staleness is harmless (the
 *  program re-checks every limit). */
const CONFIG_TTL_MS = 60_000;

export const associatedTokenAddress = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];

const big = (n: { toString(): string }) => BigInt(n.toString());

function draw(d: IdlTypes<Tilt>["draw"]): Draw {
  if ("deal" in d) return "deal";
  if ("hit" in d) return "hit";
  if ("double" in d) return "double";
  if ("dealer" in d) return "dealer";
  return "spin";
}

function status(s: RoundData["status"]): RoundStatus {
  if ("idle" in s) return { kind: "idle" };
  if ("playerTurn" in s) return { kind: "player_turn" };
  if (!s.awaitingDraw) throw new Error("unknown round status");
  return { kind: "awaiting", draw: draw(s.awaitingDraw[0]) };
}

function rouletteBet(b: IdlTypes<Tilt>["rouletteBet"]): RouletteBet {
  if (b.straight) return { kind: "straight", number: b.straight[0] };
  if (b.dozen) return { kind: "dozen", dozen: b.dozen[0] as 1 | 2 | 3 };
  if (b.column) return { kind: "column", column: b.column[0] as 1 | 2 | 3 };
  for (const kind of ["red", "black", "odd", "even", "low", "high"] as const) if (kind in b) return { kind };
  throw new Error("unknown roulette bet");
}

function baccaratBet(b: IdlTypes<Tilt>["baccaratBet"]): BaccaratBet {
  if ("player" in b) return "player";
  if ("banker" in b) return "banker";
  return "tie";
}

const dealt = (cards: number[]) => cards.filter((c) => c !== 0);

/** A blackjack round lives in the player's table. A player without one (joined before tables,
 *  never bet since) shows no hands. */
function blackjackOutcome(t: TableData | null): Outcome {
  if (!t) return { game: "blackjack", bet: "0", hands: [], active: 0, dealer: [] };
  return {
    game: "blackjack",
    bet: big(t.bet).toString(),
    hands: t.hands.slice(0, t.nHands).map((h) => ({ cards: h.cards.slice(0, h.nCards), doubled: h.doubled })),
    active: t.active,
    dealer: t.dealer.slice(0, t.nDealer),
  };
}

function outcome(r: RoundData, table: TableData | null): Outcome {
  if ("blackjack" in r.game) return blackjackOutcome(table);
  if ("roulette" in r.game) {
    if (!r.roulette) throw new Error("roulette round without a spin");
    return { game: "roulette", bet: rouletteBet(r.roulette.bet), number: r.roulette.number };
  }
  if ("baccarat" in r.game) {
    if (!r.baccarat) throw new Error("baccarat round without a coup");
    const c = r.baccarat;
    return { game: "baccarat", bet: baccaratBet(c.bet), player: dealt(c.player), banker: dealt(c.banker) };
  }
  return { game: "slots", reels: r.slots.reels as Reels };
}

export function decodeRound(r: RoundData, table: TableData | null): ChainRound {
  return {
    status: status(r.status),
    stake: big(r.stake),
    payout: big(r.payout),
    fee: big(r.fee),
    requestId: big(r.requestId),
    outcome: outcome(r, table),
  };
}

export function decodePlayer(a: PlayerAccountData, table: TableData | null): PlayerState {
  return {
    balance: big(a.balance),
    credited: big(a.credited),
    withdrawn: big(a.withdrawn),
    fees: big(a.fees),
    rounds: a.rounds,
    round: decodeRound(a.round, table),
  };
}

export interface RpcChainOptions {
  solanaRpcUrl: string;
  rollupRpcUrl: string;
  rollupWsUrl: string;
}

export class RpcChainReader implements ChainReader {
  readonly base: Connection;
  readonly rollup: Connection;
  private readonly program: ProgramT<Tilt>;
  private readonly rollupProgram: ProgramT<Tilt>;
  private cachedConfig: { value: ChainConfig; at: number } | undefined;

  constructor(options: RpcChainOptions) {
    const fetchWithTimeout = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
    this.base = new Connection(options.solanaRpcUrl, { commitment: "confirmed", fetch: fetchWithTimeout });
    this.rollup = new Connection(options.rollupRpcUrl, {
      commitment: "confirmed",
      wsEndpoint: options.rollupWsUrl,
      fetch: fetchWithTimeout,
    });
    // Read-only: the wallet is a throwaway key that never signs.
    const wallet = new anchor.Wallet(Keypair.generate());
    this.program = new Program(idl, new anchor.AnchorProvider(this.base, wallet)) as ProgramT<Tilt>;
    this.rollupProgram = new Program(idl, new anchor.AnchorProvider(this.rollup, wallet)) as ProgramT<Tilt>;
  }

  /** The account and the blackjack table, read together so the round and its cards match. */
  async playerAccount(player: PublicKey): Promise<PlayerState | null> {
    const [account, table] = await this.rollup.getMultipleAccountsInfo([
      playerAccountAddress(player),
      tableAddress(player),
    ]);
    if (!account) return null;
    const accounts = this.rollupProgram.coder.accounts;
    return decodePlayer(
      accounts.decode<PlayerAccountData>("playerAccount", account.data),
      table ? accounts.decode<TableData>("blackjackTable", table.data) : null,
    );
  }

  async deposited(player: PublicKey): Promise<bigint | null> {
    const ledger = await this.program.account.ledger.fetchNullable(ledgerAddress(player));
    return ledger ? big(ledger.deposited) : null;
  }

  async config(): Promise<ChainConfig> {
    if (this.cachedConfig && Date.now() - this.cachedConfig.at < CONFIG_TTL_MS) return this.cachedConfig.value;
    const vault = await this.program.account.vault.fetch(vaultAddress());
    const c = vault.config;
    const value: ChainConfig = {
      minBet: big(c.minBet),
      maxBet: big(c.maxBet),
      onboardingFee: big(c.onboardingFee),
      minDeposit: big(c.minDeposit),
      mint: vault.mint,
    };
    this.cachedConfig = { value, at: Date.now() };
    return value;
  }

  async walletUsdc(player: PublicKey): Promise<bigint> {
    const { mint } = await this.config();
    const info = await this.base.getAccountInfo(associatedTokenAddress(player, mint));
    if (!info) return 0n;
    if (!info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length < TOKEN_ACCOUNT_SIZE) {
      throw new Error("wallet USDC account is not an SPL token account");
    }
    return info.data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
  }
}
