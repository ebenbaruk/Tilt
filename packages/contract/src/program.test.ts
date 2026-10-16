import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  hiloBoardAddress,
  idl,
  minesBoardAddress,
  PROGRAM_ID,
  quickTableAddress,
  tableAddress,
  towerBoardAddress,
} from "./program";

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

  const games = [
    {
      account: "quick",
      seed: "quick",
      address: quickTableAddress,
      callback: "consume_quick_randomness",
      instructions: ["open_quick_table", "dice_roll", "limbo_play", "flip_play", "keno_play", "wheel_spin", "expire_quick_round"],
    },
    {
      account: "board",
      seed: "hilo",
      address: hiloBoardAddress,
      callback: "consume_hilo_randomness",
      instructions: ["open_hilo_board", "hilo_bet", "hilo_guess", "hilo_cashout", "expire_hilo_round"],
    },
    {
      account: "board",
      seed: "tower",
      address: towerBoardAddress,
      callback: "consume_tower_randomness",
      instructions: ["open_tower_board", "tower_bet", "tower_climb", "tower_cashout", "expire_tower_round"],
    },
  ];

  for (const game of games) {
    it(`only lets ${game.callback} write to the player's account and ${game.seed} PDAs`, () => {
      const callback = idl.instructions.find((i) => i.name === game.callback);
      const seeds = (name: string) => {
        const account = callback?.accounts.find((a) => a.name === name);
        return account && "pda" in account ? account.pda?.seeds : undefined;
      };
      expect(seeds("account")).toEqual([
        { kind: "const", value: Array.from(Buffer.from("account")) },
        { kind: "account", path: "account.player", account: "PlayerAccount" },
      ]);
      expect(seeds(game.account)).toEqual([
        { kind: "const", value: Array.from(Buffer.from(game.seed)) },
        { kind: "account", path: "account.player", account: "PlayerAccount" },
      ]);
    });

    it(`derives the ${game.seed} account the program expects on every move`, () => {
      const player = Keypair.generate().publicKey;
      for (const name of game.instructions) {
        const account = idl.instructions.find((i) => i.name === name)?.accounts.find((a) => a.name === game.account);
        const seeds = account && "pda" in account ? account.pda?.seeds : undefined;
        const prefix = Buffer.from(seeds?.[0]?.value ?? []);
        expect(prefix.toString(), name).toBe(game.seed);
        const [expected] = PublicKey.findProgramAddressSync([prefix, player.toBuffer()], PROGRAM_ID);
        expect(game.address(player).equals(expected), name).toBe(true);
      }
    });
  }
});
