import { describe, type Engine, expect, mock, test } from "claude-code/testing";
import type { On, TurnCompleteInput } from "claude-code";

import type { ImpressionRequest } from "../hooks/protocol";
import { BASE, BLACKJACK_TURN } from "./fixtures";
import {
  BAND,
  command,
  FIRST_TICK_MS,
  LOGGED_IN,
  NOW,
  PANE,
  PLUGIN,
  seat,
  SESSION,
  shownText,
  textOf,
  worldOf,
} from "./world";

interface TurnEnd {
  reason?: "answer" | "aborted" | "error";
  durationMs?: number;
  agentId?: string;
}

const turnEnd = ({ reason = "answer", durationMs = 374_000, agentId }: TurnEnd): TurnCompleteInput => ({
  answer: "",
  durationMs,
  isAborted: reason === "aborted",
  turnId: "t1",
  reason,
  ...(agentId === undefined ? {} : { agentId }),
});

describe("the player's choices outlive a restart", () => {
  const KENO_CHOICES = {
    game: "keno",
    betIndex: 2,
    hands: 1,
    baccarat: "banker",
    slotsSpeed: "normal",
    mines: 6,
    kenoPicks: [5, 26, 29, 35, 37],
  };

  test("a new session opens on the game last shown, with its bet and settings, not the last round's", async ($, on) => {
    // The last round played was blackjack: the stored choices win.
    await seat($, on, BASE, {}, { ...LOGGED_IN, prefs: KENO_CHOICES });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const text = textOf(await ui.drawn());

    expect(text).toContain("play · 2.00 · 5 picks");
    await ui.press({ key: "game-mines" });
    expect(textOf(await ui.drawn())).toContain("play · 2.00 · 6 mines");
  });

  test("stored choices of the wrong shape are ignored: the table opens as a first session's", async ($, on) => {
    await seat($, on, BASE, {}, { ...LOGGED_IN, prefs: { game: "poker", betIndex: "high" } });
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("deal · 0.50");
    await ui.press({ key: "bet-up" });
    expect(textOf(await ui.drawn())).toContain("deal · 1.00");
  });
});

describe("the agent comes first", () => {
  test("a turn start opens the pane without the keyboard and shows the agent working", async ($, on) => {
    const { world } = await seat($, on, BASE);

    await $.turn.start({ text: "", turnId: "t1" });

    expect(world.opened).toEqual([{ id: "tilt", focus: false }]);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] agent is working · your move/);
  });

  test("/tilt opens the pane with the keyboard, asked", async ($, on) => {
    const { world } = await seat($, on, BASE);

    await $.command.run(command());

    expect(world.opened).toEqual([{ id: "tilt", focus: true }]);
  });

  test("the turn end says how long the agent took and that the hand is saved", async ($, on) => {
    await seat($, on, BASE);
    await $.turn.start({ text: "", turnId: "t1" });
    await $.turn.complete(turnEnd({}));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });
    const text = textOf(await ui.drawn());

    expect(text).toContain("✓ agent finished in 6m 14s · your hand is saved");
    expect(text).not.toContain("agent is working");
  });

  test("an interrupted turn ends in neutral words", async ($, on) => {
    await seat($, on, BASE);
    await $.turn.start({ text: "", turnId: "t1" });
    await $.turn.complete(turnEnd({ reason: "aborted", durationMs: 31_000 }));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("agent stopped after 31s · your hand is saved");
  });

  test("a subagent's turn end is not the agent finishing", async ($, on) => {
    await seat($, on, BASE);
    await $.turn.start({ text: "", turnId: "t1" });
    await $.turn.complete(turnEnd({ agentId: "sub-1" }));
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("agent is working");
  });

  test("the turn hooks hand the turn on unchanged", async ($, on) => {
    await seat($, on, BASE);

    expect(await $.turn.start({ text: "secret prompt", turnId: "t9" })).toEqual({ turnId: "t9" });
    expect(await $.turn.complete(turnEnd({}))).toEqual({ text: "" });
  });

  test("once the person closes the pane, turns no longer reopen it until /tilt", async ($, on) => {
    const { world, clock } = await seat($, on, BASE);

    await $.turn.start({ text: "", turnId: "t1" });
    await clock.advance(2_000);
    world.isClosed = true;
    await clock.advance(2_000);
    await $.turn.start({ text: "", turnId: "t2" });
    expect(world.opened).toHaveLength(1);

    await $.command.run(command());
    await $.turn.start({ text: "", turnId: "t3" });
    expect(world.opened).toHaveLength(3);
  });

  // Back from Claude Code's agents view (←, then Esc) the session runs in a new process, which
  // Claude Code draws fullscreen: the mod starts over there, and the pane was gone until /tilt.
  /** A session starting over with the pane open, after one played with it `placement`; its band draws once. */
  const startOver = async ($: Engine, on: On, placement: string, isFullscreen: boolean) => {
    const world = worldOf(on, { "GET /v1/state": () => ({ status: 200, body: BLACKJACK_TURN }) });

    const clock = mock.clock(on, { now: NOW });
    mock.store(on, { ...LOGGED_IN, pane: true, placement });
    await $.session.start(SESSION);
    await clock.advance(FIRST_TICK_MS);
    const band = await $.ui.mount({
      plugin: PLUGIN,
      ...BAND,
      viewport: { ...BAND.viewport, columns: 160, rows: 48, isFullscreen },
      props: { ...BAND.props, maxRows: 30, bodyColumns: 160 },
    });
    // The first drawing says what the screen is; the next tick acts on it.
    await clock.advance(FIRST_TICK_MS);

    return { world, band };
  };

  test("a session that left its pane open opens it again at start, without the keyboard", async ($, on) => {
    const { world } = await startOver($, on, "inline", false);

    expect(world.opened).toEqual([{ id: "tilt", focus: false }]);
  });

  test("played under the transcript, a session brought back fullscreen gets the table above the prompt, no side pane", async ($, on) => {
    const { world, band } = await startOver($, on, "inline", true);

    expect(world.opened).toEqual([]);
    expect(await shownText(band)).toContain("DEALER");
  });

  test("a player of the docked pane gets it back docked", async ($, on) => {
    const { world } = await startOver($, on, "dock", true);

    expect(world.opened).toEqual([{ id: "tilt", focus: false }]);
  });

  test("a pane the person closed stays closed in the next session", async ($, on) => {
    const { world, clock } = await seat($, on, BASE);

    await $.turn.start({ text: "", turnId: "t1" });
    await clock.advance(2_000);
    world.isClosed = true;
    await clock.advance(2_000);
    await $.session.start(SESSION);

    expect(world.opened).toHaveLength(1);
  });
});

// Minutes of simulated clock, one engine hop per tick: room for loaded CI runners.
describe("sponsor impressions", () => {
  test("the time the sponsor is on screen is reported at most every 60 s", { timeoutMs: 30_000 }, async ($, on) => {
    const { world, clock } = await seat($, on, BASE, { "POST /v1/impressions": () => ({ status: 204 }) });

    for (let second = 0; second < 130; second += 5) {
      await clock.advance(5_000);
    }

    const reports = world.calls("POST /v1/impressions").map((call) => call.body as ImpressionRequest);

    expect(reports.length).toBe(2);
    for (const report of reports) {
      expect(report.sponsor).toBe("Northwind Cloud");
      expect(report.seconds).toBeGreaterThanOrEqual(1);
      expect(report.seconds).toBeLessThanOrEqual(60);
    }
  });

  test("nothing is reported without a sponsor, or logged out", { timeoutMs: 30_000 }, async ($, on) => {
    const { world, clock } = await seat($, on, { ...BASE, sponsor: null });

    await clock.advance(120_000);
    expect(world.calls("POST /v1/impressions")).toEqual([]);
  });
});

describe("outside an interactive session", () => {
  test("a headless run starts no background loop", async ($, on) => {
    const world = worldOf(on);
    const clock = mock.clock(on, { now: NOW });

    mock.store(on);
    await $.session.start({ ...SESSION, isInteractive: false });
    await clock.advance(10_000);

    expect(world.requests).toEqual([]);
  });
});
