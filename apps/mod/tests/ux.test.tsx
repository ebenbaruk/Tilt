import type { ConfigRow, On, TurnCompleteInput } from "claude-code";
import { describe, type Engine, expect, test } from "claude-code/testing";

import type { StateResponse } from "../hooks/protocol";
import { BASE, BLACKJACK_TURN, BLACKJACK_WIN, ROULETTE, SLOTS } from "./fixtures";
import { BAND, command, later, LOGGED_IN, PANE, PANE_INLINE, PLUGIN, seat, shownText, textOf } from "./world";

const POLL_MS = 5_000;
/** Past the longest spin: the wheel and the reels have landed. */
const SPIN_OVER_MS = 1_500;
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

  test("a roulette spin lands the ball, then names the pocket", async ($, on) => {
    const { show, clock } = await moving($, on, { ...BASE, round: null });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "game-roulette" });
    await show(ROULETTE);
    const spinning = textOf(await ui.drawn());

    expect(spinning).toContain("spinning…");
    expect(spinning).not.toContain("17 BLACK");

    await clock.advance(SPIN_OVER_MS);
    const landed = textOf(await ui.drawn());

    expect(landed).toContain(" 17 BLACK ");
    expect(landed).toContain(" ●  ");
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
