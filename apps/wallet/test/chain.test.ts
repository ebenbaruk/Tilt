// The relay's transactions, with both RPC connections stubbed: which instruction each action
// becomes, which table or board it passes, how a missing blackjack table or Mines board gets
// opened first, and how a move past the win cap raises it.
import anchor from "@coral-xyz/anchor";
import { type AccountInfo, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { type Action, idl, ledgerAddress, minesBoardAddress, PROGRAM_ID, tableAddress } from "@tilt/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TiltChain, winCapShortfall } from "../src/chain";

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

  const isGameAccount = (address: PublicKey) => address.equals(tableAddress(player)) || address.equals(minesBoardAddress(player));
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

  it("retries a stuck Mines reveal with the board, other draws with expire_round", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    await chain.expireRound(player, { mines: {} });
    await chain.expireRound(player, { blackjack: {} });
    await chain.expireRound(player, { slots: {} });
    expect(sent.rollup.map(instructionNames)).toEqual([["expire_mines_round"], ["expire_round"], ["expire_round"]]);
    const [mines, blackjack, slots] = sent.rollup.map((tx) => tx.instructions[0]);
    expect(mines.keys.some((k) => k.pubkey.equals(minesBoardAddress(player)))).toBe(true);
    expect(blackjack.keys[TABLE_INDEX].pubkey.equals(tableAddress(player))).toBe(true);
    expect(slots.keys[TABLE_INDEX].pubkey.equals(PROGRAM_ID)).toBe(true);
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

  it("raises the cap on Solana by exactly the shortfall, waits for the rollup, then sends the move again", async () => {
    const { chain, player, sent } = stubbedChain({ tableOnSolana: true, rollupMisses: 0 });
    const spin: Action = { type: "slots_spin", amount: "1000000" };
    const atOpening = { ...accountInfo(PROGRAM_ID), data: await ledgerData(player, 2_000_000) };
    const raised = { ...accountInfo(PROGRAM_ID), data: await ledgerData(player, 250_000_000) };
    vi.mocked(chain.base.getAccountInfo).mockImplementation(async (address) => (address.equals(ledgerAddress(player)) ? atOpening : null));
    // Anchor reads accounts with their context.
    vi.spyOn(chain.base, "getAccountInfoAndContext").mockResolvedValue({ context: { slot: 1 }, value: atOpening });
    vi.spyOn(chain.rollup, "getAccountInfoAndContext").mockResolvedValue({ context: { slot: 1 }, value: raised });
    vi.mocked(chain.rollup.simulateTransaction).mockImplementationOnce(async (tx) => {
      if (!("version" in tx)) sent.rollup.push(tx);
      return { context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6008 }] }, logs: SHORT_LOGS, accounts: null, unitsConsumed: 0, returnData: null } };
    });

    await chain.play(player, spin, record);

    expect(sent.solana.map(instructionNames)).toEqual([["raise_win_cap"]]);
    const raise = coder.decode(sent.solana[0].instructions[0].data)?.data;
    expect(raise && "amount" in raise ? String(raise.amount) : undefined).toBe("248000000");
    expect(sent.rollup.map(instructionNames)).toEqual([["slots_spin"], ["slots_spin"]]);
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
