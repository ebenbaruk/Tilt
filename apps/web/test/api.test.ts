import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, toApiError } from "@/lib/api";
import { approveFailure, parseUserCode, stepFor, type ApproveStep } from "@/lib/device";
import { describeError } from "@/lib/errors";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("toApiError", () => {
  it("keeps the code and message of a well-formed ErrorBody", () => {
    const error = toApiError(409, { error: { code: "PLAYER_BUSY", message: "One intent at a time." } });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "PLAYER_BUSY", message: "One intent at a time.", status: 409 });
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [422, "INVALID_REQUEST"],
    [502, "INTERNAL_ERROR"],
  ])("falls back on the HTTP status %i when the body is unusable", (status, code) => {
    expect(toApiError(status, "<html>bad gateway</html>").code).toBe(code);
  });

  it("ignores codes outside the contract", () => {
    expect(toApiError(400, { error: { code: "DROP_TABLES", message: "x" } }).code).toBe("INVALID_REQUEST");
  });
});

describe("createApi", () => {
  it("sends the access token and the identity token on money moves", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json(200, { intentId: "i", status: "pending", signature: null, error: null }),
    );
    const api = createApi("https://api.test", fetchMock);
    await api.deposit({ accessToken: "acc", identityToken: "idt" }, { intentId: "i", amount: "1000000" });

    const [url, init = {}] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.test/v1/account/deposit");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer acc", "X-Privy-Identity-Token": "idt" });
    expect(JSON.parse(String(init.body))).toEqual({ intentId: "i", amount: "1000000" });
  });

  it("maps an error response to ApiError", async () => {
    const api = createApi("https://api.test", async () => json(403, { error: { code: "GEO_BLOCKED", message: "no" } }));
    await expect(api.account({ accessToken: "a" })).rejects.toMatchObject({ code: "GEO_BLOCKED", status: 403 });
  });

  it("reports network failures as NETWORK_ERROR", async () => {
    const api = createApi("https://api.test", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(api.geo()).rejects.toMatchObject({ code: "NETWORK_ERROR", status: null });
  });

  /** A fetch that only ends when its request is aborted, like a hung API. */
  const hang: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
    );

  it("gives up on a hung API with NETWORK_ERROR instead of waiting forever", async () => {
    const api = createApi("https://api.test", hang, 10);
    await expect(api.leaderboard()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("still lets the caller cancel quietly", async () => {
    const controller = new AbortController();
    const pending = createApi("https://api.test", hang, 60_000).geo(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports a body cut mid-stream as NETWORK_ERROR, so a money move is never taken for refused", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("network error"));
      },
    });
    const api = createApi("https://api.test", async () => new Response(broken, { status: 200 }));
    await expect(
      api.deposit({ accessToken: "a", identityToken: "i" }, { intentId: "i", amount: "1" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("rejects an unreadable success body", async () => {
    const api = createApi("https://api.test", async () => new Response("not json", { status: 200 }));
    await expect(api.leaderboard()).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("encodes path parameters", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json(200, {}));
    await createApi("https://api.test", fetchMock).verifyRound("a/b?c");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.test/v1/rounds/a%2Fb%3Fc/verify");
  });
});

describe("describeError", () => {
  it("tells a player whose identity check expired to log in again, not that the account is barred", () => {
    const refused = new ApiError("FORBIDDEN", "identity check expired, sign in again", 403);
    expect(describeError(refused)).toMatch(/log in again/);
  });
});

describe("device login", () => {
  it("normalizes and validates user codes", () => {
    expect(parseUserCode(" wdjb-mjht ")).toBe("WDJB-MJHT");
    expect(parseUserCode("wdjb mjht")).toBe("WDJB-MJHT");
    expect(parseUserCode("WDJBMJHT")).toBe("WDJB-MJHT");
    expect(parseUserCode("WDJB-MJH0")).toBeNull();
    expect(parseUserCode("<script>")).toBeNull();
    expect(parseUserCode(undefined)).toBeNull();
  });

  it("treats unknown or used codes as expired", () => {
    expect(approveFailure(new ApiError("NOT_FOUND", "x", 404))).toBe("expired");
    expect(approveFailure(new ApiError("INVALID_REQUEST", "x", 400))).toBe("expired");
    expect(approveFailure(new ApiError("UNAUTHORIZED", "x", 401))).toBe("login");
    expect(approveFailure(new ApiError("NETWORK_ERROR", "x", null))).toBe("error");
    expect(approveFailure(new Error("boom"))).toBe("error");
  });

  it("lets the player approve again once a refused code is corrected", () => {
    const refused: ApproveStep = { kind: "failed", reason: "expired", message: "x", userCode: "WDJB-MJHA" };
    expect(stepFor(refused, "WDJB-MJHA")).toBe(refused);
    expect(stepFor(refused, "WDJB-MJHT")).toEqual({ kind: "idle" });
    expect(stepFor({ kind: "approved" }, "WDJB-MJHT")).toEqual({ kind: "approved" });
  });
});
