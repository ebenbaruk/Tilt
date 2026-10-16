import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { idl, minesBoardAddress, PROGRAM_ID, tableAddress } from "./program";

describe("IDL", () => {
  it("only lets the VRF callback write to a player account PDA", () => {
    const callback = idl.instructions.find((i) => i.name === "consume_randomness");
    const account = callback?.accounts.find((a) => a.name === "account");
    expect(account && "pda" in account ? account.pda?.seeds : undefined).toEqual([
      { kind: "const", value: Array.from(Buffer.from("account")) },
      { kind: "account", path: "account.player", account: "PlayerAccount" },
    ]);
  });

  it("only lets the Mines callback write to the player's account and board PDAs", () => {
    const callback = idl.instructions.find((i) => i.name === "consume_mines_randomness");
    const seeds = (name: string) => {
      const account = callback?.accounts.find((a) => a.name === name);
      return account && "pda" in account ? account.pda?.seeds : undefined;
    };
    expect(seeds("account")).toEqual([
      { kind: "const", value: Array.from(Buffer.from("account")) },
      { kind: "account", path: "account.player", account: "PlayerAccount" },
    ]);
    expect(seeds("board")).toEqual([
      { kind: "const", value: Array.from(Buffer.from("mines")) },
      { kind: "account", path: "account.player", account: "PlayerAccount" },
    ]);
  });

  it("derives the table the program expects on every blackjack move", () => {
    const player = Keypair.generate().publicKey;
    for (const name of ["blackjack_bet", "blackjack_hit", "blackjack_stand", "blackjack_double", "blackjack_split"]) {
      const table = idl.instructions.find((i) => i.name === name)?.accounts.find((a) => a.name === "table");
      const seeds = table && "pda" in table ? table.pda?.seeds : undefined;
      const prefix = Buffer.from(seeds?.[0]?.value ?? []);
      const [expected] = PublicKey.findProgramAddressSync([prefix, player.toBuffer()], PROGRAM_ID);
      expect(tableAddress(player).equals(expected), name).toBe(true);
    }
  });

  it("derives the board the program expects on every Mines move", () => {
    const player = Keypair.generate().publicKey;
    for (const name of ["open_mines_board", "mines_bet", "mines_reveal", "mines_cashout", "expire_mines_round"]) {
      const board = idl.instructions.find((i) => i.name === name)?.accounts.find((a) => a.name === "board");
      const seeds = board && "pda" in board ? board.pda?.seeds : undefined;
      const prefix = Buffer.from(seeds?.[0]?.value ?? []);
      const [expected] = PublicKey.findProgramAddressSync([prefix, player.toBuffer()], PROGRAM_ID);
      expect(minesBoardAddress(player).equals(expected), name).toBe(true);
    }
  });
});
