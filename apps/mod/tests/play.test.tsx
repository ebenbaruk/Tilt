import { describe, expect, test } from "claude-code/testing";

import type { PlayRequest } from "../hooks/protocol";
import { BASE, BLACKJACK_TURN } from "./fixtures";
import { PANE, PLUGIN, seat, textOf, TOKEN, type Answer, type Route } from "./world";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const answering =
  (...answers: Answer[]): Route =>
  (body) => {
    const next = answers.length > 1 ? answers.shift() : answers[0];

    return next === "offline" || next === undefined
      ? "offline"
      : {
          ...next,
          body: { intentId: (body as PlayRequest | undefined)?.intentId ?? "polled", ...(next.body as object) },
        };
  };

const SUBMITTED: Answer = { status: 200, body: { status: "submitted", error: null } };
const PENDING: Answer = { status: 200, body: { status: "pending", error: null } };

describe("keys send moves", () => {
  test("n deals blackjack at the table minimum, with a fresh uuid and the mod token", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });

    const [sent] = world.calls("POST /v1/play");

    expect(sent?.authorization).toBe(`Bearer ${TOKEN}`);
    expect((sent?.body as PlayRequest).action).toEqual({ type: "blackjack_bet", amount: "500000" });
    expect((sent?.body as PlayRequest).intentId).toMatch(UUID);
  });

  test("b raises the bet before the deal, v lowers it", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "bet-up" });
    await ui.press({ key: "bet-up" });
    await ui.press({ key: "bet-up" });
    await ui.press({ key: "bet-down" });
    expect(textOf(await ui.drawn())).toContain("deal · 2.00");
    await ui.press({ key: "start" });

    expect((world.calls("POST /v1/play")[0]?.body as PlayRequest).action).toEqual({
      type: "blackjack_bet",
      amount: "2000000",
    });
  });

  test("roulette: 2, then k for black, z twice for the second dozen, then n", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "game-roulette" });
    await ui.press({ key: "roulette-black" });
    await ui.press({ key: "start" });
    await ui.press({ key: "roulette-dozen" });
    await ui.press({ key: "roulette-dozen" });
    await ui.press({ key: "start" });

    expect(world.calls("POST /v1/play").map((call) => (call.body as PlayRequest).action)).toEqual([
      { type: "roulette_spin", amount: "500000", bet: { kind: "black" } },
      { type: "roulette_spin", amount: "500000", bet: { kind: "dozen", dozen: 2 } },
    ]);
  });

  test("baccarat on a tie, and a slots spin", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "game-baccarat" });
    await ui.press({ key: "baccarat-tie" });
    await ui.press({ key: "start" });
    await ui.press({ key: "game-slots" });
    await ui.press({ key: "start" });

    expect(world.calls("POST /v1/play").map((call) => (call.body as PlayRequest).action)).toEqual([
      { type: "baccarat_deal", amount: "500000", bet: "tie" },
      { type: "slots_spin", amount: "500000" },
    ]);
  });

  test("h hits in a blackjack turn", async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "bj-hit" });

    expect((world.calls("POST /v1/play")[0]?.body as PlayRequest).action).toEqual({ type: "blackjack_hit" });
  });
});

describe("a move in flight", () => {
  test("a network error resends the same intent id, never a new one", async ($, on) => {
    const { world, clock } = await seat($, on, BASE, { "POST /v1/play": answering("offline", "offline", SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    expect(textOf(await ui.drawn())).toContain("reconnecting");
    expect(await ui.find({ key: "start" })).toBeUndefined();
    await clock.advance(1_100);
    await clock.advance(1_100);
    await clock.advance(1_100);

    const ids = world.calls("POST /v1/play").map((call) => (call.body as PlayRequest).intentId);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect(await ui.find({ key: "start" })).toBeDefined();
  });

  test("a pending move is followed by its id until it settles", async ($, on) => {
    const { world, clock } = await seat($, on, BASE, { "POST /v1/play": answering(PENDING) });
    const id = () => (world.calls("POST /v1/play")[0]?.body as PlayRequest).intentId;

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    world.routes[`GET /v1/intents/${id()}`] = answering(PENDING, SUBMITTED);
    await clock.advance(400);
    await clock.advance(400);

    expect(world.calls(`GET /v1/intents/${id()}`).length).toBeGreaterThanOrEqual(2);
    expect(textOf(await ui.drawn())).not.toContain("sending your move");
  });

  test("PLAYER_BUSY reads as the previous move still settling", async ($, on) => {
    const busy: Answer = { status: 409, body: { error: { code: "PLAYER_BUSY", message: "busy" } } };
    const { world } = await seat($, on, BASE, { "POST /v1/play": () => busy });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });

    expect(world.calls("POST /v1/play")).toHaveLength(1);
    expect(textOf(await ui.drawn())).toContain("Previous move still settling.");
  });

  test("a move the chain refused shows its message and frees the keys", async ($, on) => {
    const failed: Answer = {
      status: 200,
      body: { status: "failed", error: { code: "PROGRAM_ERROR", message: "InsufficientBalance" } },
    };
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(failed) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });

    expect(world.calls("POST /v1/play")).toHaveLength(1);
    expect(textOf(await ui.drawn())).toContain("InsufficientBalance");
    expect(await ui.find({ key: "start" })).toBeDefined();
  });

  test("a 401 logs out", async ($, on) => {
    const expired: Answer = { status: 401, body: { error: { code: "UNAUTHORIZED", message: "no" } } };
    await seat($, on, BASE, { "POST /v1/play": () => expired });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });

    expect(textOf(await ui.drawn())).toContain("Session expired · run /tilt login again.");
  });
});
