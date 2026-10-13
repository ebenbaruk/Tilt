// Request metadata the api trusts only from its own proxies: the client IP and the country.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIp, country, geoPolicy } from "../src/http";

const ipApp = (TRUST_PROXY: boolean, TRUSTED_PROXY_HOPS = 1) =>
  new Hono().get("/", (c) => c.text(clientIp(c, { TRUST_PROXY, TRUSTED_PROXY_HOPS })));

const ipOf = async (app: Hono, forwardedFor?: string) =>
  (await app.request("/", { headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} })).text();

describe("clientIp", () => {
  it("ignores X-Forwarded-For unless the proxy is trusted", async () => {
    expect(await ipOf(ipApp(false), "1.1.1.1")).toBe("unknown");
  });

  it("takes the address our proxy appended, never the client-written leftmost one", async () => {
    expect(await ipOf(ipApp(true), "6.6.6.6, 1.1.1.1")).toBe("1.1.1.1");
    expect(await ipOf(ipApp(true), "1.1.1.1")).toBe("1.1.1.1");
  });

  it("counts TRUSTED_PROXY_HOPS from the right", async () => {
    expect(await ipOf(ipApp(true, 2), "6.6.6.6, 1.1.1.1, 10.0.0.1")).toBe("1.1.1.1");
  });

  it("falls back to the socket when the header has fewer entries than our proxies", async () => {
    expect(await ipOf(ipApp(true, 2), "1.1.1.1")).toBe("unknown");
    expect(await ipOf(ipApp(true))).toBe("unknown");
  });
});

describe("geoPolicy", () => {
  const config = {
    COUNTRY_HEADER: "x-country",
    BLOCKED_COUNTRIES: ["US"],
    GEO_ALLOW_UNKNOWN: false,
    EDGE_SECRET: "e".repeat(32),
  };
  const countryApp = (trustProxy: boolean, edgeSecret?: string) =>
    new Hono().get("/", (c) =>
      c.text(country(c, geoPolicy({ ...config, TRUST_PROXY: trustProxy, EDGE_SECRET: edgeSecret })) ?? "unknown"),
    );
  const fromEdge = { "x-tilt-edge": "e".repeat(32), "x-country": "DE" };

  it("reads the country only behind a trusted proxy with the edge secret", async () => {
    expect(await (await countryApp(true, config.EDGE_SECRET).request("/", { headers: fromEdge })).text()).toBe("DE");
    expect(await (await countryApp(false, config.EDGE_SECRET).request("/", { headers: fromEdge })).text()).toBe(
      "unknown",
    );
    expect(await (await countryApp(true).request("/", { headers: fromEdge })).text()).toBe("unknown");
  });
});
