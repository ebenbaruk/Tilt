import { describe, expect, it } from "vitest";
import { Amount, ErrorResponse, FaucetClaimRequest, FaucetClaimResponse, FaucetStatusResponse, IntentRequest, PrivyUserId } from "./relay";

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
      { type: "roulette_chips", chips: [{ bet: { kind: "red" }, amount: "1000000" }] },
      {
        type: "roulette_chips",
        chips: [
          { bet: { kind: "straight", number: 17 }, amount: "100000" },
          { bet: { kind: "straight", number: 18 }, amount: "100000" },
          { bet: { kind: "dozen", dozen: 2 }, amount: "300000" },
          { bet: { kind: "column", column: 2 }, amount: "300000" },
        ],
      },
      { type: "roulette_chips", chips: Array.from({ length: 20 }, (_, number) => ({ bet: { kind: "straight", number }, amount: "1" })) },
      { type: "baccarat_deal", amount: "1000000", bet: "tie" },
      { type: "slots_spin", amount: "1000000" },
      { type: "mines_bet", amount: "1000000", mines: 1 },
      { type: "mines_bet", amount: "1000000", mines: 24 },
      { type: "mines_reveal", tile: 0 },
      { type: "mines_reveal", tile: 24 },
      { type: "mines_cashout" },
      { type: "dice_roll", amount: "1000000", target: 100, over: false },
      { type: "dice_roll", amount: "1000000", target: 9_800, over: false },
      { type: "dice_roll", amount: "1000000", target: 200, over: true },
      { type: "dice_roll", amount: "1000000", target: 9_900, over: true },
      { type: "limbo_play", amount: "1000000", target: 101 },
      { type: "limbo_play", amount: "1000000", target: 1_000_000 },
      { type: "flip_play", amount: "1000000", side: "heads", flips: 1 },
      { type: "flip_play", amount: "1000000", side: "tails", flips: 10 },
      { type: "keno_play", amount: "1000000", picks: [1] },
      { type: "keno_play", amount: "1000000", picks: [40, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { type: "wheel_spin", amount: "1000000", segments: 10, risk: "low" },
      { type: "wheel_spin", amount: "1000000", segments: 50, risk: "high" },
      { type: "hilo_bet", amount: "1000000" },
      { type: "hilo_guess", guess: "higher" },
      { type: "hilo_guess", guess: "skip" },
      { type: "hilo_cashout" },
      { type: "tower_bet", amount: "1000000", difficulty: "master" },
      { type: "tower_climb", tile: 0 },
      { type: "tower_climb", tile: 3 },
      { type: "tower_cashout" },
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
      { type: "roulette_chips", chips: [] },
      { type: "roulette_chips", chips: Array.from({ length: 21 }, (_, number) => ({ bet: { kind: "straight", number }, amount: "1" })) },
      { type: "roulette_chips", chips: [{ bet: { kind: "red" }, amount: "1" }, { bet: { kind: "red" }, amount: "2" }] },
      { type: "roulette_chips", chips: [{ bet: { kind: "straight", number: 5 }, amount: "1" }, { bet: { number: 5, kind: "straight" }, amount: "1" }] },
      { type: "roulette_chips", chips: [{ bet: { kind: "straight", number: 37 }, amount: "1" }] },
      { type: "roulette_chips", chips: [{ bet: { kind: "red" }, amount: "0" }] },
      { type: "roulette_chips", chips: [{ bet: { kind: "red" }, amount: 1 }] },
      { type: "roulette_chips", chips: [{ bet: { kind: "red" } }] },
      { type: "roulette_chips", amount: "1", bet: { kind: "red" } },
      { type: "baccarat_deal", amount: "1", bet: "dragon" },
      { type: "blackjack_bet", amount: "1" },
      { type: "blackjack_bet", amount: "1", hands: 0 },
      { type: "blackjack_bet", amount: "1", hands: 7 },
      { type: "blackjack_bet", amount: "1", hands: 2.5 },
      { type: "blackjack_bet", amount: "1", hands: "2" },
      { type: "slots_spin" },
      { type: "mines_bet", amount: "1" },
      { type: "mines_bet", amount: "1", mines: 0 },
      { type: "mines_bet", amount: "1", mines: 25 },
      { type: "mines_bet", amount: "1", mines: 2.5 },
      { type: "mines_bet", amount: "1", mines: "3" },
      { type: "mines_reveal" },
      { type: "mines_reveal", tile: -1 },
      { type: "mines_reveal", tile: 25 },
      { type: "mines_reveal", tile: 1.5 },
      { type: "dice_roll", amount: "1", target: 99, over: false },
      { type: "dice_roll", amount: "1", target: 9_801, over: false },
      { type: "dice_roll", amount: "1", target: 199, over: true },
      { type: "dice_roll", amount: "1", target: 9_901, over: true },
      { type: "dice_roll", amount: "1", target: 50.5, over: true },
      { type: "dice_roll", amount: "1", target: 5_000 },
      { type: "limbo_play", amount: "1", target: 100 },
      { type: "limbo_play", amount: "1", target: 1_000_001 },
      { type: "limbo_play", amount: "1", target: 2.5 },
      { type: "flip_play", amount: "1", side: "edge", flips: 1 },
      { type: "flip_play", amount: "1", side: "heads", flips: 0 },
      { type: "flip_play", amount: "1", side: "heads", flips: 11 },
      { type: "keno_play", amount: "1", picks: [] },
      { type: "keno_play", amount: "1", picks: [0] },
      { type: "keno_play", amount: "1", picks: [41] },
      { type: "keno_play", amount: "1", picks: [3, 3] },
      { type: "keno_play", amount: "1", picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      { type: "wheel_spin", amount: "1", segments: 15, risk: "low" },
      { type: "wheel_spin", amount: "1", segments: 10, risk: "extreme" },
      { type: "hilo_guess", guess: "same" },
      { type: "hilo_bet" },
      { type: "tower_bet", amount: "1", difficulty: "insane" },
      { type: "tower_climb", tile: 4 },
      { type: "tower_climb", tile: -1 },
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

describe("faucet", () => {
  const claimId = "6F9619FF-8B86-4011-B42D-00C04FC964FF";
  const userId = "did:privy:cm3np4u9j001rc8b73seqmqqk";

  it("takes no amount from the caller and lowercases the claim id", () => {
    expect(FaucetClaimRequest.parse({ claimId, userId, amount: "1000000000000" })).toEqual({ claimId: claimId.toLowerCase(), userId });
    expect(FaucetClaimRequest.safeParse({ claimId: "1", userId }).success).toBe(false);
    expect(FaucetClaimRequest.safeParse({ claimId, userId: "did:privy:x" }).success).toBe(false);
  });

  it("describes claims and the status in base units and ISO times", () => {
    expect(FaucetClaimResponse.safeParse({ claimId: claimId.toLowerCase(), amount: "100000000", status: "submitted", signature: "5ig" }).success).toBe(true);
    expect(FaucetClaimResponse.safeParse({ claimId: claimId.toLowerCase(), amount: "100.5", status: "submitted" }).success).toBe(false);
    expect(FaucetStatusResponse.safeParse({ enabled: true, amount: "100000000", nextClaimAt: "2026-11-25T10:00:00.000Z" }).success).toBe(true);
    expect(FaucetStatusResponse.safeParse({ enabled: false, amount: null, nextClaimAt: null }).success).toBe(true);
    expect(FaucetStatusResponse.safeParse({ enabled: true, amount: "100000000", nextClaimAt: "tomorrow" }).success).toBe(false);
  });

  it("says when a refused claim can be retried", () => {
    const limit = { error: { code: "LIMIT_EXCEEDED", message: "m", retryAt: "2026-11-25T10:00:00.000Z" } };
    expect(ErrorResponse.parse(limit)).toEqual(limit);
    expect(ErrorResponse.safeParse({ error: { code: "FAUCET_EMPTY", message: "m" } }).success).toBe(true);
    expect(ErrorResponse.safeParse({ error: { ...limit.error, retryAt: "soon" } }).success).toBe(false);
  });
});
