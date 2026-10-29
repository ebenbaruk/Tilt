import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StateResponse } from "../../../apps/mod/hooks/protocol";
import { apiBase, trustedVerifyUrl } from "../src/api";
import { TiltSession } from "../src/session";
import type { Saved, Store } from "../src/types";

const API = "http://127.0.0.1:8080";

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
  sponsor: null,
  leaderboard: [],
  rank: null,
  blocked: null,
};

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

/** An answer, a thrown network error, or a promise that never settles (a request in flight). */
type Reply = Response | Error | "hang";
type Route = (sent: Sent) => Reply;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(routes: Record<string, Route>): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const request: Sent = {
      method,
      path: url.pathname,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    const route = routes[`${method} ${url.pathname}`];

    sent.push(request);

    if (route === undefined) {
      return json({ error: { code: "NOT_FOUND", message: "no route" } }, 404);
    }

    const reply = route(request);

    if (reply === "hang") {
      return new Promise<Response>(() => undefined);
    }

    if (reply instanceof Error) {
      throw reply;
    }

    return reply;
  };

  return { fetch: fetchFn, sent };
}

function memoryStore(initial: Saved): Store & { saved: Saved } {
  const store = {
    saved: initial,
    read: async () => store.saved,
    write: async (saved: Saved) => {
      store.saved = saved;
    },
  };

  return store;
}

const intentIdOf = (sent: Sent): unknown =>
  typeof sent.body === "object" && sent.body !== null && "intentId" in sent.body ? sent.body.intentId : undefined;

const plays = (sent: Sent[]): Sent[] => sent.filter((each) => each.path === "/v1/play");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TiltSession", () => {
  it("logs in with a device code, opens the trusted page and keeps the token", async () => {
    let polls = 0;
    const { fetch } = fakeFetch({
      "POST /v1/auth/device": () =>
        json({
          deviceCode: "device-secret",
          userCode: "WDJB-MJHT",
          verifyUrl: "http://127.0.0.1:3000/login?code=WDJB-MJHT",
          expiresIn: 600,
          interval: 1,
        }),
      "POST /v1/auth/device/token": () => {
        polls += 1;

        return polls === 1
          ? json({ status: "pending" })
          : json({ status: "approved", token: "mod-token", expiresAt: "2030-01-01T00:00:00.000Z" });
      },
      "GET /v1/state": () => json(STATE),
    });
    const store = memoryStore({ token: null, prefs: null });
    const openUrl = vi.fn(async (_url: string) => true);
    const session = new TiltSession({ apiUrl: API, store, fetch, openUrl });

    await session.login();

    expect(session.snapshot().auth).toEqual({
      status: "pending",
      userCode: "WDJB-MJHT",
      verifyUrl: "http://127.0.0.1:3000/login?code=WDJB-MJHT",
    });
    expect(openUrl).toHaveBeenCalledWith("http://127.0.0.1:3000/login?code=WDJB-MJHT");

    await vi.advanceTimersByTimeAsync(2_500);

    expect(session.snapshot().auth).toEqual({ status: "in" });
    expect(store.saved.token).toBe("mod-token");
    expect(session.snapshot().state).toEqual(STATE);
    session.stop();
  });

  it("refuses to open a login page off the API's site", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/auth/device": () =>
        json({ deviceCode: "d", userCode: "C", verifyUrl: "https://evil.example/login", expiresIn: 600, interval: 1 }),
    });
    const openUrl = vi.fn(async (_url: string) => true);
    const session = new TiltSession({ apiUrl: API, store: memoryStore({ token: null, prefs: null }), fetch, openUrl });

    await session.login();

    expect(session.snapshot().auth.status).toBe("out");
    expect(openUrl).not.toHaveBeenCalled();
    session.stop();
  });

  it("resends a move with the same intent id after a network failure", async () => {
    let attempts = 0;
    const { fetch, sent } = fakeFetch({
      "GET /v1/state": () => json(STATE),
      "POST /v1/play": (request) => {
        attempts += 1;

        return attempts === 1
          ? new TypeError("fetch failed")
          : json({ intentId: intentIdOf(request), status: "submitted", error: null });
      },
    });
    const session = new TiltSession({ apiUrl: API, store: memoryStore({ token: "mod-token", prefs: null }), fetch });

    session.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(session.press("n")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.snapshot().isBusy).toBe(true);

    await vi.advanceTimersByTimeAsync(1_500);

    const [first, second] = plays(sent);

    expect(plays(sent)).toHaveLength(2);
    expect(intentIdOf(first)).toEqual(expect.any(String));
    expect(intentIdOf(second)).toBe(intentIdOf(first));
    session.stop();
  });

  it("shows a refused move's reason and frees the keys", async () => {
    const { fetch } = fakeFetch({
      "GET /v1/state": () => json(STATE),
      "POST /v1/play": (request) =>
        json({
          intentId: intentIdOf(request),
          status: "failed",
          error: { code: "InsufficientBalance", message: "InsufficientBalance" },
        }),
    });
    const session = new TiltSession({ apiUrl: API, store: memoryStore({ token: "mod-token", prefs: null }), fetch });

    session.start();
    await vi.advanceTimersByTimeAsync(200);
    session.press("n");
    await vi.advanceTimersByTimeAsync(0);

    expect(session.snapshot().message).toEqual({ text: "Not enough balance for this bet.", tone: "loss" });
    expect(session.snapshot().isBusy).toBe(false);
    session.stop();
  });

  it("logs out when the api answers 401", async () => {
    const { fetch } = fakeFetch({
      "GET /v1/state": () => json({ error: { code: "UNAUTHORIZED", message: "token expired" } }, 401),
    });
    const store = memoryStore({ token: "mod-token", prefs: null });
    const session = new TiltSession({ apiUrl: API, store, fetch });
    const changes = vi.fn();

    session.onChange(changes);
    session.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(session.snapshot().auth).toEqual({ status: "out", message: "Session expired · log in to tilt again." });
    expect(store.saved.token).toBeNull();
    expect(changes).toHaveBeenCalled();
    session.stop();
  });

  it("ignores play keys while a move is in flight", async () => {
    const { fetch, sent } = fakeFetch({
      "GET /v1/state": () => json(STATE),
      "POST /v1/play": () => "hang",
    });
    const session = new TiltSession({ apiUrl: API, store: memoryStore({ token: "mod-token", prefs: null }), fetch });

    session.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(session.press("n")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(session.snapshot().isBusy).toBe(true);
    expect(session.press("n")).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(plays(sent)).toHaveLength(1);
    session.stop();
  });

  it("keeps the table choices in the store", async () => {
    const { fetch } = fakeFetch({ "GET /v1/state": () => json(STATE) });
    const store = memoryStore({ token: "mod-token", prefs: null });
    const session = new TiltSession({ apiUrl: API, store, fetch });

    await session.run({ kind: "switch", game: "dice" });
    await session.run({ kind: "dice-over" });
    await vi.advanceTimersByTimeAsync(0);

    expect(store.saved.prefs).toMatchObject({ game: "dice", diceOver: true });

    const next = new TiltSession({ apiUrl: API, store, fetch });

    await next.run({ kind: "hands", step: 1 });
    expect(next.snapshot().prefs).toMatchObject({ game: "dice", diceOver: true });
  });

  it("refuses an insecure api url without throwing", async () => {
    const session = new TiltSession({ apiUrl: "http://tilt.example", store: memoryStore({ token: null, prefs: null }) });

    await session.login();

    expect(session.snapshot().auth.status).toBe("out");
  });

  it("keeps polling after a fetch throws a value that is not an Error", async () => {
    let calls = 0;
    // A value with no prototype even makes `String` throw.
    const fetch = async (): Promise<Response> => {
      calls += 1;

      if (calls === 1) {
        throw Object.create(null);
      }

      return json(STATE);
    };
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    const session = new TiltSession({ apiUrl: API, store: memoryStore({ token: "mod-token", prefs: null }), fetch });

    process.on("unhandledRejection", onRejection);
    session.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(session.snapshot().error).toEqual(expect.any(String));

    await vi.advanceTimersByTimeAsync(6_000);

    expect(session.snapshot().state).toEqual(STATE);
    expect(session.snapshot().error).toBeNull();
    session.stop();
    await vi.advanceTimersByTimeAsync(0);
    process.off("unhandledRejection", onRejection);
    expect(rejections).toEqual([]);
  });

  it("skips a listener that throws and still runs the others and the next tick", async () => {
    let polls = 0;
    const { fetch } = fakeFetch({
      "GET /v1/state": () => {
        polls += 1;

        return json({ ...STATE, balance: String(polls) });
      },
    });
    const session = new TiltSession({ apiUrl: API, store: memoryStore({ token: "mod-token", prefs: null }), fetch });
    const changes = vi.fn();

    session.onChange(() => {
      throw new Error("listener broke");
    });
    session.onChange(changes);
    session.start();
    await vi.advanceTimersByTimeAsync(200);

    expect(changes).toHaveBeenCalled();
    expect(session.snapshot().error).toBeNull();

    await vi.advanceTimersByTimeAsync(5_100);

    expect(polls).toBe(2);
    expect(session.snapshot().state?.balance).toBe("2");
    expect(() => session.setAgent(true)).not.toThrow();
    session.stop();
  });
});

describe("apiBase", () => {
  it("takes https anywhere and plain http only on loopback", () => {
    expect(apiBase("https://api.tilt.xyz/")).toBe("https://api.tilt.xyz");
    expect(apiBase("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(apiBase("http://localhost:8080/")).toBe("http://localhost:8080");
    expect(apiBase("http://[::1]:8080")).toBe("http://[::1]:8080");
    expect(apiBase("http://api.tilt.xyz")).toBeNull();
    expect(apiBase("ftp://api.tilt.xyz")).toBeNull();
    expect(apiBase("not a url")).toBeNull();
    expect(apiBase(42)).toBeNull();
  });
});

describe("trustedVerifyUrl", () => {
  const base = "https://api.tilt.xyz";

  it("allows the API's own host and its parent domain over https", () => {
    expect(trustedVerifyUrl("https://api.tilt.xyz/login", base)).toBe("https://api.tilt.xyz/login");
    expect(trustedVerifyUrl("https://tilt.xyz/login?code=A", base)).toBe("https://tilt.xyz/login?code=A");
  });

  it("refuses other sites, plain http and credentials", () => {
    expect(trustedVerifyUrl("https://evil.xyz/login", base)).toBeNull();
    expect(trustedVerifyUrl("https://tilt.xyz.evil.com/login", base)).toBeNull();
    expect(trustedVerifyUrl("http://tilt.xyz/login", base)).toBeNull();
    expect(trustedVerifyUrl("https://user:pass@tilt.xyz/login", base)).toBeNull();
    // A two-label host has no parent site to share.
    expect(trustedVerifyUrl("https://xyz/login", "https://tilt.xyz")).toBeNull();
  });

  it("treats loopback hosts as one site", () => {
    expect(trustedVerifyUrl("http://localhost:3000/login", "http://127.0.0.1:8080")).toBe("http://localhost:3000/login");
    expect(trustedVerifyUrl("http://example.com/login", "http://127.0.0.1:8080")).toBeNull();
  });
});
