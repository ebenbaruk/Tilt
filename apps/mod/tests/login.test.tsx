import { describe, type Engine, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";

import type { DeviceStartResponse } from "../hooks/protocol";
import { BASE } from "./fixtures";
import { command, NOW, PANE, PLUGIN, SESSION, textOf, TOKEN, worldOf, type Answer } from "./world";

const DEVICE: DeviceStartResponse = {
  deviceCode: "device-secret",
  userCode: "WDJB-MJHT",
  verifyUrl: "https://tilt.example/connect?code=WDJB-MJHT",
  expiresIn: 600,
  interval: 5,
};

/** A logged-out session whose device-token poll answers `tokens` in turn. */
async function loggedOut($: Engine, on: On, tokens: Answer[]) {
  const world = worldOf(on, {
    "POST /v1/auth/device": () => ({ status: 200, body: DEVICE }),
    "POST /v1/auth/device/token": () => tokens.shift() ?? { status: 200, body: { status: "pending" } },
    "GET /v1/state": () => ({ status: 200, body: BASE }),
  });
  const clock = mock.clock(on, { now: NOW });

  mock.store(on);
  await $.session.start(SESSION);

  return { world, clock };
}

const PENDING: Answer = { status: 200, body: { status: "pending" } };
const APPROVED: Answer = { status: 200, body: { status: "approved", token: TOKEN, expiresAt: "2027-01-01T00:00:00Z" } };

describe("/tilt login", () => {
  test("opens the browser, shows the code, polls at the interval, then plays with the token", async ($, on) => {
    const { world, clock } = await loggedOut($, on, [PENDING, APPROVED]);

    const answer = await $.command.run(command("login"));

    expect(answer.text).toBe("Opened https://tilt.example/connect?code=WDJB-MJHT · confirm code WDJB-MJHT there.");
    expect(world.processes).toEqual([["open", DEVICE.verifyUrl]]);

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("Confirm code WDJB-MJHT in your browser");
    expect(await ui.find({ type: "Link" })).toBeDefined();

    await clock.advance(4_000);
    expect(world.calls("POST /v1/auth/device/token")).toEqual([]);
    await clock.advance(1_100);
    expect(world.calls("POST /v1/auth/device/token")).toHaveLength(1);
    expect(world.calls("POST /v1/auth/device/token")[0]?.body).toEqual({ deviceCode: "device-secret" });
    await clock.advance(5_000);
    await clock.advance(200);

    const [poll] = world.calls("GET /v1/state");

    expect(poll?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(textOf(await ui.drawn())).toContain("balance 12.40 USDC");
  });

  test("the login page link stays when the browser cannot be opened", async ($, on) => {
    const { world } = await loggedOut($, on, [PENDING]);

    world.openExitCode = 1;
    const answer = await $.command.run(command("login"));

    expect(answer.text).toBe("Open https://tilt.example/connect?code=WDJB-MJHT and confirm code WDJB-MJHT.");
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect((await ui.find({ type: "Link" }))?.props.href).toBe(DEVICE.verifyUrl);
  });

  test("a login page off the api's site is neither opened nor shown", async ($, on) => {
    const world = worldOf(on, {
      "POST /v1/auth/device": () => ({
        status: 200,
        body: { ...DEVICE, verifyUrl: "https://evil.example/\u001b]8;;x\u0007connect" },
      }),
    });

    mock.clock(on, { now: NOW });
    mock.store(on);
    await $.session.start(SESSION);
    const answer = await $.command.run(command("login"));

    expect(answer.text).toBe("Login failed: the login page the API sent is not on its own site.");
    expect(world.processes).toEqual([]);
    expect(answer.text).not.toContain("evil");
  });

  test("a denied code ends the login with a message", async ($, on) => {
    const { clock } = await loggedOut($, on, [{ status: 200, body: { status: "denied" } }]);

    await $.command.run(command("login"));
    await clock.advance(5_200);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("Login denied · run /tilt login again.");
  });

  // A simulated 11-minute wait: give slow CI runners room.
  test("an expired code stops polling", { timeoutMs: 20_000 }, async ($, on) => {
    const { world, clock } = await loggedOut($, on, []);

    await $.command.run(command("login"));
    // Past the 600 s expiry in a few steps: thousands of 5 s ticks time out on slow CI runners.
    for (let second = 0; second <= 660; second += 60) {
      await clock.advance(60_000);
    }
    const polls = world.calls("POST /v1/auth/device/token").length;

    await clock.advance(30_000);
    expect(world.calls("POST /v1/auth/device/token").length).toBe(polls);

    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("Login code expired · run /tilt login again.");
  });
});

describe("/tilt logout", () => {
  test("forgets the token: the pane asks to log in and nothing is polled", async ($, on) => {
    const world = worldOf(on, { "GET /v1/state": () => ({ status: 200, body: BASE }) });
    const clock = mock.clock(on, { now: NOW });

    mock.store(on, { session: { token: TOKEN, expiresAt: "2027-01-01T00:00:00Z" } });
    await $.session.start(SESSION);
    await clock.advance(200);
    expect(world.calls("GET /v1/state")).toHaveLength(1);

    expect((await $.command.run(command("logout"))).text).toBe("Logged out of tilt.");
    await clock.advance(30_000);

    expect(world.calls("GET /v1/state")).toHaveLength(1);
    const ui = await $.ui.mount({ plugin: PLUGIN, ...PANE });

    expect(textOf(await ui.drawn())).toContain("Run /tilt login");
  });

  test("an expired stored token counts as logged out", async ($, on) => {
    const world = worldOf(on, { "GET /v1/state": () => ({ status: 200, body: BASE }) });
    const clock = mock.clock(on, { now: NOW });

    mock.store(on, { session: { token: TOKEN, expiresAt: "2026-01-01T00:00:00Z" } });
    await $.session.start(SESSION);
    await clock.advance(10_000);

    expect(world.requests).toEqual([]);
  });
});
