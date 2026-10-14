import type { RenderInput } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import type { PlayRequest, StateResponse } from "../hooks/protocol";
import { TABLE_KEY } from "../hooks/table-input";
import { BASE, BLACKJACK_LOSS, BLACKJACK_MIXED, BLACKJACK_SIX_TURN, BLACKJACK_TURN, BLACKJACK_WIN } from "./fixtures";
import { PANE, PANE_INLINE, PLUGIN, seat, textOf, type Answer } from "./world";

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

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "blackjack_bet", amount: "1000000", hands: 2 },
    ]);
  });

  test("in a blackjack turn Space hits, Enter stands and d doubles", async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN, { "POST /v1/play": () => SUBMITTED });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    await ui.pointer(CLICK);
    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("Space hit · Enter stand · d double");
    await ui.key({ key: "space" });
    await ui.key({ key: "return" });
    await ui.key({ key: "d" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "blackjack_hit" },
      { type: "blackjack_stand" },
      { type: "blackjack_double" },
    ]);
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
  test("a new round is dealt card by card, a win counts up, wins in a row are counted, a loss ends the streak", async ($, on) => {
    let current: StateResponse = BASE;
    const { clock } = await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));
    const show = async (state: StateResponse) => {
      current = state;
      await clock.advance(POLL_MS);
    };

    await show(BLACKJACK_SIX_TURN);
    expect(await table()).toContain(" ▒▒ ");
    expect(await table()).not.toContain("▶ #3 11");
    await ui.advance(WHOLE_DEAL_MS);
    expect(await table()).not.toContain(" ▒▒ ");
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
  });

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
});
