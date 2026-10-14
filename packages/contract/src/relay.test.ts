import { describe, expect, it } from "vitest";
import { Amount, IntentRequest, PrivyUserId } from "./relay";

describe("Amount", () => {
  it("accepts positive integers in base units up to u64", () => {
    expect(Amount.safeParse("2500000").success).toBe(true);
    expect(Amount.safeParse("18446744073709551615").success).toBe(true);
  });

  it("refuses what the program could misread", () => {
    for (const bad of ["0", "-1", "1.5", "1e6", " 1", "01", "18446744073709551616", ""]) {
      expect(Amount.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("IntentRequest", () => {
  const base = { intentId: "6f9619ff-8b86-4011-b42d-00c04fc964ff", userId: "did:privy:cm3np4u9j001rc8b73seqmqqk" };

  it("parses every action shape", () => {
    const actions = [
      { type: "open_account", amount: "10000000" },
      { type: "deposit", amount: "1" },
      { type: "blackjack_bet", amount: "1000000", hands: 1 },
      { type: "blackjack_bet", amount: "1000000", hands: 6 },
      { type: "blackjack_hit" },
      { type: "blackjack_stand" },
      { type: "blackjack_double" },
      { type: "blackjack_split" },
      { type: "roulette_spin", amount: "1000000", bet: { kind: "straight", number: 0 } },
      { type: "roulette_spin", amount: "1000000", bet: { kind: "column", column: 3 } },
      { type: "baccarat_deal", amount: "1000000", bet: "tie" },
      { type: "slots_spin", amount: "1000000" },
      { type: "withdraw", amount: "5000000" },
    ];
    for (const action of actions) {
      expect(IntentRequest.safeParse({ ...base, action }).success, action.type).toBe(true);
    }
  });

  it("refuses bets the program would reject", () => {
    const bad = [
      { type: "roulette_spin", amount: "1", bet: { kind: "straight", number: 37 } },
      { type: "roulette_spin", amount: "1", bet: { kind: "dozen", dozen: 0 } },
      { type: "baccarat_deal", amount: "1", bet: "dragon" },
      { type: "blackjack_bet", amount: "1" },
      { type: "blackjack_bet", amount: "1", hands: 0 },
      { type: "blackjack_bet", amount: "1", hands: 7 },
      { type: "blackjack_bet", amount: "1", hands: 2.5 },
      { type: "blackjack_bet", amount: "1", hands: "2" },
      { type: "slots_spin" },
      { type: "transfer", amount: "1" },
    ];
    for (const action of bad) {
      expect(IntentRequest.safeParse({ ...base, action }).success, JSON.stringify(action)).toBe(false);
    }
  });

  it("requires a UUID intent id for idempotency", () => {
    expect(IntentRequest.safeParse({ ...base, intentId: "1", action: { type: "blackjack_hit" } }).success).toBe(false);
  });
});

describe("PrivyUserId", () => {
  it("accepts Privy DIDs only", () => {
    expect(PrivyUserId.safeParse("did:privy:cm3np4u9j001rc8b73seqmqqk").success).toBe(true);
    for (const bad of ["", "did:privy:", "did:privy:abc", "did:privy:CM3NP4U9J001RC8B73SEQMQQK", "did:privy:cm3np4u9j001rc8b73seqmqqk/../x", "did:privy:" + "a".repeat(41), "cm3np4u9j001rc8b73seqmqqk"]) {
      expect(PrivyUserId.safeParse(bad).success, bad).toBe(false);
    }
  });
});
