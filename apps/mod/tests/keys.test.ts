import { describe, expect, test } from "claude-code/testing";

import { isPlayAction, isStateResponse } from "../hooks/guards";
import {
  betOptions,
  clampHands,
  currentBet,
  GAMES,
  nextRouletteBet,
  planKeys,
  startAction,
  stepBetIndex,
  stepHands,
} from "../hooks/keys";
import type { Prefs } from "../hooks/model";
import type { StateResponse } from "../hooks/protocol";
import { isTablePost, pressFor } from "../hooks/table-input";
import * as fixtures from "./fixtures";

const PREFS: Prefs = {
  game: "blackjack",
  betIndex: 0,
  hands: 1,
  roulette: { kind: "red" },
  baccarat: "banker",
  slotsSpeed: "normal",
};
const STATES: [string, StateResponse][] = Object.entries(fixtures);
const HOTKEY = /^[0-9a-z]$/;

describe("the key plan", () => {
  test("every plan, for every game and state, is conflict-free and uses legal hotkeys", () => {
    for (const [name, state] of STATES) {
      for (const game of GAMES) {
        for (const isBusy of [false, true]) {
          const keys = planKeys({ state, prefs: { ...PREFS, game, hands: isBusy ? 6 : 1 }, isBusy });
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

    expect(hotkeysOf("blackjack")).toBe("1234jkvbn");
    expect(hotkeysOf("roulette")).toBe("1234rkoelgzcvbn");
    expect(hotkeysOf("baccarat")).toBe("1234pytvbn");
    expect(hotkeysOf("slots")).toBe("1234xftvbn");
  });

  test("blackjack in turn: hit, stand and double for the active hand, whatever the hand count", () => {
    for (const state of [fixtures.BLACKJACK_TURN, fixtures.BLACKJACK_SIX_TURN, fixtures.BLACKJACK_TEN_TURN]) {
      const keys = planKeys({ state, prefs: { ...PREFS, hands: 6 }, isBusy: false });

      expect(keys.map((key) => key.hotkey)).toEqual(["1", "2", "3", "4", "h", "s", "d"]);
    }
  });

  test("blackjack in turn: p splits a pair, offered only when the active hand can split", () => {
    const keys = planKeys({ state: fixtures.BLACKJACK_PAIR, prefs: PREFS, isBusy: false });

    expect(keys.map((key) => key.hotkey)).toEqual(["1", "2", "3", "4", "h", "s", "d", "p"]);
    expect(keys.find((key) => key.hotkey === "p")?.command).toEqual({
      kind: "play",
      action: { type: "blackjack_split" },
    });
  });

  test("the deal key names the hands and the bet per hand", () => {
    const label = (hands: number) =>
      planKeys({ state: fixtures.BASE, prefs: { ...PREFS, hands }, isBusy: false }).find((key) => key.key === "start")
        ?.label;

    expect(label(1)).toBe("deal · 0.50");
    expect(label(3)).toBe("deal · 3 × 0.50");
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

  test("j and k step the hands from one to six, held at both ends; the deal carries them", () => {
    expect(stepHands(1, -1)).toBe(1);
    expect(stepHands(1, 1)).toBe(2);
    expect(stepHands(6, 1)).toBe(6);
    expect(stepHands(6, -1)).toBe(5);
    // A count left out of bounds or broken in the stored prefs reads as the nearest legal one.
    expect(clampHands(9)).toBe(6);
    expect(clampHands(0)).toBe(1);
    expect(clampHands(Number.NaN)).toBe(1);
    expect(startAction("blackjack", "500000", { ...PREFS, hands: 4 })).toEqual({
      type: "blackjack_bet",
      amount: "500000",
      hands: 4,
    });
  });
});

describe("response guards", () => {
  test("every fixture is a valid state", () => {
    for (const [name, state] of STATES) {
      expect(isStateResponse(state), name).toBe(true);
    }
  });

  test("wrong shapes are refused", () => {
    const base = fixtures.BLACKJACK_SIX_TURN;
    const detail = base.round?.detail;
    const withDetail = (fields: Record<string, unknown>) => ({
      ...base,
      round: { ...base.round, detail: { ...detail, ...fields } },
    });
    const hands = detail?.game === "blackjack" ? detail.hands : [];
    const broken: unknown[] = [
      null,
      { ...base, balance: 12.4 },
      { ...base, balance: "-1" },
      { ...base, limits: { minBet: "1" } },
      { ...base, rtp: { blackjack: "99.00" } },
      { ...base, round: { ...base.round, phase: "won" } },
      withDetail({ hands: [{ ...hands[0], cards: [{ rank: 14, suit: "♠" }] }] }),
      withDetail({ hands: [] }),
      withDetail({ hands: [...hands, ...hands.slice(0, 5)] }),
      withDetail({ hands: [{ ...hands[0], split: undefined }] }),
      withDetail({ canSplit: undefined }),
      withDetail({ hands: [{ ...hands[0], result: "won" }] }),
      withDetail({ hands: [{ ...hands[0], stake: 1 }] }),
      withDetail({ activeHand: 6 }),
      withDetail({ activeHand: -1 }),
      // The single-hand shape the api sent before multi-hand.
      withDetail({ hands: undefined, player: hands[0]?.cards, playerTotal: 11, playerSoft: false, doubled: false }),
      { ...base, sponsor: { ...base.sponsor, endsAt: "soon" } },
      { ...base, leaderboard: [{ rank: 1, handle: "x", net: "1.5", isYou: false }] },
    ];

    for (const value of broken) {
      expect(isStateResponse(value), JSON.stringify(value)?.slice(0, 80)).toBe(false);
    }
  });

  test("play actions", () => {
    expect(isPlayAction({ type: "blackjack_hit" })).toBe(true);
    expect(isPlayAction({ type: "blackjack_split" })).toBe(true);
    expect(isPlayAction({ type: "blackjack_bet", amount: "500000", hands: 6 })).toBe(true);
    expect(isPlayAction({ type: "blackjack_bet", amount: "500000" })).toBe(false);
    expect(isPlayAction({ type: "blackjack_bet", amount: "500000", hands: 0 })).toBe(false);
    expect(isPlayAction({ type: "blackjack_bet", amount: "500000", hands: 7 })).toBe(false);
    expect(isPlayAction({ type: "blackjack_bet", amount: "500000", hands: 1.5 })).toBe(false);
    expect(isPlayAction({ type: "roulette_spin", amount: "500000", bet: { kind: "dozen", dozen: 2 } })).toBe(true);
    expect(isPlayAction({ type: "roulette_spin", amount: "500000", bet: { kind: "dozen", dozen: 4 } })).toBe(false);
    expect(isPlayAction({ type: "slots_spin", amount: "0" })).toBe(false);
    expect(isPlayAction({ type: "withdraw", amount: "1" })).toBe(false);
  });
});

describe("the table surface's input", () => {
  test("posts are exactly { press: <address> }", () => {
    expect(isTablePost({ press: "start" })).toBe(true);

    for (const value of [
      null,
      "start",
      ["start"],
      {},
      { press: "" },
      { press: 1 },
      { press: "x".repeat(41) },
      { press: "start", amount: "999000000" },
      { command: { kind: "play", action: { type: "blackjack_hit" } } },
    ]) {
      expect(isTablePost(value), JSON.stringify(value)).toBe(false);
    }
  });

  test("Space and Enter play, arrows step the bet and the hands, letters are the plan's hotkeys", () => {
    const keysOf = (state: StateResponse, prefs: Prefs = PREFS) => planKeys({ state, prefs, isBusy: false });
    const idle = keysOf(fixtures.BLACKJACK_MIXED);
    const turn = keysOf(fixtures.BLACKJACK_SIX_TURN);

    expect(pressFor({ key: "space" }, idle)).toBe("start");
    expect(pressFor({ key: "return" }, idle)).toBe("start");
    expect(pressFor({ key: "left" }, idle)).toBe("bet-down");
    expect(pressFor({ key: "right" }, idle)).toBe("bet-up");
    expect(pressFor({ key: "up" }, idle)).toBe("hands-up");
    expect(pressFor({ key: "down" }, idle)).toBe("hands-down");
    expect(pressFor({ key: "3" }, idle)).toBe("game-baccarat");
    expect(pressFor({ key: "space", ctrl: true }, idle)).toBeNull();
    expect(pressFor({ key: "space" }, turn)).toBe("bj-hit");
    expect(pressFor({ key: "return" }, turn)).toBe("bj-stand");
    expect(pressFor({ key: "d" }, turn)).toBe("bj-double");
    expect(pressFor({ key: "p" }, turn)).toBeNull();
    expect(pressFor({ key: "p" }, keysOf(fixtures.BLACKJACK_PAIR))).toBe("bj-split");
    expect(pressFor({ key: "left" }, turn)).toBeNull();
    // No hands outside blackjack, nothing at all while a move is in flight.
    expect(pressFor({ key: "up" }, keysOf(fixtures.BASE, { ...PREFS, game: "slots" }))).toBeNull();
    expect(pressFor({ key: "space" }, planKeys({ state: fixtures.BASE, prefs: PREFS, isBusy: true }))).toBeNull();
  });

  test("whatever the state, a raw key presses a key the plan has, and each hotkey its own key", () => {
    for (const [name, state] of STATES) {
      for (const game of GAMES) {
        const keys = planKeys({ state, prefs: { ...PREFS, game }, isBusy: false });
        const addresses = keys.map((key) => key.key);

        for (const key of ["space", "return", "left", "right", "up", "down", "x"]) {
          const press = pressFor({ key }, keys);

          expect(press === null || addresses.includes(press), `${name}/${game}/${key}`).toBe(true);
        }

        for (const action of keys) {
          expect(pressFor({ key: action.hotkey }, keys), `${name}/${game}/${action.hotkey}`).toBe(action.key);
        }
      }
    }
  });
});
