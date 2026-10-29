import { describe, expect, it } from "vitest";
import type { RouletteView, RoundView, SlotsView, WheelView } from "../../../apps/mod/hooks/protocol";
import { renderRoulette, renderSlots, renderWheel } from "../src/render/spin";
import { visibleWidth } from "../src/render/style";
import type { Prefs, RenderContext } from "../src/types";

const PREFS: Prefs = {
  game: "roulette",
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
  flips: 1,
  kenoPicks: [4, 12, 19, 27, 35],
  wheelSegments: 10,
  wheelRisk: "low",
  towerDifficulty: "easy",
};
const WIDTHS = [40, 80] as const;

const context = (width: number, prefs: Partial<Prefs> = {}): RenderContext => ({
  color: false,
  width,
  prefs: { ...PREFS, ...prefs },
  now: 0,
});

function round(detail: RoundView["detail"], fields: Partial<RoundView> = {}): RoundView {
  return {
    phase: "idle",
    stake: "1000000",
    payout: "0",
    fee: "0",
    net: "-1000000",
    number: 7,
    settledSignature: null,
    detail,
    ...fields,
  };
}

function expectFits(lines: readonly string[], width: number): void {
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.length).toBeLessThanOrEqual(12);

  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("renderRoulette", () => {
  const spin: RouletteView = {
    game: "roulette",
    bet: { kind: "red" },
    chips: [
      { bet: { kind: "red" }, amount: "1000000" },
      { bet: { kind: "straight", number: 17 }, amount: "500000" },
    ],
    number: 17,
  };

  it.each(WIDTHS)("draws the empty felt within %i columns", (width) => {
    const lines = renderRoulette(null, context(width));
    const text = lines.join("\n");

    expectFits(lines, width);
    expect(text).toContain("No spin yet.");
    expect(text).toContain("No chips on the table yet.");
    expect(text).toContain("36");
    expect(text).toContain("1st 12");
    expect(text).toContain("19–36");
    expect(text).toContain("2:1");
  });

  it.each(WIDTHS)("shows the landed pocket, the chips and the net within %i columns", (width) => {
    const lines = renderRoulette(round(spin, { net: "16500000", payout: "18000000" }), context(width));
    const text = lines.join("\n");

    expectFits(lines, width);
    expect(lines[0]).toBe("17 BLACK");
    expect(text).toContain("1 of 2 bets win. +16.50");
  });

  it("marks the placed chips on their cells and sums them with the max win", () => {
    const chips = [
      { bet: { kind: "straight", number: 17 } as const, amount: "1000000" },
      { bet: { kind: "straight", number: 17 } as const, amount: "1000000" },
      { bet: { kind: "dozen", dozen: 2 } as const, amount: "500000" },
    ];
    const text = renderRoulette(null, context(80, { rouletteChips: chips })).join("\n");

    expect(text).toContain(" 17●");
    expect(text).toContain("2nd 12●");
    expect(text).toContain("on the table 2.50 · 2 bets · max win 71.00");
    expect(text).toContain("17 ●2");
  });

  it("draws the spin's own chips while it is drawing", () => {
    const text = renderRoulette(
      round({ ...spin, number: null }, { phase: "drawing", net: "0" }),
      context(40, { rouletteChips: [] }),
    ).join("\n");

    expect(text).toContain("spinning…");
    expect(text).toContain("RED●");
    expect(text).toContain("on the table 1.50");
  });

  it("puts the columns on their own row under 64 columns", () => {
    expect(renderRoulette(null, context(40)).join("\n")).toContain("2:1 top");
    expect(renderRoulette(null, context(80)).join("\n")).not.toContain("2:1 top");
  });
});

describe("renderWheel", () => {
  const multipliers = ["0.00", "1.20", "1.20", "0.00", "1.50", "1.20", "0.00", "1.20", "1.20", "0.00"];
  const wheel: WheelView = { game: "wheel", segments: 10, risk: "low", multipliers, segment: 4 };

  it.each(WIDTHS)("draws the setup within %i columns", (width) => {
    const lines = renderWheel(null, context(width, { wheelSegments: 30, wheelRisk: "high" }));

    expectFits(lines, width);
    expect(lines.join(" ")).toContain("30 segments · high risk");
    expect(lines.join(" ")).toContain("No spin yet.");
  });

  it.each(WIDTHS)("highlights the landed segment within %i columns", (width) => {
    const lines = renderWheel(round(wheel, { net: "185000", payout: "1500000", fee: "5000" }), context(width));
    const text = lines.join("\n");

    expectFits(lines, width);
    expect(text).toContain("[×1.50 ]");
    expect(text).toContain("▼");
    expect(text).toContain("×0.00 (4)");
    expect(text).toContain("×1.20 (5)");
    expect(text).toContain("Landed on ×1.50. +0.18");
  });

  it("shows the setup, not a settled spin of other segments", () => {
    const text = renderWheel(round(wheel), context(80, { wheelSegments: 20 })).join("\n");

    expect(text).toContain("20 segments");
    expect(text).not.toContain("Landed");
  });
});

describe("renderSlots", () => {
  const slots = (reels: SlotsView["reels"]): SlotsView => ({ game: "slots", reels });

  it.each(WIDTHS)("draws idle reels, the speed and the pay table within %i columns", (width) => {
    const lines = renderSlots(null, context(width, { slotsSpeed: "turbo" }));
    const text = lines.join("\n");

    expectFits(lines, width);
    expect(lines[0]).toContain("[ ♣ | 7 | ◆ ]");
    expect(lines[0]).toContain("speed turbo");
    expect(text).toContain("777 ×250");
    expect(text).toContain("♥♥· ×4");
  });

  it.each(WIDTHS)("shows the drawn reels and the paid line within %i columns", (width) => {
    const lines = renderSlots(
      round(slots(["7", "7", "7"]), { payout: "250000000", net: "246510000" }),
      context(width),
    );

    expectFits(lines, width);
    expect(lines[0]).toContain("[ 7 | 7 | 7 ]");
    expect(lines[1]).toBe("7 7 7 pays ×250. +246.51");
  });

  it("says when no line pays, and hides the reels while they draw", () => {
    expect(renderSlots(round(slots(["7", "◆", "★"])), context(40))[1]).toBe("No line. −1.00");
    expect(renderSlots(round(slots(null), { phase: "drawing" }), context(40))[0]).toContain("[ · | · | · ]");
  });
});
