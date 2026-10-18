import { describe, expect, test } from "claude-code/testing";

import { DEAL_STEP_MS } from "../hooks/cards";
import type { PlayAction, PlayRequest } from "../hooks/protocol";
import { TABLE_KEY } from "../hooks/table-input";
import { BACCARAT, BASE, BLACKJACK_TURN, BLACKJACK_WIN, HILO_TURN, ROULETTE, TOWER_TURN } from "./fixtures";
import {
  BAND,
  FIRST_TICK_MS,
  later,
  movingTable,
  PANE,
  PANE_INLINE,
  PLUGIN,
  seat,
  textOf,
  TOKEN,
  type Answer,
  type Route,
} from "./world";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A win's celebration on the table. */
const SPARKLES = /[✦✧✺✹⋆]/;
/** Past a win's count-up and balance on the table. */
const EFFECT_MS = 1_400;

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
    expect((sent?.body as PlayRequest).action).toEqual({ type: "blackjack_bet", amount: "500000", hands: 1 });
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
      hands: 1,
    });
  });

  test("k adds a blackjack hand, j takes one back: the deal plays that many at the bet each", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    for (let press = 0; press < 8; press++) {
      await ui.press({ key: "hands-up" });
    }

    expect(textOf(await ui.drawn())).toContain("deal · 6 × 0.50");
    await ui.press({ key: "hands-down" });
    await ui.press({ key: "start" });

    expect((world.calls("POST /v1/play")[0]?.body as PlayRequest).action).toEqual({
      type: "blackjack_bet",
      amount: "500000",
      hands: 5,
    });
  });

  // Thirty-odd key presses and two spins, one engine hop each: room for loaded CI runners.
  test(
    "roulette: chips stack on black and on 17, n spins them all, n again rebets, u takes the last back",
    { timeoutMs: 30_000 },
    async ($, on) => {
      const { world, clock } = await seat($, on, BASE, movingTable(BASE, ROULETTE));
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

      await ui.press({ key: "game-roulette" });
      expect(await ui.find({ key: "start" })).toBeUndefined();
      await ui.press({ key: "roulette-black" });
      await ui.press({ key: "bet-up" });
      await ui.press({ key: "roulette-black" });

      for (let press = 0; press < 17; press++) {
        await ui.press({ key: "cursor-up" });
      }

      await ui.press({ key: "chip-add" });
      // 17 is black: 3.00 back on black and 36.00 on 17, over the 2.50 staked.
      expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("on the table 2.50 · 2 chips · max win 36.50");
      await ui.press({ key: "start" });
      await clock.advance(FIRST_TICK_MS);
      await ui.press({ key: "start" });
      await clock.advance(FIRST_TICK_MS);
      await ui.press({ key: "chip-undo" });
      await ui.press({ key: "start" });
      await clock.advance(FIRST_TICK_MS);
      await ui.press({ key: "chip-clear" });
      expect(await ui.find({ key: "start" })).toBeUndefined();

      const both = {
        type: "roulette_chips",
        chips: [
          { bet: { kind: "black" }, amount: "1500000" },
          { bet: { kind: "straight", number: 17 }, amount: "1000000" },
        ],
      };

      expect(world.calls("POST /v1/play").map((call) => (call.body as PlayRequest).action)).toEqual([
        both,
        both,
        { type: "roulette_chips", chips: [{ bet: { kind: "black" }, amount: "1500000" }] },
      ]);
    },
  );

  test("baccarat on a tie, and a slots spin", async ($, on) => {
    const { world, clock } = await seat($, on, BASE, movingTable(BASE, BACCARAT));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "game-baccarat" });
    await ui.press({ key: "baccarat-tie" });
    await ui.press({ key: "start" });
    await clock.advance(FIRST_TICK_MS);
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

describe("each new game sends its own move", () => {
  const plays: [string, string[], PlayAction][] = [
    [
      "dice: o rolls over, k a higher chance",
      ["game-dice", "dice-over", "dice-up"],
      { type: "dice_roll", amount: "500000", target: 3400, over: true },
    ],
    [
      "limbo: k twice for ×5",
      ["game-limbo", "limbo-up", "limbo-up"],
      { type: "limbo_play", amount: "500000", target: 500 },
    ],
    [
      "flip: t for tails, k twice for three coins",
      ["game-flip", "flip-tails", "flips-up", "flips-up"],
      { type: "flip_play", amount: "500000", side: "tails", flips: 3 },
    ],
    [
      "keno: j drops a pick",
      ["game-keno", "keno-down"],
      { type: "keno_play", amount: "500000", picks: [4, 12, 19, 27] },
    ],
    [
      "wheel: 0 to its page, k for 20 segments, r twice for high risk",
      ["game-page", "wheel-up", "wheel-risk", "wheel-risk"],
      { type: "wheel_spin", amount: "500000", segments: 20, risk: "high" },
    ],
    ["hilo: 0 then 2", ["game-page", "game-hilo"], { type: "hilo_bet", amount: "500000" }],
    [
      "tower: 0 then 3, k twice for hard",
      ["game-page", "game-tower", "tower-up", "tower-up"],
      { type: "tower_bet", amount: "500000", difficulty: "hard" },
    ],
  ];

  for (const [name, presses, action] of plays) {
    test(name, async ($, on) => {
      const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

      for (const key of presses) {
        await ui.press({ key });
      }

      await ui.press({ key: "start" });

      expect(world.calls("POST /v1/play").map((call) => (call.body as PlayRequest).action)).toEqual([action]);
    });
  }

  test("r picks five new keno numbers, all distinct", async ($, on) => {
    const { world } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "game-keno" });
    await ui.press({ key: "keno-random" });
    await ui.press({ key: "start" });

    const sent = (world.calls("POST /v1/play")[0]?.body as PlayRequest).action;
    const picks = sent.type === "keno_play" ? sent.picks : [];

    expect(new Set(picks).size).toBe(5);
    expect(picks.every((pick) => Number.isInteger(pick) && pick >= 1 && pick <= 40)).toBe(true);
  });

  test("a climbs onto the first tile of the next tower level", async ($, on) => {
    const { world } = await seat($, on, TOWER_TURN, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "tower-tile-0" });

    expect((world.calls("POST /v1/play")[0]?.body as PlayRequest).action).toEqual({ type: "tower_climb", tile: 0 });
  });

  test("l guesses lower in a hilo turn", async ($, on) => {
    const { world } = await seat($, on, HILO_TURN, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "hilo-lower" });

    expect((world.calls("POST /v1/play")[0]?.body as PlayRequest).action).toEqual({
      type: "hilo_guess",
      guess: "lower",
    });
  });
});

describe("a move in flight", () => {
  test("a network error resends the same intent id, never a new one", async ($, on) => {
    const { world, clock } = await seat($, on, BASE, { "POST /v1/play": answering("offline", "offline", SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    // The chain takes the deal: the state polled from now on shows it.
    world.routes["GET /v1/state"] = () => ({ status: 200, body: BLACKJACK_WIN });
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
    world.routes["GET /v1/state"] = () => ({ status: 200, body: BLACKJACK_WIN });
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
    expect(textOf(await ui.drawn())).toContain("Not enough balance for this bet.");
    expect(await ui.find({ key: "start" })).toBeDefined();
  });

  test("a 401 logs out", async ($, on) => {
    const expired: Answer = { status: 401, body: { error: { code: "UNAUTHORIZED", message: "no" } } };
    await seat($, on, BASE, { "POST /v1/play": () => expired });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });

    expect(textOf(await ui.drawn())).toContain("Session expired · run /tilt login again.");
  });

  test("a deal the state does not show yet holds the keys: n mashed meanwhile deals once", async ($, on) => {
    const { world, clock } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    // On-chain, but the state still answers the table before the deal.
    await clock.advance(400);
    expect(await ui.find({ key: "start" })).toBeUndefined();
    expect(textOf(await ui.drawn())).toContain("sending your move");

    world.routes["GET /v1/state"] = () => ({ status: 200, body: BLACKJACK_TURN });
    await clock.advance(400);

    expect(await ui.find({ key: "bj-hit" })).toBeDefined();
    expect(world.calls("POST /v1/play")).toHaveLength(1);
  });

  test("a submitted move the state never shows frees the keys after a while, not never", async ($, on) => {
    const { clock } = await seat($, on, BASE, { "POST /v1/play": answering(SUBMITTED) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    await clock.advance(14_000);
    expect(await ui.find({ key: "start" })).toBeUndefined();
    await clock.advance(1_500);

    expect(await ui.find({ key: "start" })).toBeDefined();
  });

  test("two presses at once send one move", async ($, on) => {
    const slow = later();
    const { world } = await seat($, on, BASE, { "POST /v1/play": slow.route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await Promise.all([ui.press({ key: "start" }), ui.press({ key: "start" })]);

    expect(world.calls("POST /v1/play")).toHaveLength(1);
    slow.answer("offline");
  });

  test("a move the api has not answered yet is not sent again meanwhile", async ($, on) => {
    const slow = later();
    const { world, clock } = await seat($, on, BASE, { "POST /v1/play": slow.route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    await clock.advance(3_000);

    expect(world.calls("POST /v1/play")).toHaveLength(1);
    expect(textOf(await ui.drawn())).toContain("sending your move");
    slow.answer("offline");
  });

  test("limits that make the bet zero send nothing, however often n is pressed", async ($, on) => {
    const slow = later();
    const zero = { ...BASE, limits: { minBet: "0", maxBet: "0" } };
    const { world } = await seat($, on, zero, { "POST /v1/play": slow.route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    await ui.press({ key: "start" });

    expect(world.calls("POST /v1/play")).toHaveLength(0);
    expect(textOf(await ui.drawn())).toContain("allow no bet");
    slow.answer("offline");
  });

  test("n mashed while a deal is in flight stays on the pane, held, and sends nothing", async ($, on) => {
    const slow = later();
    const { world } = await seat($, on, BASE, { "POST /v1/play": slow.route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "start" });
    // A key no Button takes would go to the prompt, and a mashed Enter would send it to the agent.
    const held = await ui.find({ key: "held-start" });

    expect(held?.props.hotkey).toBe("n");
    await ui.press({ key: "held-start" });
    await ui.press({ key: "held-start" });

    expect(world.calls("POST /v1/play")).toHaveLength(1);
    slow.answer("offline");
  });

  // The main screen hands the table no click nor key, but its surface module deals there as in fullscreen.
  test("on the main screen the table turns a deal's cards over one by one and invites no click", async ($, on) => {
    const { clock } = await seat($, on, BASE, movingTable(BASE, BLACKJACK_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.press({ key: "start" });
    await clock.advance(FIRST_TICK_MS);
    await ui.advance(DEAL_STEP_MS / 2);

    // In deal order: the first card is up, the second card of the hand not yet.
    expect(await table()).toContain("3♣");
    expect(await table()).not.toContain("8♦");
    expect(await table()).not.toContain("click");

    await ui.advance(1_000);
    expect(await table()).toContain("8♦");
  });

  test("a baccarat deal turns its cards over one at a time: player, banker, player, banker", async ($, on) => {
    const won = { ...BACCARAT, balance: "13340500" };
    const { clock } = await seat($, on, BASE, movingTable(BASE, won));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const faces = ["2♠", "K♦", "3♥", "7♣"];
    const seen: string[] = [];

    await ui.press({ key: "game-baccarat" });
    await ui.press({ key: "start" });
    await clock.advance(FIRST_TICK_MS);
    // The balance waits for the deal: the one before it shows.
    expect(textOf(await ui.drawn())).toContain("12.40 USDC");

    for (let frame = 0; frame < 30 && seen.length < faces.length; frame++) {
      const text = textOf(await ui.drawn({ in: TABLE_KEY }));
      const fresh = faces.filter((face) => text.includes(face) && !seen.includes(face));

      expect(fresh.length).toBeLessThanOrEqual(1);
      seen.push(...fresh);

      // Until the last card is up, nothing tells the result: no outcome, no win.
      if (seen.length < faces.length) {
        expect(text).not.toContain("Banker wins");
        expect(text).not.toContain("WINS");
        expect(text).not.toContain("+0.94");
        expect(text).not.toMatch(SPARKLES);
      }

      await ui.advance(50);
    }

    await ui.advance(EFFECT_MS);
    await clock.advance(1_000);
    const dealt = textOf(await ui.drawn({ in: TABLE_KEY }));

    expect(seen).toEqual(faces);
    expect(dealt).toContain("Banker wins 7 to 5: pays ×1.95.");
    expect(dealt).toContain("BANKER 7 WINS");
    expect(dealt).toContain("+0.94");
    expect(textOf(await ui.drawn())).toContain("13.34 USDC");
  });

  // On a fast chain the hand is dealt before the mashing stops: n is no key of the hand.
  test("n mashed past a deal that settled at once stays on the pane a moment, then gives way", async ($, on) => {
    const { world, clock } = await seat($, on, BASE, movingTable(BASE, BLACKJACK_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "start" });
    await clock.advance(FIRST_TICK_MS);
    expect(await ui.find({ key: "bj-stand" })).toBeDefined();
    const echo = await ui.find({ key: "echo-start" });

    expect(echo?.props.hotkey).toBe("n");
    await ui.press({ key: "echo-start" });
    expect(world.calls("POST /v1/play")).toHaveLength(1);

    await clock.advance(1_000);
    expect(await ui.find({ key: "echo-start" })).toBeDefined();
    const band = await $.ui.mount({ plugin: PLUGIN, ...BAND });
    expect(await band.find({ key: "echo-start" })).toBeDefined();

    await clock.advance(1_000);
    expect(await ui.find({ key: "echo-start" })).toBeUndefined();
  });

  test("a 429 while following a pending move keeps the move, and the api is left alone a while", async ($, on) => {
    const limited: Answer = { status: 429, body: { error: { code: "RATE_LIMITED", message: "slow down" } } };
    const { world, clock } = await seat($, on, BASE, { "POST /v1/play": answering(PENDING) });
    const id = () => (world.calls("POST /v1/play")[0]?.body as PlayRequest).intentId;
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    await ui.press({ key: "start" });
    world.routes[`GET /v1/intents/${id()}`] = () => limited;
    await clock.advance(400);
    expect(world.calls(`GET /v1/intents/${id()}`)).toHaveLength(1);

    const calls = world.requests.length;

    await clock.advance(4_000);
    expect(world.requests.length).toBe(calls);
    expect(await ui.find({ key: "start" })).toBeUndefined();
    await clock.advance(1_500);

    // Resent with its own id: the api answers what became of it.
    expect(world.calls("POST /v1/play").map((call) => (call.body as PlayRequest).intentId)).toEqual([id(), id()]);
  });

  test("a 429 storm on the state slows the polls down", async ($, on) => {
    const limited: Answer = { status: 429, body: { error: { code: "RATE_LIMITED", message: "slow down" } } };
    const drawing = {
      ...BLACKJACK_TURN,
      round: BLACKJACK_TURN.round && { ...BLACKJACK_TURN.round, phase: "drawing" as const },
    };
    const { world, clock } = await seat($, on, drawing);

    world.routes["GET /v1/state"] = () => limited;
    await clock.advance(10_000);

    expect(world.calls("GET /v1/state").length).toBeLessThanOrEqual(4);
  });
});
