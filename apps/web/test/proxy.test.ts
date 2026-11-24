import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const UPSTREAM = "https://api.example.test:8443";
const SECRET = "s".repeat(32);

// proxy.ts reads its env once at load, so each case loads a fresh copy after stubbing it.
async function loadProxy(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import("@/proxy")).proxy;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy with API_UPSTREAM", () => {
  it("relays api paths to the upstream with the edge secret, the caller's address and country", async () => {
    const proxy = await loadProxy({ API_UPSTREAM: UPSTREAM, EDGE_SECRET: SECRET });
    const request = new NextRequest("https://tilt.example.test/v1/auth/device?x=1", {
      method: "POST",
      headers: {
        "x-real-ip": "203.0.113.7",
        "x-vercel-ip-country": "CH",
        "x-tilt-edge": "forged",
        "x-tilt-client-ip": "198.51.100.1",
        "x-tilt-country": "ZZ",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(`${UPSTREAM}/v1/auth/device?x=1`);
    expect(response.headers.get("x-middleware-request-x-tilt-edge")).toBe(SECRET);
    expect(response.headers.get("x-middleware-request-x-tilt-client-ip")).toBe("203.0.113.7");
    expect(response.headers.get("x-middleware-request-x-tilt-country")).toBe("CH");
  });

  it("does not pass the site's cookies to the api", async () => {
    const proxy = await loadProxy({ API_UPSTREAM: UPSTREAM, EDGE_SECRET: SECRET });
    const request = new NextRequest("https://tilt.example.test/v1/state", {
      headers: { cookie: "privy-token=abc; privy-session=t", authorization: "Bearer mod-token" },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).not.toContain("cookie");
    expect(response.headers.get("x-middleware-request-authorization")).toBe("Bearer mod-token");
  });

  it.each(["/health", "/v1", "/v1/state"])("relays %s", async (path) => {
    const proxy = await loadProxy({ API_UPSTREAM: UPSTREAM, EDGE_SECRET: SECRET });
    const response = proxy(new NextRequest(`https://tilt.example.test${path}`));
    expect(response.headers.get("x-middleware-rewrite")).toBe(`${UPSTREAM}${path}`);
  });

  it.each(["/", "/connect", "/v1x", "/healthz", "/account/v1"])("serves %s itself", async (path) => {
    const proxy = await loadProxy({ API_UPSTREAM: UPSTREAM, EDGE_SECRET: SECRET });
    const response = proxy(new NextRequest(`https://tilt.example.test${path}`));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("refuses to start without a long enough edge secret", async () => {
    await expect(loadProxy({ API_UPSTREAM: UPSTREAM, EDGE_SECRET: "short" })).rejects.toThrow(/EDGE_SECRET/);
  });

  it.each(["http://api.example.test", "api.example.test", "not a url"])(
    "refuses to start with API_UPSTREAM=%s",
    async (upstream) => {
      await expect(loadProxy({ API_UPSTREAM: upstream, EDGE_SECRET: SECRET })).rejects.toThrow(/API_UPSTREAM/);
    },
  );

  it("relays nothing when unset", async () => {
    const proxy = await loadProxy({ API_UPSTREAM: "" });
    const response = proxy(new NextRequest("https://tilt.example.test/v1/state"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
