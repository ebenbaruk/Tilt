import { describe, expect, test } from "claude-code/testing";

import { isPlayAction, isStateResponse } from "../hooks/guards";
import { betOptions, currentBet, GAMES, nextRouletteBet, planKeys, stepBetIndex } from "../hooks/keys";
import type { Prefs } from "../hooks/model";
import type { StateResponse } from "../hooks/protocol";
import * as fixtures from "./fixtures";

const PREFS: Prefs = { game: "blackjack", betIndex: 0, roulette: { kind: "red" }, baccarat: "banker" };
const STATES: [string, StateResponse][] = Object.entries(fixtures);
const HOTKEY = /^[0-9a-z]$/;

describe("the key plan", () => {
  test("every plan, for every game and state, is conflict-free and uses legal hotkeys", () => {
    for (const [name, state] of STATES) {
      for (const game of GAMES) {
        for (const isBusy of [false, true]) {
          const keys = planKeys({ state, prefs: { ...PREFS, game }, isBusy });
          const hotkeys = keys.map((key) => key.hotkey);
          const addresses = keys.map((key) => key.key);

          expect(new Set(hotkeys).size, `${name}/${game}: ${hotkeys.join(" ")}`).toBe(hotkeys.length);
          expect(new Set(addresses).size, `${name}/${game}`).toBe(addresses.length);
          expect(
            hotkeys.every((hotkey) => HOTKEY.test(hotkey)),
            `${name}/${game}`,
          ).toBe(true);
        }
      }
    }
  });

  test("each game offers its own keys", () => {
    const hotkeysOf = (game: Prefs["game"]) =>
      planKeys({ state: fixtures.BASE, prefs: { ...PREFS, game }, isBusy: false })
        .map((key) => key.hotkey)
        .join("");

    expect(hotkeysOf("blackjack")).toBe("1234vbn");
    expect(hotkeysOf("roulette")).toBe("1234rkoelgzcvbn");
    expect(hotkeysOf("baccarat")).toBe("1234pytvbn");
    expect(hotkeysOf("slots")).toBe("1234vbn");
  });

  test("blackjack in turn: hit, stand and double as the hand allows", () => {
    const keys = planKeys({ state: fixtures.BLACKJACK_TURN, prefs: PREFS, isBusy: false });

    expect(keys.map((key) => key.hotkey)).toEqual(["h", "s", "d"]);
  });

  test("nothing to play while blocked, without an account, drawing or with a move in flight", () => {
    const playKeys = (state: StateResponse, isBusy = false) =>
      planKeys({ state, prefs: PREFS, isBusy }).filter((key) => key.command.kind !== "switch");

    expect(playKeys(fixtures.BLOCKED)).toEqual([]);
    expect(playKeys(fixtures.NOT_OPEN)).toEqual([]);
    expect(playKeys(fixtures.SLOTS_DRAWING)).toEqual([]);
    expect(playKeys(fixtures.BASE, true)).toEqual([]);
    expect(playKeys({ ...fixtures.BASE, pendingIntentId: "abc" })).toEqual([]);
  });
});

describe("bets", () => {
  test("v and b step through the table minimum, then the presets within the limits", () => {
    expect(betOptions({ minBet: "500000", maxBet: "25000000" })).toEqual([
      "500000",
      "1000000",
      "2000000",
      "5000000",
      "10000000",
      "25000000",
    ]);
    expect(betOptions({ minBet: "1000000", maxBet: "5000000" })).toEqual(["1000000", "2000000", "5000000"]);
    expect(betOptions({ minBet: "100000", maxBet: "100000" })).toEqual(["100000"]);
  });

  test("v and b stop at the lowest and highest bet instead of wrapping", () => {
    const limits = { minBet: "1000000", maxBet: "5000000" };

    expect(stepBetIndex(limits, 0, -1)).toBe(0);
    expect(stepBetIndex(limits, 0, 1)).toBe(1);
    expect(stepBetIndex(limits, 2, 1)).toBe(2);
    expect(stepBetIndex(limits, 2, -1)).toBe(1);
    // An index left past the end by tighter limits counts as the highest bet.
    expect(currentBet(limits, 9)).toBe("5000000");
    expect(stepBetIndex(limits, 9, -1)).toBe(1);
  });

  test("z and c step through dozens and columns", () => {
    expect(nextRouletteBet({ kind: "red" }, "dozen")).toEqual({ kind: "dozen", dozen: 1 });
    expect(nextRouletteBet({ kind: "dozen", dozen: 3 }, "dozen")).toEqual({ kind: "dozen", dozen: 1 });
    expect(nextRouletteBet({ kind: "dozen", dozen: 1 }, "column")).toEqual({ kind: "column", column: 1 });
    expect(nextRouletteBet({ kind: "column", column: 1 }, "column")).toEqual({ kind: "column", column: 2 });
  });
});

describe("response guards", () => {
  test("every fixture is a valid state", () => {
    for (const [name, state] of STATES) {
      expect(isStateResponse(state), name).toBe(true);
    }
  });

  test("wrong shapes are refused", () => {
    const base = fixtures.BLACKJACK_TURN;
    const broken: unknown[] = [
      null,
      { ...base, balance: 12.4 },
      { ...base, balance: "-1" },
      { ...base, limits: { minBet: "1" } },
      { ...base, rtp: { blackjack: "99.00" } },
      { ...base, round: { ...base.round, phase: "won" } },
      { ...base, round: { ...base.round, detail: { ...base.round?.detail, player: [{ rank: 14, suit: "♠" }] } } },
      { ...base, sponsor: { ...base.sponsor, endsAt: "soon" } },
      { ...base, leaderboard: [{ rank: 1, handle: "x", net: "1.5", isYou: false }] },
    ];

    for (const value of broken) {
      expect(isStateResponse(value), JSON.stringify(value)?.slice(0, 80)).toBe(false);
    }
  });

  test("play actions", () => {
    expect(isPlayAction({ type: "blackjack_hit" })).toBe(true);
    expect(isPlayAction({ type: "roulette_spin", amount: "500000", bet: { kind: "dozen", dozen: 2 } })).toBe(true);
    expect(isPlayAction({ type: "roulette_spin", amount: "500000", bet: { kind: "dozen", dozen: 4 } })).toBe(false);
    expect(isPlayAction({ type: "slots_spin", amount: "0" })).toBe(false);
    expect(isPlayAction({ type: "withdraw", amount: "1" })).toBe(false);
  });
});
