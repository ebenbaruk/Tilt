import { describe, expect, mock, test } from "claude-code/testing";

import type { StateResponse } from "../hooks/protocol";
import {
  BACCARAT,
  BASE,
  BLACKJACK_LOSS,
  BLACKJACK_MIXED,
  BLACKJACK_PAIR,
  BLACKJACK_SIX_TURN,
  BLACKJACK_SPLIT_SETTLED,
  BLACKJACK_TEN_TURN,
  BLACKJACK_TURN,
  BLACKJACK_WIN,
  BLOCKED,
  NOT_OPEN,
  ROULETTE,
  SLOTS,
  SLOTS_DRAWING,
} from "./fixtures";
import { BAND, NOW, PANE, PANE_INLINE, PLUGIN, seat, SESSION, shownText, textOf, worldOf } from "./world";

/** The band is drawn on these two; a pane on every surface. */
const SURFACES = ["terminal", "desktop"] as const;
const PANE_SURFACES = ["desktop", "vscode", "mobile"] as const;

const cases: [string, StateResponse, string[]][] = [
  [
    "blackjack, the player to act",
    BLACKJACK_TURN,
    ["DEALER 9 + ?", " 9♥ ", " ? ", "▶ YOU 11", "bet 1.00", " 3♣ ", " 8♦ ", "hit", "stand", "double", "rtp 99.00%"],
  ],
  [
    "blackjack, six hands, the third to act",
    BLACKJACK_SIX_TURN,
    ["DEALER 9 + ?", "#1 20", "#2 21 BLACKJACK", "▶ #3 11", "#4 soft 17", "#5 16", "#6 5", " 5♣ ", "hit", "double"],
  ],
  ["blackjack, a settled win", BLACKJACK_WIN, ["YOU 19", "WIN 1.00", "19 beats 17.", "+0.99", "fee 0.01", " 10♠ "]],
  ["blackjack, a settled loss", BLACKJACK_LOSS, ["YOU 24 BUST", "LOSE 1.00", "Bust at 24.", "−1.00", " K♣ "]],
  [
    "blackjack, four hands settled",
    BLACKJACK_MIXED,
    [
      "DEALER 18",
      "#1 21 BLACKJACK",
      "BJ 1.00",
      "#2 24 BUST",
      "LOSE 1.00",
      "#3 20",
      "WIN 2.00 doubled",
      "PUSH 1.00",
      "Dealer 18 · 1 blackjack · 1 won · 1 push · 1 lost.",
      "+2.47",
      "fee 0.02",
      "deal · 0.50",
    ],
  ],
  ["blackjack, a pair to split", BLACKJACK_PAIR, ["▶ YOU 16", " 8♠ ", " 8♥ ", "hit", "double", "split"]],
  [
    "blackjack, ten hands after four splits, a split hand to act",
    BLACKJACK_TEN_TURN,
    [
      "#1 20 10♠ ",
      "#2 soft 20 split",
      " A♠ ",
      "#3 21 split",
      "#7 22 BUST split",
      "▶ #8 11 split",
      "#9 11 5♣ ",
      "#10 5 2♥ ",
      "hit",
      "double",
    ],
  ],
  [
    "blackjack, split aces settled",
    BLACKJACK_SPLIT_SETTLED,
    [
      "#1 21 split",
      "WIN 1.00",
      "#2 soft 18 split",
      "PUSH 1.00",
      "#3 19",
      "Dealer 18 · 2 split hands · 2 won · 1 push.",
      "+1.98",
    ],
  ],
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
      const mounts = [
        ["terminal fullscreen", PANE],
        ["terminal inline", PANE_INLINE],
        ...PANE_SURFACES.map((surface) => [surface, { ...PANE, surface }] as const),
      ] as const;

      for (const [where, pane] of mounts) {
        const ui = await $.ui.mount({ plugin: PLUGIN, ...pane });
        const text = await shownText(ui);

        for (const part of expected) {
          expect(text, `${where}: ${part}`).toContain(part);
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

  test("a move the api still has in flight (sent before a restart) holds the keys and says why", async ($, on) => {
    await seat($, on, { ...BASE, pendingIntentId: "sent-before-restart" });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const text = await shownText(ui);

    expect(await ui.find({ key: "start" })).toBeUndefined();
    expect(text).toContain("previous move still settling");
    expect(text).not.toContain("Space to play");
  });

  // Pressing 2 for roulette mid-hand used to do nothing at all (the tabs were drawn, not pressable).
  test("a round in flight pins its game: a tab press says to finish the round, no new round", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await ui.find({ key: "start" })).toBeUndefined();
    await ui.press({ key: "game-roulette" });
    const text = textOf(await ui.drawn());

    expect(text).toContain("Finish this Blackjack round before switching game");
    expect(text).not.toContain("spin");
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

    for (const state of [BASE, BLACKJACK_TURN, BLACKJACK_PAIR, ROULETTE, BACCARAT, SLOTS, BLOCKED]) {
      current = state;
      await clock.advance(5_000);
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
      const hotkeys = (await ui.findAll({ type: "Button" })).map((button) => String(button.props.hotkey));

      expect(hotkeys.length).toBeGreaterThan(0);
      expect(new Set(hotkeys).size, hotkeys.join(" ")).toBe(hotkeys.length);
      await ui.unmount();
    }
  });

  test("a 21 on two cards after a split is no blackjack, in play or settled, narrow or wide", async ($, on) => {
    let current: StateResponse = BLACKJACK_TEN_TURN;
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });

    for (const state of [BLACKJACK_TEN_TURN, BLACKJACK_SPLIT_SETTLED]) {
      current = state;
      await clock.advance(5_000);

      for (const bodyColumns of [70, 160]) {
        const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, props: { ...PANE.props, bodyColumns } });
        const text = await shownText(ui);

        expect(text, `${bodyColumns}`).toContain(" 21 split");
        expect(text, `${bodyColumns}`).not.toContain("BLACKJACK");
        expect(text, `${bodyColumns}`).not.toContain("BJ ");
        await ui.unmount();
      }
    }
  });

  // Split aces finish at once: without a word the round looked like it stood on its own.
  test("split aces say they take one card; other split hands do not", async ($, on) => {
    await seat($, on, BLACKJACK_SPLIT_SETTLED);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, props: { ...PANE.props, bodyColumns: 160 } });

    // Two hands from split aces, one hand from no split.
    expect((await shownText(ui)).match(/· 1 card/g)).toHaveLength(2);
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

  test("a server error shows a plain line, never the server's own message", async ($, on) => {
    const internal = { error: { code: "INTERNAL_ERROR", message: 'relation "users" does not exist at db.ts:42' } };
    await seat($, on, BASE, { "GET /v1/state": () => ({ status: 500, body: internal }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const text = textOf(await ui.drawn());

    expect(text).toContain("tilt is having trouble · retrying");
    expect(text).not.toContain("relation");
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
