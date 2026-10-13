// The world beneath the plugin in tests: the api answered from a route table, and a record of
// everything the plugin asked the engine for.
import type { HttpResponse, On, RenderInput, SessionStartInput, UiPane } from "claude-code";
import { type Engine, mock, type MockClock } from "claude-code/testing";

import type { StateResponse } from "../hooks/protocol";

export const PLUGIN = "tilt";
export const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
export const TOKEN = "mod-token-1";

export const LOGGED_IN = { session: { token: TOKEN, expiresAt: "2027-01-01T00:00:00.000Z" } };

/** The background loop's first pass, the state poll included, after a session start. */
export const FIRST_TICK_MS = 200;

export const SESSION: SessionStartInput = { surface: "terminal", isInteractive: true, cwd: "/work" };

export const PANE: RenderInput<"Pane"> = {
  component: "Pane",
  surface: "terminal",
  requestId: "tilt",
  viewport: { columns: 180, rows: 48, isFullscreen: true },
  props: {
    title: "tilt",
    isFocused: true,
    bodyColumns: 120,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
};

export const BAND: RenderInput<"AbovePrompt"> = {
  component: "AbovePrompt",
  surface: "terminal",
  requestId: "band",
  viewport: { columns: 80, rows: 30, isFullscreen: false },
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 6,
    bodyColumns: 75,
    scroll: { offset: 0, bodyRows: 5 },
    view: {},
  },
};

export const command = (args = "") => ({
  command: "tilt",
  args,
  origin: { kind: "composer" as const },
  presentation: { isFullscreen: true, columns: 180 },
});

/** What a route answers: a status and a JSON body, or no answer at all. */
export type Answer = { status: number; body?: unknown } | "offline";
export type Route = (body: unknown) => Answer;

export interface Request {
  method: string;
  path: string;
  body: unknown;
  authorization: string | undefined;
}

export interface World {
  routes: Record<string, Route>;
  requests: Request[];
  opened: { id: string; focus: boolean }[];
  processes: (readonly string[])[];
  /** Whether `$.ui.open` places the pane (a wide terminal) or holds it back (a narrow one). */
  isPlaced: boolean;
  /** What `open <url>` exits with. */
  openExitCode: number;
  /** The person closed the pane: `$.ui.panes()` no longer lists it. */
  isClosed: boolean;
  /** The plugin's requests to one route, by `METHOD /path`. */
  calls: (route: string) => Request[];
}

const respond = (status: number, body: unknown): HttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { "content-type": "application/json" },
  text: body === undefined ? "" : JSON.stringify(body),
});

/** Seats the world beneath the plugin; `routes` are keyed `METHOD /path`. */
export function worldOf(on: On, routes: Record<string, Route> = {}): World {
  const world: World = {
    routes,
    requests: [],
    opened: [],
    processes: [],
    isPlaced: true,
    isClosed: false,
    openExitCode: 0,
    calls: (route) => world.requests.filter((request) => `${request.method} ${request.path}` === route),
  };

  on("http.fetch", ($, e) => {
    const url = new URL(e.url);
    const method = e.init?.method ?? "GET";
    const body = e.init?.body === undefined ? undefined : (JSON.parse(e.init.body) as unknown);

    world.requests.push({ method, path: url.pathname, body, authorization: e.init?.headers?.authorization });

    const route = world.routes[`${method} ${url.pathname}`];
    const answer: Answer =
      route === undefined ? { status: 404, body: { error: { code: "NOT_FOUND", message: "no route" } } } : route(body);

    return answer === "offline" ? { deny: "connect ECONNREFUSED" } : { value: respond(answer.status, answer.body) };
  });

  on("process.run", ($, e) => {
    world.processes.push(e.argv);

    return {
      value: {
        exitCode: world.openExitCode,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });

  on("command.register", ($, e) => ({ value: { command: e.name } }));

  on("ui.open", ($, e) => {
    world.opened.push({ id: e.id, focus: e.focus === true });
    world.isClosed = false;

    return {
      value: world.isPlaced
        ? { isPlaced: true as const }
        : { isPlaced: false as const, reason: "unasked below 144 columns" },
    };
  });

  on("ui.panes", () => {
    const panes: UiPane[] = world.opened.map((pane) => ({
      id: pane.id,
      title: "tilt",
      isShown: world.isPlaced,
      isFocused: false,
      isPlaced: world.isPlaced,
    }));

    return { value: world.isClosed ? [] : panes.slice(0, 1) };
  });

  on("ui.log", () => ({ value: undefined }));
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
  // The engine's own drawing, where the plugin passes.
  on("ui.render", () => ({ type: "Text", children: ["engine"] }));

  return world;
}

/** Every string a drawn tree shows, in document order, labels included. */
export function textOf(node: unknown): string {
  if (typeof node === "string") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }

  if (typeof node !== "object" || node === null) {
    return "";
  }

  const { children } = node as { children?: unknown };

  return textOf(children);
}

/** A logged-in session whose polls answer `state`, after its first poll. */
export async function seat(
  $: Engine,
  on: On,
  state: StateResponse,
  routes: Record<string, Route> = {},
): Promise<{ world: World; clock: MockClock }> {
  const world = worldOf(on, { "GET /v1/state": () => ({ status: 200, body: state }), ...routes });
  const clock = mock.clock(on, { now: NOW });

  mock.store(on, LOGGED_IN);
  await $.session.start(SESSION);
  await clock.advance(FIRST_TICK_MS);

  return { world, clock };
}
