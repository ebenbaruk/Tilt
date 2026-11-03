import { describe, expect, it } from "vitest";

import { renderBaccarat, renderBlackjack, renderHilo } from "../src/render/cards";
import { renderPanel, renderStatusLine } from "../src/render/panel";
import { visibleWidth } from "../src/render/style";
import type { Game, Prefs, RenderContext, RoundView, Snapshot, StateResponse } from "../src/types";

const WIDTH = 60;
const NARROW = 40;

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

function state(round: RoundView | null): StateResponse {
  return {
    accountOpen: true,
    balance: "12400000",
    round,
    pendingIntentId: null,
    limits: { minBet: "500000", maxBet: "25000000" },
    rtp: Object.fromEntries(GAMES.map((game) => [game, "99.00"])) as Record<Game, string>,
    sponsor: { name: "Acme", tagline: null, pool: "500000000", endsAt: "2026-11-01T00:00:00Z" },
    leaderboard: [],
    rank: 3,
    blocked: null,
  };
}

function snapshot(overrides: Partial<Snapshot>): Snapshot {
  return {
    auth: { status: "in" },
    state: null,
    error: null,
    prefs: PREFS,
    isBusy: false,
    message: null,
    agent: { isWorking: true, notice: null },
    keys: [],
    depositUrl: null,
    now: 0,
    ...overrides,
  };
}

const BLACKJACK_ROUND: RoundView = {
  phase: "player_turn",
  stake: "2000000",
  payout: "0",
  fee: "0",
  net: "0",
  number: 7,
  settledSignature: null,
  detail: {
    game: "blackjack",
    hands: [
      {
        cards: [
          { rank: 1, suit: "♠" },
          { rank: 6, suit: "♥" },
        ],
        total: 17,
        soft: true,
        doubled: false,
        split: false,
        stake: "1000000",
        result: null,
      },
      {
        cards: [
          { rank: 10, suit: "♦" },
          { rank: 9, suit: "♣" },
        ],
        total: 19,
        soft: false,
        doubled: true,
        split: false,
        stake: "1000000",
        result: null,
      },
    ],
    activeHand: 0,
    dealer: [{ rank: 9, suit: "♣" }],
    dealerTotal: 9,
    canHit: true,
    canDouble: true,
    canSplit: false,
  },
};

const BACCARAT_WIN: RoundView = {
  phase: "idle",
  stake: "1000000",
  payout: "1950000",
  fee: "9500",
  net: "940500",
  number: 8,
  settledSignature: "sig",
  detail: {
    game: "baccarat",
    bet: "banker",
    player: [
      { rank: 2, suit: "♠" },
      { rank: 3, suit: "♥" },
    ],
    banker: [
      { rank: 13, suit: "♦" },
      { rank: 8, suit: "♣" },
    ],
    playerPoints: 5,
    bankerPoints: 8,
  },
};

const HILO_ROUND: RoundView = {
  phase: "player_turn",
  stake: "1000000",
  payout: "0",
  fee: "0",
  net: "0",
  number: 9,
  settledSignature: null,
  detail: {
    game: "hilo",
    cards: [
      { rank: 13, suit: "♠" },
      { rank: 9, suit: "♥" },
    ],
    guesses: ["lower"],
    pending: null,
    multiplier: "1.3000",
    higherMultiplier: "2.1000",
    lowerMultiplier: "1.5000",
    skipsLeft: 9,
    canGuess: true,
    canCashOut: true,
    busted: false,
  },
};

function expectFitted(lines: string[], width: number): void {
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}

const text = (lines: string[]): string => lines.join("\n");

describe("renderPanel", () => {
  it("invites a logged-out player to log in, with the last message", () => {
    const lines = renderPanel(snapshot({ auth: { status: "out", message: "Login expired." } }), {
      color: false,
      width: WIDTH,
    });

    expect(text(lines)).toContain("TILT");
    expect(text(lines)).toContain("/tilt login");
    expect(text(lines)).toContain("Login expired.");
    expect(lines.every((line) => visibleWidth(line) === WIDTH)).toBe(true);
  });

  it("shows the user code and the verify URL while the login is pending, wrapping a long URL", () => {
    const verifyUrl = `https://tilt.example/login?code=${"x".repeat(60)}`;
    const lines = renderPanel(snapshot({ auth: { status: "pending", userCode: "ABCD-EFGH", verifyUrl } }), {
      color: false,
      width: NARROW,
    });

    expect(text(lines)).toContain("ABCD-EFGH");
    expect(lines.map((line) => line.trimEnd()).join("")).toContain(verifyUrl);
    expectFitted(lines, NARROW);
  });

  it("says connecting before the first state", () => {
    expect(text(renderPanel(snapshot({}), { color: false, width: WIDTH }))).toContain("connecting…");
  });

  it("draws a blackjack round in progress with tabs, balance, the active hand and the keys", () => {
    const lines = renderPanel(
      snapshot({
        state: state(BLACKJACK_ROUND),
        keys: [
          {
            key: "game-blackjack",
            hotkey: "1",
            label: "Blackjack",
            isSelected: true,
            command: { kind: "switch", game: "blackjack" },
          },
          {
            key: "hit",
            hotkey: "h",
            label: "hit",
            isSelected: false,
            command: { kind: "play", action: { type: "blackjack_hit" } },
          },
          {
            key: "stand",
            hotkey: "s",
            label: "stand",
            isSelected: false,
            command: { kind: "play", action: { type: "blackjack_stand" } },
          },
        ],
      }),
      { color: false, width: WIDTH },
    );
    const all = text(lines);

    expect(all).toContain("[1] Blackjack");
    expect(all).toContain("balance 12.40");
    expect(all).toContain("#3");
    expect(all).toContain("agent working");
    expect(all).toContain("DEALER 9 + ?");
    expect(all).toContain("▶ #1 soft 17");
    expect(all).toContain("A♠ 6♥");
    expect(all).toContain("doubled");
    expect(all).toContain("h hit");
    expect(all).toContain("s stand");
    expect(all).toContain("presented by Acme · pool 500.00");
    // The switch keys are the header's tabs, not drawn twice.
    expect(all.split("Blackjack").length - 1).toBe(1);
    expectFitted(lines, WIDTH);
  });

  it("draws a settled baccarat win in green when colored, and fits a narrow width", () => {
    const snap = snapshot({ state: state(BACCARAT_WIN), prefs: { ...PREFS, game: "baccarat" } });
    const plain = text(renderPanel(snap, { color: false, width: NARROW }));

    expect(plain).toContain("WIN +0.94");
    expect(plain).toContain("BANKER 8");
    expect(plain).toContain("WINS");
    expect(plain).toContain("K♦ 8♣");
    expectFitted(renderPanel(snap, { color: false, width: NARROW }), NARROW);

    const colored = renderPanel(snap, { color: true, width: NARROW });
    expect(text(colored)).toContain("\x1b[");
    expectFitted(colored, NARROW);
  });

  it("shows a blocked reason and the deposit hint for an unopened account", () => {
    const blocked = text(
      renderPanel(snapshot({ state: { ...state(null), blocked: "Self-excluded until May." } }), {
        color: false,
        width: WIDTH,
      }),
    );
    expect(blocked).toContain("Self-excluded until May.");

    const unopened = renderPanel(
      snapshot({ state: { ...state(null), accountOpen: false }, depositUrl: "https://tilt.example/deposit" }),
      { color: false, width: WIDTH },
    );
    expect(text(unopened)).toContain("first deposit");
    expect(text(unopened)).toContain("https://tilt.example/deposit");
  });
});

describe("renderStatusLine", () => {
  it("asks to log in when logged out", () => {
    expect(
      renderStatusLine(snapshot({ auth: { status: "out", message: null } }), { color: false, width: WIDTH }),
    ).toContain("TILT · /tilt login");
  });

  it("sums up balance, game, last result and the agent in one line", () => {
    const line = renderStatusLine(
      snapshot({
        state: state(BACCARAT_WIN),
        prefs: { ...PREFS, game: "baccarat" },
        agent: { isWorking: false, notice: null },
      }),
      {
        color: false,
        width: WIDTH,
      },
    );

    expect(line.trimEnd()).toBe("TILT 12.40 · Baccarat · +0.94 · agent idle");
    expect(visibleWidth(renderStatusLine(snapshot({ state: state(BACCARAT_WIN) }), { color: true, width: 20 }))).toBe(
      20,
    );
  });
});

describe("card renderers", () => {
  const ctx = (width: number): RenderContext => ({ color: false, width, prefs: { ...PREFS, hands: 3 }, now: 0 });

  it("draw the empty tables from the prefs", () => {
    expect(text(renderBlackjack(null, ctx(WIDTH)))).toContain("3 hands");
    expect(text(renderBaccarat(null, ctx(WIDTH)))).toContain("bet banker · pays ×1.95");
    expect(text(renderHilo(null, ctx(WIDTH)))).toContain("higher or lower");
  });

  it("draw a Hilo turn with the trail, the offers and the cash-out", () => {
    const lines = renderHilo(HILO_ROUND, ctx(NARROW));
    const all = text(lines);

    expect(all).toContain("K♠ ▼ 9♥");
    expect(all).toContain("multiplier ×1.30");
    expect(all).toContain("▲ higher or same 38% ×2.10");
    expect(all).toContain("▼ lower or same 69% ×1.50");
    expect(all).toContain("9 left");
    expect(all).toContain("cash out 1.30");
    expectFitted(lines, NARROW);
  });

  it("keep at most 12 lines with ten blackjack hands", () => {
    const detail = BLACKJACK_ROUND.detail;
    if (detail.game !== "blackjack") throw new Error("fixture");
    const hand = detail.hands[0];
    if (hand === undefined) throw new Error("fixture");
    const round: RoundView = {
      ...BLACKJACK_ROUND,
      phase: "idle",
      net: "-10000000",
      detail: { ...detail, hands: Array.from({ length: 10 }, () => ({ ...hand, result: "lose" as const })) },
    };
    const lines = renderBlackjack(round, ctx(NARROW));

    expect(lines.length).toBeLessThanOrEqual(12);
    expect(text(lines)).toContain("LOSE −10.00");
    expectFitted(lines, NARROW);
  });
});
