import { describe, expect, it } from "vitest";

import { DEAL_STEP_MS } from "../../../apps/mod/hooks/cards";
import { DICE_ROLL_MS } from "../../../apps/mod/hooks/quick";
import { ROULETTE_SPIN_MS } from "../../../apps/mod/hooks/games";
import { RESULT_MS, SURFACE_LAG_MS } from "../../../apps/mod/hooks/view";
import { MotionTracker } from "../src/motion";
import type { Card } from "../../../apps/mod/hooks/protocol";
import type { Game, RoundView, StateResponse } from "../src/types";

type BlackjackHand = Extract<RoundView["detail"], { game: "blackjack" }>["hands"][number];

const GAMES: Game[] = [
  "blackjack",
  "roulette",
  "baccarat",
  "slots",
  "mines",
  "dice",
  "limbo",
  "flip",
  "keno",
  "wheel",
  "hilo",
  "tower",
];

function state(balance: string, round: RoundView | null): StateResponse {
  return {
    accountOpen: true,
    balance,
    round,
    pendingIntentId: null,
    limits: { minBet: "500000", maxBet: "25000000" },
    rtp: Object.fromEntries(GAMES.map((game) => [game, "99.00"])) as Record<Game, string>,
    sponsor: null,
    leaderboard: [],
    rank: null,
    blocked: null,
  };
}

function roulette(number: number, net: string): RoundView {
  const bet = { kind: "red" } as const;

  return {
    phase: "idle",
    stake: "1000000",
    payout: "0",
    fee: "0",
    net,
    number,
    settledSignature: "sig",
    detail: { game: "roulette", bet, chips: [{ bet, amount: "1000000" }], number: 17 },
  };
}

function dice(number: number, phase: "drawing" | "idle", net: string): RoundView {
  return {
    phase,
    stake: "1000000",
    payout: "0",
    fee: "0",
    net,
    number,
    settledSignature: phase === "idle" ? "sig" : null,
    detail: { game: "dice", target: 4900, over: false, roll: phase === "idle" ? 7000 : null, multiplier: "1.9600" },
  };
}

const card = (rank: number): Card => ({ rank, suit: "♠" });

function hand(cards: Card[]): BlackjackHand {
  return { cards, total: 0, soft: false, doubled: false, split: false, stake: "1000000", result: null };
}

function blackjack(number: number, player: Card[], dealer: Card[]): RoundView {
  return {
    phase: "player_turn",
    stake: "1000000",
    payout: "0",
    fee: "0",
    net: "0",
    number,
    settledSignature: null,
    detail: {
      game: "blackjack",
      hands: [hand(player)],
      activeHand: 0,
      dealer,
      dealerTotal: 0,
      canHit: true,
      canDouble: false,
      canSplit: false,
    },
  };
}

describe("MotionTracker", () => {
  it("spins a new roulette round, holds the balance, then plays its result", () => {
    const tracker = new MotionTracker();
    const before = state("10000000", null);
    const after = state("9000000", roulette(5, "-1000000"));
    const start = 1_000;

    tracker.observe(null, before, 0, "normal");
    tracker.observe(before, after, start, "normal");

    expect(tracker.view(after, start, "normal")).toEqual({
      spinElapsed: 0,
      revealed: null,
      heldBalance: "10000000",
      resultElapsed: null,
    });
    expect(tracker.isMoving(after, start, "normal")).toBe(true);

    // Landed, but the result waits SURFACE_LAG_MS more: the balance stays held.
    const landed = start + ROULETTE_SPIN_MS;
    expect(tracker.view(after, landed, "normal")).toMatchObject({ spinElapsed: null, heldBalance: "10000000" });
    expect(tracker.isMoving(after, landed, "normal")).toBe(true);

    const shows = landed + SURFACE_LAG_MS;
    expect(tracker.view(after, shows, "normal")).toMatchObject({ heldBalance: null, resultElapsed: 0 });

    // A loss has no celebration: it rests once the result's effects ran.
    expect(tracker.isMoving(after, shows + RESULT_MS, "normal")).toBe(false);
    expect(tracker.tally).toEqual({ net: "-1000000", rounds: 1, startedAt: start, lastRound: 5 });
  });

  it("turns new blackjack cards over one step at a time, a drawn card a step late", () => {
    const tracker = new MotionTracker();
    const before = state("10000000", null);
    const dealt = state("9000000", blackjack(6, [card(10), card(5)], [card(9)]));

    tracker.observe(null, before, 0, "normal");
    tracker.observe(before, dealt, 0, "normal");

    // The first card shows at once; one more every step; the deal ends a lag after the last.
    expect(tracker.view(dealt, 0, "normal")).toMatchObject({ revealed: 1, heldBalance: "10000000" });
    expect(tracker.view(dealt, DEAL_STEP_MS, "normal").revealed).toBe(2);
    expect(tracker.view(dealt, 2 * DEAL_STEP_MS, "normal").revealed).toBe(3);
    expect(tracker.view(dealt, 2 * DEAL_STEP_MS + SURFACE_LAG_MS, "normal").revealed).toBeNull();
    expect(tracker.isMoving(dealt, 2 * DEAL_STEP_MS + SURFACE_LAG_MS, "normal")).toBe(false);

    const hit = state("9000000", blackjack(6, [card(10), card(5), card(3)], [card(9)]));
    const at = 10_000;

    tracker.observe(dealt, hit, at, "normal");

    expect(tracker.view(hit, at, "normal").revealed).toBe(3);
    expect(tracker.view(hit, at + DEAL_STEP_MS, "normal").revealed).toBe(4);
    expect(tracker.view(hit, at + DEAL_STEP_MS + SURFACE_LAG_MS, "normal").revealed).toBeNull();
    // A round in play is not counted.
    expect(tracker.tally.rounds).toBe(0);
  });

  it("keeps a drawing round spinning and restarts the spin on its landing", () => {
    const tracker = new MotionTracker();
    const before = state("10000000", null);
    const drawing = state("9000000", dice(7, "drawing", "0"));
    const landed = state("10960000", dice(7, "idle", "960000"));

    tracker.observe(null, before, 0, "normal");
    tracker.observe(before, drawing, 0, "normal");

    // Still drawing long after a full roll: the dice keep rolling.
    expect(tracker.view(drawing, 5 * DICE_ROLL_MS, "normal")).toMatchObject({
      spinElapsed: 5 * DICE_ROLL_MS,
      heldBalance: "10000000",
    });

    const at = 6 * DICE_ROLL_MS;
    tracker.observe(drawing, landed, at, "normal");

    expect(tracker.view(landed, at, "normal")).toMatchObject({ spinElapsed: 0, heldBalance: "10000000" });
    expect(tracker.view(landed, at + DICE_ROLL_MS + SURFACE_LAG_MS, "normal")).toMatchObject({
      heldBalance: null,
      resultElapsed: 0,
    });
    // A win celebrates past the result's own effects.
    expect(tracker.isMoving(landed, at + DICE_ROLL_MS + SURFACE_LAG_MS + RESULT_MS, "normal")).toBe(true);
    expect(tracker.tally).toMatchObject({ net: "960000", rounds: 1 });
  });

  it("plays nothing for the table found at the first look, and never counts it", () => {
    const tracker = new MotionTracker();
    const first = state("9000000", roulette(5, "-1000000"));

    tracker.observe(null, first, 0, "normal");
    tracker.observe(first, first, 100, "normal");

    expect(tracker.isMoving(first, 0, "normal")).toBe(false);
    expect(tracker.tally).toEqual({ net: "0", rounds: 0, startedAt: null, lastRound: 5 });
  });

  it("forgets everything on reset", () => {
    const tracker = new MotionTracker();
    const before = state("10000000", null);
    const after = state("9000000", roulette(5, "-1000000"));

    tracker.observe(null, before, 0, "normal");
    tracker.observe(before, after, 0, "normal");
    tracker.reset();

    expect(tracker.isMoving(after, 0, "normal")).toBe(false);
    expect(tracker.tally.rounds).toBe(0);
  });
});
