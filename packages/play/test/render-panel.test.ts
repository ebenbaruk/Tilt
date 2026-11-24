import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/panel";
import { renderStatusLine } from "../src/status";
import { stringWidth } from "../src/term/width";
import type { Game, Prefs, RoundView, Snapshot, StateResponse } from "../src/types";

const WIDTH = 60;
const ESCAPE = "\x1b[";

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
    fetchedAt: 0,
    prefs: PREFS,
    intent: null,
    isBusy: false,
    message: null,
    agent: { isWorking: true, notice: null },
    tally: { net: "0", rounds: 0, startedAt: null, lastRound: null },
    isMoving: false,
    spinElapsed: null,
    revealed: null,
    heldBalance: null,
    resultElapsed: null,
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
    ],
    activeHand: 0,
    dealer: [{ rank: 9, suit: "♣" }],
    dealerTotal: 9,
    canHit: true,
    canDouble: true,
    canSplit: false,
  },
};

const RED = { kind: "red" } as const;

const ROULETTE_LOSS: RoundView = {
  phase: "idle",
  stake: "1000000",
  payout: "0",
  fee: "0",
  net: "-1000000",
  number: 8,
  settledSignature: "sig",
  detail: { game: "roulette", bet: RED, chips: [{ bet: RED, amount: "1000000" }], number: 17 },
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

const text = (lines: string[]): string => lines.join("\n");

const SGR = /\x1b\[[0-9;]*m/g;

/** Columns a line takes on screen: its color codes take none. */
const columns = (line: string): number => stringWidth(line.replace(SGR, ""));

function expectWidth(lines: string[], width: number): void {
  for (const line of lines) expect(columns(line)).toBe(width);
}

describe("renderPanel", () => {
  it("invites a logged-out player to log in the harness's way, with the last message", () => {
    const lines = renderPanel(snapshot({ auth: { status: "out", message: "Login expired." } }), {
      color: false,
      width: WIDTH,
      loginHint: "ctrl+l",
    });

    expect(text(lines)).toContain("TILT");
    expect(text(lines)).toContain("Run /tilt login to play while your agent works.");
    expect(text(lines)).toContain("Login expired.");
    expect(text(lines)).toContain("Here, log in with ctrl+l.");
    expectWidth(lines, WIDTH);
  });

  it("names no other way to log in where /tilt login is the harness's own", () => {
    const lines = renderPanel(snapshot({ auth: { status: "out", message: null } }), { color: false, width: WIDTH });

    expect(text(lines)).not.toContain("Here, log in");
  });

  it("shows the user code and the whole login page while the login is pending", () => {
    const verifyUrl = "https://tilt.example/connect?code=ABCD-EFGH";
    const lines = renderPanel(snapshot({ auth: { status: "pending", userCode: "ABCD-EFGH", verifyUrl } }), {
      color: false,
      width: WIDTH,
    });

    expect(text(lines)).toContain("Confirm code ABCD-EFGH in your browser");
    expect(lines.some((line) => line.trim() === verifyUrl)).toBe(true);
  });

  it("draws a blackjack round with the header, the agent, large cards and the keys with their letters", () => {
    const lines = renderPanel(snapshot({ state: state(BLACKJACK_ROUND) }), { color: false, width: WIDTH, rows: 40 });
    const all = text(lines);

    expect(all).toContain("1:  Blackjack");
    expect(all).toContain("balance 12.40 USDC");
    expect(all).toContain("rank #3");
    expect(all).toContain("agent is working");
    expect(all).toContain("DEALER 9 + ?");
    expect(all).toContain("▶ YOU soft 17");
    // Large cards: the card's frame and its corner rank.
    expect(all).toContain("│A♠ │6♥   │");
    expect(all).toContain("h: hit");
    expect(all).toContain("s: stand");
    expect(all).toContain("PRESENTED BY Acme");
    expectWidth(lines, WIDTH);
  });

  it("gives way to small cards and puts the keys first in fewer rows", () => {
    const lines = renderPanel(snapshot({ state: state(BLACKJACK_ROUND) }), { color: false, width: WIDTH, rows: 20 });
    const all = text(lines);
    const keysAt = lines.findIndex((line) => line.includes("h: hit"));
    const dealerAt = lines.findIndex((line) => line.includes("DEALER"));

    expect(all).not.toContain("╭───╭");
    expect(all).toContain("A♠   6♥");
    expect(keysAt).toBeGreaterThan(-1);
    expect(keysAt).toBeLessThan(dealerAt);
  });

  it("spins a round the motion says is spinning, its balance held back", () => {
    const lines = renderPanel(
      snapshot({
        state: { ...state(ROULETTE_LOSS), balance: "11400000" },
        prefs: { ...PREFS, game: "roulette" },
        isMoving: true,
        spinElapsed: 300,
        heldBalance: "12400000",
      }),
      { color: false, width: WIDTH },
    );

    expect(text(lines)).toContain("spinning…");
    expect(text(lines)).toContain("balance 12.40");
    expect(text(lines)).not.toContain("loses");
  });

  it("tells the settled result and the balance once nothing moves", () => {
    const lines = renderPanel(
      snapshot({ state: { ...state(ROULETTE_LOSS), balance: "11400000" }, prefs: { ...PREFS, game: "roulette" } }),
      { color: false, width: WIDTH },
    );

    expect(text(lines)).toContain("balance 11.40");
    expect(text(lines)).toContain("17 BLACK");
  });

  it("draws the footer's key hint the harness gives", () => {
    const options = { color: false, width: WIDTH, keysHint: [["ctrl+c", " quits"]] as const };
    const lines = renderPanel(snapshot({ state: state(null) }), options);

    expect(lines.at(-1)).toContain("ctrl+c quits");
    expect(text(lines)).not.toContain("esc hands");
  });

  it("shows a refused move and a blocked account", () => {
    const refused = renderPanel(
      snapshot({ state: state(BLACKJACK_ROUND), message: { text: "Not enough balance.", tone: "loss" } }),
      { color: false, width: WIDTH },
    );
    const blocked = renderPanel(snapshot({ state: { ...state(null), blocked: "Self-excluded until May." } }), {
      color: false,
      width: WIDTH,
    });

    expect(text(refused)).toContain("Not enough balance.");
    expect(text(blocked)).toContain("Self-excluded until May.");
  });

  it("gives the deposit page in full to an account not open yet", () => {
    const lines = renderPanel(
      snapshot({ state: { ...state(null), accountOpen: false }, depositUrl: "https://tilt.example/deposit" }),
      { color: false, width: WIDTH },
    );

    expect(text(lines)).toContain("first deposit");
    expect(lines.some((line) => line.trim() === "https://tilt.example/deposit")).toBe(true);
  });

  it("colors only when asked, every line still the width", () => {
    const snap = snapshot({ state: state(BACCARAT_WIN), prefs: { ...PREFS, game: "baccarat" } });
    const plain = renderPanel(snap, { color: false, width: WIDTH });
    const colored = renderPanel(snap, { color: true, width: WIDTH });

    expect(text(plain)).not.toContain(ESCAPE);
    expect(text(colored)).toContain(ESCAPE);
    expectWidth(colored, WIDTH);
    expect(renderPanel(snap, { color: true, width: WIDTH, light: true })).not.toEqual(colored);
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
      { color: false, width: WIDTH },
    );

    expect(line.trimEnd()).toBe("TILT 12.40 · Baccarat · +0.94 · agent idle");
    expect(columns(line)).toBe(WIDTH);
  });

  it("cuts to the width, colored or not", () => {
    const snap = snapshot({ state: state(BACCARAT_WIN) });

    expect(columns(renderStatusLine(snap, { color: true, width: 20 }))).toBe(20);
    expect(renderStatusLine(snap, { color: false, width: 20 })).not.toContain(ESCAPE);
  });
});
