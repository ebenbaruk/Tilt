// Decoding of on-chain accounts into the api's plain round shape.
import anchor from "@coral-xyz/anchor";
import { type AccountInfo, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { idl, minesBoardAddress, PROGRAM_ID, playerAccountAddress, tableAddress } from "@tilt/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { associatedTokenAddress, decodeRound, RpcChainReader } from "../src/chain";

const { BN } = anchor;
type RoundData = Parameters<typeof decodeRound>[0];
type TableData = NonNullable<Parameters<typeof decodeRound>[1]>;
type BoardData = NonNullable<Parameters<typeof decodeRound>[2]>;

const MAX_CARDS = 21;
const MAX_TABLE_HANDS = 10;
const cards = (ranks: number[]) => [...ranks, ...Array<number>(MAX_CARDS - ranks.length).fill(0)];
const emptyHand = { cards: cards([]), nCards: 0, doubled: false, split: false };

const base: RoundData = {
  game: { blackjack: {} },
  status: { idle: {} },
  stake: new BN(4_000_000),
  lastAction: new BN(0),
  requestId: new BN(7),
  payout: new BN(3_980_000),
  fee: new BN(20_000),
  // Legacy: kept for the account layout, never written since tables.
  blackjack: { player: cards([]), nPlayer: 0, dealer: cards([]), nDealer: 0, doubled: false },
  roulette: null,
  baccarat: null,
  slots: { reels: [0, 0, 0] },
};

const player = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");

/** Three hands of 1 USDC: an 8-8 split into the first two (the second doubled), every hand
 *  finished. */
const table: TableData = {
  player,
  bet: new BN(1_000_000),
  hands: [
    { cards: cards([8, 10]), nCards: 2, doubled: false, split: true },
    { cards: cards([8, 3, 10]), nCards: 3, doubled: true, split: true },
    { cards: cards([1, 13]), nCards: 2, doubled: false, split: false },
    ...Array.from({ length: MAX_TABLE_HANDS - 3 }, () => emptyHand),
  ],
  nHands: 3,
  active: 3,
  dealer: cards([9, 8]),
  nDealer: 2,
  splits: 1,
};

/** 3 mines on 1 USDC: tiles 7 and 12 safe, 3 awaiting its draw. */
const board: BoardData = {
  player,
  bet: new BN(1_000_000),
  mines: 3,
  revealed: (1 << 7) | (1 << 12),
  order: [7, 12, ...Array<number>(23).fill(0)],
  nRevealed: 2,
  pending: 3,
  busted: 255,
  maxGain: new BN(2_000_000),
};

afterEach(() => vi.restoreAllMocks());

describe("chain decoding", () => {
  it("derives the player's USDC token account like spl-token", () => {
    const owner = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    const mint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(associatedTokenAddress(owner, mint).toBase58()).toBe("C4PRXFV6Gf5mytVZb6RoeLsG8CjcFWzR2EJ3dvwPTUJH");
  });

  it("decodes a settled blackjack round from the table, trimming empty hands and card slots, splits kept", () => {
    expect(decodeRound(base, table, null)).toEqual({
      status: { kind: "idle" },
      stake: 4_000_000n,
      payout: 3_980_000n,
      fee: 20_000n,
      requestId: 7n,
      outcome: {
        game: "blackjack",
        bet: "1000000",
        hands: [
          { cards: [8, 10], doubled: false, split: true },
          { cards: [8, 3, 10], doubled: true, split: true },
          { cards: [1, 13], doubled: false, split: false },
        ],
        active: 3,
        dealer: [9, 8],
        splits: 1,
      },
    });
  });

  it("shows no hands for a blackjack round without a table (played before tables)", () => {
    expect(decodeRound(base, null, null).outcome).toEqual({
      game: "blackjack",
      bet: "0",
      hands: [],
      active: 0,
      dealer: [],
      splits: 0,
    });
  });

  it("decodes statuses and the other games, whatever the table holds", () => {
    expect(decodeRound({ ...base, status: { playerTurn: {} } }, table, null).status).toEqual({ kind: "player_turn" });
    expect(decodeRound({ ...base, status: { awaitingDraw: { 0: { double: {} } } } }, table, null).status).toEqual({
      kind: "awaiting",
      draw: "double",
    });
    expect(decodeRound({ ...base, status: { awaitingDraw: { 0: { split: {} } } } }, table, null).status).toEqual({
      kind: "awaiting",
      draw: "split",
    });
    const roulette = { ...base, game: { roulette: {} }, roulette: { bet: { dozen: { 0: 2 } }, number: 14 } };
    expect(decodeRound(roulette, table, null).outcome).toEqual({
      game: "roulette",
      bet: { kind: "dozen", dozen: 2 },
      number: 14,
    });
    const red = { ...roulette, roulette: { bet: { red: {} }, number: 3 } };
    expect(decodeRound(red, null, null).outcome).toMatchObject({ bet: { kind: "red" } });
    const baccarat = {
      ...base,
      game: { baccarat: {} },
      baccarat: { bet: { tie: {} }, player: [3, 4, 0], banker: [13, 7, 2] },
    };
    expect(decodeRound(baccarat, table, null).outcome).toEqual({
      game: "baccarat",
      bet: "tie",
      player: [3, 4],
      banker: [13, 7, 2],
    });
    expect(decodeRound({ ...base, game: { slots: {} }, slots: { reels: [6, 6, 1] } }, null, null).outcome).toEqual({
      game: "slots",
      reels: [6, 6, 1],
    });
  });

  it("decodes a mines round from the board: tiles in reveal order, empty markers as null", () => {
    const awaiting = { ...base, game: { mines: {} }, status: { awaitingDraw: { 0: { reveal: {} } } } };
    expect(decodeRound(awaiting, table, board)).toMatchObject({
      status: { kind: "awaiting", draw: "reveal" },
      outcome: { game: "mines", mines: 3, order: [7, 12], pending: 3, busted: null, maxGain: "2000000" },
    });
    const bust = { ...board, pending: 255, busted: 3 };
    expect(decodeRound({ ...awaiting, status: { idle: {} } }, null, bust).outcome).toMatchObject({
      pending: null,
      busted: 3,
    });
  });

  it("fails loudly on an inconsistent round", () => {
    expect(() => decodeRound({ ...base, game: { roulette: {} } }, null, null)).toThrow();
    expect(() => decodeRound({ ...base, game: { mines: {} } }, table, null)).toThrow();
  });
});

describe("RpcChainReader.playerAccount", () => {
  // The program's coder, as the reader uses it (camelCase names, like the decoded accounts).
  const coder = new anchor.Program(idl as anchor.Idl, { connection: new Connection("http://127.0.0.1:1") }).coder
    .accounts;
  const info = (data: Buffer): AccountInfo<Buffer> => ({ data, owner: PROGRAM_ID, executable: false, lamports: 1 });
  const account = {
    player,
    maxWin: new BN(0),
    credited: new BN(10_000_000),
    forfeited: new BN(0),
    withdrawn: new BN(0),
    balance: new BN(6_000_000),
    rounds: 4,
    fees: new BN(0),
    round: { ...base, status: { playerTurn: {} } },
  };

  async function read(withTable: boolean, withBoard = false, round: RoundData = account.round) {
    const reader = new RpcChainReader({
      solanaRpcUrl: "http://127.0.0.1:1",
      rollupRpcUrl: "http://127.0.0.1:2",
      rollupWsUrl: "ws://127.0.0.1:2",
    });
    const accountData = await coder.encode("playerAccount", { ...account, round });
    const tableData = await coder.encode("blackjackTable", { ...table, active: 1 });
    const boardData = await coder.encode("minesBoard", board);
    const fetch = vi
      .spyOn(reader.rollup, "getMultipleAccountsInfo")
      .mockResolvedValue([info(accountData), withTable ? info(tableData) : null, withBoard ? info(boardData) : null]);
    const state = await reader.playerAccount(player);
    return { state, fetch };
  }

  it("reads the account, the table and the board in one call and decodes them", async () => {
    const { state, fetch } = await read(true, true);
    expect(fetch).toHaveBeenCalledWith([playerAccountAddress(player), tableAddress(player), minesBoardAddress(player)]);
    expect(state?.balance).toBe(6_000_000n);
    expect(state?.round.status).toEqual({ kind: "player_turn" });
    expect(state?.round.outcome).toMatchObject({ game: "blackjack", bet: "1000000", active: 1 });
  });

  it("decodes a player without a table", async () => {
    const { state } = await read(false);
    expect(state?.round.outcome).toMatchObject({ game: "blackjack", hands: [] });
  });

  it("decodes a mines round in play from the board", async () => {
    const { state } = await read(false, true, { ...base, game: { mines: {} }, status: { playerTurn: {} } });
    expect(state?.round.outcome).toMatchObject({ game: "mines", order: [7, 12], pending: 3 });
  });

  it("is null before the first deposit", async () => {
    const reader = new RpcChainReader({
      solanaRpcUrl: "http://127.0.0.1:1",
      rollupRpcUrl: "http://127.0.0.1:2",
      rollupWsUrl: "ws://127.0.0.1:2",
    });
    vi.spyOn(reader.rollup, "getMultipleAccountsInfo").mockResolvedValue([null, null]);
    expect(await reader.playerAccount(Keypair.generate().publicKey)).toBeNull();
  });
});
