import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { idl, PROGRAM_ID, tableAddress } from "./program";

describe("IDL", () => {
  it("only lets the VRF callback write to a player account PDA", () => {
    const callback = idl.instructions.find((i) => i.name === "consume_randomness");
    const account = callback?.accounts.find((a) => a.name === "account");
    expect(account && "pda" in account ? account.pda?.seeds : undefined).toEqual([
      { kind: "const", value: Array.from(Buffer.from("account")) },
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
});
