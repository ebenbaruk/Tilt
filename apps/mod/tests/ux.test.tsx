import type { ConfigRow, On, TurnCompleteInput } from "claude-code";
import { describe, type Engine, expect, test } from "claude-code/testing";

import { ROULETTE_SPIN_MS, TILE_FILL, wheelPosition } from "../hooks/games";
import { WHEEL_SPIN_MS, wheelSegmentAt } from "../hooks/quick";
import type { StateResponse } from "../hooks/protocol";
import {
  BASE,
  BLACKJACK_LOSS,
  BLACKJACK_TURN,
  BLACKJACK_WIN,
  DICE,
  DICE_LOSS,
  MINES_BUSTED,
  MINES_CASHED,
  MINES_TURN,
  ROULETTE,
  SLOTS,
  TOWER_BUSTED,
  TOWER_CASHED,
  TOWER_TURN,
  WHEEL,
} from "./fixtures";
import { BAND, command, later, LOGGED_IN, PANE, PANE_INLINE, PLUGIN, seat, shownText, textOf } from "./world";

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

const BAND_ROOMY = {
  ...BAND,
  props: { ...BAND.props, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 29 } },
};

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
    const pane = textOf(await (await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE })).drawn());

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
    const { world } = await seat($, on, SLOTS);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(await shownText(ui)).toContain("★ BIG WIN +3.96 USDC");
    await ui.press({ key: "share" });

    expect(world.copied).toEqual([
      "Won 3.96 USDC on slots with Tilt while my agent worked · presented by Northwind Cloud",
    ]);
  });

  test("a small win gets no banner", async ($, on) => {
    await seat($, on, BLACKJACK_WIN);
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

    const text = textOf(await ui.drawn());

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

    // Inline, so no table surface module carries the whole state in its props.
    const drawn = JSON.stringify(await (await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE })).drawn());

    expect(drawn).toContain("Balance too low");
    expect(drawn).not.toContain("evil.example");
  });

  test("a deal in flight draws the hands face down at once, and nothing else about them", async ($, on) => {
    const { route } = later();

    await seat($, on, BASE, { "POST /v1/play": route });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "hands-up" });
    await ui.press({ key: "start" });
    const text = textOf(await ui.drawn());

    expect(text).toContain("#1");
    expect(text).toContain("#2");
    expect(text).toContain("░░░░░");
    expect(text).not.toMatch(/[2-9AJQK]♠/);
  });
});

describe("tight rooms", () => {
  test(
    "the band at the bottom of a short terminal puts the keys before the table",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, BLACKJACK_TURN);
      const band = {
        ...BAND,
        props: { ...BAND.props, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 11 } },
      };
      const text = textOf(await (await $.ui.mount({ plugin: PLUGIN, ...band })).drawn());

      expect(text.indexOf("hit")).toBeGreaterThan(-1);
      expect(text.indexOf("hit")).toBeLessThan(text.indexOf("DEALER"));
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
    const text = textOf(await ui.drawn());

    // The keys come first, and the wheel is a row of tiles under the marker, not a framed strip.
    expect(text.indexOf("chip on number 0")).toBeGreaterThan(-1);
    expect(text.indexOf("chip on number 0")).toBeLessThan(text.indexOf("1st 12"));
    expect(text).not.toContain("▲");

    // Large tiles would push the keys out: the board draws small ones.
    await ui.press({ key: "game-mines" });
    expect(await tileWidths()).toEqual(new Set([4]));
  });

  test(
    "a band of a few rows shows the keys before the first-hand guide",
    { options: { layout: "bottom" } },
    async ($, on) => {
      await seat($, on, BASE);
      const band = {
        ...BAND,
        props: { ...BAND.props, maxRows: 6, bodyColumns: 75, scroll: { offset: 0, bodyRows: 6 } },
      };
      const text = textOf(await (await $.ui.mount({ plugin: PLUGIN, ...band })).drawn());

      expect(text.indexOf("deal · 0.50")).toBeGreaterThan(-1);
      expect(text.indexOf("deal · 0.50")).toBeLessThan(text.indexOf("First hand?"));
    },
  );

  test("with room, the roulette table keeps its framed wheel and the keys under it", async ($, on) => {
    await seat($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "game-roulette" });
    const text = textOf(await ui.drawn());

    expect(text).toContain("▲");
    expect(text.indexOf("1st 12")).toBeLessThan(text.indexOf("chip on number 0"));
  });
});

describe("spins", () => {
  test("a slots spin turns the reels, then shows the result: nothing tells it before they stop", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const won = { ...SLOTS, balance: "16360000" };

    await show(won);
    const spinning = textOf(await ui.drawn());

    expect(spinning).toContain("balance 12.40 USDC");
    expect(spinning).not.toContain("BIG WIN");
    expect(spinning).not.toContain("+3.96");

    await clock.advance(SPIN_OVER_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain("balance 16.36 USDC");
    expect(landed).toContain("★ BIG WIN +3.96 USDC");
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
    expect(textOf(await ui.drawn())).not.toContain("+3.96");
    await clock.advance(SPIN_OVER_MS / 3);
    expect(textOf(await ui.drawn())).toContain("+3.96");

    await ui.press({ key: "slots-turbo" });
    await show(win(902));
    expect(textOf(await ui.drawn())).toContain("+3.96");
  });

  test("a roulette spin lands the ball, then names the pocket", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

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
    const drawn = await (await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE })).drawn();
    const text = textOf(drawn);

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

describe("the wheel", () => {
  const hasSparkles = (text: string) => /[✦✧✺✹⋆]/.test(text);
  const DARK_LINE4 = "#4a4b50";
  const DARK_GOLD = "#f1c45e";
  const DARK_GREEN = "#7ccd8e";
  const DARK_BLUE = "#7fa8f2";
  const DARK_TEAL = "#5ccbc2";
  const DARK_HUB = "#f0eee9";
  /** The wide pane's disc: 31 columns across, 16 rows down, its middle column under the pointer. */
  const DISC_ROWS = 16;
  const POINTER = 15;

  test("a disc of colored wedges in a gold rim, the pointer over it, the landed wedge under the pointer", async ($, on) => {
    await seat($, on, WHEEL);
    const drawn = await (await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE })).drawn();
    const [pointer, ...disc] = wheelRowsOf(drawn);
    const text = textOf(drawn);

    expect(disc).toHaveLength(DISC_ROWS);
    expect(textOf(pointer).indexOf("▼")).toBe(POINTER);
    // The rim at the top and the bottom under the pointer, the wedge landed on (×1.50) just inside it.
    expect(cellColor(disc[0], POINTER)).toBe(DARK_GOLD);
    expect(cellColor(disc[DISC_ROWS - 1], POINTER)).toBe(DARK_GOLD);
    expect(cellColor(disc[1], POINTER)).toBe(DARK_GREEN);
    expect(cellColor(disc[DISC_ROWS / 2], POINTER)).toBe(DARK_HUB);
    // Every multiplier's wedges show, colored as the legend says.
    const colors = discColors(disc);

    for (const color of [DARK_LINE4, DARK_BLUE, DARK_TEAL, DARK_GREEN]) {
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

    for (const key of ["wheel-up", "wheel-up", "wheel-up", "wheel-up", "wheel-risk", "wheel-risk"]) {
      await ui.press({ key });
    }

    const drawn = await ui.drawn();
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
        const rows = wheelLines(await ui.drawn()).length - 1;

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
    const lines = wheelLines(await (await $.ui.mount({ plugin: PLUGIN, ...pane })).drawn());
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
    // Several laps, starting half a wheel off the drawn segment: the slowing's first frame tells nothing.
    expect((landing[0] ?? 0) - 7).toBeGreaterThanOrEqual(3 * 20);
    expect(Math.round(landing[0] ?? 0) % 20).not.toBe(7);
    // The disc turns by fractions of a wedge between frames, not a wedge at a time.
    expect(landing.slice(1, -1).every((position) => !Number.isInteger(position))).toBe(true);
    expect(Math.abs((drawing[0] ?? 0) - (drawing[1] ?? 0) - ((drawing[1] ?? 0) - (drawing[2] ?? 0)))).toBeLessThan(
      1e-9,
    );
    expect(Math.abs(paceAt(false) - paceAt(true))).toBeLessThan(1e-3);
  });

  test("a spin lands before the result, the balance and the celebration show, and the result says it once", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
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

    await clock.advance(3 * SPIN_FRAME_MS);
    const drawn = await ui.drawn();
    const landed = textOf(drawn);

    // At rest with the landed wedge (×1.50) under the pointer, its multiplier on the chip.
    expect(cellColor(wheelRowsOf(drawn)[2], POINTER)).toBe(DARK_GREEN);
    expect(landed).toContain(" ×1.50 ");
    expect(landed).not.toContain("10 segments · low risk");

    expect(landed.match(/landed on/gi)).toEqual(["Landed on"]);
    expect(landed).toContain("Landed on ×1.50. +0.49 · fee 0.00");
    expect(landed).toContain("balance 12.89 USDC");
    expect(landed).not.toContain("spinning…");
    expect(hasSparkles(landed)).toBe(true);
  });
});

describe("a win celebrates", () => {
  const hasSparkles = (text: string) => /[✦✧✺✹⋆]/.test(text);

  test("fireworks once the reels land on a big win, then the table rests", async ($, on) => {
    const { show, clock } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

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
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);
    await clock.advance(CELEBRATION_OVER_MS);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);

    const next = (state: StateResponse): StateResponse =>
      state.round === null ? state : { ...state, round: { ...state.round, number: 8 } };

    await show(next(MINES_TURN));
    await show(next(MINES_BUSTED));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
  });

  test("the new games celebrate their wins as soon as they show: a dice roll, a tower cash-out", async ($, on) => {
    // Each show is one poll later: a small win's sparkles are over by the next one.
    const { show } = await moving($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const renumbered = (state: StateResponse, number: number): StateResponse =>
      state.round === null ? state : { ...state, round: { ...state.round, number } };

    await ui.press({ key: "game-dice" });
    await show(DICE);
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);
    await show(renumbered(DICE_LOSS, 8));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);

    await ui.press({ key: "game-page" });
    await ui.press({ key: "game-tower" });
    await show(renumbered(TOWER_TURN, 9));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
    await show(renumbered(TOWER_CASHED, 9));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(true);
    await show(renumbered(TOWER_TURN, 10));
    await show(renumbered(TOWER_BUSTED, 10));
    expect(hasSparkles(textOf(await ui.drawn()))).toBe(false);
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
