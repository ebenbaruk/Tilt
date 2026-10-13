// Indexer against Postgres with a fake rollup: events and VRF callbacks encoded with the real IDL.
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { idl, PROGRAM_ID, playerAccountAddress } from "@tilt/contract";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  decodeCallbacks,
  Indexer,
  parseSettled,
  type FetchedTransaction,
  type RollupSource,
  type SignatureInfo,
} from "../src/indexer";
import { FakeChain, idleAccount, must, resetDb, testDb } from "./helpers";

const coder = new anchor.BorshCoder(idl as anchor.Idl);
const EVENT_DISCRIMINATOR = Buffer.from(
  must(
    idl.events.find((e) => e.name === "RoundSettled"),
    "RoundSettled",
  ).discriminator,
);
const PROGRAM = PROGRAM_ID.toBase58();

function settledLogs(player: PublicKey, round: number, requestId: number, randomness: number): string[] {
  const data = coder.types.encode("RoundSettled", {
    player,
    round,
    game: { Slots: {} },
    stake: new anchor.BN(1_000_000),
    payout: new anchor.BN(0),
    fee: new anchor.BN(0),
    request_id: new anchor.BN(requestId),
    randomness: Array(32).fill(randomness),
  });
  return [
    `Program ${PROGRAM} invoke [1]`,
    "Program log: Instruction: ConsumeRandomness",
    `Program data: ${Buffer.concat([EVENT_DISCRIMINATOR, data]).toString("base64")}`,
    `Program ${PROGRAM} success`,
  ];
}

const callbackLogs = [
  `Program ${PROGRAM} invoke [2]`,
  "Program log: Instruction: ConsumeRandomness",
  `Program ${PROGRAM} success`,
];

const callbackData = (requestId: number, byte: number) =>
  coder.instruction.encode("consume_randomness", {
    randomness: Array(32).fill(byte),
    request_id: new anchor.BN(requestId),
  });

class FakeSource implements RollupSource {
  /** Newest last. */
  history: (SignatureInfo & { tx: FetchedTransaction })[] = [];
  listener: ((signature: string, logs: string[]) => void) | undefined;
  fetched: string[] = [];
  failNextSignatures = false;

  async subscribe(onLogs: (signature: string, logs: string[]) => void) {
    this.listener = onLogs;
    return async () => {
      this.listener = undefined;
    };
  }

  async signatures({ until, before, limit }: { until?: string; before?: string; limit: number }) {
    if (this.failNextSignatures) {
      this.failNextSignatures = false;
      throw new Error("rpc down");
    }
    const newestFirst = [...this.history].reverse();
    const from = before ? newestFirst.findIndex((h) => h.signature === before) + 1 : 0;
    const to = until ? newestFirst.findIndex((h) => h.signature === until) : newestFirst.length;
    return newestFirst.slice(from, to === -1 ? newestFirst.length : to).slice(0, limit);
  }

  async transaction(signature: string) {
    this.fetched.push(signature);
    return this.history.find((h) => h.signature === signature)?.tx ?? null;
  }

  add(signature: string, logs: string[], draws: FetchedTransaction["draws"] = [], failed = false) {
    this.history.push({ signature, failed, tx: { logs, blockTime: new Date("2026-10-13T10:00:00Z"), draws } });
  }
}

const db = await testDb();

describe("decoding", () => {
  it("parses RoundSettled from program logs", () => {
    const player = Keypair.generate().publicKey;
    const [r] = parseSettled("sig", settledLogs(player, 7, 12, 3), new Date(0));
    expect(r).toMatchObject({
      signature: "sig",
      player: player.toBase58(),
      round: 7,
      game: "slots",
      stake: 1_000_000n,
      requestId: 12n,
    });
    expect(r.randomness).toEqual(Buffer.alloc(32, 3));
    const other = Keypair.generate().publicKey.toBase58();
    expect(parseSettled("sig", [`Program ${other} invoke [1]`, `Program ${other} success`], new Date(0))).toEqual([]);
  });

  it("finds consume_randomness calls among a transaction's instructions", () => {
    const account = Keypair.generate().publicKey;
    const draws = decodeCallbacks([
      { programId: Keypair.generate().publicKey, accounts: [], data: callbackData(1, 1) },
      { programId: PROGRAM_ID, accounts: [Keypair.generate().publicKey, account], data: callbackData(5, 9) },
    ]);
    expect(draws).toEqual([{ account: account.toBase58(), requestId: 5n, randomness: Buffer.alloc(32, 9) }]);
  });
});

describe.skipIf(!db)("indexer", () => {
  if (!db) return;
  const player = Keypair.generate().publicKey;
  const account = playerAccountAddress(player).toBase58();
  let source: FakeSource;
  let chain: FakeChain;
  let indexer: Indexer;

  afterAll(() => db.end());
  beforeEach(async () => {
    await resetDb(db);
    source = new FakeSource();
    chain = new FakeChain();
    indexer = new Indexer(db, source, chain, 60_000);
  });

  const count = async (table: string) => Number((await db.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  it("backfills settled rounds and mid-hand draws, oldest first, then resumes from its cursor", async () => {
    source.add("s1", callbackLogs, [{ account, requestId: 1n, randomness: Buffer.alloc(32, 1) }]);
    source.add("s2", settledLogs(player, 1, 2, 2));
    source.add("s3", ["Program log: unrelated"], [], true);
    await indexer.backfill();
    const { rows } = await db.query("SELECT signature, round, settled_at FROM rounds");
    expect(rows).toEqual([{ signature: "s2", round: 1, settled_at: new Date("2026-10-13T10:00:00Z") }]);
    const draws = await db.query("SELECT request_id, signature FROM draws WHERE account = $1 ORDER BY request_id", [
      account,
    ]);
    expect(draws.rows).toEqual([
      { request_id: "1", signature: "s1" },
      { request_id: "2", signature: "s2" },
    ]);
    expect(source.fetched).toEqual(["s1", "s2"]);

    source.fetched = [];
    source.add("s4", settledLogs(player, 2, 3, 4));
    await indexer.backfill();
    expect(source.fetched).toEqual(["s4"]);
    expect(await count("rounds")).toBe(2);
  });

  it("indexes the live feed idempotently and snapshots the round while the account still holds it", async () => {
    chain.accounts.set(
      player.toBase58(),
      idleAccount({
        rounds: 1,
        round: {
          status: { kind: "idle" },
          stake: 1_000_000n,
          payout: 0n,
          fee: 0n,
          requestId: 2n,
          outcome: { game: "slots", reels: [1, 2, 3] },
        },
      }),
    );
    await indexer.start();
    source.listener?.("live1", settledLogs(player, 1, 2, 5));
    source.listener?.("live1", settledLogs(player, 1, 2, 5));
    await indexer.stop();
    const { rows } = await db.query("SELECT detail FROM rounds");
    expect(rows).toEqual([{ detail: { game: "slots", reels: [1, 2, 3] } }]);
  });

  it("does not snapshot a round the player has already moved past", async () => {
    chain.accounts.set(player.toBase58(), idleAccount({ rounds: 2 }));
    await indexer.process("x", settledLogs(player, 1, 2, 5), new Date());
    expect((await db.query("SELECT detail FROM rounds")).rows).toEqual([{ detail: null }]);
  });

  it("skips undecodable events and keeps going", async () => {
    const broken = [`Program ${PROGRAM} invoke [1]`, "Program data: AAAA", `Program ${PROGRAM} success`];
    source.add("bad", broken);
    source.add("good", settledLogs(player, 1, 2, 2));
    await indexer.backfill();
    expect(await count("rounds")).toBe(1);
  });

  it("survives RPC failures: the next run picks up where it stopped", async () => {
    source.add("s1", settledLogs(player, 1, 1, 1));
    source.failNextSignatures = true;
    await indexer.backfill();
    expect(await count("rounds")).toBe(0);
    await indexer.backfill();
    expect(await count("rounds")).toBe(1);
  });
});
