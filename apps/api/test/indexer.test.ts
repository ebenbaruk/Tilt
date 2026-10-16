// Indexer against Postgres with a fake rollup: events and VRF callbacks encoded with the real IDL.
import anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { idl, PROGRAM_ID, playerAccountAddress } from "@tilt/contract";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  decodeCallbacks,
  Indexer,
  indexedThrough,
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

function settledLogs(
  player: PublicKey,
  round: number,
  requestId: number,
  randomness: number,
  game = "Slots",
  instruction = "ConsumeRandomness",
): string[] {
  const data = coder.types.encode("RoundSettled", {
    player,
    round,
    game: { [game]: {} },
    stake: new anchor.BN(1_000_000),
    payout: new anchor.BN(0),
    fee: new anchor.BN(0),
    request_id: new anchor.BN(requestId),
    randomness: Array(32).fill(randomness),
  });
  return [
    `Program ${PROGRAM} invoke [1]`,
    `Program log: Instruction: ${instruction}`,
    `Program data: ${Buffer.concat([EVENT_DISCRIMINATOR, data]).toString("base64")}`,
    `Program ${PROGRAM} success`,
  ];
}

const callbackLogs = [
  `Program ${PROGRAM} invoke [2]`,
  "Program log: Instruction: ConsumeRandomness",
  `Program ${PROGRAM} success`,
];

const callbackLogsOf = (instruction: string) => [
  `Program ${PROGRAM} invoke [2]`,
  `Program log: Instruction: ${instruction}`,
  `Program ${PROGRAM} success`,
];
const minesCallbackLogs = callbackLogsOf("ConsumeMinesRandomness");

const callbackData = (requestId: number, byte: number, name = "consume_randomness") =>
  coder.instruction.encode(name, {
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

  it("parses RoundSettled emitted inside the VRF program's callback CPI (real log shape)", () => {
    const player = Keypair.generate().publicKey;
    const vrf = Keypair.generate().publicKey.toBase58();
    const [, ...inner] = settledLogs(player, 3, 9, 1);
    const logs = [
      "Program ComputeBudget111111111111111111111111111111 invoke [1]",
      "Program ComputeBudget111111111111111111111111111111 success",
      `Program ${vrf} invoke [1]`,
      `Program ${PROGRAM} invoke [2]`,
      ...inner,
      `Program ${vrf} success`,
    ];
    expect(parseSettled("sig", logs, new Date(0))).toMatchObject([{ round: 3, requestId: 9n }]);
    // The same payload logged by another program is not ours.
    const spoofed = [`Program ${vrf} invoke [1]`, inner[1], `Program ${vrf} success`];
    expect(parseSettled("sig", spoofed, new Date(0))).toEqual([]);
  });

  it("finds consume_randomness calls among a transaction's instructions", () => {
    const account = Keypair.generate().publicKey;
    const draws = decodeCallbacks([
      { programId: Keypair.generate().publicKey, accounts: [], data: callbackData(1, 1) },
      { programId: PROGRAM_ID, accounts: [Keypair.generate().publicKey, account], data: callbackData(5, 9) },
    ]);
    expect(draws).toEqual([{ account: account.toBase58(), requestId: 5n, randomness: Buffer.alloc(32, 9) }]);
  });

  it("finds consume_mines_randomness calls too, the player account second", () => {
    const account = Keypair.generate().publicKey;
    const board = Keypair.generate().publicKey;
    const draws = decodeCallbacks([
      {
        programId: PROGRAM_ID,
        accounts: [Keypair.generate().publicKey, account, board],
        data: callbackData(3, 4, "consume_mines_randomness"),
      },
    ]);
    expect(draws).toEqual([{ account: account.toBase58(), requestId: 3n, randomness: Buffer.alloc(32, 4) }]);
  });

  it("parses a mines RoundSettled, a cash-out's included (zero randomness)", () => {
    const player = Keypair.generate().publicKey;
    const [r] = parseSettled("sig", settledLogs(player, 2, 6, 0, "Mines", "MinesCashout"), new Date(0));
    expect(r).toMatchObject({ game: "mines", round: 2, requestId: 6n });
    expect(r.randomness).toEqual(Buffer.alloc(32));
  });

  it("finds the quick table, hilo and tower callbacks, the player account second", () => {
    const account = Keypair.generate().publicKey;
    const names = ["consume_quick_randomness", "consume_hilo_randomness", "consume_tower_randomness"];
    const draws = decodeCallbacks(
      names.map((name, i) => ({
        programId: PROGRAM_ID,
        accounts: [Keypair.generate().publicKey, account, Keypair.generate().publicKey],
        data: callbackData(i + 1, i + 1, name),
      })),
    );
    expect(draws).toEqual(
      names.map((_, i) => ({
        account: account.toBase58(),
        requestId: BigInt(i + 1),
        randomness: Buffer.alloc(32, i + 1),
      })),
    );
  });

  it("parses RoundSettled of every new game", () => {
    const player = Keypair.generate().publicKey;
    const games = ["Dice", "Limbo", "Flip", "Keno", "Wheel", "Hilo", "Tower"];
    const parsed = games.map((g, i) => parseSettled("sig", settledLogs(player, i + 1, i + 1, 5, g), new Date(0))[0]);
    expect(parsed.map((r) => r.game)).toEqual(["dice", "limbo", "flip", "keno", "wheel", "hilo", "tower"]);
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

  it("indexes every mines reveal draw, but no draw for a cash-out (it reuses the last reveal's request)", async () => {
    const reveal = (requestId: number, byte: number) => [
      { account, requestId: BigInt(requestId), randomness: Buffer.alloc(32, byte) },
    ];
    source.add("r1", minesCallbackLogs, reveal(1, 1));
    source.add("r2", minesCallbackLogs, reveal(2, 2));
    source.add("cash", settledLogs(player, 1, 2, 0, "Mines", "MinesCashout"));
    source.add("r3", minesCallbackLogs, reveal(3, 3));
    source.add("bust", settledLogs(player, 2, 4, 9, "Mines", "ConsumeMinesRandomness"));
    await indexer.backfill();
    const rounds = await db.query("SELECT signature, game, request_id FROM rounds ORDER BY round");
    expect(rounds.rows).toEqual([
      { signature: "cash", game: "mines", request_id: "2" },
      { signature: "bust", game: "mines", request_id: "4" },
    ]);
    const draws = await db.query("SELECT request_id, randomness FROM draws WHERE account = $1 ORDER BY request_id", [
      account,
    ]);
    expect(draws.rows).toEqual([
      { request_id: "1", randomness: "01".repeat(32) },
      { request_id: "2", randomness: "02".repeat(32) },
      { request_id: "3", randomness: "03".repeat(32) },
      { request_id: "4", randomness: "09".repeat(32) },
    ]);
  });

  it("indexes hilo and tower draws (the hilo bet's first card included), none for their cash-outs", async () => {
    const draw = (requestId: number) => [
      { account, requestId: BigInt(requestId), randomness: Buffer.alloc(32, requestId) },
    ];
    const hiloLogs = callbackLogsOf("ConsumeHiloRandomness");
    const towerLogs = callbackLogsOf("ConsumeTowerRandomness");
    source.add("first", hiloLogs, draw(1));
    source.add("guess", hiloLogs, draw(2));
    source.add("hilo", settledLogs(player, 1, 2, 0, "Hilo", "HiloCashout"));
    source.add("climb", towerLogs, draw(3));
    source.add("tower", settledLogs(player, 2, 3, 0, "Tower", "TowerCashout"));
    source.add("dice", settledLogs(player, 3, 4, 4, "Dice", "ConsumeQuickRandomness"));
    await indexer.backfill();
    const rounds = await db.query("SELECT signature, game, request_id FROM rounds ORDER BY round");
    expect(rounds.rows).toEqual([
      { signature: "hilo", game: "hilo", request_id: "2" },
      { signature: "tower", game: "tower", request_id: "3" },
      { signature: "dice", game: "dice", request_id: "4" },
    ]);
    const draws = await db.query("SELECT request_id, randomness FROM draws WHERE account = $1 ORDER BY request_id", [
      account,
    ]);
    expect(draws.rows).toEqual([1, 2, 3, 4].map((n) => ({ request_id: String(n), randomness: `0${n}`.repeat(32) })));
  });

  it("does not let a cash-out seen before its last reveal hide that reveal's draw", async () => {
    await indexer.process("cash", settledLogs(player, 1, 2, 0, "Mines", "MinesCashout"), new Date());
    await indexer.process("r2", minesCallbackLogs, new Date(), {
      logs: minesCallbackLogs,
      blockTime: null,
      draws: [{ account, requestId: 2n, randomness: Buffer.alloc(32, 2) }],
    });
    const { rows } = await db.query("SELECT randomness FROM draws WHERE account = $1", [account]);
    expect(rows).toEqual([{ randomness: "02".repeat(32) }]);
  });

  it("skips undecodable events and keeps going", async () => {
    const broken = [`Program ${PROGRAM} invoke [1]`, "Program data: AAAA", `Program ${PROGRAM} success`];
    source.add("bad", broken);
    source.add("good", settledLogs(player, 1, 2, 2));
    await indexer.backfill();
    expect(await count("rounds")).toBe(1);
  });

  it("records how far it is complete only once a backfill run has seen everything", async () => {
    source.add("s1", settledLogs(player, 1, 1, 1));
    source.failNextSignatures = true;
    await indexer.backfill();
    expect(await indexedThrough(db)).toBeNull();
    const before = Date.now();
    await indexer.backfill();
    const through = must((await indexedThrough(db)) ?? undefined, "indexed_through");
    expect(through.getTime()).toBeLessThanOrEqual(before);
    expect(through.getTime()).toBeGreaterThan(before - 60_000);
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
