import type { RenderInput } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { DEAL_STEP_MS } from "../hooks/cards";
import type { PlayRequest, StateResponse } from "../hooks/protocol";
import { DICE_ROLL_MS, KENO_DRAW_MS, WHEEL_SPIN_MS } from "../hooks/quick";
import { TABLE_KEY } from "../hooks/table-input";
import {
  BACCARAT,
  BASE,
  BLACKJACK_LOSS,
  BLACKJACK_MIXED,
  BLACKJACK_PAIR,
  BLACKJACK_SIX_TURN,
  BLACKJACK_TURN,
  BLACKJACK_WIN,
  DICE,
  HILO_TURN,
  KENO,
  WHEEL,
} from "./fixtures";
import { BAND, FIRST_TICK_MS, movingTable, PANE, PANE_INLINE, PLUGIN, seat, textOf, type Answer } from "./world";

const SUBMITTED: Answer = { status: 200, body: { intentId: "sent", status: "submitted", error: null } };
/** The Client acts (key, pointer, post, advance) are typed on the terminal's drawing. */
const FULLSCREEN: RenderInput<"Pane", "terminal"> = { ...PANE, surface: "terminal" };
const UNFOCUSED = { ...FULLSCREEN, props: { ...PANE.props, isFocused: false } };
const CLICK = { type: "down", x: 2, y: 1, button: "left" } as const;
/** Every card of six hands and the dealer turned over, one deal step each. */
const WHOLE_DEAL_MS = 14 * 150;
const EFFECT_MS = 1_400;
const POLL_MS = 5_000;

const actionsOf = (calls: { body: unknown }[]) => calls.map((call) => (call.body as PlayRequest).action);
/** The same round under another number: a new round for the table. */
const renumbered = (state: StateResponse, number: number): StateResponse =>
  state.round === null ? state : { ...state, round: { ...state.round, number } };

describe("the table in the fullscreen pane", () => {
  test("is a surface module there, led by how to give it the keys; inline it invites no click, the letters play it", async ($, on) => {
    await seat($, on, BASE);
    const full = await $.ui.mount({ plugin: PLUGIN, ...UNFOCUSED });

    expect(await full.find({ type: "Client", key: TABLE_KEY })).toBeDefined();
    expect(textOf(await full.drawn({ in: TABLE_KEY }))).toContain("click the table, then Space to play");
    await full.unmount();

    const inline = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE, props: UNFOCUSED.props });
    const text = textOf(await inline.drawn());

    // The main screen hands the table neither clicks nor keys: it animates, and says nothing of either.
    expect(await inline.find({ type: "Client", key: TABLE_KEY })).toBeDefined();
    expect(textOf(await inline.drawn({ in: TABLE_KEY }))).not.toContain("click");
    expect(text).toContain("ctrl+x tab");
    expect(text).toContain("deal · 0.50");

    // Mines and Tower keep the still board there: its hidden tiles are the Buttons of their letters.
    await inline.press({ key: "game-mines" });
    expect(await inline.find({ type: "Client" })).toBeUndefined();
  });

  test("a click, then → raises the bet, ↑ adds a hand and Space deals them", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": () => SUBMITTED });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.pointer(CLICK);
    expect(await table()).not.toContain("click the table");
    expect(await table()).toContain("Space · play");

    await ui.key({ key: "right" });
    expect(await table()).toContain("deal · 1.00");
    await ui.key({ key: "up" });
    await ui.key({ key: "up" });
    await ui.key({ key: "down" });
    expect(await table()).toContain("deal · 2 × 1.00");
    await ui.key({ key: "space" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "blackjack_bet", amount: "1000000", hands: 2 }]);
  });

  test("once the keyboard leaves the pane, the table asks for a click again before Space", async ($, on) => {
    await seat($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.pointer(CLICK);
    expect(await table()).toContain("Space · play");

    // The prompt (or the agents view) took the keys: ← there is Claude Code's, not the table's.
    await ui.redraw(UNFOCUSED.props);
    expect(await table()).toContain("click the table, then Space to play");

    // ctrl+x tab gives the pane the keys back, but not the table: Space still needs a click.
    await ui.redraw(FULLSCREEN.props);
    expect(await table()).toContain("click the table, then Space to play");
    await ui.pointer(CLICK);
    expect(await table()).toContain("Space · play");
  });

  test("in a blackjack turn Space hits, Enter stands and d doubles", async ($, on) => {
    const { world, clock } = await seat($, on, BLACKJACK_TURN, movingTable(BLACKJACK_TURN, BLACKJACK_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    await ui.pointer(CLICK);
    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("Space hit · Enter stand · d double");
    // Each key waits for the state to show the move before it: a stale table offers none.
    await ui.key({ key: "space" });
    await clock.advance(FIRST_TICK_MS);
    await ui.key({ key: "return" });
    await clock.advance(FIRST_TICK_MS);
    await ui.key({ key: "d" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "blackjack_hit" },
      { type: "blackjack_stand" },
      { type: "blackjack_double" },
    ]);
  });

  test("on a pair p splits, once however often it is mashed", async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_PAIR, movingTable(BLACKJACK_PAIR, BLACKJACK_PAIR));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    await ui.pointer(CLICK);
    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("Space hit · Enter stand · d double · p split");
    await ui.key({ key: "p" });
    await ui.key({ key: "p" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "blackjack_split" }]);
  });

  test("a post presses only a key the plan has right now, and nothing malformed", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": () => SUBMITTED });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    await ui.post({ press: "start", amount: "999000000" });
    await ui.post({ press: "bj-hit" });
    await ui.post({ action: { type: "blackjack_bet", amount: "999000000", hands: 6 } });
    await ui.post("start");
    expect(world.calls("POST /v1/play")).toHaveLength(0);

    await ui.post({ press: "start" });
    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "blackjack_bet", amount: "500000", hands: 1 }]);
  });
});

describe("the table moves", () => {
  // Several rounds of frames, one engine hop each: room for loaded CI runners.
  test(
    "a new round is dealt card by card, a win counts up, wins in a row are counted, a loss ends the streak",
    { timeoutMs: 30_000 },
    async ($, on) => {
      let current: StateResponse = BASE;
      const { clock } = await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: current }) });
      const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
      const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));
      const show = async (state: StateResponse) => {
        current = state;
        await clock.advance(POLL_MS);
      };

      await show(BLACKJACK_SIX_TURN);
      // Cards are dealt face down, then turned over one by one.
      expect(await table()).not.toContain("5♣");
      expect(await table()).not.toContain("▶ #3 11");
      await ui.advance(WHOLE_DEAL_MS);
      expect(await table()).toContain("5♣");
      expect(await table()).toContain("▶ #3 11");

      await show(BLACKJACK_MIXED);
      await ui.advance(WHOLE_DEAL_MS);
      expect(await table()).not.toContain("+2.47");
      await ui.advance(EFFECT_MS);
      expect(await table()).toContain("+2.47");
      expect(await table()).toContain("balance 12.40");
      expect(await table()).toContain("play again (same bet)");

      await show(renumbered(BLACKJACK_WIN, 10));
      await ui.advance(WHOLE_DEAL_MS + EFFECT_MS);
      expect(await table()).toContain("2 wins in a row");

      await show(renumbered(BLACKJACK_LOSS, 11));
      await ui.advance(WHOLE_DEAL_MS + EFFECT_MS);
      expect(await table()).toContain("LOSE 1.00");
      expect(await table()).not.toContain("wins in a row");
    },
  );

  test("a wheel spin lands before the result and the balance show", { timeoutMs: 30_000 }, async ($, on) => {
    let current: StateResponse = { ...BASE, round: null };
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.press({ key: "game-page" });
    current = { ...WHEEL, balance: "12895000" };
    await clock.advance(POLL_MS);
    await ui.advance(WHEEL_SPIN_MS - 300);
    expect(await table()).toContain("spinning…");
    expect(await table()).not.toContain("Landed on");
    expect(await table()).not.toContain("+0.49");

    await ui.advance(300 + EFFECT_MS);
    expect(await table()).toContain("Landed on ×1.50.");
    expect(await table()).toContain("balance 12.89");
    expect(await table()).not.toContain("spinning…");
  });

  test(
    "a dice roll tumbles, then the verdict and the count-up, and Keno lights its numbers first",
    { timeoutMs: 30_000 },
    async ($, on) => {
      let current: StateResponse = { ...BASE, round: null };
      const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
      const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
      const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

      await ui.press({ key: "game-dice" });
      current = { ...DICE, balance: "13390000" };
      await clock.advance(POLL_MS);
      await ui.advance(DICE_ROLL_MS - 300);
      expect(await table()).toContain("rolling ");
      expect(await table()).not.toContain("WIN");
      expect(await table()).not.toContain("Rolled 37.42");

      await ui.advance(300 + EFFECT_MS);
      expect(await table()).toContain("rolled 37.42 WIN");
      expect(await table()).toContain("Rolled 37.42: under 49.00 wins. +0.99");
      expect(await table()).toContain("balance 13.39");

      await ui.press({ key: "game-keno" });
      current = renumbered({ ...KENO, balance: "16360000" }, 8);
      await clock.advance(POLL_MS);
      await ui.advance(KENO_DRAW_MS - 300);
      expect(await table()).not.toContain("3 hits of 5 picks.");

      await ui.advance(300 + EFFECT_MS);
      expect(await table()).toContain("3 hits WIN");
      expect(await table()).toContain("3 hits of 5 picks. +2.97");
    },
  );

  test("keys go through while cards are still being dealt", async ($, on) => {
    let current: StateResponse = BASE;
    const { world, clock } = await seat($, on, BASE, {
      "GET /v1/state": () => ({ status: 200, body: current }),
      "POST /v1/play": () => SUBMITTED,
    });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    current = BLACKJACK_SIX_TURN;
    await clock.advance(POLL_MS);
    await ui.pointer(CLICK);
    await ui.key({ key: "return" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "blackjack_stand" }]);
  });

  test("a deal Space sent stays on the same table: face down until it shows, then dealt card by card", async ($, on) => {
    let current: StateResponse = BASE;
    const { world, clock } = await seat($, on, BASE, {
      "GET /v1/state": () => ({ status: 200, body: current }),
      "POST /v1/play": () => SUBMITTED,
    });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.pointer(CLICK);
    await ui.key({ key: "space" });
    expect(await table()).toContain("░░░░░");

    current = BLACKJACK_TURN;
    await clock.advance(POLL_MS);
    await ui.advance(DEAL_STEP_MS / 2);
    expect(await table()).toContain("3♣");
    expect(await table()).not.toContain("8♦");

    // The table kept the keys the click gave it: Space hits the hand it dealt.
    await ui.advance(WHOLE_DEAL_MS);
    await ui.key({ key: "space" });
    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "blackjack_bet", amount: "500000", hands: 1 },
      { type: "blackjack_hit" },
    ]);
  });

  test("a baccarat round is dealt card by card, the third cards last, and the outcome waits for the last", async ($, on) => {
    // The player draws a third card, then the banker does.
    const thirds: StateResponse =
      BACCARAT.round === null
        ? BACCARAT
        : {
            ...BACCARAT,
            round: {
              ...BACCARAT.round,
              detail: {
                game: "baccarat",
                bet: "banker",
                player: [
                  { rank: 2, suit: "♠" },
                  { rank: 3, suit: "♥" },
                  { rank: 4, suit: "♦" },
                ],
                banker: [
                  { rank: 13, suit: "♦" },
                  { rank: 3, suit: "♣" },
                  { rank: 5, suit: "♠" },
                ],
                playerPoints: 9,
                bankerPoints: 8,
              },
            },
          };
    let current: StateResponse = BASE;
    const { clock } = await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));
    const faces = ["2♠", "K♦", "3♥", "3♣", "4♦", "5♠"];
    const seen: string[] = [];

    await ui.press({ key: "game-baccarat" });
    current = thirds;
    await clock.advance(POLL_MS);

    for (let frame = 0; frame < 40 && seen.length < faces.length; frame++) {
      const text = await table();
      const fresh = faces.filter((face) => text.includes(face) && !seen.includes(face));

      expect(fresh.length).toBeLessThanOrEqual(1);
      seen.push(...fresh);

      if (seen.length < faces.length) {
        expect(text).not.toContain("Player 9 · banker 8.");
      }

      await ui.advance(50);
    }

    expect(seen).toEqual(faces);
    await ui.advance(EFFECT_MS);
    expect(await table()).toContain("Player 9 · banker 8.");
    expect(await table()).toContain("+0.94");
  });

  test("a hilo guess lies face down from the key on, turns over a step after it lands, and its result waits for it", async ($, on) => {
    const turn = HILO_TURN.round;
    const busted: StateResponse =
      turn === null || turn.detail.game !== "hilo"
        ? HILO_TURN
        : {
            ...HILO_TURN,
            round: {
              ...turn,
              phase: "idle",
              net: "-500000",
              detail: {
                ...turn.detail,
                cards: [...turn.detail.cards, { rank: 11, suit: "♦" }],
                guesses: [...turn.detail.guesses, "lower"],
                busted: true,
                canGuess: false,
                canCashOut: false,
              },
            },
          };
    let current: StateResponse = HILO_TURN;
    const { world, clock } = await seat($, on, HILO_TURN, {
      "GET /v1/state": () => ({ status: 200, body: current }),
      "POST /v1/play": () => SUBMITTED,
    });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.pointer(CLICK);
    await ui.key({ key: "l" });
    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "hilo_guess", guess: "lower" }]);
    expect(await table()).toContain("░░░░░");
    expect(await table()).toContain("drawing… ▼ lower or same");

    current = busted;
    await clock.advance(POLL_MS);
    await ui.advance(DEAL_STEP_MS / 2);
    expect(await table()).toContain("░░░░░");
    expect(await table()).not.toContain("J♦");
    expect(await table()).not.toContain("Wrong guess");

    await ui.advance(DEAL_STEP_MS * 2);
    expect(await table()).toContain("5♦ ▼ J♦");
    expect(await table()).toContain("WRONG GUESS");
    expect(await table()).toContain("Wrong guess after 2 right.");
  });
});

describe("the table in the bottom band of the fullscreen terminal", () => {
  /** Placed at the bottom (/tilt setup), the whole table is the band above the prompt. */
  const BOTTOM = { options: { layout: "bottom" }, timeoutMs: 30_000 };
  const BOTTOM_BAND: RenderInput<"AbovePrompt", "terminal"> = {
    ...BAND,
    surface: "terminal",
    viewport: { columns: 125, rows: 60, isFullscreen: true },
    props: { ...BAND.props, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 30 } },
  };

  test("deals card by card and counts a win up once the last card is over, as the pane does", BOTTOM, async ($, on) => {
    let current: StateResponse = BASE;
    const { clock } = await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BOTTOM_BAND });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    current = BLACKJACK_SIX_TURN;
    await clock.advance(POLL_MS);
    expect(await table()).not.toContain("5♣");
    await ui.advance(WHOLE_DEAL_MS);
    expect(await table()).toContain("5♣");

    current = BLACKJACK_MIXED;
    await clock.advance(POLL_MS);
    await ui.advance(WHOLE_DEAL_MS);
    expect(await table()).not.toContain("+2.47");
    await ui.advance(EFFECT_MS);
    expect(await table()).toContain("+2.47");
    expect(await table()).toContain("balance 12.40");
  });

  test("a wheel spin lands before the result shows", BOTTOM, async ($, on) => {
    let current: StateResponse = { ...BASE, round: null };
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BOTTOM_BAND });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.press({ key: "game-page" });
    current = { ...WHEEL, balance: "12895000" };
    await clock.advance(POLL_MS);
    await ui.advance(WHEEL_SPIN_MS - 300);
    expect(await table()).toContain("spinning…");
    expect(await table()).not.toContain("Landed on");

    await ui.advance(300 + EFFECT_MS);
    expect(await table()).toContain("Landed on ×1.50.");
  });

  test("a click then Space deals; a post presses only a key the plan has right now", BOTTOM, async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": () => SUBMITTED });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BOTTOM_BAND });

    // The band never says it holds the keyboard: the table always says how to give it the keys.
    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("click the table, then Space to play");
    await ui.post({ press: "bj-hit" });
    await ui.post({ press: "start", amount: "999000000" });
    expect(world.calls("POST /v1/play")).toHaveLength(0);

    await ui.pointer(CLICK);
    await ui.key({ key: "space" });
    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "blackjack_bet", amount: "500000", hands: 1 }]);
  });
});

describe("the table on the main screen", () => {
  test("spins the wheel, then counts the win up, as in fullscreen", { timeoutMs: 30_000 }, async ($, on) => {
    let current: StateResponse = { ...BASE, round: null };
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.press({ key: "game-page" });
    current = { ...WHEEL, balance: "12895000" };
    await clock.advance(POLL_MS);
    await ui.advance(WHEEL_SPIN_MS - 300);
    expect(await table()).toContain("spinning…");

    // Landed: the result shows, its net still counting up.
    await ui.advance(400);
    expect(await table()).toContain("Landed on ×1.50.");
    expect(await table()).not.toContain("+0.49");

    await ui.advance(EFFECT_MS);
    expect(await table()).toContain("+0.49");
    expect(await table()).toContain("balance 12.89");
  });

  test(
    "the band at the bottom animates there too, and invites no click",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, BLACKJACK_TURN);
      const band = await $.ui.mount({
        plugin: PLUGIN,
        ...BAND,
        props: { ...BAND.props, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 30 } },
      });

      expect(await band.find({ type: "Client", key: TABLE_KEY })).toBeDefined();
      expect(textOf(await band.drawn({ in: TABLE_KEY }))).toContain("DEALER");
      expect(textOf(await band.drawn({ in: TABLE_KEY }))).not.toContain("click");
    },
  );
});
