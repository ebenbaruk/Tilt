import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StateResponse } from "../../../apps/mod/hooks/protocol";
import type * as Core from "../../../packages/play/src/core";
import type { CommandDefinition, CopilotSession, JoinSession } from "../copilot";
import { startTilt } from "../tilt";

const API = "http://127.0.0.1:8080";

// The session's disk and turn file stay in memory: the test never touches ~/.tilt.
vi.mock("../../../packages/play/src/core", async (importOriginal) => {
  const core = await importOriginal<typeof Core>();
  return {
    ...core,
    fileStore: () => ({
      read: async () => ({ token: "mod-token", apiBase: API, prefs: null }),
      write: async () => undefined,
    }),
    writeAgentSignal: async () => undefined,
  };
});

const STATE: StateResponse = {
  accountOpen: true,
  balance: "12400000",
  round: null,
  pendingIntentId: null,
  limits: { minBet: "500000", maxBet: "25000000" },
  rtp: {
    blackjack: "99.00",
    roulette: "97.30",
    baccarat: "98.94",
    slots: "96.16",
    mines: "99.00",
    dice: "98.00",
    limbo: "98.00",
    flip: "98.00",
    keno: "95.00",
    wheel: "98.00",
    hilo: "98.00",
    tower: "98.00",
  },
  sponsor: { name: "Acme", tagline: null, pool: "0", endsAt: "2030-01-01T00:00:00.000Z" },
  leaderboard: [],
  rank: null,
  blocked: null,
};

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TILT_API_URL", API);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Copilot /tilt", () => {
  it("reports no sponsor time while its dialog is open: the dialog never shows the sponsor", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname;
      paths.push(`${init?.method ?? "GET"} ${path}`);
      return path === "/v1/state" ? json(STATE) : json({});
    });

    let command: CommandDefinition | undefined;
    let cancel: (choice: null) => void = () => undefined;
    const copilot: CopilotSession = {
      capabilities: { ui: { elicitation: true } },
      // Executor form: the harnesses target ES2022, whose lib has no Promise.withResolvers.
      ui: { select: () => new Promise((resolve) => (cancel = resolve)) },
      log: async () => undefined,
      on: () => () => undefined,
    };
    const joinSession: JoinSession = async (config) => {
      command = config.commands?.find((each) => each.name === "tilt");
      return copilot;
    };

    await startTilt(joinSession);
    await vi.advanceTimersByTimeAsync(200);

    // The play dialog stays open past a full impression report period, then is cancelled.
    const playing = command?.handler({ args: "" });
    await vi.advanceTimersByTimeAsync(130_000);
    cancel(null);
    await playing;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(paths).toContain("GET /v1/state");
    expect(paths).not.toContain("POST /v1/impressions");
  });
});
