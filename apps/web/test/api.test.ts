import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, toApiError } from "@/lib/api";
import { approveFailure, parseUserCode } from "@/lib/device";

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
});
