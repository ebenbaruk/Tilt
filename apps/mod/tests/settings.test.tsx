import type { ConfigRow, ConfigSetInput } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { BLACKJACK_TURN } from "./fixtures";
import { BAND, command, PANE, PLUGIN, seat, shownText, textOf } from "./world";

const LARGE_CARD_TOP = "╭─────╮";
const SETUP_PANE = { ...PANE, requestId: "tilt-setup" };
/** A band of 30 rows on the main screen of a terminal tall enough for it to take them. */
const BAND_ROOMY = {
  ...BAND,
  viewport: { columns: 125, rows: 80, isFullscreen: false },
  props: { ...BAND.props, maxRows: 30, bodyColumns: 120, scroll: { offset: 0, bodyRows: 29 } },
};

const row = (field: string, value: string | boolean): ConfigRow => ({
  key: `${PLUGIN}.${field}`,
  label: field,
  kind: typeof value === "boolean" ? "boolean" : "choice",
  value,
  provider: { plugin: PLUGIN, tier: "user" },
  isLocked: false,
});

const ROWS = [
  row("apiUrl", "https://api.tilt.example"),
  row("layout", "side"),
  row("cards", "large"),
  row("autoOpen", true),
];

describe("cards fit the room", () => {
  test("large cards where they fit, small ones in a short pane", async ($, on) => {
    await seat($, on, BLACKJACK_TURN);

    const roomy = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const roomyText = await shownText(roomy);

    expect(roomyText).toContain(LARGE_CARD_TOP);
    expect(roomyText).toContain("hit");
    await roomy.unmount();

    const short = await $.ui.mount({
      plugin: PLUGIN,
      ...PANE,
      props: { ...PANE.props, scroll: { offset: 0, bodyRows: 16 } },
    });
    const shortText = await shownText(short);

    expect(shortText).not.toContain(LARGE_CARD_TOP);
    expect(shortText).toContain(" 9♥ ");
    expect(shortText).toContain("hit");
  });

  test("small cards when the person chose them, whatever the room", { options: { cards: "small" } }, async ($, on) => {
    await seat($, on, BLACKJACK_TURN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const text = await shownText(ui);

    expect(text).not.toContain(LARGE_CARD_TOP);
    expect(text).toContain(" 9♥ ");
  });

  test("the pane asks for the rows its cards want", async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN);

    await $.command.run(command());

    expect(world.openedRows[0]).toBeGreaterThanOrEqual(25);
  });
});

describe("where the table sits", () => {
  test(
    "bottom: a turn opens no pane and the band draws the whole table",
    { options: { layout: "bottom" } },
    async ($, on) => {
      const { world } = await seat($, on, BLACKJACK_TURN);

      await $.turn.start({ text: "", turnId: "t1" });
      await $.command.run(command());

      expect(world.opened).toEqual([]);
      const band = await shownText(await $.ui.mount({ plugin: PLUGIN, ...BAND_ROOMY }));

      for (const part of ["DEALER 9 + ?", "▶ YOU 11", "LEADERBOARD", "rtp 99.00%"]) {
        expect(band, part).toContain(part);
      }
    },
  );

  test("compact: a turn opens no pane, /tilt still does", { options: { layout: "compact" } }, async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN);

    await $.turn.start({ text: "", turnId: "t1" });
    expect(world.opened).toEqual([]);

    await $.command.run(command());
    expect(world.opened).toEqual([{ id: "tilt", focus: true }]);
  });

  test("auto-open off: a turn opens no pane", { options: { autoOpen: false } }, async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN);

    await $.turn.start({ text: "", turnId: "t1" });

    expect(world.opened).toEqual([]);
  });

  test("an unknown layout counts as the default", { options: { layout: "upside-down" } }, async ($, on) => {
    const { world } = await seat($, on, BLACKJACK_TURN);

    await $.turn.start({ text: "", turnId: "t1" });

    expect(world.opened).toEqual([{ id: "tilt", focus: false }]);
  });
});

describe("/tilt setup", () => {
  test("previews each choice and saves the one pressed to the mod's own /config rows", async ($, on) => {
    const saved: Pick<ConfigSetInput, "key" | "value">[] = [];

    on("config.set", ($, e) => {
      saved.push({ key: e.key, value: e.value });

      return { value: e.value };
    });
    const { world } = await seat($, on, BLACKJACK_TURN);

    world.configRows = ROWS;
    await $.command.run(command("setup"));
    expect(world.opened).toEqual([{ id: "tilt-setup", focus: true }]);

    const ui = await $.ui.mount({ plugin: PLUGIN, ...SETUP_PANE });
    const text = textOf(await ui.drawn());

    for (const part of [
      "WHERE THE TABLE SITS",
      "Side",
      "Bottom",
      "Compact",
      "CARDS",
      "Large",
      "Small",
      LARGE_CARD_TOP,
      " A♠ ",
    ]) {
      expect(text, part).toContain(part);
    }

    await ui.press({ key: "setup-bottom" });
    await ui.press({ key: "setup-small" });
    await ui.press({ key: "setup-a" });

    expect(saved).toEqual([
      { key: "tilt.layout", value: "bottom" },
      { key: "tilt.cards", value: "small" },
      { key: "tilt.autoOpen", value: false },
    ]);
  });

  test("a refused save says so in a toast and changes nothing else", async ($, on) => {
    const toasts: string[] = [];

    on("config.set", () => ({ deny: "locked by your organization" }));
    on("ui.toast", ($, e) => {
      toasts.push(e.text);

      return { value: undefined };
    });
    const { world } = await seat($, on, BLACKJACK_TURN);

    world.configRows = ROWS;
    await $.command.run(command("setup"));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...SETUP_PANE });

    await ui.press({ key: "setup-compact" });

    expect(toasts).toEqual(["Tilt could not save layout: locked by your organization"]);
  });
});
