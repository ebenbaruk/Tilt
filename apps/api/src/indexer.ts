// Indexes the program's rollup activity: RoundSettled events (one per settled round) and every
// VRF callback (blackjack, mines, hilo and tower rounds take several draws, and only the last one
// is in the event).
// Live feed from `onLogs`, plus a periodic backfill from a signature cursor that catches
// anything the websocket missed. Never crashes the process: errors are logged and retried.
import anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { idl, PROGRAM_ID, playerAccountAddress } from "@tilt/contract";
import type { Game } from "@tilt/mod/protocol";
import { z } from "zod";
import { RPC_TIMEOUT_MS, type ChainReader } from "./chain";
import { transaction, type Db, type Queryable } from "./db";
import { VRF_BYTES } from "./games/rng";
import { log } from "./log";
import { isCashout, saveDetail, saveDraw, saveRound, type DrawRecord, type SettledRound } from "./rounds";

const coder = new anchor.BorshCoder(idl as anchor.Idl);
/** VRF callbacks: blackjack, roulette, baccarat and slots draws, mines reveals, the one-draw
 *  games' draws (quick table), hilo cards, tower climbs and roulette chips spins. */
const CALLBACK_LOGS = [
  "Program log: Instruction: ConsumeRandomness",
  "Program log: Instruction: ConsumeMinesRandomness",
  "Program log: Instruction: ConsumeQuickRandomness",
  "Program log: Instruction: ConsumeHiloRandomness",
  "Program log: Instruction: ConsumeTowerRandomness",
  "Program log: Instruction: ConsumeRouletteRandomness",
];
const CALLBACKS = new Set([
  "consume_randomness",
  "consume_mines_randomness",
  "consume_quick_randomness",
  "consume_hilo_randomness",
  "consume_tower_randomness",
  "consume_roulette_randomness",
]);
const PROGRAM = PROGRAM_ID.toBase58();
const PROGRAM_DATA = "Program data: ";
const INVOKE_LOG = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/;
const EXIT_LOG = /^Program [1-9A-HJ-NP-Za-km-z]+ (success|failed)/;
const CURSOR = "rollup";
const PAGE = 1_000;
/** Failed runs in a row on one signature before it counts as stuck and may be skipped. */
export const STUCK_RUNS = 3;
/** Pages per backfill run; beyond, the gap is logged (the live feed covers normal operation). */
const MAX_PAGES = 50;
const RESUBSCRIBE_MAX_MS = 60_000;
/** How late a transaction may appear in the signature listing after its block time. */
const LISTING_LAG_MS = 10_000;

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
  Mines: "mines",
  Dice: "dice",
  Limbo: "limbo",
  Flip: "flip",
  Keno: "keno",
  Wheel: "wheel",
  Hilo: "hilo",
  Tower: "tower",
};

const bigOf = (v: unknown) => BigInt(String(v));

function randomnessOf(v: unknown): Buffer {
  if (!Array.isArray(v) || v.length !== VRF_BYTES) throw new Error("randomness must be 32 bytes");
  return Buffer.from(v as number[]);
}

/** `Program data:` payloads emitted by the Tilt program itself, at any CPI depth. Anchor's
 *  EventParser drops events of a program invoked by another one, and every VRF callback (the
 *  instruction that settles rounds) is a CPI from the VRF program. */
function programData(logs: string[]): string[] {
  const stack: string[] = [];
  const payloads: string[] = [];
  for (const line of logs) {
    const invoked = INVOKE_LOG.exec(line);
    if (invoked) stack.push(invoked[1]);
    else if (EXIT_LOG.test(line)) stack.pop();
    else if (line.startsWith(PROGRAM_DATA) && stack.at(-1) === PROGRAM) payloads.push(line.slice(PROGRAM_DATA.length));
  }
  return payloads;
}

/** RoundSettled events in a transaction's logs (snake_case fields, as the IDL names them). */
export function parseSettled(signature: string, logs: string[], settledAt: Date): SettledRound[] {
  const rounds: SettledRound[] = [];
  for (const payload of programData(logs)) {
    const event = coder.events.decode(payload);
    if (event?.name !== "RoundSettled") continue;
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

/** VRF callbacks (`CALLBACKS`) among a transaction's instructions (top level or CPI). */
export function decodeCallbacks(instructions: RawInstruction[]): Omit<DrawRecord, "signature">[] {
  const draws: Omit<DrawRecord, "signature">[] = [];
  for (const ix of instructions) {
    if (!ix.programId.equals(PROGRAM_ID)) continue;
    const decoded = coder.instruction.decode(ix.data);
    if (!decoded || !CALLBACKS.has(decoded.name)) continue;
    const args = decoded.data as Record<string, unknown>;
    // Accounts: vrf_program_identity, account (the player account), then the game's PDA if any.
    const account = ix.accounts[1];
    if (!account) throw new Error(`${decoded.name} without its player account`);
    draws.push({
      account: account.toBase58(),
      requestId: bigOf(args.request_id),
      randomness: randomnessOf(args.randomness),
    });
  }
  return draws;
}

/** `getTransaction` with the base64 encoding. Not json: the rollup's RPC never answers the
 *  json encoding of its own huge internal transactions (~1 MB program loads, 2026-11-24 and 27),
 *  which blocked the backfill. */
const RawTransaction = z.object({
  blockTime: z.number().nullish(),
  transaction: z.tuple([z.string(), z.literal("base64")]),
  meta: z
    .object({
      err: z.unknown(),
      logMessages: z.array(z.string()).nullish(),
      loadedAddresses: z.object({ writable: z.array(z.string()), readonly: z.array(z.string()) }).nullish(),
      innerInstructions: z
        .array(
          z.object({
            instructions: z.array(
              z.object({ programIdIndex: z.number(), accounts: z.array(z.number()), data: z.string() }),
            ),
          }),
        )
        .nullish(),
    })
    .nullable(),
});
export type RawTransaction = z.infer<typeof RawTransaction>;

const RpcResponse = z.object({
  result: RawTransaction.nullish(),
  error: z.object({ message: z.string() }).optional(),
});

/** Every instruction of a fetched transaction, CPIs included, with resolved accounts. */
function instructionsOf(raw: RawTransaction): RawInstruction[] {
  const { message } = VersionedTransaction.deserialize(Buffer.from(raw.transaction[0], "base64"));
  const loaded = raw.meta?.loadedAddresses;
  const keys = message.getAccountKeys({
    accountKeysFromLookups: loaded && {
      writable: loaded.writable.map((k) => new PublicKey(k)),
      readonly: loaded.readonly.map((k) => new PublicKey(k)),
    },
  });
  const resolve = (programIdIndex: number, accounts: number[], data: Buffer): RawInstruction => {
    const programId = keys.get(programIdIndex);
    if (!programId) throw new Error("instruction references an unknown account");
    return { programId, accounts: accounts.map((i) => keys.get(i) ?? PublicKey.default), data };
  };
  const top = message.compiledInstructions.map((ix) =>
    resolve(ix.programIdIndex, ix.accountKeyIndexes, Buffer.from(ix.data)),
  );
  const inner = (raw.meta?.innerInstructions ?? []).flatMap((group) =>
    group.instructions.map((ix) =>
      resolve(ix.programIdIndex, ix.accounts, Buffer.from(anchor.utils.bytes.bs58.decode(ix.data))),
    ),
  );
  return [...top, ...inner];
}

/** A fetched transaction as the indexer needs it; null for a failed one. Instructions are only
 *  decoded when the logs show a VRF callback: the rollup's own transactions use a message
 *  version web3.js cannot read. */
export function decodeTransaction(raw: RawTransaction): FetchedTransaction | null {
  if (raw.meta?.err) return null;
  const logs = raw.meta?.logMessages ?? [];
  return {
    logs,
    blockTime: raw.blockTime ? new Date(raw.blockTime * 1000) : null,
    draws: logs.some((l) => CALLBACK_LOGS.includes(l)) ? decodeCallbacks(instructionsOf(raw)) : [],
  };
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
    const response = await fetch(this.connection.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`getTransaction: HTTP ${response.status}`);
    const body = RpcResponse.parse(await response.json());
    if (body.error) throw new Error(`getTransaction: ${body.error.message}`);
    return body.result ? decodeTransaction(body.result) : null;
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
      if (!isCashout(round)) {
        await saveDraw(this.db, { account, requestId: round.requestId, randomness: round.randomness, signature });
      }
      await this.snapshot(round);
    }
    if (settled.length > 0 || !logs.some((l) => CALLBACK_LOGS.includes(l))) return;
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

  private async advance(signature: string, blockTime: Date | null): Promise<void> {
    await this.db.query(
      `INSERT INTO indexer_cursor (name, signature, indexed_through) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET signature = EXCLUDED.signature, updated_at = now(),
         indexed_through = GREATEST(indexer_cursor.indexed_through, EXCLUDED.indexed_through)`,
      [CURSOR, signature, blockTime],
    );
  }

  private async indexedThrough(at: Date): Promise<void> {
    await this.db.query("UPDATE indexer_cursor SET indexed_through = GREATEST(indexed_through, $2) WHERE name = $1", [
      CURSOR,
      at,
    ]);
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

  /** Transient failures (RPC, database) stop the run at the last indexed signature. A run that
   *  completes has seen everything listed when it started (give or take the listing lag). */
  private async catchUp(): Promise<void> {
    const startedAt = Date.now();
    for (const info of await this.newSignatures(await this.cursor())) {
      if (this.stopped) return;
      try {
        const tx = info.failed ? null : await this.source.transaction(info.signature);
        if (tx) await this.process(info.signature, tx.logs, tx.blockTime ?? new Date(), tx);
        await this.advance(info.signature, tx?.blockTime ?? null);
      } catch (e) {
        const runs = await this.failedOn(info.signature);
        if (runs < STUCK_RUNS) log.error("indexer backfill failed", e, { signature: info.signature, runs });
        else log.error("indexer backfill stuck; see admin indexer:skip", e, { signature: info.signature, runs });
        return;
      }
    }
    await this.db.query("DELETE FROM indexer_stuck WHERE name = $1", [CURSOR]);
    await this.indexedThrough(new Date(startedAt - LISTING_LAG_MS));
  }

  /** Counts the runs in a row that failed on `signature`; returns that count. */
  private async failedOn(signature: string): Promise<number> {
    const { rows } = await this.db.query<{ runs: number }>(
      `INSERT INTO indexer_stuck (name, signature, runs) VALUES ($1, $2, 1)
       ON CONFLICT (name) DO UPDATE SET
         runs = CASE WHEN indexer_stuck.signature = EXCLUDED.signature THEN indexer_stuck.runs + 1 ELSE 1 END,
         since = CASE WHEN indexer_stuck.signature = EXCLUDED.signature THEN indexer_stuck.since ELSE now() END,
         signature = EXCLUDED.signature
       RETURNING runs`,
      [CURSOR, signature],
    );
    return rows[0].runs;
  }
}

/** Moves the backfill cursor onto the signature it is stuck on, so the next run resumes right
 *  after it and that one transaction is never indexed. Refuses any other signature, and one that
 *  has not failed STUCK_RUNS runs in a row: a passing outage, or a pasted signature further on,
 *  would silently drop rounds from competitions. */
export async function skipTo(db: Db, signature: string): Promise<{ previous: string | null; runs: number }> {
  return transaction(db, async (client) => {
    const stuck = await client.query<{ signature: string; runs: number }>(
      "SELECT signature, runs FROM indexer_stuck WHERE name = $1 FOR UPDATE",
      [CURSOR],
    );
    const row = stuck.rows[0];
    if (!row || row.signature !== signature) throw new Error("the backfill is not stuck on this signature");
    if (row.runs < STUCK_RUNS) throw new Error(`failed ${row.runs} run(s) only; wait for ${STUCK_RUNS} in a row`);
    const { rows } = await client.query<{ previous: string | null }>(
      `WITH previous AS (SELECT signature FROM indexer_cursor WHERE name = $1)
       INSERT INTO indexer_cursor (name, signature) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET signature = EXCLUDED.signature, updated_at = now()
       RETURNING (SELECT signature FROM previous) AS previous`,
      [CURSOR, signature],
    );
    await client.query("DELETE FROM indexer_stuck WHERE name = $1", [CURSOR]);
    return { previous: rows[0].previous, runs: row.runs };
  });
}

/** Every round settled before this time is indexed; null before the first backfill. */
export async function indexedThrough(db: Queryable): Promise<Date | null> {
  const { rows } = await db.query<{ indexed_through: Date | null }>(
    "SELECT indexed_through FROM indexer_cursor WHERE name = $1",
    [CURSOR],
  );
  return rows[0]?.indexed_through ?? null;
}
