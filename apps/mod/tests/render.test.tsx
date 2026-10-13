import { describe, expect, mock, test } from "claude-code/testing";

import type { StateResponse } from "../hooks/protocol";
import {
  BACCARAT,
  BASE,
  BLACKJACK_LOSS,
  BLACKJACK_TURN,
  BLACKJACK_WIN,
  BLOCKED,
  NOT_OPEN,
  ROULETTE,
  SLOTS,
  SLOTS_DRAWING,
} from "./fixtures";
import { BAND, NOW, PANE, PLUGIN, seat, SESSION, textOf, worldOf } from "./world";

/** The band is drawn on these two; a pane on every surface. */
const SURFACES = ["terminal", "desktop"] as const;
const PANE_SURFACES = ["terminal", "desktop", "vscode", "mobile"] as const;

const cases: [string, StateResponse, string[]][] = [
  [
    "blackjack, the player to act",
    BLACKJACK_TURN,
    ["DEALER 9 + ?", " 9♥ ", " ? ", "YOU 11 · bet 1.00", " 3♣ ", " 8♦ ", "hit", "stand", "double", "rtp 99.00%"],
  ],
  ["blackjack, a settled win", BLACKJACK_WIN, ["19 beats 17.", "+0.99", "fee 0.01", " 10♠ ", "deal · 0.50"]],
  ["blackjack, a settled loss", BLACKJACK_LOSS, ["YOU 24 BUST", "Bust at 24.", "−1.00", " K♣ "]],
  ["roulette, settled", ROULETTE, ["bet red", "Ball on 17 black.", "−1.00", " 17 ", "spin · 0.50", "rtp 97.30%"]],
  ["baccarat, settled", BACCARAT, ["bet banker", "PLAYER 5", "BANKER 7", "Player 5 · banker 7.", "+0.94"]],
  ["slots, settled", SLOTS, ["7", "★", "+3.96", "spin · 0.50", "rtp 96.16%"]],
  ["slots, drawing", SLOTS_DRAWING, ["drawing", "░"]],
  ["an account not open yet", NOT_OPEN, ["No Tilt account yet", "first deposit on the web"]],
  ["play blocked", BLOCKED, ["Play paused · Self-exclusion until 2026-11-01."]],
];

const CHROME = [
  "TILT",
  "balance 12.40 USDC",
  "rank #414",
  "PRESENTED BY",
  "sponsored",
  "Northwind Cloud",
  "pool 3,000.00 USDC",
  "ends in 14h 3m",
];

describe("the pane draws each state the api sends", () => {
  for (const [name, state, expected] of cases) {
    test(name, async ($, on) => {
      await seat($, on, state);

      for (const surface of PANE_SURFACES) {
        const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface });
        const text = textOf(await ui.drawn());

        for (const part of expected) {
          expect(text, `${surface}: ${part}`).toContain(part);
        }

        await ui.unmount();
      }
    });
  }

  test("the header, sponsor and leaderboard around a game", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const text = textOf(await ui.drawn());

    for (const part of [...CHROME, "LEADERBOARD", "@0xkira", "+412.90", "⋮", "414", "you", "+17.95"]) {
      expect(text, part).toContain(part);
    }
  });

  test("the money keys are gone while play is blocked or the account is not open", async ($, on) => {
    await seat($, on, BLOCKED);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await ui.find({ key: "start" })).toBeUndefined();
    expect(await ui.find({ key: "bet-up" })).toBeUndefined();
    expect(await ui.find({ key: "game-roulette" })).toBeDefined();
  });

  test("a round in flight pins its game: no tab switches, no new round", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await ui.find({ key: "game-roulette" })).toBeUndefined();
    expect(await ui.find({ key: "start" })).toBeUndefined();
    expect(textOf(await ui.drawn())).toContain("[2] Roulette");
  });

  test("a narrow pane drops the sidebar but keeps the sponsor, labelled", async ($, on) => {
    await seat($, on, ROULETTE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, props: { ...PANE.props, bodyColumns: 70 } });
    const text = textOf(await ui.drawn());

    expect(text).not.toContain("LEADERBOARD");
    expect(text).toContain("PRESENTED BY Northwind Cloud · sponsored · pool 3,000.00 USDC · ends in 14h 3m");
  });

  test("every drawn hotkey is unique", async ($, on) => {
    let current: StateResponse = BASE;
    const { clock } = await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: current }) });

    for (const state of [BASE, BLACKJACK_TURN, ROULETTE, BACCARAT, SLOTS, BLOCKED]) {
      current = state;
      await clock.advance(5_000);
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
      const hotkeys = (await ui.findAll({ type: "Button" })).map((button) => String(button.props.hotkey));

      expect(hotkeys.length).toBeGreaterThan(0);
      expect(new Set(hotkeys).size, hotkeys.join(" ")).toBe(hotkeys.length);
      await ui.unmount();
    }
  });
});

describe("before there is a game", () => {
  test("logged out, the pane says how to log in", async ($, on) => {
    worldOf(on);
    mock.clock(on, { now: NOW });
    mock.store(on);
    await $.session.start(SESSION);

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface });

      expect(textOf(await ui.drawn())).toContain("Run /tilt login to play while your agent works.");
    }
  });

  test("the api is down: one line, no crash", async ($, on) => {
    await seat($, on, BASE, { "GET /v1/state": () => "offline" });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("couldn't reach tilt · retrying");
  });

  test("a state of the wrong shape is not drawn", async ($, on) => {
    await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: { ...BASE, balance: 12.4 } }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("unexpected answer from /v1/state");
  });
});

describe("the band above the prompt", () => {
  test("draws balance, hand, keys and sponsor in three rows when the pane is not shown", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: PLUGIN, ...BAND, surface });
      const text = textOf(await ui.drawn());

      expect(text).toContain("12.40 USDC");
      expect(text).toContain("blackjack · you 11 · dealer 9");
      expect(text).toContain("PRESENTED BY Northwind Cloud · sponsored");
      expect(await ui.find({ key: "bj-hit" })).toBeDefined();
    }
  });

  test("yields to the pane once it is shown, and to a survey", async ($, on) => {
    const { world, clock } = await seat($, on, BASE);

    const drawn = async (band: typeof BAND) => {
      const ui = await $.ui.mount({ plugin: PLUGIN, ...band });
      const text = textOf(await ui.drawn());

      await ui.unmount();

      return text;
    };

    await $.turn.start({ text: "", turnId: "t1" });
    await clock.advance(2_000);
    expect(world.opened).toHaveLength(1);
    expect(await drawn(BAND)).toBe("engine");

    world.isPlaced = false;
    await clock.advance(2_000);
    expect(await drawn({ ...BAND, props: { ...BAND.props, hasSurvey: true } })).toBe("engine");
    expect(await drawn(BAND)).toContain("TILT");
  });

  test("logged out, one line", async ($, on) => {
    worldOf(on);
    mock.clock(on, { now: NOW });
    mock.store(on);
    await $.session.start(SESSION);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BAND });

    expect(textOf(await ui.drawn())).toContain("TILTRun /tilt login");
  });
});
