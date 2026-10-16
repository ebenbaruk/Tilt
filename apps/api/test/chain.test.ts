// Decoding of on-chain accounts into the api's plain round shape.
import anchor from "@coral-xyz/anchor";
import { type AccountInfo, Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  hiloBoardAddress,
  idl,
  minesBoardAddress,
  PROGRAM_ID,
  playerAccountAddress,
  quickTableAddress,
  tableAddress,
  towerBoardAddress,
} from "@tilt/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { associatedTokenAddress, decodeRound, type GameAccounts, RpcChainReader } from "../src/chain";

const { BN } = anchor;
type RoundData = Parameters<typeof decodeRound>[0];
const none: GameAccounts = { table: null, mines: null, quick: null, hilo: null, tower: null };

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
const table: NonNullable<GameAccounts["table"]> = {
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
const board: NonNullable<GameAccounts["mines"]> = {
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

const quickOf = (round: NonNullable<GameAccounts["quick"]>["round"]): NonNullable<GameAccounts["quick"]> => ({
  player,
  bet: new BN(1_000_000),
  round,
  drawn: true,
});

/** Hilo on 1 USDC: a 5 (card 4), "higher" drew a jack of hearts (card 23), "lower" awaits its card. */
const hiloBoard: NonNullable<GameAccounts["hilo"]> = {
  player,
  bet: new BN(1_000_000),
  maxGain: new BN(5_000_000),
  fair: new BN(1_444_444),
  cards: [4, 23, ...Array<number>(62).fill(0)],
  nCards: 2,
  guesses: [0, ...Array<number>(62).fill(0)],
  nRight: 1,
  skips: 0,
  pending: 1,
  busted: false,
};

/** Tower, hard, on 1 USDC: tiles 1 and 0 safe, then tile 1 busted. */
const towerBoard: NonNullable<GameAccounts["tower"]> = {
  player,
  bet: new BN(1_000_000),
  maxGain: new BN(500_000_000),
  difficulty: { hard: {} },
  climbed: [1, 0, ...Array<number>(7).fill(0)],
  level: 2,
  pending: 255,
  busted: 1,
};

afterEach(() => vi.restoreAllMocks());

describe("chain decoding", () => {
  it("derives the player's USDC token account like spl-token", () => {
    const owner = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    const mint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(associatedTokenAddress(owner, mint).toBase58()).toBe("C4PRXFV6Gf5mytVZb6RoeLsG8CjcFWzR2EJ3dvwPTUJH");
  });

  it("decodes a settled blackjack round from the table, trimming empty hands and card slots, splits kept", () => {
    expect(decodeRound(base, { ...none, table })).toEqual({
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
    expect(decodeRound(base, none).outcome).toEqual({
      game: "blackjack",
      bet: "0",
      hands: [],
      active: 0,
      dealer: [],
      splits: 0,
    });
  });

  it("decodes statuses and the other games, whatever the table holds", () => {
    expect(decodeRound({ ...base, status: { playerTurn: {} } }, { ...none, table }).status).toEqual({
      kind: "player_turn",
    });
    expect(
      decodeRound({ ...base, status: { awaitingDraw: { 0: { double: {} } } } }, { ...none, table }).status,
    ).toEqual({
      kind: "awaiting",
      draw: "double",
    });
    expect(decodeRound({ ...base, status: { awaitingDraw: { 0: { split: {} } } } }, { ...none, table }).status).toEqual(
      {
        kind: "awaiting",
        draw: "split",
      },
    );
    const roulette = { ...base, game: { roulette: {} }, roulette: { bet: { dozen: { 0: 2 } }, number: 14 } };
    expect(decodeRound(roulette, { ...none, table }).outcome).toEqual({
      game: "roulette",
      bet: { kind: "dozen", dozen: 2 },
      number: 14,
    });
    const red = { ...roulette, roulette: { bet: { red: {} }, number: 3 } };
    expect(decodeRound(red, none).outcome).toMatchObject({ bet: { kind: "red" } });
    const baccarat = {
      ...base,
      game: { baccarat: {} },
      baccarat: { bet: { tie: {} }, player: [3, 4, 0], banker: [13, 7, 2] },
    };
    expect(decodeRound(baccarat, { ...none, table }).outcome).toEqual({
      game: "baccarat",
      bet: "tie",
      player: [3, 4],
      banker: [13, 7, 2],
    });
    expect(decodeRound({ ...base, game: { slots: {} }, slots: { reels: [6, 6, 1] } }, none).outcome).toEqual({
      game: "slots",
      reels: [6, 6, 1],
    });
  });

  it("decodes a mines round from the board: tiles in reveal order, empty markers as null", () => {
    const awaiting = { ...base, game: { mines: {} }, status: { awaitingDraw: { 0: { reveal: {} } } } };
    expect(decodeRound(awaiting, { ...none, table, mines: board })).toMatchObject({
      status: { kind: "awaiting", draw: "reveal" },
      outcome: { game: "mines", mines: 3, order: [7, 12], pending: 3, busted: null, maxGain: "2000000" },
    });
    const bust = { ...board, pending: 255, busted: 3 };
    expect(decodeRound({ ...awaiting, status: { idle: {} } }, { ...none, mines: bust }).outcome).toMatchObject({
      pending: null,
      busted: 3,
    });
  });

  it("decodes the one-draw games from the quick table", () => {
    const settled = (game: RoundData["game"], round: NonNullable<GameAccounts["quick"]>["round"]) =>
      decodeRound({ ...base, game }, { ...none, quick: quickOf(round) }).outcome;
    expect(settled({ dice: {} }, { dice: { target: 5000, over: true, roll: 7342 } })).toEqual({
      game: "dice",
      target: 5000,
      over: true,
      roll: 7342,
    });
    expect(settled({ limbo: {} }, { limbo: { target: 200, result: 153 } })).toEqual({
      game: "limbo",
      target: 200,
      result: 153,
    });
    // Coins 0 and 2 tails: bits 0 and 2.
    expect(settled({ flip: {} }, { flip: { side: { heads: {} }, flips: 3, coins: 0b101 } })).toEqual({
      game: "flip",
      side: "heads",
      flips: 3,
      results: ["tails", "heads", "tails"],
    });
    const picks = [3, 17, 40, ...Array<number>(7).fill(0)];
    const drawn = [40, 1, 2, 4, 5, 6, 7, 8, 9, 3];
    expect(settled({ keno: {} }, { keno: { picks, nPicks: 3, drawn } })).toEqual({
      game: "keno",
      picks: [3, 17, 40],
      drawn,
    });
    expect(settled({ wheel: {} }, { wheel: { segments: 30, risk: { medium: {} }, segment: 7 } })).toEqual({
      game: "wheel",
      segments: 30,
      risk: "medium",
      segment: 7,
    });
  });

  it("decodes hilo and tower rounds from their boards", () => {
    const hilo = { ...base, game: { hilo: {} }, status: { awaitingDraw: { 0: { card: {} } } } };
    expect(decodeRound(hilo, { ...none, hilo: hiloBoard })).toMatchObject({
      status: { kind: "awaiting", draw: "card" },
      outcome: {
        game: "hilo",
        cards: [4, 23],
        guesses: ["higher"],
        pending: "lower",
        busted: false,
        maxGain: "5000000",
      },
    });
    const first = { ...hiloBoard, nCards: 0, pending: 255 };
    expect(decodeRound(hilo, { ...none, hilo: first }).outcome).toMatchObject({
      cards: [],
      guesses: [],
      pending: null,
    });
    const tower = { ...base, game: { tower: {} } };
    expect(decodeRound(tower, { ...none, tower: towerBoard }).outcome).toEqual({
      game: "tower",
      difficulty: "hard",
      climbed: [1, 0],
      pending: null,
      busted: 1,
      maxGain: "500000000",
    });
  });

  it("fails loudly on an inconsistent round", () => {
    expect(() => decodeRound({ ...base, game: { roulette: {} } }, none)).toThrow();
    expect(() => decodeRound({ ...base, game: { mines: {} } }, { ...none, table })).toThrow();
    expect(() => decodeRound({ ...base, game: { hilo: {} } }, none)).toThrow();
    expect(() => decodeRound({ ...base, game: { tower: {} } }, none)).toThrow();
    // A quick table holding another game's round, or none.
    const limbo = quickOf({ limbo: { target: 200, result: 153 } });
    expect(() => decodeRound({ ...base, game: { dice: {} } }, { ...none, quick: limbo })).toThrow();
    expect(() => decodeRound({ ...base, game: { keno: {} } }, none)).toThrow();
    expect(() =>
      decodeRound({ ...base, game: { hilo: {} } }, { ...none, hilo: { ...hiloBoard, pending: 7 } }),
    ).toThrow();
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

  /** Reads `round` with the PDAs in `opened` (the others not opened yet). */
  async function read(opened: (keyof GameAccounts)[], round: RoundData = account.round) {
    const reader = new RpcChainReader({
      solanaRpcUrl: "http://127.0.0.1:1",
      rollupRpcUrl: "http://127.0.0.1:2",
      rollupWsUrl: "ws://127.0.0.1:2",
    });
    const encoded: Record<keyof GameAccounts, Buffer> = {
      table: await coder.encode("blackjackTable", { ...table, active: 1 }),
      mines: await coder.encode("minesBoard", board),
      quick: await coder.encode("quickTable", quickOf({ wheel: { segments: 10, risk: { high: {} }, segment: 9 } })),
      hilo: await coder.encode("hiloBoard", hiloBoard),
      tower: await coder.encode("towerBoard", towerBoard),
    };
    const pdas = (["table", "mines", "quick", "hilo", "tower"] as const).map((k) =>
      opened.includes(k) ? info(encoded[k]) : null,
    );
    const fetch = vi
      .spyOn(reader.rollup, "getMultipleAccountsInfo")
      .mockResolvedValue([info(await coder.encode("playerAccount", { ...account, round })), ...pdas]);
    const state = await reader.playerAccount(player);
    return { state, fetch };
  }

  it("reads the account and every game PDA in one call and decodes them", async () => {
    const { state, fetch } = await read(["table", "mines", "quick", "hilo", "tower"]);
    expect(fetch).toHaveBeenCalledWith([
      playerAccountAddress(player),
      tableAddress(player),
      minesBoardAddress(player),
      quickTableAddress(player),
      hiloBoardAddress(player),
      towerBoardAddress(player),
    ]);
    expect(state?.balance).toBe(6_000_000n);
    expect(state?.round.status).toEqual({ kind: "player_turn" });
    expect(state?.round.outcome).toMatchObject({ game: "blackjack", bet: "1000000", active: 1 });
  });

  it("decodes a player without a table", async () => {
    const { state } = await read([]);
    expect(state?.round.outcome).toMatchObject({ game: "blackjack", hands: [] });
  });

  it("decodes a mines round in play from the board", async () => {
    const { state } = await read(["mines"], { ...base, game: { mines: {} }, status: { playerTurn: {} } });
    expect(state?.round.outcome).toMatchObject({ game: "mines", order: [7, 12], pending: 3 });
  });

  it("decodes one-draw, hilo and tower rounds from their PDAs", async () => {
    const opened: (keyof GameAccounts)[] = ["quick", "hilo", "tower"];
    const wheel = await read(opened, { ...base, game: { wheel: {} } });
    expect(wheel.state?.round.outcome).toEqual({ game: "wheel", segments: 10, risk: "high", segment: 9 });
    const hilo = await read(opened, { ...base, game: { hilo: {} } });
    expect(hilo.state?.round.outcome).toMatchObject({ game: "hilo", cards: [4, 23], pending: "lower" });
    const tower = await read(opened, { ...base, game: { tower: {} } });
    expect(tower.state?.round.outcome).toMatchObject({ game: "tower", difficulty: "hard", climbed: [1, 0] });
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
