import type { ConfigRow, On, TurnCompleteInput } from "claude-code";
import { describe, type Engine, expect, type Mounted, test } from "claude-code/testing";

import { baccaratOutcome, ROULETTE_SPIN_MS, slotsOutcome, TILE_FILL, wheelPosition } from "../hooks/games";
import {
  DICE_ROLL_MS,
  flipMs,
  KENO_DRAW_MS,
  LIMBO_RISE_MS,
  limboAt,
  rollAt,
  WHEEL_SPIN_MS,
  wheelSegmentAt,
} from "../hooks/quick";
import type { BaccaratView, FlipView, StateResponse } from "../hooks/protocol";
import {
  BACCARAT,
  BASE,
  BLACKJACK_LOSS,
  BLACKJACK_TURN,
  BLACKJACK_WIN,
  DICE,
  DICE_LOSS,
  FLIP,
  FLIP_LOSS,
  HILO_ACE,
  HILO_BUSTED,
  HILO_DRAWING,
  HILO_TURN,
  KENO,
  KENO_DRAWING,
  LIMBO,
  MINES_BUSTED,
  MINES_CASHED,
  MINES_TURN,
  ROULETTE,
  ROULETTE_CHIPS,
  SLOTS,
  SLOTS_JACKPOT,
  TOWER_BUSTED,
  TOWER_CASHED,
  TOWER_TURN,
  WHEEL,
} from "./fixtures";
import { TABLE_KEY } from "../hooks/table-input";
import { RESULT_MS, SURFACE_LAG_MS } from "../hooks/view";
import {
  BAND,
  command,
  FIRST_TICK_MS,
  later,
  LOGGED_IN,
  PANE,
  PANE_INLINE,
  PANE_STILL,
  PLUGIN,
  seat,
  shownText,
  textOf,
} from "./world";

const POLL_MS = 5_000;
/** Past the longest spin: the wheel and the reels have landed. */
const SPIN_OVER_MS = 2_100;
/** A frame of the main screen's spin. */
const SPIN_FRAME_MS = 100;
/** Past a big win's fireworks. */
const CELEBRATION_OVER_MS = 3_000;
const LARGE_CARD_TOP = "╭─────╮";
const LIGHT_PINK = "#c42a7f";
const DARK_PINK = "#f779ba";

const turnEnd: TurnCompleteInput = {
  answer: "",
  durationMs: 374_000,
  isAborted: false,
  turnId: "t1",
  reason: "answer",
};

const themeRow = (value: string): ConfigRow => ({
  key: "theme",
  label: "Theme",
  kind: "choice",
  value,
  provider: { plugin: "engine", tier: "core" },
  isLocked: false,
});

/** Three heads called on three coins, as FLIP lands them. */
const FLIP_DETAIL: FlipView = {
  game: "flip",
  side: "heads",
  flips: 3,
  results: ["heads", "heads", "heads"],
  multiplier: "7.8400",
};

/** Where the table surface module's region sits in a drawing's tree. */
const TABLE_REGION = '"type":"Client"';

/** A band of 30 rows on the main screen of a terminal tall enough for it to take them. */
const BAND_ROOMY = {
  ...BAND,
  viewport: { columns: 125, rows: 80, isFullscreen: false },
  props: { ...BAND.props, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 29 } },
};

/** The same round under another number: a new round for the table. */
const numbered = (state: StateResponse, number: number): StateResponse =>
  state.round === null ? state : { ...state, round: { ...state.round, number } };

/** A logged-in session whose state the test changes as it goes, polled every `POLL_MS`. */
async function moving($: Engine, on: On, first: StateResponse) {
  let current = first;
  const seated = await seat($, on, first, { "GET /v1/state": () => ({ status: 200, body: current }) });
  const show = async (state: StateResponse) => {
    current = state;
    await seated.clock.advance(POLL_MS);
  };

  return { ...seated, show };
}

describe("the table stays when the agent finishes", () => {
  test("an inline pane stays open with the whole table and the finish notice", async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN);

    await $.turn.start({ text: "", turnId: "t1" });
    await (
      await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE, props: { ...PANE_INLINE.props, isFocused: false } })
    ).unmount();
    await $.turn.complete(turnEnd);

    expect(world.closed).toEqual([]);
    const pane = await shownText(await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE }));

    expect(pane).toContain("✓ agent finished in 6m 14s · your hand is saved");
    expect(pane).toContain("DEALER");
  });

  test(
    "bottom: the band keeps the whole table when the turn ends",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, BLACKJACK_TURN);
      await $.turn.start({ text: "", turnId: "t1" });
      await $.turn.complete(turnEnd);
      const band = textOf(await (await $.ui.mount({ plugin: PLUGIN, ...BAND_ROOMY })).drawn());

      expect(band).toContain("LEADERBOARD");
      expect(band).toContain("your hand is saved");
    },
  );
});

describe("the bottom band on the main screen", () => {
  test(
    "takes at most half the terminal: a table taller than that gives way to the compact band, the answer in view",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, BLACKJACK_TURN);
      const short = await $.ui.mount({
        plugin: PLUGIN,
        ...BAND_ROOMY,
        viewport: { columns: 125, rows: 24, isFullscreen: false },
      });

      expect(await short.find({ type: "Client" })).toBeUndefined();
      expect(textOf(await short.drawn())).toContain("blackjack · you 11 · dealer 9");
      await short.unmount();

      const tall = await $.ui.mount({ plugin: PLUGIN, ...BAND_ROOMY });

      expect(textOf(await tall.drawn({ in: TABLE_KEY }))).toContain("DEALER");
    },
  );
});

describe("the first hand", () => {
  test("a guide shows how to get the keys until the first move, then never again", async ($, on) => {
    const { route } = later();
    const { world } = await seat($, on, BASE, { "POST /v1/play": route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, props: { ...PANE.props, isFocused: false } });

    expect(textOf(await ui.drawn())).toContain("First hand? Press ctrl+x tab to give Tilt the keys, then n to deal.");

    await ui.press({ key: "start" });

    expect(world.calls("POST /v1/play")).toHaveLength(1);
    expect(textOf(await ui.drawn())).not.toContain("First hand?");
  });

  test("the guide's rows count: a pane that would push the keys out with large cards draws small ones", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      ...PANE,
      props: { ...PANE.props, scroll: { offset: 0, bodyRows: 31 } },
    });
    const text = await shownText(ui);

    expect(text).toContain("First hand?");
    expect(text).not.toContain(LARGE_CARD_TOP);
  });

  test("a later session that finds the first move stored shows no guide", async ($, on) => {
    await seat($, on, BASE, {}, { ...LOGGED_IN, onboarded: true });

    expect(textOf(await (await $.ui.mount({ plugin: PLUGIN, ...PANE })).drawn())).not.toContain("First hand?");
  });
});

describe("a light terminal", () => {
  test("the accents switch to their light set", async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN);

    world.configRows = [themeRow("light-daltonized")];
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });
    const drawn = JSON.stringify(await (await $.ui.mount({ plugin: PLUGIN, ...PANE })).drawn());

    expect(drawn).toContain(LIGHT_PINK);
    expect(drawn).not.toContain(DARK_PINK);
  });

  test("a dark theme keeps the dark set", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);

    expect(JSON.stringify(await (await $.ui.mount({ plugin: PLUGIN, ...PANE })).drawn())).toContain(DARK_PINK);
  });
});

describe("around the table", () => {
  test("a big win gets a banner and a key that copies a line to share, nothing about the work", async ($, on) => {
    const { world } = await seat($, on, SLOTS_JACKPOT);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await shownText(ui)).toContain("★ BIG WIN +247.51 USDC");
    await ui.press({ key: "share" });

    expect(world.copied).toEqual([
      "Won 247.51 USDC on slots with Tilt while my agent worked · presented by Northwind Cloud",
    ]);
    await ui.unmount();

    // The band keeps its rows: no banner there.
    expect(await shownText(await $.ui.mount({ plugin: PLUGIN, ...BAND }))).not.toContain("BIG WIN");
  });

  test("a small win gets no banner: slots' ×5 neither, loud for someone coding", async ($, on) => {
    const { show } = await moving($, on, SLOTS);
    const slots = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await shownText(slots)).not.toContain("BIG WIN");
    await slots.unmount();
    await show(BLACKJACK_WIN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await shownText(ui)).not.toContain("BIG WIN");
    expect(await ui.find({ key: "share" })).toBeUndefined();
  });

  test("the bet and the hands are steppers, and still step", async ($, on) => {
    await seat($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("◂bet 0.50▸");
    await ui.press({ key: "bet-up" });
    await ui.press({ key: "hands-up" });

    const text = textOf(await ui.drawn());

    expect(text).toContain("bet 1.00");
    expect(text).toContain("●●○○○○ 2 hands");
  });

  test("the session line counts the rounds settled since the session started, not the ones before", async ($, on) => {
    const { show, clock } = await moving($, on, BLACKJACK_WIN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).not.toContain("session ");

    await show({ ...SLOTS, round: SLOTS.round === null ? null : { ...SLOTS.round, number: 8 } });
    await clock.advance(SPIN_OVER_MS);

    expect(textOf(await ui.drawn())).toContain("session +3.96 · 1 round");
  });

  test("a logout starts the next account's session from zero, its last round not counted", async ($, on) => {
    let current: StateResponse = BASE;
    const { clock } = await seat($, on, BASE, {
      "GET /v1/state": () => ({ status: 200, body: current }),
      "POST /v1/auth/device": () => ({
        status: 200,
        body: {
          deviceCode: "d",
          userCode: "AAAA-BBBB",
          verifyUrl: "https://tilt.example/c",
          expiresIn: 600,
          interval: 1,
        },
      }),
      "POST /v1/auth/device/token": () => ({
        status: 200,
        body: { status: "approved", token: "other-account", expiresAt: "2027-01-01T00:00:00.000Z" },
      }),
    });
    const settled = (state: StateResponse, number: number): StateResponse =>
      state.round === null ? state : { ...state, round: { ...state.round, number } };

    current = settled(SLOTS, 8);
    await clock.advance(POLL_MS);
    await clock.advance(SPIN_OVER_MS);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect(textOf(await ui.drawn())).toContain("session +3.96 · 1 round");

    await $.command.run(command("logout"));
    current = settled(BLACKJACK_WIN, 9);
    await $.command.run(command("login"));
    await clock.advance(POLL_MS);
    await clock.advance(POLL_MS);

    const text = await shownText(ui);

    expect(text).toContain("YOU 19");
    expect(text).not.toContain("session ");
  });

  test("the leaderboard says how far the next rank is", async ($, on) => {
    await seat($, on, BASE);

    expect(textOf(await (await $.ui.mount({ plugin: PLUGIN, ...PANE })).drawn())).toContain(
      "+3.21 to pass @sol (#413)",
    );
  });

  test("a balance under the bet says so before n, with the deposit page on the api's site", async ($, on) => {
    await seat($, on, { ...BASE, balance: "100000" });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect(textOf(await ui.drawn())).toContain("Balance too low for this bet · lower it with v");
    expect(JSON.stringify(await ui.drawn())).toContain("https://tilt.example");
  });

  test("a deposit page off the api's site is not shown", async ($, on) => {
    await seat($, on, { ...BASE, balance: "100000", webUrl: "https://evil.example" });

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect(await shownText(ui)).toContain("Balance too low");
    expect(JSON.stringify(await ui.findAll({ type: "Link" }))).not.toContain("evil.example");
    expect(await shownText(ui)).not.toContain("evil.example");
  });

  test("a deal in flight draws the hands face down at once, and nothing else about them", async ($, on) => {
    const { route } = later();

    await seat($, on, BASE, { "POST /v1/play": route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "hands-up" });
    await ui.press({ key: "start" });
    const text = await shownText(ui);

    expect(text).toContain("#1");
    expect(text).toContain("#2");
    expect(text).toContain("░░░░░");
    expect(text).not.toMatch(/[2-9AJQK]♠/);
  });
});

describe("a one-draw round in flight", () => {
  test("draws its draw to come at once, nothing of the last round's result", async ($, on) => {
    const { route } = later();

    await seat($, on, DICE, { "POST /v1/play": route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect(await shownText(ui)).toContain("Rolled 37.42");
    await ui.press({ key: "start" });
    const text = await shownText(ui);

    expect(text).toContain("rolling…");
    expect(text).toContain("roll under 49.00");
    expect(text).not.toContain("37.42");
    expect(text).not.toContain("+0.99 · fee");
  });

  test("keeps the last paytable while the same count of Keno picks is sent", async ($, on) => {
    const { route } = later();

    await seat($, on, KENO, { "POST /v1/play": route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "keno-random" });
    await ui.press({ key: "start" });
    const text = await shownText(ui);

    expect(text).toContain("drawing…");
    expect(text).toContain("3 ×4.00");
    expect(text).not.toContain("3 hits");
  });
});

describe("tight rooms", () => {
  test(
    "a fullscreen band too short for the table gives way to the compact band, its sponsor in view",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, BLACKJACK_TURN);
      // 100x30 fullscreen: the bottom slot leaves the band about ten rows.
      const band = {
        ...BAND,
        viewport: { columns: 100, rows: 30, isFullscreen: true },
        props: { ...BAND.props, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 9 } },
      };
      const ui = await $.ui.mount({ plugin: PLUGIN, ...band });
      const text = textOf(await ui.drawn());

      expect(await ui.find({ type: "Client" })).toBeUndefined();
      expect(text).toContain("blackjack · you 11 · dealer 9");
      expect(text).toContain("PRESENTED BY Northwind Cloud");
    },
  );

  test(
    "on the main screen the Wheel takes its strip in half the terminal rather than the compact band",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, WHEEL);
      // The band may take the terminal's height there: half of it fits the strip, not a disc.
      const band = {
        ...BAND,
        viewport: { columns: 125, rows: 54, isFullscreen: false },
        props: { ...BAND.props, maxRows: 54, bodyColumns: 120, scroll: { offset: 0, bodyRows: 53 } },
      };
      const ui = await $.ui.mount({ plugin: PLUGIN, ...band });

      expect(wheelLines(await ui.drawn({ in: TABLE_KEY }))).toHaveLength(2);
      expect(textOf(await ui.drawn())).toContain("Northwind Cloud");
    },
  );

  test("a game shown before its first round counts its whole table in a short pane", async ($, on) => {
    // The last round was blackjack: roulette and Mines have none to show, yet draw their table.
    await seat($, on, BLACKJACK_LOSS, {}, { ...LOGGED_IN, onboarded: true });
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      ...PANE_INLINE,
      props: { ...PANE_INLINE.props, bodyColumns: 78, scroll: { offset: 0, bodyRows: 24 } },
    });
    const tileWidths = async () =>
      new Set(
        (await ui.findAll({ type: "Box" }))
          .filter((box) => box.props.backgroundColor === TILE_FILL.hidden)
          .map((box) => box.props.width),
      );

    await ui.press({ key: "game-roulette" });
    const tree = JSON.stringify(await ui.drawn());
    const table = textOf(await ui.drawn({ in: TABLE_KEY }));

    // The keys come first, and the wheel is a row of tiles under the marker, not a framed strip.
    expect(table).toContain("1st 12");
    expect(tree.indexOf("chip on number 0")).toBeGreaterThan(-1);
    expect(tree.indexOf("chip on number 0")).toBeLessThan(tree.indexOf(TABLE_REGION));
    expect(table).not.toContain("▲");

    // Large tiles would push the keys out: the board draws small ones.
    await ui.press({ key: "game-mines" });
    expect(await tileWidths()).toEqual(new Set([4]));
  });

  test("with room, the roulette table keeps its framed wheel and the keys under it", async ($, on) => {
    await seat($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "game-roulette" });
    const tree = JSON.stringify(await ui.drawn());

    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("▲");
    expect(tree.indexOf(TABLE_REGION)).toBeGreaterThan(-1);
    expect(tree.indexOf(TABLE_REGION)).toBeLessThan(tree.indexOf("chip on number 0"));
  });
});

describe("spins", () => {
  test("a slots spin turns the reels, then shows the result: nothing tells it before they stop", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    await ui.press({ key: "game-slots" });
    await show(SLOTS_JACKPOT);
    const spinning = textOf(await ui.drawn());

    expect(spinning).toContain("balance 12.40 USDC");
    expect(spinning).not.toContain("BIG WIN");
    expect(spinning).not.toContain("+247.51");

    await clock.advance(SPIN_OVER_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain("★ BIG WIN +247.51 USDC");
    // The header counts up with the result line.
    await clock.advance(RESULT_MS);
    expect(textOf(await ui.drawn())).toContain("balance 259.91 USDC");
    // Another game's tab shows no banner of it.
    await ui.press({ key: "game-mines" });
    expect(textOf(await ui.drawn())).not.toContain("BIG WIN");
  });

  test("fast reels land in a third of the time; turbo shows the draw at once", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const win = (number: number) => ({
      ...SLOTS,
      balance: "16360000",
      round: SLOTS.round === null ? null : { ...SLOTS.round, number },
    });

    await ui.press({ key: "game-slots" });
    await ui.press({ key: "slots-fast" });
    await show(win(901));
    expect(textOf(await ui.drawn())).not.toContain("session +3.96");
    await clock.advance(SPIN_OVER_MS / 3 + SURFACE_LAG_MS);
    expect(textOf(await ui.drawn())).toContain("session +3.96");

    await ui.press({ key: "slots-turbo" });
    await show(win(902));
    await clock.advance(SURFACE_LAG_MS);
    expect(textOf(await ui.drawn())).toContain("session +7.92");
  });

  test("the band says the pocket and the net only once the wheel lands", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BAND });

    await ui.press({ key: "game-roulette" });
    await show(ROULETTE);
    const spinning = textOf(await ui.drawn());

    expect(spinning).toContain("roulette · red");
    expect(spinning).not.toContain("ball 17");
    expect(spinning).not.toContain("−1.00");

    await clock.advance(SPIN_OVER_MS);
    expect(textOf(await ui.drawn())).toContain("roulette · red · ball 17 · −1.00");
  });

  test("a roulette spin lands the ball, then names the pocket", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await ui.press({ key: "game-roulette" });
    await show(ROULETTE);
    const spinning = textOf(await ui.drawn());

    expect(spinning).toContain("spinning…");
    expect(spinning).not.toContain("17 BLACK");

    // Slowing into the pocket, nearly there: still nothing tells it.
    await clock.advance(ROULETTE_SPIN_MS - 2 * SPIN_FRAME_MS);
    const creeping = textOf(await ui.drawn());

    expect(creeping).toContain("spinning…");
    expect(creeping).not.toContain("17 BLACK");
    expect(creeping.slice(creeping.indexOf("▼"), creeping.indexOf("▲"))).not.toContain("●");
    expect(creeping).not.toContain("Red loses.");

    await clock.advance(SPIN_OVER_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain(" 17 BLACK ");
    expect(landed.slice(landed.indexOf("▼"), landed.indexOf("▲"))).toContain(" ●  ");
  });

  test("the wheel turns steadily while the chain draws, then slows frame by frame into the drawn pocket", () => {
    const frames = Math.ceil(ROULETTE_SPIN_MS / SPIN_FRAME_MS);
    const landing = Array.from({ length: frames + 1 }, (_, frame) => wheelPosition(17, frame * SPIN_FRAME_MS, false));
    const steps = landing.slice(1).map((position, frame) => position - (landing[frame] ?? 0));
    const drawing = [0, 1, 2].map((frame) => wheelPosition(null, frame * SPIN_FRAME_MS, true));
    const drawingSteps = [(drawing[1] ?? 0) - (drawing[0] ?? 0), (drawing[2] ?? 0) - (drawing[1] ?? 0)];
    const paceAt = (isDrawing: boolean) => wheelPosition(17, 1, isDrawing) - wheelPosition(17, 0, isDrawing);

    // Each frame moves the wheel on, never back, and less than the one before.
    expect(steps.every((step) => step >= 0)).toBe(true);
    steps.slice(1).forEach((step, frame) => expect(step).toBeLessThan(steps[frame] ?? 0));
    expect(steps[0] ?? 0).toBeGreaterThan(20 * (steps[steps.length - 1] ?? 0));
    // 17 is the ninth pocket around the wheel from 0: the wheel rests exactly on it.
    expect(landing[frames]).toBe(8);
    // While drawing: the same distance every frame, and the pace the slowing starts at.
    expect(Math.abs((drawingSteps[1] ?? 0) - (drawingSteps[0] ?? 0))).toBeLessThan(1e-9);
    expect(Math.abs(paceAt(false) - paceAt(true))).toBeLessThan(1e-3);
  });

  test("the slots show their pay table, the winning line lit", async ($, on) => {
    await seat($, on, {
      ...SLOTS,
      round: SLOTS.round === null ? null : { ...SLOTS.round, detail: { game: "slots", reels: ["7", "7", "7"] } },
    });
    const text = await shownText(await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE }));

    expect(text).toContain("PAYS × BET");
    expect(text).toContain("7 7 7");
    expect(text).toContain("250");
  });
});

interface Drawn {
  type?: string;
  props?: { color?: string };
  children?: unknown;
}

const nodesOf = (node: unknown): Drawn[] =>
  Array.isArray(node)
    ? node.flatMap(nodesOf)
    : typeof node === "object" && node !== null
      ? [node as Drawn, ...nodesOf((node as Drawn).children)]
      : [];

/** The wheel's drawing: the Box its pointer `▼` heads, the disc's (or the strip's) rows under it. */
function wheelBox(drawn: unknown): Drawn {
  const box = nodesOf(drawn).find(
    (node) => node.type === "Box" && Array.isArray(node.children) && textOf(node.children[0]).trim() === "▼",
  );

  expect(box).toBeDefined();

  return box ?? {};
}

function wheelRowsOf(drawn: unknown): Drawn[] {
  const { children } = wheelBox(drawn);

  return Array.isArray(children) ? (children as Drawn[]) : [];
}

function wheelLines(drawn: unknown): string[] {
  return wheelRowsOf(drawn).map(textOf);
}

/** The color a row draws the cell at `column` in: a half-block's top pixel, or its only one. */
function cellColor(row: Drawn | undefined, column: number): string | undefined {
  const pieces = [row?.children].flat(Number.POSITIVE_INFINITY);
  let at = 0;

  for (const piece of pieces) {
    at += textOf(piece).length;

    if (column < at) {
      return typeof piece === "object" && piece !== null ? (piece as Drawn).props?.color : undefined;
    }
  }

  return undefined;
}

/** Every color a disc's cells are drawn in. */
const discColors = (rows: Drawn[]): Set<string | undefined> =>
  new Set(rows.flatMap((row) => nodesOf(row.children).map((node) => node.props?.color)));

/** Fifty segments at high risk, landed on the last: the one that pays ×49.00. */
const WHEEL_HIGH_50: StateResponse =
  WHEEL.round === null
    ? WHEEL
    : {
        ...WHEEL,
        round: {
          ...WHEEL.round,
          payout: "24500000",
          fee: "240000",
          net: "23760000",
          detail: {
            game: "wheel",
            segments: 50,
            risk: "high",
            multipliers: [...Array.from({ length: 49 }, () => "0.00"), "49.00"],
            segment: 49,
          },
        },
      };

describe("one draw plays out before the result shows", () => {
  test("the header balance waits for the result, then counts up with its line, never ahead of it", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });
    const header = async () => textOf(await ui.drawn()).split("rank")[0] ?? "";

    await ui.press({ key: "game-dice" });
    await show({ ...DICE, balance: "13390000" });
    // Landed, and the table surface module a beat behind: the balance before it still shows.
    await clock.advance(DICE_ROLL_MS);
    expect(await header()).toContain("balance 12.40 USDC");
    expect(textOf(await ui.drawn())).not.toContain("Rolled 37.42");
    // The net counts up first: the balance after it.
    await clock.advance(SURFACE_LAG_MS + RESULT_MS / 3);
    expect(await header()).toContain("balance 12.40 USDC");
    await clock.advance(RESULT_MS);
    expect(await header()).toContain("balance 13.39 USDC");
  });

  const hasSparkles = (text: string) => /[✦✧✺✹⋆]/.test(text);

  test("a dice roll tumbles, rests on the roll, then the verdict, the balance and the sparkles show", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });
    const untold = (text: string) => {
      expect(text).toContain("rolling ");
      expect(text).toContain("balance 12.40 USDC");
      expect(text).not.toContain("Rolled 37.42");
      expect(text).not.toContain("WIN");
      expect(text).not.toContain("+0.99");
      expect(hasSparkles(text)).toBe(false);
    };

    await ui.press({ key: "game-dice" });
    await show({ ...DICE, balance: "13390000" });
    const first = textOf(await ui.drawn());

    untold(first);
    await clock.advance(SPIN_FRAME_MS);
    expect(textOf(await ui.drawn())).not.toBe(first);

    // Closing in on the roll, nearly there: still nothing tells it.
    await clock.advance(DICE_ROLL_MS - 4 * SPIN_FRAME_MS);
    untold(textOf(await ui.drawn()));

    await clock.advance(3 * SPIN_FRAME_MS + SURFACE_LAG_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain("rolled 37.42 WIN");
    expect(landed).toContain("Rolled 37.42: under 49.00 wins. +");
    expect(landed).toContain("balance 12.40");
    expect(hasSparkles(landed)).toBe(true);
    // The win counts up, as on the moving table.
    await clock.advance(RESULT_MS);
    expect(textOf(await ui.drawn())).toContain("Rolled 37.42: under 49.00 wins. +0.99");
  });

  test("the roll tumbles across the track, then closes in on the drawn one", () => {
    const tumbling = [0, 1, 2, 3].map((frame) => rollAt(null, frame * SPIN_FRAME_MS));
    const settling = [600, 800, 950].map((elapsed) => Math.abs((rollAt(3742, elapsed) ?? 0) - 3742));

    expect(new Set(tumbling).size).toBe(tumbling.length);
    settling.slice(1).forEach((gap, index) => expect(gap).toBeLessThanOrEqual(settling[index] ?? 0));
    expect(settling[settling.length - 1]).toBeLessThan(10);
    expect(rollAt(3742, DICE_ROLL_MS)).toBe(3742);
    expect(rollAt(3742, null)).toBe(3742);
  });

  test("the limbo multiplier rises from ×1.00 by ratios and stops on the result, never past it", async ($, on) => {
    const rise = Array.from({ length: LIMBO_RISE_MS / SPIN_FRAME_MS + 1 }, (_, frame) =>
      Number(limboAt("312.00", frame * SPIN_FRAME_MS)),
    );

    expect(rise[0]).toBe(1);
    rise.slice(1).forEach((value, frame) => expect(value).toBeGreaterThanOrEqual(rise[frame] ?? 0));
    expect(rise.every((value) => value <= 312)).toBe(true);
    expect(rise[rise.length - 1]).toBe(312);
    // Halfway through, past halfway in ratios: the slowing is at the end.
    expect(rise[LIMBO_RISE_MS / SPIN_FRAME_MS / 2] ?? 0).toBeGreaterThan(Math.sqrt(312));

    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await ui.press({ key: "game-limbo" });
    await show(LIMBO);
    const rising = textOf(await ui.drawn());

    expect(rising).toContain("rising…");
    expect(rising).not.toContain("falls short");
    expect(rising).not.toContain("LOSE");

    await clock.advance(LIMBO_RISE_MS + SURFACE_LAG_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain("×1.53");
    expect(landed).toContain("LOSE");
    expect(landed).toContain("×1.53 falls short of ×2.00. −1.00");
  });

  test("the coins land one by one up to the first off the call, which decides the round", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });
    const missFirst: StateResponse = {
      ...FLIP_LOSS,
      round:
        FLIP_LOSS.round === null
          ? null
          : {
              ...FLIP_LOSS.round,
              detail: {
                game: "flip",
                side: "heads",
                flips: 3,
                results: ["tails", "heads", "heads"],
                multiplier: "7.8400",
              },
            },
    };

    await ui.press({ key: "game-flip" });
    await ui.press({ key: "flips-up" });
    await ui.press({ key: "flips-up" });
    await show(numbered(missFirst, 21));
    expect(textOf(await ui.drawn())).not.toContain("Tails on coin 1 of 3.");
    // The first coin decides: its landing ends the flip, the two after it show with it.
    await clock.advance(
      flipMs(missFirst.round?.detail.game === "flip" ? missFirst.round.detail : FLIP_DETAIL) + SURFACE_LAG_MS,
    );
    const missed = textOf(await ui.drawn());

    expect(missed).toContain("(T)(H)(H)");
    expect(missed).toContain("Tails on coin 1 of 3. −1.00");
  });

  test("three heads called take all three coins to land", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await ui.press({ key: "game-flip" });
    await ui.press({ key: "flips-up" });
    await ui.press({ key: "flips-up" });
    await show(FLIP);
    await clock.advance(flipMs(FLIP_DETAIL) - 3 * SPIN_FRAME_MS);
    expect(textOf(await ui.drawn())).not.toContain("3 heads in a row.");
    await clock.advance(3 * SPIN_FRAME_MS + SURFACE_LAG_MS);
    expect(textOf(await ui.drawn())).toContain("3 heads in a row. +");
    await clock.advance(RESULT_MS);
    expect(textOf(await ui.drawn())).toContain("3 heads in a row. +5.77");
  });

  test("the ten Keno numbers light one by one, the hits counting up, then the paytable's row", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await ui.press({ key: "game-keno" });
    // 1, 4, 8, 12, 15, 22, 27… are drawn in turn; 4, 12 and 27 are picks.
    await show(KENO);
    expect(textOf(await ui.drawn())).toMatch(/picks[01] hits?/);
    await clock.advance(SPIN_FRAME_MS);
    expect(textOf(await ui.drawn())).toMatch(/picks[12] hits?/);
    await clock.advance(SPIN_FRAME_MS);
    const counting = textOf(await ui.drawn());

    expect(counting).toContain("2 hits");
    expect(counting).not.toContain("3 hits of 5 picks.");
    expect(counting).not.toContain("+2.97");

    await clock.advance(KENO_DRAW_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain("3 hits WIN");
    expect(landed).toContain(" 3 ×4.00 ");
    expect(landed).toContain("3 hits of 5 picks. +");
    await clock.advance(RESULT_MS);
    expect(textOf(await ui.drawn())).toContain("3 hits of 5 picks. +2.97");
  });

  test("a choice changed after a round drops its result and its sentence together", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await ui.press({ key: "game-dice" });
    await show(DICE);
    await clock.advance(DICE_ROLL_MS + SURFACE_LAG_MS);
    expect(textOf(await ui.drawn())).toContain("Rolled 37.42: under 49.00 wins.");

    await ui.press({ key: "dice-up" });
    const changed = textOf(await ui.drawn());

    expect(changed).toContain("No roll yet.");
    expect(changed).not.toContain("Rolled 37.42");
    expect(changed).not.toContain("+0.99 · fee");

    await ui.press({ key: "dice-down" });
    expect(textOf(await ui.drawn())).toContain("Rolled 37.42: under 49.00 wins.");
  });
});

describe("the wheel", () => {
  const hasSparkles = (text: string) => /[✦✧✺✹⋆]/.test(text);
  const DARK_LINE4 = "#4a4b50";
  const DARK_GOLD = "#f1c45e";
  const PART_BACK = "#8a4a4a";
  const DARK_BLUE = "#7fa8f2";
  const DARK_TEAL = "#5ccbc2";
  const DARK_HUB = "#f0eee9";
  /** The wide pane's disc: 31 columns across, 16 rows down, its middle column under the pointer. */
  const DISC_ROWS = 16;
  const POINTER = 15;

  test("a disc of colored wedges in a gold rim, the pointer over it, the landed wedge under the pointer", async ($, on) => {
    await seat($, on, WHEEL);
    const drawn = await (await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE })).drawn({ in: TABLE_KEY });
    const [pointer, ...disc] = wheelRowsOf(drawn);
    const text = textOf(drawn);

    expect(disc).toHaveLength(DISC_ROWS);
    expect(textOf(pointer).indexOf("▼")).toBe(POINTER);
    // The rim at the top and the bottom under the pointer, the wedge landed on (×1.50) just inside it.
    expect(cellColor(disc[0], POINTER)).toBe(DARK_GOLD);
    expect(cellColor(disc[DISC_ROWS - 1], POINTER)).toBe(DARK_GOLD);
    expect(cellColor(disc[1], POINTER)).toBe(DARK_TEAL);
    expect(cellColor(disc[DISC_ROWS / 2], POINTER)).toBe(DARK_HUB);
    // Every multiplier's wedges show, colored as the legend says.
    const colors = discColors(disc);

    // ×0.80 gives part of the stake back: a loss, never a win's cool color.
    for (const color of [DARK_LINE4, PART_BACK, DARK_BLUE, DARK_TEAL]) {
      expect(colors.has(color), color).toBe(true);
    }

    // The landed multiplier on its chip beside the disc; one color per multiplier, in the order of what they pay.
    expect(text).toContain(" ×1.50 ");
    expect(text).not.toContain("10 segments · low risk");
    const legend = ["● ×0.00", "● ×0.80", "● ×1.20", "● ×1.50"].map((entry) => text.indexOf(entry));

    expect(legend.every((index, entry) => index > (legend[entry - 1] ?? 0))).toBe(true);
  });

  test("fifty segments are thin wedges with no seams, the landed one under the pointer", async ($, on) => {
    await seat($, on, WHEEL_HIGH_50);
    // Room for the big win's banner and the first-hand guide over the biggest disc.
    const tall = { ...PANE_INLINE, props: { ...PANE_INLINE.props, scroll: { offset: 0, bodyRows: 48 } } };
    const ui = await $.ui.mount({ plugin: PLUGIN, ...tall });
    // The session opened on the last round's fifty segments at high risk: that round is on the table.
    const drawn = await ui.drawn({ in: TABLE_KEY });
    const [, ...disc] = wheelRowsOf(drawn);

    expect(disc).toHaveLength(DISC_ROWS);
    expect(cellColor(disc[1], POINTER)).toBe(DARK_PINK);
    expect([...discColors(disc)].sort()).toEqual([DARK_LINE4, DARK_GOLD, DARK_HUB, DARK_PINK].sort());
    expect(textOf(drawn)).toContain(" ×49.00 ");
    expect(textOf(drawn)).toContain("● ×0.00");
    expect(textOf(drawn)).toContain("● ×49.00");
  });

  test(
    "the disc is the biggest the room fits, whatever card size was chosen",
    { options: { cards: "small" } },
    async ($, on) => {
      await seat($, on, WHEEL);
      const discRows = async (bodyColumns: number, bodyRows: number) => {
        const pane = { ...PANE_INLINE, props: { ...PANE_INLINE.props, bodyColumns, scroll: { offset: 0, bodyRows } } };
        const ui = await $.ui.mount({ plugin: PLUGIN, ...pane });
        const rows = wheelLines(await ui.drawn({ in: TABLE_KEY })).length - 1;

        await ui.unmount();

        return rows;
      };

      // 31 columns across, then 25, then 17: as many half-rows down, under the chrome and the first-hand guide.
      expect(await discRows(120, 40)).toBe(DISC_ROWS);
      expect(await discRows(120, 37)).toBe(13);
      expect(await discRows(120, 33)).toBe(9);
      expect(await discRows(120, 30)).toBe(1);
      // A narrow pane fits the big disc too, given the rows.
      expect(await discRows(70, 42)).toBe(DISC_ROWS);
    },
  );

  test("where no disc fits, a strip of the segments around the pointer", async ($, on) => {
    await seat($, on, WHEEL);
    const pane = {
      ...PANE_INLINE,
      props: { ...PANE_INLINE.props, bodyColumns: 70, scroll: { offset: 0, bodyRows: 20 } },
    };
    const lines = wheelLines(await (await $.ui.mount({ plugin: PLUGIN, ...pane })).drawn({ in: TABLE_KEY }));
    const at = lines[0]?.indexOf("▼") ?? -1;

    expect(lines).toHaveLength(2);
    expect(lines[1]?.slice(at - 2, at + 3)).toBe("×1.50");
  });

  test("the disc turns steadily while the chain draws, then slows frame by frame onto the drawn segment", () => {
    const frames = WHEEL_SPIN_MS / SPIN_FRAME_MS;
    const landing = Array.from({ length: frames + 1 }, (_, frame) =>
      wheelSegmentAt(20, 7, frame * SPIN_FRAME_MS, false),
    );
    // Clockwise: the segment under the pointer counts down.
    const steps = landing.slice(1).map((position, frame) => (landing[frame] ?? 0) - position);
    const drawing = [0, 1, 2].map((frame) => wheelSegmentAt(20, null, frame * SPIN_FRAME_MS, true));
    const paceAt = (isDrawing: boolean) => wheelSegmentAt(20, 7, 0, isDrawing) - wheelSegmentAt(20, 7, 1, isDrawing);

    expect(steps.every((step) => step > 0)).toBe(true);
    steps.slice(1).forEach((step, frame) => expect(step).toBeLessThan(steps[frame] ?? 0));
    expect(steps[0] ?? 0).toBeGreaterThan(20 * (steps[steps.length - 1] ?? 0));
    expect(landing[frames]).toBe(7);
    // Under half a wedge a frame, the drawing loop too: the eye never sees the wedges step backwards.
    expect(steps.every((step) => step < 0.5)).toBe(true);
    expect(Math.abs((drawing[0] ?? 0) - (drawing[1] ?? 0))).toBeLessThan(0.5);
    // The disc turns by fractions of a wedge between frames, not a wedge at a time.
    expect(landing.slice(1, -1).every((position) => !Number.isInteger(position))).toBe(true);
    expect(Math.abs((drawing[0] ?? 0) - (drawing[1] ?? 0) - ((drawing[1] ?? 0) - (drawing[2] ?? 0)))).toBeLessThan(
      1e-9,
    );
    expect(Math.abs(paceAt(false) - paceAt(true))).toBeLessThan(1e-3);
  });

  test("a spin lands before the result, the balance and the celebration show, and the result says it once", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });
    const untold = (text: string) => {
      expect(text).toContain("spinning…");
      expect(text).toContain("10 segments · low risk");
      expect(text).toContain("balance 12.40 USDC");
      expect(text).not.toMatch(/landed on/i);
      expect(text).not.toContain("+0.49");
      expect(hasSparkles(text)).toBe(false);
    };

    await ui.press({ key: "game-page" });
    await show({ ...WHEEL, balance: "12895000" });
    untold(textOf(await ui.drawn()));
    const turning = JSON.stringify(wheelRowsOf(await ui.drawn()));

    await clock.advance(SPIN_FRAME_MS);
    expect(JSON.stringify(wheelRowsOf(await ui.drawn()))).not.toBe(turning);

    // Slowing onto the segment, nearly there: still nothing tells it.
    await clock.advance(WHEEL_SPIN_MS - 3 * SPIN_FRAME_MS);
    untold(textOf(await ui.drawn()));

    await clock.advance(3 * SPIN_FRAME_MS + SURFACE_LAG_MS);
    const drawn = await ui.drawn();
    const landed = textOf(drawn);

    // At rest with the landed wedge (×1.50) under the pointer, its multiplier on the chip.
    expect(cellColor(wheelRowsOf(drawn)[2], POINTER)).toBe(DARK_TEAL);
    expect(landed).toContain(" ×1.50 ");
    expect(landed).not.toContain("10 segments · low risk");

    expect(landed.match(/landed on/gi)).toEqual(["Landed on"]);
    expect(landed).toContain("Landed on ×1.50. +");
    expect(landed).not.toContain("spinning…");
    expect(hasSparkles(landed)).toBe(true);
    await clock.advance(RESULT_MS);
    // A fee under a cent is not said.
    expect(textOf(await ui.drawn())).toContain("Landed on ×1.50. +0.49");
    expect(textOf(await ui.drawn())).not.toContain("fee 0.00");
    expect(textOf(await ui.drawn())).toContain("balance 12.89 USDC");
  });
});

describe("a win celebrates", () => {
  const hasSparkles = (text: string) => /[✦✧✺✹⋆]/.test(text);

  test("fireworks once the reels land on a big win, then the table rests", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await ui.press({ key: "game-slots" });
    await show({ ...SLOTS, balance: "16360000" });
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);

    await clock.advance(SPIN_OVER_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);

    await clock.advance(CELEBRATION_OVER_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
  });

  test("a loss gets none", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const lost =
      SLOTS.round === null ? SLOTS : { ...SLOTS, round: { ...SLOTS.round, net: "-500000", payout: "0", fee: "0" } };

    await ui.press({ key: "game-slots" });
    await show(lost);
    await clock.advance(SPIN_OVER_MS);

    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
  });

  test("a Mines cash-out sparkles, a mine does not", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "game-mines" });
    await show(MINES_TURN);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
    await show(MINES_CASHED);
    await clock.advance(SURFACE_LAG_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);
    await clock.advance(CELEBRATION_OVER_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);

    const next = (state: StateResponse): StateResponse =>
      state.round === null ? state : { ...state, round: { ...state.round, number: 8 } };

    await show(next(MINES_TURN));
    await show(next(MINES_BUSTED));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
  });

  test("the new games celebrate their wins once they show: a dice roll once it rests, a tower cash-out", async ($, on) => {
    // Each show is one poll later: a small win's sparkles are over by the next one.
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });
    const renumbered = (state: StateResponse, number: number): StateResponse =>
      state.round === null ? state : { ...state, round: { ...state.round, number } };

    await ui.press({ key: "game-dice" });
    await show(DICE);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
    await clock.advance(DICE_ROLL_MS + SURFACE_LAG_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);
    await show(renumbered(DICE_LOSS, 8));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);

    await ui.press({ key: "game-page" });
    await ui.press({ key: "game-tower" });
    await show(renumbered(TOWER_TURN, 9));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
    await show(renumbered(TOWER_CASHED, 9));
    await clock.advance(SURFACE_LAG_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);
    await show(renumbered(TOWER_TURN, 10));
    await show(renumbered(TOWER_BUSTED, 10));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
  });

  test("the still Mines board of the main screen shakes on a mine and counts a cash-out up, as blackjack does", async ($, on) => {
    let current: StateResponse = BASE;
    const { clock } = await seat($, on, BASE, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const shakes = (node: unknown): boolean => {
      if (Array.isArray(node)) {
        return node.some(shakes);
      }

      if (typeof node !== "object" || node === null) {
        return false;
      }

      const { props, children } = node as { props?: { paddingLeft?: number }; children?: unknown };

      return (props?.paddingLeft ?? 0) > 0 || shakes(children);
    };
    // Every frame from the next poll on, until the result's effects are over.
    const frames = async (state: StateResponse) => {
      const seen: { isShaken: boolean; text: string }[] = [];

      current = state;

      for (let elapsed = 0; elapsed <= POLL_MS + RESULT_MS; elapsed += SPIN_FRAME_MS) {
        const drawn = await ui.drawn();

        seen.push({ isShaken: shakes(drawn), text: textOf(drawn) });
        await clock.advance(SPIN_FRAME_MS);
      }

      return seen;
    };
    const next = (state: StateResponse): StateResponse =>
      state.round === null ? state : { ...state, round: { ...state.round, number: 8 } };

    await ui.press({ key: "game-mines" });
    expect(await ui.find({ type: "Client" })).toBeUndefined();
    await frames(MINES_TURN);
    const bust = (await frames(MINES_BUSTED)).filter((frame) => frame.text.includes("Mine on h"));

    expect(bust.some((frame) => frame.isShaken)).toBe(true);
    expect(bust.every((frame) => frame.text.includes("Mine on h after 1 safe tile. −1.00"))).toBe(true);
    expect(bust.at(-1)?.isShaken).toBe(false);

    await frames(next(MINES_TURN));
    const cashOut = (await frames(next(MINES_CASHED))).filter((frame) => frame.text.includes("Cashed out"));

    expect(cashOut.some((frame) => frame.isShaken)).toBe(false);
    // Counted up from below to the whole win.
    expect(cashOut[0]?.text).not.toContain("+0.47");
    expect(cashOut.at(-1)?.text).toContain("+0.47");
  });
});

describe("sounds", () => {
  test("off by default", async ($, on) => {
    const { world, show } = await moving($, on, BASE);

    await show(SLOTS);

    expect(world.played).toEqual([]);
  });

  test("a deal and a win, when turned on", { options: { sound: true } }, async ($, on) => {
    const { world, show } = await moving($, on, BASE);

    await show(SLOTS);

    expect(world.played).toEqual(["sounds/deal.wav", "sounds/win.wav"]);
  });
});

describe("the card games tag their result as blackjack does", () => {
  test("baccarat: the bet's verdict once the cards show, NATURAL on a two-card 9", async ($, on) => {
    const coup = (bet: BaccaratView["bet"], net: string, banker: BaccaratView["banker"], points: number) =>
      BACCARAT.round === null
        ? BACCARAT
        : {
            ...BACCARAT,
            round: {
              ...BACCARAT.round,
              net,
              detail: { ...(BACCARAT.round.detail as BaccaratView), bet, banker, bankerPoints: points },
            },
          };
    await seat(
      $,
      on,
      coup(
        "player",
        "-1000000",
        [
          { rank: 9, suit: "♣" },
          { rank: 13, suit: "♦" },
        ],
        9,
      ),
    );
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    expect(textOf(await ui.drawn())).toContain("BANKER 9 WINS NATURAL");
    expect(textOf(await ui.drawn())).toContain("bet player LOSE 1.00");
  });

  test("hilo with small cards shows its history alone, each card once; the guide uses the game's verb", async ($, on) => {
    await seat($, on, HILO_TURN, {}, { session: LOGGED_IN.session });
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      ...PANE_STILL,
      props: { ...PANE_STILL.props, scroll: { offset: 0, bodyRows: 18 } },
    });
    const text = textOf(await ui.drawn());

    expect(text.match(/Q♠/g)).toHaveLength(1);
    expect(text).toContain("n to play");
  });

  test("mines in the band: a board on one line, its hidden tiles the keys, its gems shown", async ($, on) => {
    await seat($, on, MINES_TURN);
    const band = await $.ui.mount({ plugin: PLUGIN, ...BAND });

    expect((await band.find({ key: "mines-tile-0" }))?.props.hotkey).toBe("a");
    expect(textOf(await band.drawn()).match(/◆/g)).toHaveLength(2);
  });

  test("hilo: a bust says so in the band, never a multiplier that reads as a win", async ($, on) => {
    await seat($, on, HILO_BUSTED);
    const band = textOf(await (await $.ui.mount({ plugin: PLUGIN, ...BAND })).drawn());

    expect(band).toContain("hilo · J♦ · wrong guess · −1.00");
    expect(band).not.toContain("×1.06");
  });

  test("blackjack: a hand's WIN or BJ waits for the dealer's hole card", async ($, on) => {
    const { show, clock } = await moving($, on, BLACKJACK_TURN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_STILL });

    await show(BLACKJACK_WIN);
    // The dealer's second card is still face down: no verdict on the hand yet.
    expect(textOf(await ui.drawn())).not.toMatch(/\b(WIN|BJ|LOSE|PUSH) \d/);
    await clock.advance(SPIN_OVER_MS);
    expect(textOf(await ui.drawn())).toMatch(/\b(WIN|BJ) \d/);
  });
});

describe("the result says what won", () => {
  const coup = (bet: BaccaratView["bet"], playerPoints: number, bankerPoints: number): BaccaratView => ({
    game: "baccarat",
    bet,
    player: [],
    banker: [],
    playerPoints,
    bankerPoints,
  });

  test("baccarat: the side that won, the points, and what the bet got", () => {
    expect(baccaratOutcome(coup("banker", 5, 7))).toBe("Banker wins 7 to 5: pays ×1.95.");
    expect(baccaratOutcome(coup("player", 9, 8))).toBe("Player wins 9 to 8: pays ×2.");
    expect(baccaratOutcome(coup("banker", 6, 3))).toBe("Player wins 6 to 3: banker bet loses.");
    expect(baccaratOutcome(coup("tie", 6, 3))).toBe("Player wins 6 to 3: tie bet loses.");
    // A tie pays the tie bet, and gives a player or banker bet back.
    expect(baccaratOutcome(coup("tie", 5, 5))).toBe("Tie at 5: pays ×9.");
    expect(baccaratOutcome(coup("player", 5, 5))).toBe("Tie at 5: player bet returned.");
  });

  test("slots: the line the reels hit and what it pays", () => {
    expect(slotsOutcome(["7", "7", "7"])).toBe("7 7 7 pays ×250.");
    expect(slotsOutcome(["♥", "★", "♥"])).toBe("Two ♥ pay ×4.");
    expect(slotsOutcome(["♥", "♥", "♥"])).toBe("♥ ♥ ♥ pays ×10.");
    expect(slotsOutcome(["7", "7", "★"])).toBe("No line.");
  });
});

describe("the compact band follows the round as the table plays it", () => {
  test("a rise moves, a deal says nothing of its cards, then each says its result and verdict", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BAND });
    const band = async () => textOf(await ui.drawn());

    expect(await band()).toContain("blackjack · no hand yet");
    await ui.press({ key: "game-limbo" });
    expect(await band()).toContain("limbo · no round yet");
    await show(LIMBO);
    expect(await band()).toMatch(/limbo · ×1\.\d\d…/);
    await clock.advance(SPIN_OVER_MS);
    expect(await band()).toContain("×1.53 · −1.00 LOSE");
  });

  test("a baccarat deal says nothing of its cards, then the points, who won and the verdict", async ($, on) => {
    let current: StateResponse = { ...BASE, round: null };
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...BAND });
    const band = async () => textOf(await ui.drawn());

    await ui.press({ key: "game-baccarat" });
    current = BACCARAT;
    await clock.advance(POLL_MS);
    expect(await band()).toContain("baccarat · dealing…");
    expect(await band()).not.toContain("player 5");
    await clock.advance(SPIN_OVER_MS);
    expect(await band()).toContain("baccarat · banker · player 5 · banker 7 WINS · +0.94 WIN");
  });
});

describe("the band never takes what is typed in the prompt", () => {
  test("its tabs take clicks only, so a digit typed first in an empty prompt stays there; m steps the game", async ($, on) => {
    await seat($, on, BASE);
    const band = await $.ui.mount({ plugin: PLUGIN, ...BAND });
    const tab = await band.find({ key: "game-roulette" });

    expect(tab?.props.hotkey ?? "").toBe("");
    expect((await band.find({ key: "game-page" }))?.props.hotkey ?? "").toBe("");
    expect((await band.find({ key: "game-next" }))?.props.hotkey).toBe("m");
    await band.press({ key: "game-next" });
    expect(textOf(await band.drawn())).toContain("roulette · no");
    await band.unmount();

    // A pane takes no key from the prompt: its digits switch games once it has the keys.
    const pane = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect((await pane.find({ key: "game-baccarat" }))?.props.hotkey).toBe("3");
  });

  test("in a Mines round m reveals tile m: the next game then takes a click only", async ($, on) => {
    const round = MINES_TURN.round;
    const hidingM = round?.detail.game === "mines" ? { ...round, detail: { ...round.detail, revealed: [6] } } : null;

    await seat($, on, { ...MINES_TURN, round: hidingM });
    const band = await $.ui.mount({ plugin: PLUGIN, ...BAND });

    expect((await band.find({ key: "mines-tile-12" }))?.props.hotkey).toBe("m");
    expect((await band.find({ key: "game-next" }))?.props.hotkey ?? "").toBe("");
    await band.press({ key: "game-next" });
    expect(textOf(await band.drawn())).toContain("Finish this Mines round before switching game.");
  });
});

describe("the key row keeps its keys in place", () => {
  /** The play keys drawn, in order, live or waiting: their addresses without the waiting prefix. */
  const rowOf = async (ui: Pick<Mounted, "findAll">) =>
    (await ui.findAll({ type: "Button" }))
      .map((button) => String(button.key).replace(/^held-/, ""))
      .filter((key) => !key.startsWith("game-") && !key.startsWith("table-") && key !== "share");

  test("a turn's moves are always drawn: z before any cash-out, s with no skip left, h after a bust", async ($, on) => {
    const { world, show, clock } = await moving($, on, HILO_ACE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect((await ui.find({ key: "held-hilo-cashout" }))?.props.hotkey).toBe("z");
    expect((await ui.find({ key: "held-hilo-skip" }))?.props.hotkey).toBe("s");
    // Pressed, it is swallowed: nothing reaches the prompt, nothing is played.
    await ui.press({ key: "held-hilo-cashout" });
    expect(world.calls("POST /v1/play")).toHaveLength(0);

    await show(HILO_BUSTED);
    await clock.advance(SPIN_OVER_MS);
    const after = await $.ui.mount({ plugin: PLUGIN, ...BAND });

    expect((await after.find({ key: "held-hilo-higher" }))?.props.hotkey).toBe("h");
    expect((await after.find({ key: "held-hilo-lower" }))?.props.hotkey).toBe("l");
  });

  test("while a guess's card turns over, the keys wait in their place and tell nothing of it", async ($, on) => {
    let current = HILO_DRAWING;
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    current = HILO_TURN;
    await clock.advance(FIRST_TICK_MS * 2);
    const turning = textOf(await ui.drawn());

    expect(await ui.find({ key: "held-hilo-higher" })).toBeDefined();
    expect(turning).not.toContain("cash out ·");
    expect(turning).not.toContain("×2.21");

    await clock.advance(SPIN_OVER_MS);
    expect((await ui.find({ key: "hilo-higher" }))?.props.hotkey).toBe("h");
    expect(textOf(await ui.drawn())).toContain("cash out · 1.53");
  });

  test("a draw in flight keeps the row's keys, order and values: Keno, roulette", async ($, on) => {
    const { show } = await moving($, on, KENO);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const idleRow = await rowOf(ui);

    await show(KENO_DRAWING);
    expect(await rowOf(ui)).toEqual(idleRow);
    expect(textOf(await ui.drawn())).toContain("bet 0.50");

    await show(ROULETTE_CHIPS);
    await ui.press({ key: "game-roulette" });
    await ui.press({ key: "roulette-red" });
    const spunRow = await rowOf(ui);

    await show({ ...ROULETTE_CHIPS, pendingIntentId: "elsewhere" });
    expect(await rowOf(ui)).toEqual(spunRow);
  });
});
