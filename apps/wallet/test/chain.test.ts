// The relay's transactions, with both RPC connections stubbed: which instruction each action
// becomes, which table or board it passes, how a missing game account (blackjack table,
// one-draw table, Mines, Hilo or Tower board) gets opened first, and how a move past the win
// cap raises it.
import anchor from "@coral-xyz/anchor";
import { type AccountInfo, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import {
  type Action,
  hiloBoardAddress,
  idl,
  ledgerAddress,
  minesBoardAddress,
  PROGRAM_ID,
  quickTableAddress,
  rouletteTableAddress,
  tableAddress,
  towerBoardAddress,
} from "@tilt/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TiltChain, winCapShortfall } from "../src/chain";

type GameAction = Exclude<Action, { type: "open_account" | "deposit" | "withdraw" }>;

const coder = new anchor.BorshInstructionCoder(idl as anchor.Idl);
/** Position of the optional `table` account in every play instruction (IDL order). */
const TABLE_INDEX = idl.instructions.find((i) => i.name === "blackjack_bet")!.accounts.findIndex((a) => a.name === "table");

const accountInfo = (owner: PublicKey): AccountInfo<Buffer> => ({ owner, data: Buffer.alloc(0), executable: false, lamports: 1 });
const instructionNames = (tx: Transaction) => tx.instructions.map((ix) => coder.decode(ix.data)?.name);

interface Fakes {
  /** The table and the Mines board as Solana holds them (delegated: owned by the delegation program). */
  tableOnSolana: boolean;
  /** Rollup reads of the table or board that still miss it, before it shows up (Infinity: never). */
  rollupMisses: number;
  /** The open + delegate transaction fails to simulate. */
  openRefused?: boolean;
}

/** A TiltChain whose Solana and rollup connections are stubbed; records what gets sent. */
function stubbedChain(fakes: Fakes) {
  const player = Keypair.generate().publicKey;
  const chain = new TiltChain({
    solanaRpcUrl: "http://127.0.0.1:1",
    rollupRpcUrl: "http://127.0.0.1:2",
    rollupWsUrl: "ws://127.0.0.1:2",
    vrfQueue: Keypair.generate().publicKey,
    relayer: Keypair.generate(),
  });
  const sent = { solana: [] as Transaction[], rollup: [] as Transaction[], rollupTableReads: 0 };
  const blockhash = { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 };
  const delegationProgram = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

  const gameAccounts = [tableAddress, quickTableAddress, rouletteTableAddress, minesBoardAddress, hiloBoardAddress, towerBoardAddress].map((address) => address(player));
  const isGameAccount = (address: PublicKey) => gameAccounts.some((a) => a.equals(address));
  vi.spyOn(chain.base, "getAccountInfo").mockImplementation(async (address) => {
    if (address.equals(ledgerAddress(player))) return accountInfo(PROGRAM_ID);
    if (isGameAccount(address)) return fakes.tableOnSolana ? accountInfo(delegationProgram) : null;
    return null;
  });
  vi.spyOn(chain.base, "getLatestBlockhash").mockResolvedValue(blockhash);
  // Recorded at simulation, the step every transaction goes through before being sent.
  vi.spyOn(chain.base, "simulateTransaction").mockImplementation(async (tx) => {
    if (!("version" in tx)) sent.solana.push(tx);
    const err = fakes.openRefused ? { InstructionError: [0, { Custom: 0 }] } : null;
    return { context: { slot: 1 }, value: { err, logs: [], accounts: null, unitsConsumed: 0, returnData: null } };
  });
  vi.spyOn(chain.base, "sendRawTransaction").mockImplementation(async () => {
    fakes.tableOnSolana = true;
    return "solana-sig";
  });
  vi.spyOn(chain.base, "confirmTransaction").mockResolvedValue({ context: { slot: 1 }, value: { err: null } });

  vi.spyOn(chain.rollup, "getAccountInfo").mockImplementation(async (address) => {
    if (!isGameAccount(address)) return null;
    sent.rollupTableReads++;
    if (fakes.rollupMisses > 0) {
      fakes.rollupMisses--;
      return null;
    }
    return accountInfo(PROGRAM_ID);
  });
  vi.spyOn(chain.rollup, "getLatestBlockhash").mockResolvedValue(blockhash);
  vi.spyOn(chain.rollup, "simulateTransaction").mockImplementation(async (tx) => {
    if (!("version" in tx)) sent.rollup.push(tx);
    return { context: { slot: 1 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 0, returnData: null } };
  });
  vi.spyOn(chain.rollup, "sendRawTransaction").mockResolvedValue("rollup-sig");
  vi.spyOn(chain.rollup, "getSignatureStatuses").mockResolvedValue({
    context: { slot: 1 },
    value: [{ slot: 1, confirmations: null, err: null, confirmationStatus: "confirmed" }],
  });
  return { chain, player, sent };
}

const record = async () => undefined;
const bet: Action = { type: "blackjack_bet", amount: "1000000", hands: 3 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("play transactions", () => {
  it("bets on several blackjack hands at the player's table", async () => {
    const { chain, player } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const tx = await chain.playTransaction(player, { type: "blackjack_bet", amount: "2500000", hands: 6 });
    const [ix] = tx.instructions;
    const decoded = coder.decode(ix.data);
    expect(decoded?.name).toBe("blackjack_bet");
    const args = decoded?.data;
    expect(args).toMatchObject({ hands: 6 });
    expect(args && "amount" in args ? String(args.amount) : undefined).toBe("2500000");
    expect(ix.keys[TABLE_INDEX]).toMatchObject({ pubkey: tableAddress(player), isWritable: true });
  });

  it("splits at the player's bjtable table", async () => {
    const { chain, player } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const [ix] = (await chain.playTransaction(player, { type: "blackjack_split" })).instructions;
    expect(coder.decode(ix.data)?.name).toBe("blackjack_split");
    const [bjtable] = PublicKey.findProgramAddressSync([Buffer.from("bjtable"), player.toBuffer()], PROGRAM_ID);
    expect(ix.keys[TABLE_INDEX]).toMatchObject({ pubkey: bjtable, isWritable: true });
  });

  it("passes the table to every blackjack move and to no other game", async () => {
    const { chain, player } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const moves = [{ type: "blackjack_hit" }, { type: "blackjack_stand" }, { type: "blackjack_double" }, { type: "blackjack_split" }] as const;
    for (const move of moves) {
      const [ix] = (await chain.playTransaction(player, move)).instructions;
      expect(ix.keys[TABLE_INDEX].pubkey.equals(tableAddress(player)), move.type).toBe(true);
    }
    const others = [
      { type: "slots_spin", amount: "1" },
      { type: "roulette_spin", amount: "1", bet: { kind: "red" } },
      { type: "baccarat_deal", amount: "1", bet: "tie" },
    ] as const;
    for (const other of others) {
      const [ix] = (await chain.playTransaction(player, other)).instructions;
      // Anchor's "no account" for an optional slot: the program id.
      expect(ix.keys[TABLE_INDEX].pubkey.equals(PROGRAM_ID), other.type).toBe(true);
    }
  });

  it("passes the board, not the table, to every Mines move", async () => {
    const { chain, player } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const moves = [
      { type: "mines_bet", amount: "2500000", mines: 3 },
      { type: "mines_reveal", tile: 24 },
      { type: "mines_cashout" },
    ] as const;
    for (const move of moves) {
      const [ix] = (await chain.playTransaction(player, move)).instructions;
      const decoded = coder.decode(ix.data);
      expect(decoded?.name).toBe(move.type);
      const instruction = idl.instructions.find((i) => i.name === move.type)!;
      const boardIndex = instruction.accounts.findIndex((a) => a.name === "board");
      expect(ix.keys[boardIndex], move.type).toMatchObject({ pubkey: minesBoardAddress(player), isWritable: true });
      expect(ix.keys.some((k) => k.pubkey.equals(tableAddress(player))), move.type).toBe(false);
    }
    const [bet] = (await chain.playTransaction(player, moves[0])).instructions;
    const args = coder.decode(bet.data)?.data;
    expect(args).toMatchObject({ mines: 3 });
    expect(args && "amount" in args ? String(args.amount) : undefined).toBe("2500000");
    const [reveal] = (await chain.playTransaction(player, moves[1])).instructions;
    expect(coder.decode(reveal.data)?.data).toMatchObject({ tile: 24 });
  });

  const ownAccountMoves: { account: "quick" | "board"; address: (player: PublicKey) => PublicKey; action: GameAction; args: object }[] = [
    { account: "quick", address: quickTableAddress, action: { type: "dice_roll", amount: "2500000", target: 4_950, over: true }, args: { target: 4_950, over: true } },
    { account: "quick", address: quickTableAddress, action: { type: "limbo_play", amount: "2500000", target: 250 }, args: { target: 250 } },
    // The instruction coder decodes enum variants by their Rust names.
    { account: "quick", address: quickTableAddress, action: { type: "flip_play", amount: "2500000", side: "tails", flips: 3 }, args: { side: { Tails: {} }, flips: 3 } },
    { account: "quick", address: quickTableAddress, action: { type: "keno_play", amount: "2500000", picks: [40, 1, 7] }, args: { picks: Buffer.from([40, 1, 7]) } },
    { account: "quick", address: quickTableAddress, action: { type: "wheel_spin", amount: "2500000", segments: 30, risk: "medium" }, args: { segments: 30, risk: { Medium: {} } } },
    { account: "board", address: hiloBoardAddress, action: { type: "hilo_bet", amount: "2500000" }, args: {} },
    { account: "board", address: hiloBoardAddress, action: { type: "hilo_guess", guess: "lower" }, args: { guess: { Lower: {} } } },
    { account: "board", address: hiloBoardAddress, action: { type: "hilo_cashout" }, args: {} },
    { account: "board", address: towerBoardAddress, action: { type: "tower_bet", amount: "2500000", difficulty: "expert" }, args: { difficulty: { Expert: {} } } },
    { account: "board", address: towerBoardAddress, action: { type: "tower_climb", tile: 2 }, args: { tile: 2 } },
    { account: "board", address: towerBoardAddress, action: { type: "tower_cashout" }, args: {} },
  ];

  it("passes each new game's own account, not the table, with the action's arguments", async () => {
    const { chain, player } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    for (const move of ownAccountMoves) {
      const [ix] = (await chain.playTransaction(player, move.action)).instructions;
      const decoded = coder.decode(ix.data);
      expect(decoded?.name).toBe(move.action.type);
      expect(decoded?.data, move.action.type).toMatchObject(move.args);
      if ("amount" in move.action) {
        const args = decoded?.data;
        expect(args && "amount" in args ? String(args.amount) : undefined, move.action.type).toBe("2500000");
      }
      const instruction = idl.instructions.find((i) => i.name === move.action.type)!;
      const index = instruction.accounts.findIndex((a) => a.name === move.account);
      expect(ix.keys[index], move.action.type).toMatchObject({ pubkey: move.address(player), isWritable: true });
      expect(ix.keys.some((k) => k.pubkey.equals(tableAddress(player))), move.action.type).toBe(false);
    }
  });

  it("spins every chip on the player's roulette table, the single-bet spin without it", async () => {
    const { chain, player } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const action: GameAction = {
      type: "roulette_chips",
      chips: [
        { bet: { kind: "straight", number: 17 }, amount: "100000" },
        { bet: { kind: "red" }, amount: "200000" },
        { bet: { kind: "dozen", dozen: 2 }, amount: "300000" },
      ],
    };
    const [ix] = (await chain.playTransaction(player, action)).instructions;
    const decoded = coder.decode(ix.data);
    expect(decoded?.name).toBe("roulette_chips");
    const args = decoded?.data;
    const chips = args && "chips" in args && Array.isArray(args.chips) ? args.chips : [];
    // The instruction coder decodes enum variants by their Rust names.
    expect(chips.map((c: { bet: object; amount: { toString(): string } }) => [c.bet, c.amount.toString()])).toEqual([
      [{ Straight: { 0: 17 } }, "100000"],
      [{ Red: {} }, "200000"],
      [{ Dozen: { 0: 2 } }, "300000"],
    ]);
    const index = idl.instructions.find((i) => i.name === "roulette_chips")!.accounts.findIndex((a) => a.name === "roulette");
    expect(ix.keys[index]).toMatchObject({ pubkey: rouletteTableAddress(player), isWritable: true });
    expect(ix.keys.some((k) => k.pubkey.equals(tableAddress(player)))).toBe(false);
    const [single] = (await chain.playTransaction(player, { type: "roulette_spin", amount: "1", bet: { kind: "red" } })).instructions;
    expect(single.keys.some((k) => k.pubkey.equals(rouletteTableAddress(player)))).toBe(false);
  });

  it("retries a stuck draw of a new game with its own expire instruction and account", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const games = [
      { game: { dice: {} }, name: "expire_quick_round", address: quickTableAddress },
      { game: { limbo: {} }, name: "expire_quick_round", address: quickTableAddress },
      { game: { flip: {} }, name: "expire_quick_round", address: quickTableAddress },
      { game: { keno: {} }, name: "expire_quick_round", address: quickTableAddress },
      { game: { wheel: {} }, name: "expire_quick_round", address: quickTableAddress },
      { game: { hilo: {} }, name: "expire_hilo_round", address: hiloBoardAddress },
      { game: { tower: {} }, name: "expire_tower_round", address: towerBoardAddress },
      // A roulette round without its bet in the round: a multi-chip spin, on the roulette table.
      { game: { roulette: {} }, name: "expire_roulette_round", address: rouletteTableAddress },
    ] as const;
    for (const { game } of games) await chain.expireRound(player, { game, roulette: null });
    expect(sent.rollup.map(instructionNames)).toEqual(games.map(({ name }) => [name]));
    sent.rollup.forEach((tx, i) => {
      expect(tx.instructions[0].keys.some((k) => k.pubkey.equals(games[i].address(player))), games[i].name).toBe(true);
    });
  });

  it("retries a stuck Mines reveal with the board, other draws with expire_round", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    await chain.expireRound(player, { game: { mines: {} }, roulette: null });
    await chain.expireRound(player, { game: { blackjack: {} }, roulette: null });
    await chain.expireRound(player, { game: { slots: {} }, roulette: null });
    await chain.expireRound(player, { game: { roulette: {} }, roulette: { bet: { red: {} }, number: 0 } });
    expect(sent.rollup.map(instructionNames)).toEqual([["expire_mines_round"], ["expire_round"], ["expire_round"], ["expire_round"]]);
    const [mines, blackjack, slots, roulette] = sent.rollup.map((tx) => tx.instructions[0]);
    expect(mines.keys.some((k) => k.pubkey.equals(minesBoardAddress(player)))).toBe(true);
    expect(blackjack.keys[TABLE_INDEX].pubkey.equals(tableAddress(player))).toBe(true);
    expect(slots.keys[TABLE_INDEX].pubkey.equals(PROGRAM_ID)).toBe(true);
    expect(roulette.keys[TABLE_INDEX].pubkey.equals(PROGRAM_ID)).toBe(true);
    expect(roulette.keys.some((k) => k.pubkey.equals(rouletteTableAddress(player)))).toBe(false);
  });
});

describe("blackjack table", () => {
  it("plays at once when the rollup already holds the table", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    await chain.play(player, bet, record);
    expect(sent.solana).toHaveLength(0);
    expect(sent.rollup.map(instructionNames)).toEqual([["blackjack_bet"]]);
  });

  it("opens and delegates a missing table on Solana, waits for the rollup, then plays", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: 3 });
    await chain.play(player, bet, record);
    expect(sent.solana.map(instructionNames)).toEqual([["open_table", "delegate_table"]]);
    expect(sent.solana[0].instructions[0].keys.some((k) => k.pubkey.equals(tableAddress(player)))).toBe(true);
    expect(sent.rollup.map(instructionNames)).toEqual([["blackjack_bet"]]);
    // Ready once seen: later moves skip the lookup.
    const reads = sent.rollupTableReads;
    await chain.play(player, { type: "blackjack_stand" }, record);
    expect(sent.rollupTableReads).toBe(reads);
    expect(sent.solana).toHaveLength(1);
  });

  it("never opens a table again that Solana already has, only waits for it", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 2 });
    await chain.play(player, bet, record);
    expect(sent.solana).toHaveLength(0);
    expect(sent.rollup).toHaveLength(1);
  });

  it("refuses the move with TABLE_NOT_READY when the rollup never sees the table", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: Infinity });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(chain.rollup.getAccountInfo).mockImplementation(async () => {
      sent.rollupTableReads++;
      vi.setSystemTime(Date.now() + 10_000);
      return null;
    });
    await expect(chain.play(player, bet, record)).rejects.toMatchObject({ code: "TABLE_NOT_READY" });
    expect(sent.rollup).toHaveLength(0);
  });

  it("refuses the move with TABLE_NOT_READY when opening the table fails", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: Infinity, openRefused: true });
    await expect(chain.play(player, bet, record)).rejects.toMatchObject({ code: "TABLE_NOT_READY" });
    expect(sent.rollup).toHaveLength(0);
  });

  it("leaves the table alone for other games", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: Infinity });
    await chain.play(player, { type: "slots_spin", amount: "1000000" }, record);
    expect(sent.rollupTableReads).toBe(0);
    expect(sent.solana).toHaveLength(0);
  });
});

describe("mines board", () => {
  const minesBet: Action = { type: "mines_bet", amount: "1000000", mines: 3 };

  it("opens and delegates a missing board on Solana, waits for the rollup, then plays", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: 3 });
    await chain.play(player, minesBet, record);
    expect(sent.solana.map(instructionNames)).toEqual([["open_mines_board", "delegate_mines_board"]]);
    expect(sent.solana[0].instructions[0].keys.some((k) => k.pubkey.equals(minesBoardAddress(player)))).toBe(true);
    expect(sent.rollup.map(instructionNames)).toEqual([["mines_bet"]]);
    const reads = sent.rollupTableReads;
    await chain.play(player, { type: "mines_reveal", tile: 7 }, record);
    await chain.play(player, { type: "mines_cashout" }, record);
    expect(sent.rollupTableReads).toBe(reads);
    expect(sent.solana).toHaveLength(1);
    expect(sent.rollup.map(instructionNames)).toEqual([["mines_bet"], ["mines_reveal"], ["mines_cashout"]]);
  });

  it("checks the board separately from the table", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    await chain.play(player, bet, record);
    const reads = sent.rollupTableReads;
    await chain.play(player, minesBet, record);
    expect(sent.rollupTableReads).toBe(reads + 1);
  });

  it("refuses the move with TABLE_NOT_READY when opening the board fails", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: Infinity, openRefused: true });
    await expect(chain.play(player, minesBet, record)).rejects.toMatchObject({ code: "TABLE_NOT_READY", message: expect.stringContaining("mines board") });
    expect(sent.rollup).toHaveLength(0);
  });
});

describe("new games' accounts", () => {
  const cases: { action: GameAction; opened: string[]; address: (player: PublicKey) => PublicKey; label: string }[] = [
    { action: { type: "keno_play", amount: "1000000", picks: [5] }, opened: ["open_quick_table", "delegate_quick_table"], address: quickTableAddress, label: "one-draw table" },
    { action: { type: "hilo_bet", amount: "1000000" }, opened: ["open_hilo_board", "delegate_hilo_board"], address: hiloBoardAddress, label: "hilo board" },
    { action: { type: "tower_bet", amount: "1000000", difficulty: "easy" }, opened: ["open_tower_board", "delegate_tower_board"], address: towerBoardAddress, label: "tower board" },
    {
      action: { type: "roulette_chips", chips: [{ bet: { kind: "odd" }, amount: "1000000" }] },
      opened: ["open_roulette_table", "delegate_roulette_table"],
      address: rouletteTableAddress,
      label: "roulette table",
    },
  ];

  for (const { action, opened, address, label } of cases) {
    it(`opens and delegates a missing ${label} before ${action.type}, once`, async () => {
      const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: 2 });
      await chain.play(player, action, record);
      expect(sent.solana.map(instructionNames)).toEqual([opened]);
      expect(sent.solana[0].instructions[0].keys.some((k) => k.pubkey.equals(address(player)))).toBe(true);
      const reads = sent.rollupTableReads;
      await chain.play(player, action, record);
      expect(sent.rollupTableReads).toBe(reads);
      expect(sent.solana).toHaveLength(1);
      expect(sent.rollup.map(instructionNames)).toEqual([[action.type], [action.type]]);
    });

    it(`refuses ${action.type} with TABLE_NOT_READY when opening the ${label} fails`, async () => {
      const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: Infinity, openRefused: true });
      await expect(chain.play(player, action, record)).rejects.toMatchObject({ code: "TABLE_NOT_READY", message: expect.stringContaining(label) });
      expect(sent.rollup).toHaveLength(0);
    });
  }

  it("shares one table between the one-draw games", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: 1 });
    await chain.play(player, { type: "dice_roll", amount: "1000000", target: 5_000, over: false }, record);
    await chain.play(player, { type: "wheel_spin", amount: "1000000", segments: 10, risk: "low" }, record);
    expect(sent.solana.map(instructionNames)).toEqual([["open_quick_table", "delegate_quick_table"]]);
  });

  it("opens no account for a single-bet roulette spin", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: false, rollupMisses: Infinity });
    await chain.play(player, { type: "roulette_spin", amount: "1000000", bet: { kind: "red" } }, record);
    expect(sent.rollupTableReads).toBe(0);
    expect(sent.solana).toHaveLength(0);
    expect(sent.rollup.map(instructionNames)).toEqual([["roulette_spin"]]);
  });
});

describe("rolling win cap", () => {
  const SHORT_LOGS = [
    "Program log: Instruction: SlotsSpin",
    "Program log: Win cap short by 248000000",
    "Program log: AnchorError occurred. Error Code: WinCapReached. Error Number: 6008. Error Message: Lifetime win cap reached.",
  ];
  const ledgerData = (player: PublicKey, maxWin: number) =>
    new anchor.BorshAccountsCoder(idl as anchor.Idl).encode("Ledger", {
      player,
      deposited: new anchor.BN(0),
      withdrawn_paid: new anchor.BN(0),
      forfeited: new anchor.BN(0),
      max_win: new anchor.BN(maxWin),
      window_start: new anchor.BN(0),
      window_paid: new anchor.BN(0),
    });

  it("reads by how much the program found the move past the cap", () => {
    expect(winCapShortfall(SHORT_LOGS)).toBe(248_000_000n);
    expect(winCapShortfall(["Program log: Error Code: InsufficientBalance."])).toBeUndefined();
  });

  const spin: Action = { type: "slots_spin", amount: "1000000" };
  const ledgerInfo = async (player: PublicKey, maxWin: number) => ({ ...accountInfo(PROGRAM_ID), data: await ledgerData(player, maxWin) });

  /** The ledger on Solana and the rollup's copies of it, read in turn (the last one repeats);
   *  the first spin is refused 248 000 000 past the cap. */
  async function refusedSpin(solanaMaxWin: number, rollupMaxWins: number[]) {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const onSolana = await ledgerInfo(player, solanaMaxWin);
    vi.mocked(chain.base.getAccountInfo).mockImplementation(async (address) => (address.equals(ledgerAddress(player)) ? onSolana : null));
    // Anchor reads accounts with their context.
    vi.spyOn(chain.base, "getAccountInfoAndContext").mockResolvedValue({ context: { slot: 1 }, value: onSolana });
    const copies = await Promise.all(rollupMaxWins.map((maxWin) => ledgerInfo(player, maxWin)));
    vi.spyOn(chain.rollup, "getAccountInfoAndContext").mockImplementation(async () => ({ context: { slot: 1 }, value: copies.length > 1 ? copies.shift()! : copies[0] }));
    vi.mocked(chain.rollup.simulateTransaction).mockImplementationOnce(async (tx) => {
      if (!("version" in tx)) sent.rollup.push(tx);
      return { context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6008 }] }, logs: SHORT_LOGS, accounts: null, unitsConsumed: 0, returnData: null } };
    });
    return { chain, player, sent };
  }

  it("raises the cap on Solana by exactly the shortfall, waits for the rollup, then sends the move again", async () => {
    const { chain, player, sent } = await refusedSpin(2_000_000, [2_000_000, 2_000_000, 250_000_000]);

    await chain.play(player, spin, record);

    expect(sent.solana.map(instructionNames)).toEqual([["raise_win_cap"]]);
    const raise = coder.decode(sent.solana[0].instructions[0].data)?.data;
    expect(raise && "amount" in raise ? String(raise.amount) : undefined).toBe("248000000");
    expect(sent.rollup.map(instructionNames)).toEqual([["slots_spin"], ["slots_spin"]]);
  });

  it("refuses the move, retryable, when the rollup never sees the raised cap", async () => {
    const { chain, player, sent } = await refusedSpin(2_000_000, [2_000_000]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(chain.rollup.getAccountInfoAndContext).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return { context: { slot: 1 }, value: await ledgerInfo(player, 2_000_000) };
    });

    await expect(chain.play(player, spin, record)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(sent.solana.map(instructionNames)).toEqual([["raise_win_cap"]]);
    expect(sent.rollup.map(instructionNames)).toEqual([["slots_spin"]]);
  });

  it("never raises the cap again for a raise the rollup has not seen yet", async () => {
    // A retry after the case above: Solana already holds 250 000 000, the rollup still checks 2 000 000.
    const { chain, player, sent } = await refusedSpin(250_000_000, [2_000_000, 2_000_000, 250_000_000]);

    await chain.play(player, spin, record);

    expect(sent.solana).toHaveLength(0);
    expect(sent.rollup.map(instructionNames)).toEqual([["slots_spin"], ["slots_spin"]]);
  });

  it("raises only what Solana's cap lacks when the rollup lags a smaller raise", async () => {
    const { chain, player, sent } = await refusedSpin(100_000_000, [2_000_000, 250_000_000]);

    await chain.play(player, spin, record);

    const raise = coder.decode(sent.solana[0].instructions[0].data)?.data;
    expect(raise && "amount" in raise ? String(raise.amount) : undefined).toBe("150000000");
  });

  it("never raises the cap for a move that stakes nothing", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    vi.mocked(chain.rollup.simulateTransaction).mockImplementationOnce(async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [0, { Custom: 6008 }] }, logs: SHORT_LOGS, accounts: null, unitsConsumed: 0, returnData: null },
    }));

    await expect(chain.play(player, { type: "hilo_guess", guess: "higher" }, record)).rejects.toMatchObject({ code: "PROGRAM_ERROR", message: "WinCapReached" });
    expect(sent.solana).toHaveLength(0);
  });

  it("passes any other refusal on, untouched", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    vi.mocked(chain.rollup.simulateTransaction).mockImplementationOnce(async () => ({
      context: { slot: 1 },
      value: { err: { InstructionError: [0, { Custom: 6007 }] }, logs: ["Program log: Error Code: InsufficientBalance."], accounts: null, unitsConsumed: 0, returnData: null },
    }));

    await expect(chain.play(player, { type: "slots_spin", amount: "1000000" }, record)).rejects.toMatchObject({ code: "PROGRAM_ERROR", message: "InsufficientBalance" });
    expect(sent.solana).toHaveLength(0);
  });
});
