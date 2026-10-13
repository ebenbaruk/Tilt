// Indexes the program's rollup activity: RoundSettled events (one per settled round) and every
// VRF callback (blackjack rounds take several draws, and only the last one is in the event).
// Live feed from `onLogs`, plus a periodic backfill from a signature cursor that catches
// anything the websocket missed. Never crashes the process: errors are logged and retried.
import anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { idl, PROGRAM_ID, playerAccountAddress } from "@tilt/contract";
import type { Game } from "@tilt/mod/protocol";
import type { ChainReader } from "./chain";
import type { Db } from "./db";
import { VRF_BYTES } from "./games/rng";
import { log } from "./log";
import { saveDetail, saveDraw, saveRound, type DrawRecord, type SettledRound } from "./rounds";

const coder = new anchor.BorshCoder(idl as anchor.Idl);
const eventParser = new anchor.EventParser(PROGRAM_ID, coder);
const CALLBACK_LOG = "Program log: Instruction: ConsumeRandomness";
const CURSOR = "rollup";
const PAGE = 1_000;
/** Pages per backfill run; beyond, the gap is logged (the live feed covers normal operation). */
const MAX_PAGES = 50;
const RESUBSCRIBE_MAX_MS = 60_000;

export interface SignatureInfo {
  signature: string;
  failed: boolean;
}

export interface FetchedTransaction {
  logs: string[];
  blockTime: Date | null;
  draws: Omit<DrawRecord, "signature">[];
}

/** The rollup as the indexer needs it; `ConnectionSource` in production, a fake in tests. */
export interface RollupSource {
  subscribe(onLogs: (signature: string, logs: string[]) => void): Promise<() => Promise<void>>;
  /** Newest first, strictly after `until` and before `before`. */
  signatures(options: { until?: string; before?: string; limit: number }): Promise<SignatureInfo[]>;
  transaction(signature: string): Promise<FetchedTransaction | null>;
}

const GAMES: Record<string, Game> = {
  Blackjack: "blackjack",
  Roulette: "roulette",
  Baccarat: "baccarat",
  Slots: "slots",
};

const bigOf = (v: unknown) => BigInt(String(v));

function randomnessOf(v: unknown): Buffer {
  if (!Array.isArray(v) || v.length !== VRF_BYTES) throw new Error("randomness must be 32 bytes");
  return Buffer.from(v as number[]);
}

/** RoundSettled events in a transaction's logs (snake_case fields, as the IDL names them). */
export function parseSettled(signature: string, logs: string[], settledAt: Date): SettledRound[] {
  const rounds: SettledRound[] = [];
  for (const event of eventParser.parseLogs(logs)) {
    if (event.name !== "RoundSettled") continue;
    const d = event.data as Record<string, unknown>;
    const game = GAMES[Object.keys(d.game as object)[0]];
    if (!game) throw new Error("unknown game in RoundSettled");
    rounds.push({
      signature,
      player: (d.player as PublicKey).toBase58(),
      round: Number(d.round),
      game,
      stake: bigOf(d.stake),
      payout: bigOf(d.payout),
      fee: bigOf(d.fee),
      requestId: bigOf(d.request_id),
      randomness: randomnessOf(d.randomness),
      settledAt,
    });
  }
  return rounds;
}

export interface RawInstruction {
  programId: PublicKey;
  accounts: PublicKey[];
  data: Buffer;
}

/** `consume_randomness` calls among a transaction's instructions (top level or CPI). */
export function decodeCallbacks(instructions: RawInstruction[]): Omit<DrawRecord, "signature">[] {
  const draws: Omit<DrawRecord, "signature">[] = [];
  for (const ix of instructions) {
    if (!ix.programId.equals(PROGRAM_ID)) continue;
    const decoded = coder.instruction.decode(ix.data);
    if (decoded?.name !== "consume_randomness") continue;
    const args = decoded.data as Record<string, unknown>;
    // Accounts: vrf_program_identity, account (the player account).
    const account = ix.accounts[1];
    if (!account) throw new Error("consume_randomness without its player account");
    draws.push({
      account: account.toBase58(),
      requestId: bigOf(args.request_id),
      randomness: randomnessOf(args.randomness),
    });
  }
  return draws;
}

/** Every instruction of a fetched transaction, CPIs included, with resolved accounts. */
function instructionsOf(tx: VersionedTransactionResponse): RawInstruction[] {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
  const resolve = (programIdIndex: number, accounts: number[], data: Buffer): RawInstruction => {
    const programId = keys.get(programIdIndex);
    if (!programId) throw new Error("instruction references an unknown account");
    return { programId, accounts: accounts.map((i) => keys.get(i) ?? PublicKey.default), data };
  };
  const top = tx.transaction.message.compiledInstructions.map((ix) =>
    resolve(ix.programIdIndex, ix.accountKeyIndexes, Buffer.from(ix.data)),
  );
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) =>
    group.instructions.map((ix) =>
      resolve(ix.programIdIndex, ix.accounts, Buffer.from(anchor.utils.bytes.bs58.decode(ix.data))),
    ),
  );
  return [...top, ...inner];
}

export class ConnectionSource implements RollupSource {
  constructor(private readonly connection: Connection) {}

  async subscribe(onLogs: (signature: string, logs: string[]) => void): Promise<() => Promise<void>> {
    const id = this.connection.onLogs(
      PROGRAM_ID,
      (l) => {
        if (!l.err) onLogs(l.signature, l.logs);
      },
      "confirmed",
    );
    return () => this.connection.removeOnLogsListener(id);
  }

  async signatures(options: { until?: string; before?: string; limit: number }): Promise<SignatureInfo[]> {
    const infos = await this.connection.getSignaturesForAddress(PROGRAM_ID, options, "confirmed");
    return infos.map((i) => ({ signature: i.signature, failed: i.err !== null }));
  }

  async transaction(signature: string): Promise<FetchedTransaction | null> {
    const tx = await this.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || tx.meta?.err) return null;
    return {
      logs: tx.meta?.logMessages ?? [],
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
      draws: decodeCallbacks(instructionsOf(tx)),
    };
  }
}

export class Indexer {
  private unsubscribe: (() => Promise<void>) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private live: Promise<void> = Promise.resolve();
  private backfilling: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly source: RollupSource,
    private readonly chain: Pick<ChainReader, "playerAccount">,
    private readonly backfillMs: number,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.subscribe(1_000);
    this.timer = setInterval(() => void this.backfill(), this.backfillMs);
    void this.backfill();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.unsubscribe?.().catch((e: unknown) => log.error("indexer unsubscribe failed", e));
    await Promise.allSettled([this.live, this.backfilling]);
  }

  /** One backfill run (never two at once); errors are logged and the next run retries. */
  backfill(): Promise<void> {
    this.backfilling ??= this.catchUp()
      .catch((e: unknown) => log.error("indexer backfill failed", e))
      .finally(() => (this.backfilling = undefined));
    return this.backfilling;
  }

  /** Indexes one transaction from its logs; fetches it only for draws without an event. */
  async process(signature: string, logs: string[], settledAt: Date, fetched?: FetchedTransaction): Promise<void> {
    const settled = this.settledEvents(signature, logs, settledAt);
    for (const round of settled) {
      const account = playerAccountAddress(new PublicKey(round.player)).toBase58();
      await saveRound(this.db, round);
      await saveDraw(this.db, { account, requestId: round.requestId, randomness: round.randomness, signature });
      await this.snapshot(round);
    }
    if (settled.length > 0 || !logs.includes(CALLBACK_LOG)) return;
    const tx = fetched ?? (await this.source.transaction(signature));
    for (const draw of tx?.draws ?? []) await saveDraw(this.db, { ...draw, signature });
  }

  private settledEvents(signature: string, logs: string[], settledAt: Date): SettledRound[] {
    try {
      return parseSettled(signature, logs, settledAt);
    } catch (e) {
      // Malformed data cannot get better by retrying: log it and move on.
      log.error("undecodable RoundSettled", e, { signature });
      return [];
    }
  }

  /** Reads the account right after settlement: while the player has not started another round,
   *  it still holds this round's bet and cards (kept for display and /verify). */
  private async snapshot(round: SettledRound): Promise<void> {
    try {
      const account = await this.chain.playerAccount(new PublicKey(round.player));
      const r = account?.round;
      if (!account || !r || account.rounds !== round.round || r.requestId !== round.requestId) return;
      if (r.status.kind !== "idle") return;
      await saveDetail(this.db, round.player, round.round, round.requestId, r.outcome);
    } catch (e) {
      log.warn("round snapshot skipped", { signature: round.signature, error: String(e) });
    }
  }

  private async subscribe(delayMs: number): Promise<void> {
    if (this.stopped) return;
    try {
      this.unsubscribe = await this.source.subscribe((signature, logs) => {
        this.live = this.live
          .then(() => this.process(signature, logs, new Date()))
          .catch((e: unknown) => log.error("indexer live event failed", e, { signature }));
      });
    } catch (e) {
      log.error("indexer subscription failed, retrying", e, { delayMs });
      setTimeout(() => void this.subscribe(Math.min(delayMs * 2, RESUBSCRIBE_MAX_MS)), delayMs).unref();
    }
  }

  private async cursor(): Promise<string | undefined> {
    const { rows } = await this.db.query<{ signature: string }>(
      "SELECT signature FROM indexer_cursor WHERE name = $1",
      [CURSOR],
    );
    return rows[0]?.signature;
  }

  private async advance(signature: string): Promise<void> {
    await this.db.query(
      `INSERT INTO indexer_cursor (name, signature) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET signature = EXCLUDED.signature, updated_at = now()`,
      [CURSOR, signature],
    );
  }

  /** Every signature after the cursor, oldest first. */
  private async newSignatures(until: string | undefined): Promise<SignatureInfo[]> {
    const found: SignatureInfo[] = [];
    let before: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.source.signatures({ until, before, limit: PAGE });
      found.push(...batch);
      if (batch.length < PAGE) return found.reverse();
      before = batch[batch.length - 1].signature;
    }
    log.warn("indexer backfill truncated; older signatures skipped", { pages: MAX_PAGES });
    return found.reverse();
  }

  /** Transient failures (RPC, database) stop the run at the last indexed signature. */
  private async catchUp(): Promise<void> {
    for (const info of await this.newSignatures(await this.cursor())) {
      if (this.stopped) return;
      if (!info.failed) {
        const tx = await this.source.transaction(info.signature);
        if (tx) await this.process(info.signature, tx.logs, tx.blockTime ?? new Date(), tx);
      }
      await this.advance(info.signature);
    }
  }
}
