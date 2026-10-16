import { describe, expect, type FoundElement, type Mounted, mock, test } from "claude-code/testing";

import { TILE_FILL } from "../hooks/games";
import type { PlayRequest, StateResponse } from "../hooks/protocol";
import { TABLE_KEY } from "../hooks/table-input";
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
  DICE,
  DICE_DRAWING,
  DICE_LOSS,
  FLIP,
  FLIP_LOSS,
  HILO_ACE,
  HILO_BUSTED,
  HILO_CASHED,
  HILO_DRAWING,
  HILO_KING,
  HILO_TURN,
  KENO,
  KENO_DRAWING,
  LIMBO,
  LIMBO_WIN,
  MINES_BUSTED,
  MINES_CASHED,
  MINES_DRAWING,
  MINES_TURN,
  NOT_OPEN,
  ROULETTE,
  ROULETTE_CHIPS,
  SLOTS,
  SLOTS_DRAWING,
  TOWER_BUSTED,
  TOWER_CASHED,
  TOWER_DRAWING,
  TOWER_TURN,
  WHEEL,
  WHEEL_DRAWING,
} from "./fixtures";
import { BAND, movingTable, NOW, PANE, PANE_INLINE, PLUGIN, seat, SESSION, shownText, textOf, worldOf } from "./world";

/** The tiles of a Mines board or a tower drawn in the pane, or by the table surface module in `scope`. */
async function tilesOf(ui: Pick<Mounted, "findAll">, scope?: string): Promise<FoundElement[]> {
  const fills = new Set<unknown>(Object.values(TILE_FILL).flat());
  const boxes = await ui.findAll(scope === undefined ? { type: "Box" } : { type: "Box", in: scope });

  return boxes.filter((box) => fills.has(box.props.backgroundColor));
}

/** The band is drawn on these two; a pane on every surface. */
const SURFACES = ["terminal", "desktop"] as const;
const PANE_SURFACES = ["desktop", "vscode", "mobile"] as const;

const cases: [string, StateResponse, string[]][] = [
  [
    "blackjack, the player to act",
    BLACKJACK_TURN,
    ["DEALER 9 + ?", "9♥", "░░░░░", "▶ YOU 11", "bet 1.00", "3♣", "8♦", "hit", "stand", "double", "rtp 99.00%"],
  ],
  [
    "blackjack, six hands, the third to act",
    BLACKJACK_SIX_TURN,
    ["DEALER 9 + ?", "#1 20", "#2 21 BLACKJACK", "▶ #3 11", "#4 soft 17", "#5 16", "#6 5", "5♣", "hit", "double"],
  ],
  ["blackjack, a settled win", BLACKJACK_WIN, ["YOU 19", "WIN 1.00", "19 beats 17.", "+0.99", "fee 0.01", "10♠"]],
  ["blackjack, a settled loss", BLACKJACK_LOSS, ["YOU 24 BUST", "LOSE 1.00", "Bust at 24.", "−1.00", "K♣"]],
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
  ["blackjack, a pair to split", BLACKJACK_PAIR, ["▶ YOU 16", "8♠", "8♥", "hit", "double", "split"]],
  [
    "blackjack, ten hands after four splits, a split hand to act",
    BLACKJACK_TEN_TURN,
    [
      "#1 20 10♠ ",
      "#2 soft 20 split",
      "A♠",
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
  [
    "roulette, settled",
    ROULETTE,
    ["No chips on the table yet.", " 17 BLACK ", "Red loses.", "−1.00", " 17 ", "chip ●", "rtp 97.30%"],
  ],
  ["roulette, three chips settled", ROULETTE_CHIPS, [" 17 BLACK ", "2 of 3 chips win.", "+17.91", "BIG WIN"]],
  ["baccarat, settled", BACCARAT, ["bet banker", "PLAYER 5", "BANKER 7", "Player 5 · banker 7.", "+0.94"]],
  ["slots, settled", SLOTS, ["7", "★", "+3.96", "spin · 0.50", "rtp 96.16%"]],
  ["slots, drawing", SLOTS_DRAWING, ["drawing", "PAYS × BET"]],
  [
    "mines, the player to reveal or cash out",
    MINES_TURN,
    ["3 mines", "multiplier ×1.2857", "next tile ×1.4785", "cash out 1.28", "2 safe", "◆", "rtp 99.00%"],
  ],
  ["mines, a reveal drawing", MINES_DRAWING, ["3 mines", "multiplier ×1.1250", "1 safe", "◆"]],
  ["mines, busted", MINES_BUSTED, ["✸", "◆", "Mine on h after 1 safe tile.", "−1.00", "play · 0.50 · 3 mines"]],
  ["mines, cashed out", MINES_CASHED, ["◆", "Cashed out at ×1.4785 after 3 safe tiles.", "+0.47"]],
  [
    "dice, a win under the target",
    DICE,
    [
      "roll under 49.00",
      "win chance 49.00%",
      "multiplier ×2.0000",
      "rolled 37.42",
      "Rolled 37.42: under 49.00 wins.",
      "+0.99",
      "roll · 0.50 · under 49.00",
      "rtp 98.00%",
    ],
  ],
  ["dice, a loss over the target", DICE_LOSS, ["Rolled 12.00: over 75.00 loses.", "−1.00"]],
  ["dice, rolling", DICE_DRAWING, ["rolling…", "drawing"]],
  [
    "limbo, short of the target",
    LIMBO,
    ["×1.53", "target ×2.00", "win chance 49.00%", "×1.53 falls short of ×2.00.", "−1.00", "play · 0.50 · ×2.00"],
  ],
  ["limbo, the target reached", LIMBO_WIN, ["×3.12", "×3.12 reaches ×2.00.", "+0.99"]],
  ["flip, three heads in a row", FLIP, ["3 heads in a row.", "+5.77", "BIG WIN +5.77 USDC", "flip · 0.50 · 1 × heads"]],
  ["flip, a tail", FLIP_LOSS, ["Tails on coin 2 of 2.", "−1.00"]],
  [
    "keno, three hits",
    KENO,
    [
      "[ 4]",
      "[12]",
      "[19]",
      "5 picks",
      "3 hits",
      "HITS",
      "3 ×4.00",
      "3 hits of 5 picks.",
      "+2.97",
      "play · 0.50 · 5 picks",
    ],
  ],
  ["keno, drawing", KENO_DRAWING, ["[ 4]", "drawing…"]],
  [
    "wheel, landed",
    WHEEL,
    [" ×1.50 ", "● ×0.80", "● ×1.50", "Landed on ×1.50.", "+0.49", "spin · 0.50 · 10 segments · low"],
  ],
  ["wheel, spinning", WHEEL_DRAWING, ["10 segments · low risk", "spinning…"]],
  [
    "hilo, the player to guess or cash out",
    HILO_TURN,
    [
      "Q♠ ▼ 9♥ ▼ 5♦",
      "multiplier ×1.5335",
      "higher or same ×2.2151",
      "lower or same ×3.9871",
      "10 skips left",
      "cash out 1.53",
      "2 right",
      "rtp 98.00%",
    ],
  ],
  ["hilo, an ace", HILO_ACE, ["higher ×1.0616", "lower or same ×12.7400", "0 skips left"]],
  ["hilo, a king", HILO_KING, ["higher or same ×12.7400", "lower ×1.0616", "0 skips left"]],
  ["hilo, a card drawing", HILO_DRAWING, ["Q♠ ▼ 9♥ ▲ …", "drawing"]],
  ["hilo, a wrong guess", HILO_BUSTED, ["wrong guess", "Wrong guess after 1 right.", "−1.00", "play · 0.50"]],
  ["hilo, cashed out", HILO_CASHED, ["Cashed out at ×1.5335 after 2 right guesses.", "+0.52"]],
  [
    "tower, the player to climb or cash out",
    TOWER_TURN,
    ["easy · 3 safe of 4", "multiplier ×1.7422", "next level ×2.3229", "cash out 1.74", "2 levels", "×13.0519", "◆"],
  ],
  ["tower, a climb drawing", TOWER_DRAWING, ["multiplier ×1.3066", "1 level", "drawing"]],
  ["tower, a fall", TOWER_BUSTED, ["✸", "◆", "Fell on level 3.", "−1.00", "play · 0.50 · easy"]],
  ["tower, cashed out", TOWER_CASHED, ["Cashed out at ×1.7422 on level 2.", "+0.73"]],
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

    for (const state of [
      BASE,
      BLACKJACK_TURN,
      BLACKJACK_PAIR,
      ROULETTE,
      BACCARAT,
      SLOTS,
      MINES_TURN,
      DICE,
      FLIP,
      KENO,
      WHEEL,
      HILO_TURN,
      TOWER_TURN,
      BLOCKED,
    ]) {
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
    const text = await shownText(ui);

    // Two hands from split aces, one hand from no split.
    expect(text.match(/· 1 card/g)).toHaveLength(2);
  });
});

describe("the Mines board", () => {
  const actionsOf = (calls: { body: unknown }[]) => calls.map((call) => (call.body as PlayRequest).action);

  test("on the main screen its hidden tiles are the keys: a press reveals, the safe ones are not keys", async ($, on) => {
    const { world } = await seat($, on, MINES_TURN, movingTable(MINES_TURN, MINES_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const tile = (index: number) => ui.find({ key: `mines-tile-${index}` });

    expect((await tile(0))?.props.hotkey).toBe("a");
    expect((await tile(24))?.props.hotkey).toBe("y");
    expect(await tile(6)).toBeUndefined();
    expect(await tile(12)).toBeUndefined();
    const tiles = await Promise.all(Array.from({ length: 25 }, (_, index) => tile(index)));

    expect(tiles.filter((found) => found !== undefined)).toHaveLength(23);
    expect(await ui.find({ key: "mines-cashout" })).toBeDefined();

    await ui.press({ key: "mines-tile-0" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "mines_reveal", tile: 0 }]);
  });

  test("a reveal being drawn turns its tile and holds the other tiles' keys, inert", async ($, on) => {
    const { clock } = await seat($, on, MINES_DRAWING);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const glyphs = new Set<string>();

    for (let frame = 0; frame < 8; frame++) {
      const text = textOf(await ui.drawn());

      glyphs.add(text.match(/[◐◓◑◒]/)?.[0] ?? "");
      await clock.advance(200);
    }

    expect(glyphs.has("")).toBe(false);
    expect(glyphs.size).toBeGreaterThan(1);
    expect(await ui.find({ key: "mines-tile-0" })).toBeUndefined();
    expect(await ui.find({ key: "held-mines-tile-0" })).toBeDefined();
    expect(await ui.find({ key: "held-mines-tile-12" })).toBeUndefined();
  });

  test("in the fullscreen pane a click on a tile reveals it, a click on the cash-out takes it", async ($, on) => {
    const { world, clock } = await seat($, on, MINES_TURN, movingTable(MINES_TURN, MINES_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface: "terminal" });

    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("click a tile to reveal it");
    await ui.press({ key: "table-mines-tile-24" });
    await clock.advance(1_000);
    await ui.press({ key: "table-mines-cashout" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "mines_reveal", tile: 24 },
      { type: "mines_cashout" },
    ]);
  });

  test("the board is 25 tiles: hidden ones the keys, gems, the mine and the tile being drawn", async ($, on) => {
    let current: StateResponse = MINES_TURN;
    const { clock } = await seat($, on, current, { "GET /v1/state": () => ({ status: 200, body: current }) });
    const fullscreen = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface: "terminal" });
    const table = await tilesOf(fullscreen, TABLE_KEY);

    expect(table).toHaveLength(25);
    expect(table.filter((tile) => tile.props.backgroundColor === TILE_FILL.safe)).toHaveLength(2);
    // Each hidden tile is a Button, its letter dim in its corner: a click reveals it (the test above).
    const buttons = (await fullscreen.findAll({ type: "Button", in: TABLE_KEY })).filter((button) =>
      String(button.props.key).startsWith("table-mines-tile-"),
    );

    expect(buttons).toHaveLength(23);
    expect(textOf(await fullscreen.find({ key: "table-mines-tile-0", in: TABLE_KEY }))).toMatch(/^a +$/);
    expect(textOf(await fullscreen.find({ key: "table-mines-tile-24", in: TABLE_KEY }))).toMatch(/^y +$/);
    await fullscreen.unmount();

    for (const [state, fill, glyph] of [
      [MINES_BUSTED, TILE_FILL.mine, "✸"],
      [MINES_DRAWING, null, /[◐◓◑◒]/],
    ] as const) {
      current = state;
      await clock.advance(5_000);
      const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
      const tiles = await tilesOf(ui);

      expect(tiles).toHaveLength(25);
      expect(
        tiles.filter((tile) =>
          fill === null
            ? TILE_FILL.pending.some((shade) => shade === tile.props.backgroundColor)
            : tile.props.backgroundColor === fill,
        ),
      ).toHaveLength(1);
      expect(textOf(await ui.drawn())).toMatch(glyph);
      await ui.unmount();
    }
  });
});

describe("the Tower, Hilo and Keno boards", () => {
  const actionsOf = (calls: { body: unknown }[]) => calls.map((call) => (call.body as PlayRequest).action);

  test("on the main screen the next level's tiles are the keys: a press climbs", async ($, on) => {
    const { world } = await seat($, on, TOWER_TURN, movingTable(TOWER_TURN, TOWER_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect((await ui.find({ key: "tower-tile-0" }))?.props.hotkey).toBe("a");
    expect((await ui.find({ key: "tower-tile-3" }))?.props.hotkey).toBe("d");
    expect(await ui.find({ key: "tower-tile-4" })).toBeUndefined();
    expect(await ui.find({ key: "tower-cashout" })).toBeDefined();

    await ui.press({ key: "tower-tile-2" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([{ type: "tower_climb", tile: 2 }]);
  });

  test("the tower is nine levels of tiles, top first, what each pays on its left, the level in play lit", async ($, on) => {
    await seat($, on, TOWER_TURN);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const tiles = await tilesOf(ui);
    const text = textOf(await ui.drawn());

    expect(tiles).toHaveLength(9 * 4);
    expect(tiles.filter((tile) => tile.props.backgroundColor === TILE_FILL.safe)).toHaveLength(2);
    expect(tiles.filter((tile) => tile.props.backgroundColor === TILE_FILL.lit)).toHaveLength(4);
    expect(text.indexOf("×13.0519")).toBeLessThan(text.indexOf("×1.3066"));
  });

  test("a climb being drawn turns its tile and holds the others, inert", async ($, on) => {
    await seat($, on, TOWER_DRAWING);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect(textOf(await ui.drawn())).toMatch(/[◐◓◑◒]/);
    expect(await ui.find({ key: "tower-tile-0" })).toBeUndefined();
    expect(await ui.find({ key: "held-tower-tile-0" })).toBeDefined();
    expect(await ui.find({ key: "held-tower-tile-2" })).toBeUndefined();
  });

  test("in the fullscreen pane a click on a tile climbs, a click on the cash-out takes it", async ($, on) => {
    const { world, clock } = await seat($, on, TOWER_TURN, movingTable(TOWER_TURN, TOWER_TURN));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface: "terminal" });

    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("click a tile to climb");
    await ui.press({ key: "table-tower-tile-1" });
    await clock.advance(1_000);
    await ui.press({ key: "table-tower-cashout" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "tower_climb", tile: 1 },
      { type: "tower_cashout" },
    ]);
  });

  test("hilo: the guesses are keys on the main screen and clicks on the fullscreen table", async ($, on) => {
    const { world, clock } = await seat($, on, HILO_TURN, movingTable(HILO_TURN, HILO_TURN));
    const inline = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect((await inline.find({ key: "hilo-higher" }))?.props.hotkey).toBe("h");
    expect((await inline.find({ key: "hilo-skip" }))?.props.hotkey).toBe("s");
    await inline.press({ key: "hilo-lower" });
    await inline.unmount();
    await clock.advance(1_000);

    const full = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface: "terminal" });

    await full.press({ key: "table-hilo-higher" });
    await clock.advance(1_000);
    await full.press({ key: "table-hilo-cashout" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "hilo_guess", guess: "lower" },
      { type: "hilo_guess", guess: "higher" },
      { type: "hilo_cashout" },
    ]);
  });

  test("keno: on the fullscreen table a click on a number picks or unpicks it, the play carries the picks", async ($, on) => {
    const { world } = await seat($, on, KENO, movingTable(KENO, KENO));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE, surface: "terminal" });

    await ui.press({ key: "table-keno-pick-7" });
    await ui.press({ key: "table-keno-pick-35" });
    await ui.press({ key: "start" });

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      { type: "keno_play", amount: "500000", picks: [4, 7, 12, 19, 27] },
    ]);
  });

  test("keno: on the main screen the numbers are drawn, not keys", async ($, on) => {
    await seat($, on, KENO);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    expect(await ui.find({ key: "keno-pick-7" })).toBeUndefined();
    expect(await ui.find({ key: "keno-random" })).toBeDefined();
  });
});

describe("the roulette layout", () => {
  const actionsOf = (calls: { body: unknown }[]) => calls.map((call) => (call.body as PlayRequest).action);
  const FULLSCREEN = { ...PANE, surface: "terminal" } as const;
  const GOLD = "#f1c45e";
  const DRAWING: StateResponse =
    ROULETTE.round === null
      ? ROULETTE
      : {
          ...ROULETTE,
          round: {
            ...ROULETTE.round,
            phase: "drawing",
            detail: {
              game: "roulette",
              bet: { kind: "red" },
              chips: [{ bet: { kind: "red" }, amount: "1000000" }],
              number: null,
            },
          },
        };

  test("lies under the wheel, the landed pocket and the winning cells lit", async ($, on) => {
    await seat($, on, ROULETTE_CHIPS);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const cellOf = async (cell: string) =>
      JSON.stringify(await ui.find({ key: `table-roulette-${cell}`, in: TABLE_KEY }));

    await ui.press({ key: "game-roulette" });
    const table = textOf(await ui.drawn({ in: TABLE_KEY }));

    for (const cell of ["2:1", "1st 12", "2nd 12", "3rd 12", "1–18", "EVEN", "BLACK", "ODD", "19–36"]) {
      expect(table).toContain(cell);
    }

    // 17 and the second dozen won; red lost, 16 was not played.
    expect(await cellOf("straight-17")).toContain(GOLD);
    expect(await cellOf("dozen-2")).toContain(GOLD);
    expect(await cellOf("red")).not.toContain(GOLD);
    expect(await cellOf("straight-16")).not.toContain(GOLD);
    // Once the table holds the keys, its prompt says the layout takes clicks.
    await ui.pointer({ type: "down", x: 2, y: 1, button: "left" });
    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("click the layout to add a chip");
  });

  test("clicks stack chips on a number, RED, a dozen and a 2:1; undo, spin and clear are buttons", async ($, on) => {
    const { world, clock } = await seat($, on, ROULETTE, movingTable(ROULETTE, ROULETTE));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });
    const table = async () => textOf(await ui.drawn({ in: TABLE_KEY }));

    await ui.press({ key: "game-roulette" });
    expect(await ui.find({ key: "table-start", in: TABLE_KEY })).toBeUndefined();

    for (const cell of ["straight-17", "straight-17", "red", "dozen-1", "column-3"]) {
      await ui.press({ key: `table-roulette-${cell}` });
    }

    expect(await table()).toContain("●1");
    expect(await table()).toContain("on the table 2.50 · 4 chips");
    expect(JSON.stringify(await ui.find({ key: "table-roulette-straight-17", in: TABLE_KEY }))).toContain(GOLD);
    await ui.press({ key: "table-chip-undo" });
    expect(await table()).toContain("on the table 2.00 · 3 chips");
    await ui.press({ key: "table-start" });
    await clock.advance(1_000);
    // The chips stay for the next spin, until cleared.
    expect(await table()).toContain("on the table 2.00 · 3 chips");
    await ui.press({ key: "table-chip-clear" });
    expect(await table()).toContain("No chips on the table yet.");
    expect(await ui.find({ key: "table-start", in: TABLE_KEY })).toBeUndefined();

    expect(actionsOf(world.calls("POST /v1/play"))).toEqual([
      {
        type: "roulette_chips",
        chips: [
          { bet: { kind: "straight", number: 17 }, amount: "1000000" },
          { bet: { kind: "red" }, amount: "500000" },
          { bet: { kind: "dozen", dozen: 1 }, amount: "500000" },
        ],
      },
    ]);
  });

  test("a 21st bet is refused with a word; the 20 already on stay", async ($, on) => {
    await seat($, on, ROULETTE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    await ui.press({ key: "game-roulette" });

    for (let number = 0; number <= 20; number++) {
      await ui.press({ key: `table-roulette-straight-${number}` });
    }

    expect(textOf(await ui.drawn())).toContain("20 bets at most on one spin.");
    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("on the table 10.00 · 20 chips");
  });

  test("is inert while the wheel draws: no cell takes a click", async ($, on) => {
    await seat($, on, DRAWING);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...FULLSCREEN });

    expect(textOf(await ui.drawn({ in: TABLE_KEY }))).toContain("1st 12");
    expect(await ui.find({ key: "table-roulette-straight-17", in: TABLE_KEY })).toBeUndefined();
    expect(await ui.find({ key: "table-roulette-red", in: TABLE_KEY })).toBeUndefined();
    expect(await ui.find({ key: "table-roulette-dozen-1", in: TABLE_KEY })).toBeUndefined();
  });

  test("on the main screen s and d move the cursor, a puts a chip under it and x takes it off", async ($, on) => {
    await seat($, on, BASE);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });
    const text = async () => textOf(await ui.drawn());

    await ui.press({ key: "game-roulette" });
    expect((await ui.find({ key: "cursor-up" }))?.props.hotkey).toBe("d");
    expect(await ui.find({ key: "roulette-straight-17" })).toBeUndefined();
    await ui.press({ key: "cursor-up" });
    expect(await text()).toContain("on number 1");
    await ui.press({ key: "cursor-down" });
    await ui.press({ key: "cursor-down" });
    expect(await text()).toContain("on column 3");

    for (let press = 0; press < 6; press++) {
      await ui.press({ key: "cursor-down" });
    }

    expect(await text()).toContain("on number 36");
    await ui.press({ key: "chip-add" });
    expect(await text()).toContain("●.5");
    expect(await text()).toContain("spin · 0.50 · 1 chip");
    await ui.press({ key: "chip-remove" });
    expect(await text()).toContain("No chips on the table yet.");
    expect(await ui.find({ key: "start" })).toBeUndefined();
  });

  test("the balance short of the chips is said before n", async ($, on) => {
    await seat($, on, { ...BASE, balance: "700000" });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE_INLINE });

    await ui.press({ key: "game-roulette" });
    await ui.press({ key: "roulette-red" });
    expect(textOf(await ui.drawn())).not.toContain("Balance too low");
    await ui.press({ key: "roulette-black" });
    expect(textOf(await ui.drawn())).toContain("Balance too low for these chips");
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
