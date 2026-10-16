import type { RenderInput } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import type { PlayRequest, StateResponse } from "../hooks/protocol";
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
} from "./fixtures";
import { FIRST_TICK_MS, movingTable, PANE, PANE_INLINE, PLUGIN, seat, textOf, type Answer } from "./world";

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
  test("is a surface module there, led by how to give it the keys; inline it is the still table and the letters", async ($, on) => {
    await seat($, on, BASE);
    const full = await $.ui.mount({ plugin: PLUGIN, ...UNFOCUSED });

    expect(await full.find({ type: "Client", key: TABLE_KEY })).toBeDefined();
    expect(textOf(await full.drawn({ in: TABLE_KEY }))).toContain("click the table, then Space to play");
    await full.unmount();

    const inline = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE, props: UNFOCUSED.props });
    const text = textOf(await inline.drawn());

    expect(await inline.find({ type: "Client" })).toBeUndefined();
    expect(text).toContain("ctrl+x tab");
    expect(text).toContain("deal · 0.50");
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
});
