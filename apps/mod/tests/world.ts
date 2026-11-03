// The world beneath the plugin in tests: the api answered from a route table, and a record of
// everything the plugin asked the engine for.
import type { ConfigRow, HttpResponse, On, RenderInput, SessionStartInput, UiPane } from "claude-code";
import { type Engine, mock, type MockClock, type Mounted } from "claude-code/testing";

import type { PlayRequest, StateResponse } from "../hooks/protocol";
import { TABLE_KEY } from "../hooks/table-input";

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

/** The same pane on the main screen: no clicks nor raw keys there, but the table surface module animates. */
export const PANE_INLINE: RenderInput<"Pane", "terminal"> = {
  ...PANE,
  surface: "terminal",
  viewport: { columns: 180, rows: 48, isFullscreen: false },
  props: { ...PANE.props, placement: "inline" },
};

/** A pane no table surface module draws in (Claude Code Desktop): the still table, moved by the hooks module's clock. */
export const PANE_STILL: RenderInput<"Pane", "desktop"> = { ...PANE_INLINE, surface: "desktop" };

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
/** A route answers at once, or later (a slow api) through a promise the test resolves. */
export type Route = (body: unknown) => Answer | Promise<Answer>;

/** A route that answers only once the test calls `answer`: an api slow to reply. */
export function later(): { route: Route; answer: (value: Answer) => void } {
  let answer: (value: Answer) => void = () => undefined;
  // The mod's tsconfig lib predates Promise.withResolvers.
  const promise = new Promise<Answer>((resolve) => {
    answer = resolve;
  });

  return { route: () => promise, answer: (value) => answer(value) };
}

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
  /** The panes the plugin closed, by id. */
  closed: string[];
  /** What the plugin put on the clipboard. */
  copied: string[];
  /** The sound files the plugin played. */
  played: string[];
  /** What `$.config.list` answers: the `/config` rows, none by default. */
  configRows: ConfigRow[];
  /** The rows each open asked for, in order. */
  openedRows: (number | undefined)[];
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
    openedRows: [],
    configRows: [],
    closed: [],
    copied: [],
    played: [],
    processes: [],
    isPlaced: true,
    isClosed: false,
    openExitCode: 0,
    calls: (route) => world.requests.filter((request) => `${request.method} ${request.path}` === route),
  };

  on("http.fetch", async ($, e) => {
    const url = new URL(e.url);
    const method = e.init?.method ?? "GET";
    const body = e.init?.body === undefined ? undefined : (JSON.parse(e.init.body) as unknown);

    world.requests.push({ method, path: url.pathname, body, authorization: e.init?.headers?.authorization });

    const route = world.routes[`${method} ${url.pathname}`];
    const answer: Answer =
      route === undefined
        ? { status: 404, body: { error: { code: "NOT_FOUND", message: "no route" } } }
        : await route(body);

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
  on("config.list", () => ({ value: world.configRows }));
  on("ui.close", ($, e) => {
    world.closed.push(e.id);
    world.isClosed = true;

    return { value: undefined };
  });
  on("ui.copy", ($, e) => {
    world.copied.push(e.text);

    return { value: { isCopied: true as const } };
  });
  on("audio.play", ($, e) => {
    world.played.push("asset" in e.clip && e.clip.asset !== undefined ? e.clip.asset : "other");

    return { value: undefined };
  });

  on("ui.open", ($, e) => {
    world.opened.push({ id: e.id, focus: e.focus === true });
    world.openedRows.push(e.rows);
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

/** What a mounted drawing shows: its own tree, then the table surface module's when it holds one. */
export async function shownText(ui: Pick<Mounted, "drawn" | "find">): Promise<string> {
  const own = textOf(await ui.drawn());

  return (await ui.find({ type: "Client" })) === undefined ? own : own + textOf(await ui.drawn({ in: TABLE_KEY }));
}

/** A logged-in session whose polls answer `state`, after its first poll. */
export async function seat(
  $: Engine,
  on: On,
  state: StateResponse,
  routes: Record<string, Route> = {},
  stored: Readonly<Record<string, unknown>> = LOGGED_IN,
): Promise<{ world: World; clock: MockClock }> {
  const world = worldOf(on, { "GET /v1/state": () => ({ status: 200, body: state }), ...routes });
  const clock = mock.clock(on, { now: NOW });

  mock.store(on, stored);
  await $.session.start(SESSION);
  await clock.advance(FIRST_TICK_MS);

  return { world, clock };
}

/** The api's state and play routes for a table that shows each move: a submitted play makes the
 * next state `after`, its round renumbered per move, as a new card or round changes it on-chain. */
export function movingTable(start: StateResponse, after: StateResponse): Record<string, Route> {
  let current = start;
  let moves = 0;

  return {
    "GET /v1/state": () => ({ status: 200, body: current }),
    "POST /v1/play": (body) => {
      moves += 1;
      current =
        after.round === null ? after : { ...after, round: { ...after.round, number: after.round.number + moves } };

      return { status: 200, body: { intentId: (body as PlayRequest).intentId, status: "submitted", error: null } };
    },
  };
}
