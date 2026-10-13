import { describe, expect, it } from "vitest";
import { idl } from "./program";

describe("IDL", () => {
  it("only lets the VRF callback write to a player account PDA", () => {
    const callback = idl.instructions.find((i) => i.name === "consume_randomness");
    const account = callback?.accounts.find((a) => a.name === "account");
    expect(account && "pda" in account ? account.pda?.seeds : undefined).toEqual([
      { kind: "const", value: Array.from(Buffer.from("account")) },
      { kind: "account", path: "account.player", account: "PlayerAccount" },
    ]);
  });
});
