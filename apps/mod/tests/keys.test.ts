import { describe, expect, test } from "claude-code/testing";

import { isPlayAction, isStateResponse } from "../hooks/guards";
import {
  addChip,
  betOptions,
  choicesOf,
  clampHands,
  clampMines,
  crossCursor,
  currentBet,
  cursorBet,
  GAMES,
  heldKeys,
  keyRow,
  MAX_ROULETTE_CHIPS,
  MAX_ROULETTE_PLACED,
  planKeys,
  randomPicks,
  ROULETTE_CURSOR_CELLS,
  stackChips,
  startAction,
  stepBetIndex,
  stepCursor,
  stepHands,
  stepMines,
  stepSetting,
  tableKeys,
  toggleKenoPick,
} from "../hooks/keys";
import { type Prefs, prefsView } from "../hooks/model";
import type { RouletteBet, RouletteChip, RoundView, StateResponse } from "../hooks/protocol";
import { isTablePost, pressFor } from "../hooks/table-input";
import * as fixtures from "./fixtures";

const PREFS: Prefs = {
  game: "blackjack",
  betIndex: 0,
  hands: 1,
  rouletteChips: [],
  rouletteCursor: 0,
  baccarat: "banker",
  slotsSpeed: "normal",
  mines: 3,
  diceChance: 4900,
  diceOver: false,
  limboTarget: 200,
  flipSide: "heads",
  flips: 1,
  kenoPicks: [4, 12, 19, 27, 35],
  wheelSegments: 10,
  wheelRisk: "low",
  towerDifficulty: "easy",
};
/** The switcher's first page: nine games, then 0 for the next page. */
const PAGE_1 = "1234567890";
const PAGE_2 = "1230";
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

    expect(hotkeysOf("blackjack")).toBe(`${PAGE_1}jkvbn`);
    expect(hotkeysOf("roulette")).toBe(`${PAGE_1}rkoelgsdfhavb`);
    expect(hotkeysOf("baccarat")).toBe(`${PAGE_1}pytvbn`);
    expect(hotkeysOf("slots")).toBe(`${PAGE_1}xftvbn`);
    expect(hotkeysOf("mines")).toBe(`${PAGE_1}jkvbn`);
    expect(hotkeysOf("dice")).toBe(`${PAGE_1}jkovbn`);
    expect(hotkeysOf("limbo")).toBe(`${PAGE_1}jkvbn`);
    expect(hotkeysOf("flip")).toBe(`${PAGE_1}htjkvbn`);
    expect(hotkeysOf("keno")).toBe(`${PAGE_1}jkrvbn`);
    expect(hotkeysOf("wheel")).toBe(`${PAGE_2}jkrvbn`);
    expect(hotkeysOf("hilo")).toBe(`${PAGE_2}vbn`);
    expect(hotkeysOf("tower")).toBe(`${PAGE_2}jkvbn`);
  });

  test("blackjack in turn: hit, stand and double for the active hand, whatever the hand count", () => {
    for (const state of [fixtures.BLACKJACK_TURN, fixtures.BLACKJACK_SIX_TURN, fixtures.BLACKJACK_TEN_TURN]) {
      const keys = planKeys({ state, prefs: { ...PREFS, hands: 6 }, isBusy: false });

      expect(keys.map((key) => key.hotkey).join("")).toBe(`${PAGE_1}hsd`);
    }
  });

  test("blackjack in turn: p splits a pair, offered only when the active hand can split", () => {
    const keys = planKeys({ state: fixtures.BLACKJACK_PAIR, prefs: PREFS, isBusy: false });

    expect(keys.map((key) => key.hotkey).join("")).toBe(`${PAGE_1}hsdp`);
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

  test("mines in turn: a letter for each hidden tile, a to y, and z cashes out at the current multiplier", () => {
    const keys = planKeys({ state: fixtures.MINES_TURN, prefs: PREFS, isBusy: false });
    const plays = keys.filter((key) => key.command.kind !== "switch");

    // g (6) and m (12) are revealed: no key for them.
    expect(plays.map((key) => key.hotkey).join("")).toBe("abcdefhijklnopqrstuvwxyz");
    expect(keys.find((key) => key.hotkey === "a")?.command).toEqual({
      kind: "play",
      action: { type: "mines_reveal", tile: 0 },
    });
    expect(keys.find((key) => key.hotkey === "y")?.command).toEqual({
      kind: "play",
      action: { type: "mines_reveal", tile: 24 },
    });
    // 1.00 at ×1.2857.
    expect(keys.find((key) => key.hotkey === "z")).toMatchObject({
      key: "mines-cashout",
      label: "cash out · 1.28",
      command: { kind: "play", action: { type: "mines_cashout" } },
    });
  });

  test("mines: no cash-out before a safe tile, no tile once none is left to reveal", () => {
    const turn = fixtures.MINES_TURN;
    const detail = turn.round?.detail;
    const withBoard = (fields: Record<string, unknown>): StateResponse =>
      turn.round === null || detail?.game !== "mines"
        ? turn
        : { ...turn, round: { ...turn.round, detail: { ...detail, ...fields } } };
    const hotkeys = (state: StateResponse) =>
      planKeys({ state, prefs: PREFS, isBusy: false })
        .filter((key) => key.command.kind !== "switch")
        .map((key) => key.hotkey)
        .join("");

    expect(hotkeys(withBoard({ revealed: [], canCashOut: false }))).toBe("abcdefghijklmnopqrstuvwxy");
    expect(hotkeys(withBoard({ canReveal: false }))).toBe("z");
  });

  test("mines: a reveal being drawn holds the board's keys, the tile drawn and the safe ones left out", () => {
    const input = { state: fixtures.MINES_DRAWING, prefs: PREFS, isBusy: false };

    expect(planKeys(input).filter((key) => key.command.kind !== "switch")).toEqual([]);
    // g (6) is safe, m (12) is being drawn.
    expect(
      heldKeys(input)
        .map((key) => key.hotkey)
        .join(""),
    ).toBe("abcdefhijklnopqrstuvwxyz");
  });

  test("a settled mines board offers the next one: mines, bet and play", () => {
    for (const state of [fixtures.MINES_BUSTED, fixtures.MINES_CASHED]) {
      const keys = planKeys({ state, prefs: { ...PREFS, game: "mines" }, isBusy: false });

      expect(keys.map((key) => key.hotkey).join("")).toBe(`${PAGE_1}jkvbn`);
      expect(keys.find((key) => key.key === "start")?.label).toBe("play · 0.50 · 3 mines");
    }
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

  const LIMITS = { minBet: "500000", maxBet: "25000000" };
  const RED: RouletteBet = { kind: "red" };
  const chip = (bet: RouletteBet, amount: string): RouletteChip => ({ bet, amount });
  const straight = (number: number): RouletteBet => ({ kind: "straight", number });

  test("s and d move the cursor over 0 to 36, the dozens, then the columns, around both ends", () => {
    expect(ROULETTE_CURSOR_CELLS).toHaveLength(37 + 3 + 3);
    expect(cursorBet(17)).toEqual(straight(17));
    expect(cursorBet(37)).toEqual({ kind: "dozen", dozen: 1 });
    expect(cursorBet(42)).toEqual({ kind: "column", column: 3 });
    expect(stepCursor(0, -1)).toBe(42);
    expect(stepCursor(42, 1)).toBe(0);
    expect(stepCursor(36, 1)).toBe(37);
  });

  test("f and h move the cursor across the felt: a row three numbers at a time, 0 and the 2:1 at its ends", () => {
    const across = (from: RouletteBet, steps: readonly (-1 | 1)[]) =>
      cursorBet(
        steps.reduce(
          (cursor, step) => crossCursor(cursor, step),
          ROULETTE_CURSOR_CELLS.findIndex((cell) => JSON.stringify(cell) === JSON.stringify(from)),
        ),
      );
    const fromZero = (number: number) => {
      // The fastest way there with s, d, f and h, by a breadth-first walk from 0.
      const seen = new Map<number, number>([[0, 0]]);
      const queue = [0];

      for (let cursor = queue.shift(); cursor !== undefined; cursor = queue.shift()) {
        for (const next of [
          stepCursor(cursor, -1),
          stepCursor(cursor, 1),
          crossCursor(cursor, -1),
          crossCursor(cursor, 1),
        ]) {
          if (!seen.has(next)) {
            seen.set(next, (seen.get(cursor) ?? 0) + 1);
            queue.push(next);
          }
        }
      }

      return seen.get(number) ?? Infinity;
    };

    expect(across(straight(0), [1])).toEqual(straight(3));
    expect(across(straight(17), [1, 1])).toEqual(straight(23));
    expect(across(straight(2), [-1])).toEqual(straight(0));
    expect(across(straight(34), [1])).toEqual({ kind: "column", column: 1 });
    expect(across(straight(36), [1, 1])).toEqual({ kind: "column", column: 3 });
    expect(across({ kind: "column", column: 2 }, [-1])).toEqual(straight(35));
    expect(across({ kind: "dozen", dozen: 1 }, [1, 1, 1])).toEqual({ kind: "dozen", dozen: 3 });
    expect(across({ kind: "dozen", dozen: 2 }, [-1, -1])).toEqual({ kind: "dozen", dozen: 1 });
    // Any number, dozen or column within a few presses, where s and d alone take up to 21.
    expect(Math.max(...ROULETTE_CURSOR_CELLS.map((_, cursor) => fromZero(cursor)))).toBeLessThanOrEqual(8);
  });

  test("chips stack per bet in the order each bet got its first one, held to the table maximum", () => {
    const placed = [chip(RED, "1000000"), chip(straight(17), "500000"), chip(RED, "2000000")];

    expect(stackChips(placed)).toEqual([chip(RED, "3000000"), chip(straight(17), "500000")]);
    expect(addChip(placed, straight(17), "500000", LIMITS)).toEqual([...placed, chip(straight(17), "500000")]);
    // 3.00 on red: a 25.00 chip only fills it to the 25.00 maximum, then red takes no more.
    const full = addChip(placed, RED, "25000000", LIMITS);

    expect(full).toEqual([...placed, chip(RED, "22000000")]);
    expect(addChip(typeof full === "string" ? [] : full, RED, "500000", LIMITS)).toBe(
      "The red bet is at the table maximum (25.00).",
    );
  });

  test("a spin takes 20 bets and the table 100 chips, no more", () => {
    const twenty = Array.from({ length: MAX_ROULETTE_CHIPS }, (_, number) => chip(straight(number), "500000"));
    const hundred = Array.from({ length: MAX_ROULETTE_PLACED }, () => chip(RED, "1"));

    expect(addChip(twenty, straight(30), "500000", LIMITS)).toBe("20 bets at most on one spin.");
    // One more chip on a bet already played still goes on.
    expect(addChip(twenty, straight(3), "500000", LIMITS)).toHaveLength(MAX_ROULETTE_CHIPS + 1);
    expect(addChip(hundred, RED, "1", LIMITS)).toBe("100 chips at most on the table: undo or clear some.");
  });

  test("roulette: the spin sends every stack as one chip; no spin key without chips", () => {
    const placed = [chip(RED, "1000000"), chip(straight(17), "500000"), chip(RED, "500000")];
    const prefs = { ...PREFS, game: "roulette" as const, rouletteChips: placed, rouletteCursor: 17 };
    const keys = planKeys({ state: fixtures.BASE, prefs, isBusy: false });

    expect(startAction("roulette", "500000", prefs)).toEqual({
      type: "roulette_chips",
      chips: [chip(RED, "1500000"), chip(straight(17), "500000")],
    });
    // On 17, which has chips: x takes them off; u and q undo and clear.
    expect(keys.map((key) => key.hotkey).join("")).toBe(`${PAGE_1}rkoelgsdfhaxuqvbn`);
    expect(keys.find((key) => key.key === "start")?.label).toBe("spin · 2.00 · 2 chips");
    expect(keys.find((key) => key.key === "roulette-red")?.isSelected).toBe(true);
    expect(keys.find((key) => key.key === "roulette-black")?.isSelected).toBe(false);
    expect(keys.find((key) => key.key === "bet-up")?.label).toBe("chip +");
    expect(keys.find((key) => key.key === "chip-add")?.command).toEqual({ kind: "roulette-add", bet: null });
  });

  test("stored chips another plugin broke read as an empty table, a broken cursor as 0", () => {
    const held = (rouletteChips: unknown, rouletteCursor?: number) =>
      prefsView({ ...PREFS, rouletteChips, rouletteCursor });
    const good = [chip(RED, "500000"), chip(straight(36), "1000000")];

    expect(held(good, 42).rouletteChips).toEqual(good);
    expect(held(good, 42).rouletteCursor).toBe(42);
    expect(held(good, 43).rouletteCursor).toBe(0);
    expect(held(good, 1.5).rouletteCursor).toBe(0);
    expect(held(undefined).rouletteChips).toEqual([]);
    expect(held([...good, chip(straight(37), "1")]).rouletteChips).toEqual([]);
    expect(held([...good, chip(RED, "0")]).rouletteChips).toEqual([]);
    expect(held([...good, { bet: RED, amount: 5 }]).rouletteChips).toEqual([]);
    expect(held(Array.from({ length: MAX_ROULETTE_PLACED + 1 }, () => chip(RED, "1"))).rouletteChips).toEqual([]);
    expect(
      held(Array.from({ length: MAX_ROULETTE_CHIPS + 1 }, (_, number) => chip(straight(number), "1"))).rouletteChips,
    ).toEqual([]);
  });

  test("the roulette layout's numbers, dozens and columns are clicks on the fullscreen table, no letter's", () => {
    const prefs = { ...PREFS, game: "roulette" as const, rouletteChips: [chip(straight(17), "500000")] };
    const input = { state: fixtures.BASE, prefs, isBusy: false };
    const keys = tableKeys(input);
    const clicks = keys.filter((key) => key.hotkey === "");

    expect(clicks).toHaveLength(37 + 3 + 3);
    expect(new Set(keys.map((key) => key.key)).size).toBe(keys.length);
    expect(clicks.filter((key) => key.isSelected).map((key) => key.key)).toEqual(["roulette-straight-17"]);
    expect(clicks.find((key) => key.key === "roulette-dozen-2")?.command).toEqual({
      kind: "roulette-add",
      bet: { kind: "dozen", dozen: 2 },
    });
    // Not while a spin is in flight.
    expect(tableKeys({ ...input, isBusy: true }).some((key) => key.hotkey === "")).toBe(false);
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

  test("j and k step the mines from 1 to 24, held at both ends; the bet carries them", () => {
    expect(stepMines(1, -1)).toBe(1);
    expect(stepMines(3, 1)).toBe(4);
    expect(stepMines(24, 1)).toBe(24);
    expect(stepMines(24, -1)).toBe(23);
    expect(clampMines(30)).toBe(24);
    expect(clampMines(0)).toBe(1);
    // A broken stored count reads as the default, not as an extreme.
    expect(clampMines(Number.NaN)).toBe(3);
    expect(startAction("mines", "500000", { ...PREFS, mines: 7 })).toEqual({
      type: "mines_bet",
      amount: "500000",
      mines: 7,
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
      // An api from before Mines: no Mines RTP.
      { ...base, rtp: { blackjack: "99.00", roulette: "97.30", baccarat: "98.94", slots: "96.16" } },
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

  test("a Mines board of the wrong shape is refused", () => {
    const base = fixtures.MINES_TURN;
    const withBoard = (fields: Record<string, unknown>) => ({
      ...base,
      round: { ...base.round, detail: { ...base.round?.detail, ...fields } },
    });
    const broken: unknown[] = [
      withBoard({ mines: 0 }),
      withBoard({ mines: 25 }),
      withBoard({ mines: 2.5 }),
      withBoard({ revealed: [6, 6] }),
      withBoard({ revealed: [25] }),
      withBoard({ revealed: [-1] }),
      withBoard({ revealed: "6,12" }),
      // 24 mines leave one safe tile: two cannot be revealed.
      withBoard({ mines: 24, revealed: [0, 1] }),
      withBoard({ pending: 6 }),
      withBoard({ pending: 25 }),
      withBoard({ busted: 12 }),
      withBoard({ busted: undefined }),
      withBoard({ multiplier: 1.2857 }),
      withBoard({ multiplier: "1.29" }),
      withBoard({ multiplier: "-1.2857" }),
      withBoard({ nextMultiplier: "x1.4785" }),
      withBoard({ canCashOut: "yes" }),
      withBoard({ canReveal: undefined }),
    ];

    for (const value of broken) {
      expect(isStateResponse(value), JSON.stringify(value)?.slice(-160)).toBe(false);
    }

    expect(isStateResponse(withBoard({ mines: 24, revealed: [0], pending: 1 }))).toBe(true);
    expect(isStateResponse(withBoard({ nextMultiplier: null, canReveal: false }))).toBe(true);
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
    const chips = (count: number) =>
      Array.from({ length: count }, (_, number) => ({ bet: { kind: "straight", number }, amount: "500000" }));

    expect(isPlayAction({ type: "roulette_chips", chips: chips(1) })).toBe(true);
    expect(isPlayAction({ type: "roulette_chips", chips: chips(20) })).toBe(true);
    expect(isPlayAction({ type: "roulette_chips", chips: chips(0) })).toBe(false);
    expect(isPlayAction({ type: "roulette_chips", chips: chips(21) })).toBe(false);
    expect(isPlayAction({ type: "roulette_chips", chips: [...chips(2), ...chips(1)] })).toBe(false);
    expect(isPlayAction({ type: "roulette_chips", chips: [{ bet: { kind: "red" }, amount: "0" }] })).toBe(false);
    expect(isPlayAction({ type: "roulette_chips", chips: [{ bet: { kind: "red" }, amount: 500000 }] })).toBe(false);
    expect(isPlayAction({ type: "slots_spin", amount: "0" })).toBe(false);
    expect(isPlayAction({ type: "mines_bet", amount: "500000", mines: 1 })).toBe(true);
    expect(isPlayAction({ type: "mines_bet", amount: "500000", mines: 24 })).toBe(true);
    expect(isPlayAction({ type: "mines_bet", amount: "500000", mines: 0 })).toBe(false);
    expect(isPlayAction({ type: "mines_bet", amount: "500000", mines: 25 })).toBe(false);
    expect(isPlayAction({ type: "mines_bet", amount: "500000" })).toBe(false);
    expect(isPlayAction({ type: "mines_bet", amount: "0", mines: 3 })).toBe(false);
    expect(isPlayAction({ type: "mines_reveal", tile: 0 })).toBe(true);
    expect(isPlayAction({ type: "mines_reveal", tile: 24 })).toBe(true);
    expect(isPlayAction({ type: "mines_reveal", tile: 25 })).toBe(false);
    expect(isPlayAction({ type: "mines_reveal", tile: 1.5 })).toBe(false);
    expect(isPlayAction({ type: "mines_reveal" })).toBe(false);
    expect(isPlayAction({ type: "mines_cashout" })).toBe(true);
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

  test("at Mines the arrows step the mines, the letters reveal, z cashes out, Space plays nothing mid-board", () => {
    const idle = planKeys({ state: fixtures.MINES_CASHED, prefs: { ...PREFS, game: "mines" }, isBusy: false });
    const turn = planKeys({ state: fixtures.MINES_TURN, prefs: PREFS, isBusy: false });

    expect(pressFor({ key: "up" }, idle)).toBe("mines-up");
    expect(pressFor({ key: "down" }, idle)).toBe("mines-down");
    expect(pressFor({ key: "space" }, idle)).toBe("start");
    expect(pressFor({ key: "a" }, turn)).toBe("mines-tile-0");
    expect(pressFor({ key: "Y" }, turn)).toBe("mines-tile-24");
    // g is revealed already.
    expect(pressFor({ key: "g" }, turn)).toBeNull();
    expect(pressFor({ key: "z" }, turn)).toBe("mines-cashout");
    expect(pressFor({ key: "space" }, turn)).toBeNull();
    expect(pressFor({ key: "return" }, turn)).toBeNull();
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

describe("the twelve games", () => {
  const plays = (state: StateResponse, prefs: Prefs = PREFS) =>
    planKeys({ state, prefs, isBusy: false }).filter((key) => key.command.kind !== "switch");
  const keyOf = (state: StateResponse, address: string, prefs: Prefs = PREFS) =>
    planKeys({ state, prefs, isBusy: false }).find((key) => key.key === address);
  /** A stand-in for Math.random: always the first choice left. */
  const first = () => 0;

  test("the switcher: 1 to 9 pick a game of the page shown, 0 turns to the next page's first game", () => {
    const switches = (prefs: Prefs, state = fixtures.BASE) =>
      planKeys({ state, prefs, isBusy: false }).filter((key) => key.command.kind === "switch");

    expect(switches({ ...PREFS, game: "keno" }).map((key) => key.label)).toEqual([
      "Blackjack",
      "Roulette",
      "Baccarat",
      "Slots",
      "Mines",
      "Dice",
      "Limbo",
      "Flip",
      "Keno",
      "more 1/2",
    ]);
    expect(keyOf(fixtures.BASE, "game-page")?.command).toEqual({ kind: "switch", game: "wheel" });

    const second = switches({ ...PREFS, game: "hilo" });

    expect(second.map((key) => `${key.hotkey}:${key.label}`)).toEqual(["1:Wheel", "2:Hilo", "3:Tower", "0:more 2/2"]);
    expect(second.find((key) => key.isSelected)?.key).toBe("game-hilo");
    expect(second.find((key) => key.hotkey === "0")?.command).toEqual({ kind: "switch", game: "blackjack" });
    // A round in play shows its own game's page, whatever game the prefs hold.
    expect(switches(PREFS, fixtures.TOWER_TURN).map((key) => key.label)).toContain("Tower");
  });

  test("n starts each game with the choices made", () => {
    const bet = "500000";

    expect(startAction("dice", bet, PREFS)).toEqual({ type: "dice_roll", amount: bet, target: 4900, over: false });
    expect(startAction("dice", bet, { ...PREFS, diceChance: 2500, diceOver: true })).toEqual({
      type: "dice_roll",
      amount: bet,
      target: 7500,
      over: true,
    });
    expect(startAction("limbo", bet, { ...PREFS, limboTarget: 1000 })).toEqual({
      type: "limbo_play",
      amount: bet,
      target: 1000,
    });
    expect(startAction("flip", bet, { ...PREFS, flipSide: "tails", flips: 4 })).toEqual({
      type: "flip_play",
      amount: bet,
      side: "tails",
      flips: 4,
    });
    expect(startAction("keno", bet, PREFS)).toEqual({ type: "keno_play", amount: bet, picks: [4, 12, 19, 27, 35] });
    expect(startAction("wheel", bet, { ...PREFS, wheelSegments: 30, wheelRisk: "high" })).toEqual({
      type: "wheel_spin",
      amount: bet,
      segments: 30,
      risk: "high",
    });
    expect(startAction("hilo", bet, PREFS)).toEqual({ type: "hilo_bet", amount: bet });
    expect(startAction("tower", bet, { ...PREFS, towerDifficulty: "master" })).toEqual({
      type: "tower_bet",
      amount: bet,
      difficulty: "master",
    });

    // Roulette spins the chips on the table: one on red here.
    const withChip = { ...PREFS, rouletteChips: [{ bet: { kind: "red" } as const, amount: bet }] };

    for (const game of GAMES) {
      expect(isPlayAction(startAction(game, bet, withChip)), game).toBe(true);
    }
  });

  test("the start key names the choices", () => {
    const label = (prefs: Partial<Prefs>) => keyOf(fixtures.BASE, "start", { ...PREFS, ...prefs })?.label;

    expect(label({ game: "dice" })).toBe("roll · 0.50 · under 49.00");
    expect(label({ game: "dice", diceOver: true, diceChance: 2500 })).toBe("roll · 0.50 · over 75.00");
    expect(label({ game: "limbo" })).toBe("play · 0.50 · ×2.00");
    expect(label({ game: "flip", flips: 3 })).toBe("flip · 0.50 · 3 × heads");
    expect(label({ game: "keno" })).toBe("play · 0.50 · 5 picks");
    expect(label({ game: "wheel" })).toBe("spin · 0.50 · 10 segments · low");
    expect(label({ game: "hilo" })).toBe("play · 0.50");
    expect(label({ game: "tower" })).toBe("play · 0.50 · easy");
  });

  test("j and k step each choice through its presets, held at both ends", () => {
    const step = (prefs: Partial<Prefs>, setting: Parameters<typeof stepSetting>[1], by: -1 | 1) =>
      stepSetting({ ...PREFS, ...prefs }, setting, by, first);

    expect(step({}, "dice", 1).diceChance).toBe(6600);
    expect(step({}, "dice", -1).diceChance).toBe(2500);
    expect(step({ diceChance: 9800 }, "dice", 1).diceChance).toBe(9800);
    expect(step({ diceChance: 100 }, "dice", -1).diceChance).toBe(100);
    expect(step({}, "limbo", 1).limboTarget).toBe(300);
    expect(step({ limboTarget: 150 }, "limbo", -1).limboTarget).toBe(150);
    expect(step({ limboTarget: 100_000 }, "limbo", 1).limboTarget).toBe(100_000);
    expect(step({}, "flips", 1).flips).toBe(2);
    expect(step({}, "flips", -1).flips).toBe(1);
    expect(step({ flips: 10 }, "flips", 1).flips).toBe(10);
    expect(step({}, "wheel", 1).wheelSegments).toBe(20);
    expect(step({ wheelSegments: 50 }, "wheel", 1).wheelSegments).toBe(50);
    expect(step({}, "tower", 1).towerDifficulty).toBe("medium");
    expect(step({}, "tower", -1).towerDifficulty).toBe("easy");
    expect(step({ towerDifficulty: "master" }, "tower", 1).towerDifficulty).toBe("master");
    // Keno: one pick more is a free number, one fewer drops the highest; 1 to 10 picks.
    expect(step({}, "keno", 1).kenoPicks).toEqual([1, 4, 12, 19, 27, 35]);
    expect(step({}, "keno", -1).kenoPicks).toEqual([4, 12, 19, 27]);
    expect(step({ kenoPicks: [7] }, "keno", -1).kenoPicks).toEqual([7]);
    expect(step({ kenoPicks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, "keno", 1).kenoPicks).toHaveLength(10);
  });

  test("a new session takes the last one-draw round's choices; other games keep the prefs", () => {
    const round = (detail: RoundView["detail"]): RoundView => ({
      phase: "idle",
      stake: "500000",
      payout: "0",
      fee: "0",
      net: "-500000",
      number: 1,
      settledSignature: null,
      detail,
    });

    expect(
      choicesOf(PREFS, round({ game: "dice", target: 7500, over: true, roll: 1200, multiplier: "3.9200" })),
    ).toEqual({ ...PREFS, diceOver: true, diceChance: 2500 });
    expect(choicesOf(PREFS, round({ game: "limbo", target: "10.00", result: "1.53" }))).toEqual({
      ...PREFS,
      limboTarget: 1000,
    });
    expect(
      choicesOf(PREFS, round({ game: "flip", side: "tails", flips: 3, results: null, multiplier: "7.8400" })),
    ).toEqual({ ...PREFS, flipSide: "tails", flips: 3 });
    expect(choicesOf(PREFS, round({ game: "keno", picks: [9, 2], drawn: null, hits: null, paytable: [] }))).toEqual({
      ...PREFS,
      kenoPicks: [2, 9],
    });
    expect(
      choicesOf(PREFS, round({ game: "wheel", segments: 30, risk: "high", multipliers: [], segment: null })),
    ).toEqual({ ...PREFS, wheelSegments: 30, wheelRisk: "high" });
    expect(choicesOf(PREFS, round({ game: "slots", reels: null }))).toBe(PREFS);
  });

  test("keno picks: a click toggles a number within 1 to 10 picks, r draws as many new distinct ones", () => {
    expect(toggleKenoPick([4, 12], 7)).toEqual([4, 7, 12]);
    expect(toggleKenoPick([4, 12], 12)).toEqual([4]);
    expect(toggleKenoPick([4], 4)).toEqual([4]);
    expect(toggleKenoPick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 40)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(randomPicks(5, first)).toEqual([1, 2, 3, 4, 5]);

    let seed = 7;
    const scrambled = (bound: number) => {
      seed = (seed * 31 + 17) % 1_009;

      return seed % bound;
    };

    for (let round = 0; round < 50; round++) {
      const picks = randomPicks(10, scrambled);

      expect(new Set(picks).size).toBe(10);
      expect(picks.every((pick) => pick >= 1 && pick <= 40)).toBe(true);
      expect([...picks].sort((a, b) => a - b)).toEqual(picks);
    }
  });

  test("the keno numbers are click-only keys of the fullscreen table, never a letter's", () => {
    const prefs = { ...PREFS, game: "keno" as const };
    const input = { state: fixtures.BASE, prefs, isBusy: false };
    const clicks = tableKeys(input).filter((key) => key.key.startsWith("keno-pick-"));

    expect(clicks).toHaveLength(40);
    expect(clicks.every((key) => key.hotkey === "")).toBe(true);
    expect(clicks.find((key) => key.key === "keno-pick-12")).toMatchObject({
      isSelected: true,
      command: { kind: "keno-pick", number: 12 },
    });
    expect(planKeys(input).some((key) => key.key.startsWith("keno-pick-"))).toBe(false);
    // Not while the round draws, nor at another game.
    expect(tableKeys({ ...input, state: fixtures.KENO_DRAWING }).some((key) => key.hotkey === "")).toBe(false);
    expect(tableKeys({ ...input, prefs: PREFS }).some((key) => key.hotkey === "")).toBe(false);

    for (const key of ["", " ", "a", "1"]) {
      expect(pressFor({ key }, tableKeys(input))?.startsWith("keno-pick-") ?? false, key).toBe(false);
    }
  });

  test("the one-draw games' choice keys", () => {
    expect(keyOf(fixtures.BASE, "dice-over", { ...PREFS, game: "dice" })).toMatchObject({
      hotkey: "o",
      label: "roll under",
      command: { kind: "dice-over" },
    });
    expect(keyOf(fixtures.BASE, "flip-tails", { ...PREFS, game: "flip" })).toMatchObject({
      hotkey: "t",
      isSelected: false,
      command: { kind: "flip-side", side: "tails" },
    });
    expect(keyOf(fixtures.BASE, "wheel-risk", { ...PREFS, game: "wheel" })).toMatchObject({
      hotkey: "r",
      label: "low risk",
    });
    expect(keyOf(fixtures.BASE, "keno-random", { ...PREFS, game: "keno" })?.command).toEqual({ kind: "keno-random" });
    // A settled round offers the next one at once.
    for (const state of [fixtures.DICE, fixtures.LIMBO, fixtures.FLIP, fixtures.KENO, fixtures.WHEEL]) {
      const game = state.round?.detail.game ?? "blackjack";

      expect(keyOf(state, "start", { ...PREFS, game })?.hotkey, game).toBe("n");
    }
  });

  test("hilo in turn: h higher and l lower, named as the table names them, at what a right guess pays, s skip, z cash out", () => {
    expect(
      plays(fixtures.HILO_TURN)
        .map((key) => `${key.hotkey} ${key.label}`)
        .join(" | "),
    ).toBe("h higher or same ×2.2151 | l lower or same ×3.9871 | s skip · 10 left | z cash out · 1.53");
    expect(keyOf(fixtures.HILO_TURN, "hilo-higher")?.command).toEqual({
      kind: "play",
      action: { type: "hilo_guess", guess: "higher" },
    });
    expect(keyOf(fixtures.HILO_TURN, "hilo-cashout")?.command).toEqual({
      kind: "play",
      action: { type: "hilo_cashout" },
    });
    // An ace: higher is strict, so offered at ×13/12; no skip left; no right guess to cash out yet.
    expect(plays(fixtures.HILO_ACE).map((key) => `${key.hotkey} ${key.label}`)).toEqual([
      "h higher ×1.0616",
      "l lower or same ×12.7400",
    ]);
    // A king: lower is strict.
    expect(plays(fixtures.HILO_KING).map((key) => `${key.hotkey} ${key.label}`)).toEqual([
      "h higher or same ×12.7400",
      "l lower ×1.0616",
    ]);
    // A card being drawn holds the guesses.
    const drawing = { state: fixtures.HILO_DRAWING, prefs: PREFS, isBusy: false };

    expect(plays(fixtures.HILO_DRAWING)).toEqual([]);
    expect(heldKeys(drawing).map((key) => key.hotkey)).toEqual(["s"]);
    // A round's first card being drawn: no guess, not even a skip, before it shows.
    expect(heldKeys({ state: fixtures.HILO_FIRST_DRAWING, prefs: PREFS, isBusy: false })).toEqual([]);
  });

  test("the key row is the same keys in the same order in every phase, its words never a round's own", () => {
    const row = (state: StateResponse) => keyRow("blackjack", state, PREFS).map((key) => `${key.hotkey} ${key.label}`);

    expect(row(fixtures.BLACKJACK_TURN)).toEqual(row(fixtures.BASE));
    expect(row(fixtures.BASE)).toEqual([
      "h hit",
      "s stand",
      "d double",
      "p split",
      "j hands −",
      "k hands +",
      "v bet −",
      "b bet +",
      "n deal · 0.50",
    ]);
    expect(keyRow("hilo", fixtures.HILO_TURN, PREFS).map((key) => key.label)).toContain("cash out");
  });

  test("tower in turn: a to d climb onto a tile of the next level, z cashes out", () => {
    expect(
      plays(fixtures.TOWER_TURN)
        .map((key) => key.hotkey)
        .join(""),
    ).toBe("abcdz");
    expect(keyOf(fixtures.TOWER_TURN, "tower-tile-3")?.command).toEqual({
      kind: "play",
      action: { type: "tower_climb", tile: 3 },
    });
    expect(keyOf(fixtures.TOWER_TURN, "tower-cashout")?.label).toBe("cash out · 1.74");
    // c being drawn: the other tiles and the cash-out are held, inert.
    expect(
      heldKeys({ state: fixtures.TOWER_DRAWING, prefs: PREFS, isBusy: false })
        .map((key) => key.hotkey)
        .join(""),
    ).toBe("abdz");
    // Settled: the next tower, at the difficulty chosen.
    expect(keyOf(fixtures.TOWER_BUSTED, "start", { ...PREFS, game: "tower" })?.label).toBe("play · 0.50 · easy");
  });

  test("at the table the arrows step each game's own choice", () => {
    const keysOf = (game: Prefs["game"]) =>
      planKeys({ state: fixtures.BASE, prefs: { ...PREFS, game }, isBusy: false });

    expect(pressFor({ key: "up" }, keysOf("dice"))).toBe("dice-up");
    expect(pressFor({ key: "down" }, keysOf("limbo"))).toBe("limbo-down");
    expect(pressFor({ key: "up" }, keysOf("flip"))).toBe("flips-up");
    expect(pressFor({ key: "up" }, keysOf("keno"))).toBe("keno-up");
    expect(pressFor({ key: "up" }, keysOf("wheel"))).toBe("wheel-up");
    expect(pressFor({ key: "down" }, keysOf("tower"))).toBe("tower-down");
    expect(pressFor({ key: "up" }, keysOf("hilo"))).toBeNull();
    expect(pressFor({ key: "h" }, planKeys({ state: fixtures.HILO_TURN, prefs: PREFS, isBusy: false }))).toBe(
      "hilo-higher",
    );
    expect(
      pressFor({ key: "space" }, planKeys({ state: fixtures.TOWER_TURN, prefs: PREFS, isBusy: false })),
    ).toBeNull();
  });
});

describe("the new games' guards", () => {
  const withDetail = (base: StateResponse, fields: Record<string, unknown>) => ({
    ...base,
    round: { ...base.round, detail: { ...base.round?.detail, ...fields } },
  });
  const refused = (base: StateResponse, cases: Record<string, unknown>[]) => {
    for (const fields of cases) {
      expect(isStateResponse(withDetail(base, fields)), JSON.stringify(fields)).toBe(false);
    }
  };

  test("an api without the new games' RTP is refused", () => {
    const { rtp } = fixtures.BASE;

    expect(isStateResponse({ ...fixtures.BASE, rtp: { ...rtp, tower: undefined } })).toBe(false);
  });

  test("dice, limbo and flip views of the wrong shape are refused", () => {
    refused(fixtures.DICE, [
      { target: 99 },
      { target: 9_801 },
      { over: true, target: 100 },
      { over: "yes" },
      { roll: 10_000 },
      { roll: -1 },
      { roll: 37.42 },
      { multiplier: "2.00" },
    ]);
    expect(isStateResponse(withDetail(fixtures.DICE, { over: true, target: 9_900 }))).toBe(true);
    refused(fixtures.LIMBO, [{ target: "2" }, { target: 2 }, { result: "1.5" }, { result: undefined }]);
    refused(fixtures.FLIP, [
      { side: "edge" },
      { flips: 0 },
      { flips: 11 },
      { results: ["heads"] },
      { results: ["heads", "heads", "edge"] },
      { multiplier: 7.84 },
    ]);
  });

  test("keno and wheel views of the wrong shape are refused", () => {
    refused(fixtures.KENO, [
      { picks: [] },
      { picks: [4, 4, 12, 19, 27] },
      { picks: [0, 12, 19, 27, 35] },
      { picks: [41, 12, 19, 27, 35] },
      { picks: Array.from({ length: 11 }, (_, index) => index + 1) },
      { drawn: [1, 4, 8, 12, 15, 22, 27, 30, 33] },
      { drawn: [1, 1, 8, 12, 15, 22, 27, 30, 33, 40] },
      // Three of the picks are drawn: any other count is not this board.
      { hits: 2 },
      { hits: null },
      { drawn: null },
      { paytable: ["0.00", "0.00", "1.50"] },
      { paytable: [0, 0, 1.5, 4, 12, 50] },
    ]);
    refused(fixtures.WHEEL, [
      { segments: 15 },
      { risk: "extreme" },
      { multipliers: ["1.50"] },
      { segment: 10 },
      { segment: -1 },
    ]);
  });

  test("hilo and tower boards of the wrong shape are refused", () => {
    refused(fixtures.HILO_TURN, [
      { cards: [{ rank: 14, suit: "♠" }], guesses: [] },
      { guesses: ["lower"] },
      { guesses: ["lower", "sideways"] },
      { pending: "maybe" },
      { cards: [], guesses: [], pending: "higher" },
      { skipsLeft: 11 },
      { skipsLeft: -1 },
      { higherMultiplier: "2.21" },
      { canGuess: "yes" },
      { busted: undefined },
    ]);
    refused(fixtures.TOWER_TURN, [
      { difficulty: "insane" },
      { tiles: 3 },
      { levels: 8 },
      { climbed: [4] },
      { climbed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { pending: 4 },
      { pending: 1, busted: 2 },
      { multiplier: "1.74" },
      { canClimb: undefined },
    ]);
    expect(isStateResponse(withDetail(fixtures.HILO_TURN, { cards: [], guesses: [] }))).toBe(true);
  });

  test("the new play actions", () => {
    const valid: unknown[] = [
      { type: "dice_roll", amount: "500000", target: 100, over: false },
      { type: "dice_roll", amount: "500000", target: 9_800, over: false },
      { type: "dice_roll", amount: "500000", target: 200, over: true },
      { type: "dice_roll", amount: "500000", target: 9_900, over: true },
      { type: "limbo_play", amount: "500000", target: 101 },
      { type: "limbo_play", amount: "500000", target: 1_000_000 },
      { type: "flip_play", amount: "500000", side: "tails", flips: 10 },
      { type: "keno_play", amount: "500000", picks: [40] },
      { type: "keno_play", amount: "500000", picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      { type: "wheel_spin", amount: "500000", segments: 50, risk: "high" },
      { type: "hilo_bet", amount: "500000" },
      { type: "hilo_guess", guess: "skip" },
      { type: "hilo_cashout" },
      { type: "tower_bet", amount: "500000", difficulty: "expert" },
      { type: "tower_climb", tile: 3 },
      { type: "tower_cashout" },
    ];
    const invalid: unknown[] = [
      { type: "dice_roll", amount: "500000", target: 99, over: false },
      { type: "dice_roll", amount: "500000", target: 9_801, over: false },
      { type: "dice_roll", amount: "500000", target: 100, over: true },
      { type: "dice_roll", amount: "500000", target: 4_900 },
      { type: "dice_roll", amount: "0", target: 4_900, over: false },
      { type: "limbo_play", amount: "500000", target: 100 },
      { type: "limbo_play", amount: "500000", target: 1_000_001 },
      { type: "limbo_play", amount: "500000", target: 2.5 },
      { type: "flip_play", amount: "500000", side: "edge", flips: 1 },
      { type: "flip_play", amount: "500000", side: "heads", flips: 0 },
      { type: "flip_play", amount: "500000", side: "heads", flips: 11 },
      { type: "keno_play", amount: "500000", picks: [] },
      { type: "keno_play", amount: "500000", picks: [3, 3] },
      { type: "keno_play", amount: "500000", picks: [0] },
      { type: "keno_play", amount: "500000", picks: [41] },
      { type: "keno_play", amount: "500000", picks: Array.from({ length: 11 }, (_, index) => index + 1) },
      { type: "wheel_spin", amount: "500000", segments: 60, risk: "low" },
      { type: "wheel_spin", amount: "500000", segments: 10, risk: "wild" },
      { type: "hilo_bet", amount: "0" },
      { type: "hilo_guess", guess: "same" },
      { type: "hilo_guess" },
      { type: "tower_bet", amount: "500000", difficulty: "insane" },
      { type: "tower_climb", tile: 4 },
      { type: "tower_climb", tile: -1 },
    ];

    for (const action of valid) {
      expect(isPlayAction(action), JSON.stringify(action)).toBe(true);
    }

    for (const action of invalid) {
      expect(isPlayAction(action), JSON.stringify(action)).toBe(false);
    }
  });
});
