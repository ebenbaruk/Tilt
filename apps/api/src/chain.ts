// Read-only view of the Tilt program: player accounts in the rollup, vault and ledgers on
// Solana, and the player's own USDC. The api never signs anything (spec §7).
import anchor from "@coral-xyz/anchor";
import type { IdlAccounts, IdlTypes, Program as ProgramT } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  hiloBoardAddress,
  idl,
  ledgerAddress,
  minesBoardAddress,
  playerAccountAddress,
  quickTableAddress,
  tableAddress,
  type Tilt,
  towerBoardAddress,
  vaultAddress,
} from "@tilt/contract";
import type { BaccaratBet, FlipSide, RouletteBet } from "@tilt/mod/protocol";
import * as flip from "./games/flip";
import * as hilo from "./games/hilo";
import { NO_TILE } from "./games/mines";
import type { ChainRound, Draw, Outcome, RoundStatus } from "./games/round";
import type { Reels } from "./games/slots";
import * as tower from "./games/tower";
import * as wheel from "./games/wheel";

const { Program } = anchor;
type PlayerAccountData = IdlAccounts<Tilt>["playerAccount"];
type RoundData = IdlTypes<Tilt>["round"];

/** The player's per-game PDAs (null when not opened yet), read with the account. */
export interface GameAccounts {
  table: IdlAccounts<Tilt>["blackjackTable"] | null;
  mines: IdlAccounts<Tilt>["minesBoard"] | null;
  quick: IdlAccounts<Tilt>["quickTable"] | null;
  hilo: IdlAccounts<Tilt>["hiloBoard"] | null;
  tower: IdlAccounts<Tilt>["towerBoard"] | null;
}
type TableData = NonNullable<GameAccounts["table"]>;

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
  if ("split" in d) return "split";
  if ("dealer" in d) return "dealer";
  if ("reveal" in d) return "reveal";
  if ("card" in d) return "card";
  if ("climb" in d) return "climb";
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
  if (!t) return { game: "blackjack", bet: "0", hands: [], active: 0, dealer: [], splits: 0 };
  return {
    game: "blackjack",
    bet: big(t.bet).toString(),
    hands: t.hands
      .slice(0, t.nHands)
      .map((h) => ({ cards: h.cards.slice(0, h.nCards), doubled: h.doubled, split: h.split })),
    active: t.active,
    dealer: t.dealer.slice(0, t.nDealer),
    splits: t.splits,
  };
}

const tileOrNull = (t: number) => (t === NO_TILE ? null : t);

/** A mines round lives in the player's board, opened before their first mines bet. */
function minesOutcome(b: GameAccounts["mines"]): Outcome {
  if (!b) throw new Error("mines round without a board");
  return {
    game: "mines",
    mines: b.mines,
    order: b.order.slice(0, b.nRevealed),
    pending: tileOrNull(b.pending),
    busted: tileOrNull(b.busted),
    maxGain: big(b.maxGain).toString(),
  };
}

/** A one-draw round lives in the player's quick table, which must hold this game's round. */
function quickOutcome(game: Outcome["game"], q: GameAccounts["quick"]): Outcome {
  const round = q?.round;
  if (game === "dice" && round?.dice) {
    const { target, over, roll } = round.dice;
    return { game, target, over, roll };
  }
  if (game === "limbo" && round?.limbo) return { game, target: round.limbo.target, result: round.limbo.result };
  if (game === "flip" && round?.flip) {
    const { side, flips, coins } = round.flip;
    const results = Array.from({ length: flips }, (_, i): FlipSide => flip.SIDES[(coins >> i) & 1]);
    return { game, side: "heads" in side ? "heads" : "tails", flips, results };
  }
  if (game === "keno" && round?.keno) {
    const { picks, nPicks, drawn } = round.keno;
    return { game, picks: picks.slice(0, nPicks), drawn };
  }
  if (game === "wheel" && round?.wheel) {
    const { segments, risk, segment } = round.wheel;
    const name = wheel.RISKS.find((r) => r in risk);
    if (!name) throw new Error("unknown wheel risk");
    return { game, segments, risk: name, segment };
  }
  throw new Error(`${game} round without its quick table`);
}

function hiloGuess(code: number) {
  const guess = hilo.GUESSES[code];
  if (!guess) throw new Error(`unknown hilo guess ${code}`);
  return guess;
}

function hiloOutcome(b: GameAccounts["hilo"]): Outcome {
  if (!b) throw new Error("hilo round without a board");
  return {
    game: "hilo",
    cards: b.cards.slice(0, b.nCards),
    guesses: b.guesses.slice(0, Math.max(0, b.nCards - 1)).map(hiloGuess),
    pending: b.pending === hilo.NO_GUESS ? null : hiloGuess(b.pending),
    busted: b.busted,
    maxGain: big(b.maxGain).toString(),
  };
}

function towerOutcome(b: GameAccounts["tower"]): Outcome {
  if (!b) throw new Error("tower round without a board");
  const difficulty = tower.DIFFICULTY_NAMES.find((d) => d in b.difficulty);
  if (!difficulty) throw new Error("unknown tower difficulty");
  return {
    game: "tower",
    difficulty,
    climbed: b.climbed.slice(0, b.level),
    pending: tileOrNull(b.pending),
    busted: tileOrNull(b.busted),
    maxGain: big(b.maxGain).toString(),
  };
}

function outcome(r: RoundData, pdas: GameAccounts): Outcome {
  if ("blackjack" in r.game) return blackjackOutcome(pdas.table);
  if ("mines" in r.game) return minesOutcome(pdas.mines);
  if ("hilo" in r.game) return hiloOutcome(pdas.hilo);
  if ("tower" in r.game) return towerOutcome(pdas.tower);
  for (const game of ["dice", "limbo", "flip", "keno", "wheel"] as const) {
    if (game in r.game) return quickOutcome(game, pdas.quick);
  }
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

export function decodeRound(r: RoundData, pdas: GameAccounts): ChainRound {
  return {
    status: status(r.status),
    stake: big(r.stake),
    payout: big(r.payout),
    fee: big(r.fee),
    requestId: big(r.requestId),
    outcome: outcome(r, pdas),
  };
}

export function decodePlayer(a: PlayerAccountData, pdas: GameAccounts): PlayerState {
  return {
    balance: big(a.balance),
    credited: big(a.credited),
    withdrawn: big(a.withdrawn),
    fees: big(a.fees),
    rounds: a.rounds,
    round: decodeRound(a.round, pdas),
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

  /** The account and the player's game PDAs, read together so the round and its cards, tiles
   *  or draw match. */
  async playerAccount(player: PublicKey): Promise<PlayerState | null> {
    const [account, table, mines, quick, hiloBoard, towerBoard] = await this.rollup.getMultipleAccountsInfo([
      playerAccountAddress(player),
      tableAddress(player),
      minesBoardAddress(player),
      quickTableAddress(player),
      hiloBoardAddress(player),
      towerBoardAddress(player),
    ]);
    if (!account) return null;
    const accounts = this.rollupProgram.coder.accounts;
    return decodePlayer(accounts.decode<PlayerAccountData>("playerAccount", account.data), {
      table: table ? accounts.decode<GameAccounts["table"]>("blackjackTable", table.data) : null,
      mines: mines ? accounts.decode<GameAccounts["mines"]>("minesBoard", mines.data) : null,
      quick: quick ? accounts.decode<GameAccounts["quick"]>("quickTable", quick.data) : null,
      hilo: hiloBoard ? accounts.decode<GameAccounts["hilo"]>("hiloBoard", hiloBoard.data) : null,
      tower: towerBoard ? accounts.decode<GameAccounts["tower"]>("towerBoard", towerBoard.data) : null,
    });
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
