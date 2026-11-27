// The Claude Code mod's own pane (apps/mod/hooks/view.tsx), drawn by the term renderer for one
// fixture per game, at two widths and both card sizes.
import { beforeAll, describe, expect, test, vi } from "vitest";

import { isStateResponse } from "../../../apps/mod/hooks/guards";
import { prefsView } from "../../../apps/mod/hooks/model";
import type { Game, StateResponse } from "../../../apps/mod/hooks/protocol";
import type { Ui } from "../../../apps/mod/hooks/theme";
import { type PaneLayout, renderPane, type Snapshot } from "../../../apps/mod/hooks/view";
import { renderLines, termUi, withJsx } from "../src/term/index";
import { stringWidth } from "../src/term/width";

// The mod's fixtures take their clock from its test world, which loads Claude Code's test kit.
vi.mock("claude-code/testing", () => ({ mock: {} }));

const WIDTHS = [80, 120] as const;
const SIZES = ["large", "small"] as const;
const FIXTURE_OF: Record<Game, string> = {
  blackjack: "BLACKJACK_TURN",
  roulette: "ROULETTE_CHIPS",
  baccarat: "BACCARAT",
  slots: "SLOTS",
  mines: "MINES_TURN",
  dice: "DICE",
  limbo: "LIMBO_WIN",
  flip: "FLIP",
  keno: "KENO",
  wheel: "WHEEL",
  hilo: "HILO_TURN",
  tower: "TOWER_TURN",
};

let fixtures: Record<string, unknown> = {};
/** The fixtures' clock (apps/mod/tests/world.ts `NOW`): countdowns are drawn from it. */
let now = 0;

beforeAll(async () => {
  // Computed paths: the mod's test modules stay out of the type check, which cannot see Claude
  // Code's test kit.
  const tests = "../../../apps/mod/tests";
  fixtures = (await import(/* @vite-ignore */ `${tests}/fixtures`)) as Record<string, unknown>;
  const world = (await import(/* @vite-ignore */ `${tests}/world`)) as Record<string, unknown>;

  if (typeof world.NOW !== "number") {
    throw new Error("apps/mod/tests/world.ts has no NOW");
  }

  now = world.NOW;
});

function stateOf(game: Game): StateResponse {
  const state = fixtures[FIXTURE_OF[game]];

  if (!isStateResponse(state)) {
    throw new Error(`fixture ${FIXTURE_OF[game]} is not a StateResponse`);
  }

  return state;
}

function snapshotOf(game: Game, state: StateResponse): Snapshot {
  return {
    auth: { status: "in" },
    remote: { state, error: null, fetchedAt: now },
    prefs: prefsView({ game, betIndex: 0, hands: 1, baccarat: "banker", slotsSpeed: "normal" }),
    intent: null,
    message: null,
    agent: { isWorking: false, frame: 0, notice: null },
    session: { net: "0", rounds: 0, startedAt: null, lastRound: null },
    isOnboarded: true,
    depositUrl: null,
    spinElapsed: null,
    revealed: null,
    heldBalance: null,
    resultElapsed: null,
  };
}

function render(game: Game, width: number, cards: "large" | "small"): string[] {
  const layout: PaneLayout = {
    bodyColumns: width,
    bodyRows: 40,
    isFocused: true,
    cards,
    isClickable: false,
    isBand: false,
  };
  return withJsx(() =>
    renderLines(
      renderPane(termUi as unknown as Ui, snapshotOf(game, stateOf(game)), layout, () => {}, null),
      {
        width,
        color: false,
      },
    ),
  );
}

describe("the mod's pane drawn by term", () => {
  const games = Object.keys(FIXTURE_OF) as Game[];

  for (const game of games) {
    for (const width of WIDTHS) {
      for (const size of SIZES) {
        test(`${game} at ${width} columns, ${size} cards`, () => {
          const lines = render(game, width, size);

          expect(lines.length).toBeGreaterThan(5);
          expect(lines.join("")).not.toContain("\x1b");

          for (const line of lines) {
            expect(stringWidth(line)).toBe(width);
          }

          expect(lines.join("\n")).toContain(game === "hilo" ? "Hilo" : game.charAt(0).toUpperCase() + game.slice(1));
        });
      }
    }
  }

  test("blackjack's large cards are drawn as framed cards, small ones on one row", () => {
    const large = render("blackjack", 80, "large").join("\n");
    const small = render("blackjack", 80, "small").join("\n");

    expect(large).toContain("╭─────╮");
    expect(large).toContain("╰─────╯");
    expect(small).not.toContain("╭─────╮");
    expect(small).toContain("9♥");
    // The keys show their letters, as Claude Code draws a Button's hotkey.
    expect(large).toContain("h: hit");
  });

  test("the roulette felt shows its numbers and columns", () => {
    const felt = render("roulette", 120, "large").join("\n");

    for (const number of ["0", "3", "18", "34", "36", "2:1"]) {
      expect(felt).toContain(number);
    }
  });
});
