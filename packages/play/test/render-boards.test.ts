import { describe, expect, it } from "vitest";

import { renderKeno, renderMines, renderTower } from "../src/render/boards";
import { renderDice, renderFlip, renderLimbo } from "../src/render/draws";
import { visibleWidth } from "../src/render/style";
import type { Prefs, RenderContext, RoundView } from "../src/types";

const PREFS: Prefs = {
  game: "mines",
  betIndex: 0,
  hands: 1,
  rouletteChips: [],
  rouletteCursor: 0,
  baccarat: "banker",
  slotsSpeed: "normal",
  mines: 3,
  diceChance: 4_900,
  diceOver: false,
  limboTarget: 200,
  flipSide: "heads",
  flips: 3,
  kenoPicks: [4, 12, 19, 27, 35],
  wheelSegments: 10,
  wheelRisk: "low",
  towerDifficulty: "easy",
};

const ctx = (width: number): RenderContext => ({ color: false, width, prefs: PREFS, now: 0 });

const round = (detail: RoundView["detail"], phase: RoundView["phase"], net: string): RoundView => ({
  phase,
  stake: "1000000",
  payout: "0",
  fee: "0",
  net,
  number: 7,
  settledSignature: null,
  detail,
});

const MINES_TURN = round(
  {
    game: "mines",
    mines: 3,
    revealed: [0, 6],
    pending: null,
    busted: null,
    multiplier: "1.2500",
    nextMultiplier: "1.5600",
    canCashOut: true,
    canReveal: true,
  },
  "player_turn",
  "0",
);

const TOWER_BUST = round(
  {
    game: "tower",
    difficulty: "easy",
    tiles: 4,
    levels: 9,
    climbed: [1, 2],
    pending: null,
    busted: 0,
    multiplier: "1.7422",
    nextMultiplier: null,
    canClimb: false,
    canCashOut: false,
  },
  "idle",
  "-1000000",
);

const KENO_HITS = round(
  {
    game: "keno",
    picks: [4, 12, 19, 27, 35],
    drawn: [4, 12, 1, 2, 3, 5, 6, 7, 8, 9],
    hits: 2,
    paytable: ["0.00", "0.00", "1.50", "4.00", "12.00", "50.00"],
  },
  "idle",
  "500000",
);

const DICE_LOSS = round({ game: "dice", target: 4_900, over: false, roll: 7_500, multiplier: "2.0000" }, "idle", "-1000000");

const text = (lines: string[]): string => lines.join("\n");

describe("boards", () => {
  it("draws a mines board mid-round with its keys and cash-out", () => {
    const lines = renderMines(MINES_TURN, ctx(40));

    expect(lines[0]).toMatch(/^◆ b c d e/);
    expect(lines[1]).toMatch(/^f ◆ h i j/);
    expect(text(lines)).toContain("3 mines");
    expect(text(lines)).toContain("now ×1.2500");
    expect(text(lines)).toContain("YOUR TURN");
    expect(text(lines)).toContain("next ×1.5600");
    expect(text(lines)).toContain("z cash out 1.25");
    expect(text(lines)).toContain("2 safe");
  });

  it("draws a busted tower with the mine where it fell", () => {
    const lines = renderTower(TOWER_BUST, ctx(40));

    expect(lines).toHaveLength(9);
    // Bottom level first climbed on tile b, the second on c, the third busted on a.
    expect(lines[8]).toMatch(/· ◆ · ·$/);
    expect(lines[7]).toMatch(/· · ◆ ·$/);
    expect(lines[6]).toContain("✸ · · ·");
    expect(text(lines)).toContain("easy · 3 of 4 safe");
    expect(text(lines)).toContain("now ×0");
    expect(text(lines)).toContain("BUST −1.00");
  });

  it("draws a keno draw with its hits and the landed pay", () => {
    const lines = renderKeno(KENO_HITS, ctx(40));

    expect(lines[0]).toBe("( 1)( 2)( 3)< 4>( 5)( 6)( 7)( 8)( 9) 10 ");
    expect(lines[1]).toContain("<12>");
    expect(lines[1]).toContain("[19]");
    expect(text(lines)).toContain("5 picks · 2 hits WIN +0.50");
    expect(text(lines)).toContain("▸2 ×1.50");
  });
});

describe("draws", () => {
  it("draws a dice loss with the roll past the target", () => {
    const lines = renderDice(DICE_LOSS, ctx(40));

    expect(lines[0]).toBe(`${" ".repeat(30)}▼`);
    expect(lines[1]?.indexOf("┃")).toBe(20);
    expect(lines[1]?.startsWith("━")).toBe(true);
    expect(lines[1]?.endsWith("─")).toBe(true);
    expect(text(lines)).toContain("roll under 49.00 · ×2.00");
    expect(text(lines)).toContain("win chance 49.00%");
    expect(text(lines)).toContain("rolled 75.00  LOSE −1.00");
  });

  it("draws the next round's setup when there is no round", () => {
    expect(text(renderLimbo(null, ctx(40)))).toContain("target ×2.00 · win chance 49.00%");
    expect(text(renderFlip(null, ctx(40)))).toContain("3 × heads (H) pays ×7.84");
  });
});

describe("every table fits", () => {
  const renderers = [renderMines, renderTower, renderKeno, renderDice, renderLimbo, renderFlip];
  const rounds = [null, MINES_TURN, TOWER_BUST, KENO_HITS, DICE_LOSS];

  it.each([40, 80])("in %i columns and 12 lines", (width) => {
    for (const render of renderers) {
      for (const shown of rounds) {
        const lines = render(shown, ctx(width));

        expect(lines.length).toBeLessThanOrEqual(12);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
