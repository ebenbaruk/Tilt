// Device-code login and mod sessions, against Postgres.
import type { DeviceStartResponse, DeviceTokenResponse } from "@tilt/mod/protocol";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { access, FakeChain, FakeRelay, json, resetDb, testApp, testDb } from "./helpers";

const db = await testDb();
const ALICE = "did:privy:cmalice00000000000000000a";
const BOB = "did:privy:cmbob0000000000000000000b";

describe.skipIf(!db)("device login", () => {
  if (!db) return;
  const relay = new FakeRelay();
  const chain = new FakeChain();
  let app: ReturnType<typeof testApp>["app"];

  beforeAll(() => relay.start());
  afterAll(async () => {
    await relay.stop();
    await db.end();
  });
  beforeEach(async () => {
    await resetDb(db);
    ({ app } = testApp(db, relay, chain));
  });

  const start = async () =>
    (await (await app.request("/v1/auth/device", { method: "POST" })).json()) as DeviceStartResponse;
  const poll = (deviceCode: string) => app.request("/v1/auth/device/token", json({ deviceCode }));
  const approve = (userCode: string, userId = ALICE) =>
    app.request("/v1/auth/device/approve", json({ userCode }, access(userId)));
  /** Lets the next poll through without waiting for the interval. */
  const allowPoll = () => db.query("UPDATE device_codes SET last_polled_at = now() - interval '1 minute'");

  async function login(userId = ALICE): Promise<string> {
    const { deviceCode, userCode } = await start();
    expect((await approve(userCode, userId)).status).toBe(200);
    const body = (await (await poll(deviceCode)).json()) as DeviceTokenResponse;
    if (body.status !== "approved") throw new Error(`login failed: ${body.status}`);
    return body.token;
  }

  it("starts with a secret device code, a readable user code and a verify link", async () => {
    const body = await start();
    expect(body.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.userCode).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(body.verifyUrl).toBe(`https://tilt.test/connect?code=${body.userCode}`);
    expect(body).toMatchObject({ expiresIn: 600, interval: 5 });
    const { rows } = await db.query("SELECT device_code_hash FROM device_codes");
    expect(rows[0].device_code_hash.toString("hex")).not.toContain(Buffer.from(body.deviceCode).toString("hex"));
  });

  it("goes pending -> approved -> spent, and the token plays", async () => {
    const { deviceCode, userCode } = await start();
    expect(await (await poll(deviceCode)).json()).toEqual({ status: "pending" });
    expect((await approve(userCode.toLowerCase().replace("-", " "))).status).toBe(200);
    await allowPoll();
    const approved = (await (await poll(deviceCode)).json()) as DeviceTokenResponse;
    expect(approved).toMatchObject({ status: "approved", token: expect.stringMatching(/^tilt_/) });
    await allowPoll();
    expect(await (await poll(deviceCode)).json()).toEqual({ status: "expired" });
    if (approved.status !== "approved") throw new Error("unreachable");
    const { rows } = await db.query("SELECT token_hash, scope FROM mod_sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe("play");
    relay.addUser(ALICE);
    const state = await app.request("/v1/state", { headers: { authorization: `Bearer ${approved.token}` } });
    expect(state.status).toBe(200);
  });

  it("asks the mod to slow down when it polls faster than the interval", async () => {
    const { deviceCode } = await start();
    expect((await poll(deviceCode)).status).toBe(200);
    const fast = await poll(deviceCode);
    expect(fast.status).toBe(429);
    expect(await fast.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("expires codes after ten minutes, even approved ones", async () => {
    const { deviceCode, userCode } = await start();
    await approve(userCode);
    await db.query("UPDATE device_codes SET expires_at = now() - interval '1 second'");
    expect(await (await poll(deviceCode)).json()).toEqual({ status: "expired" });
    const late = await start();
    await db.query("UPDATE device_codes SET expires_at = now() - interval '1 second'");
    expect((await approve(late.userCode)).status).toBe(404);
  });

  it("refuses unknown device codes and malformed bodies", async () => {
    expect((await poll("x".repeat(43))).status).toBe(400);
    expect((await poll("not a code")).status).toBe(400);
    expect((await app.request("/v1/auth/device/token", json({ deviceCode: 1 }))).status).toBe(400);
  });

  it("needs a Privy access token to approve, and stops guessing after a few wrong codes", async () => {
    const { userCode } = await start();
    expect((await app.request("/v1/auth/device/approve", json({ userCode }))).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await approve("AAAA-AAAA", BOB)).status).toBe(404);
    const blocked = await approve(userCode, BOB);
    expect(blocked.status).toBe(429);
    expect((await approve(userCode, ALICE)).status).toBe(200);
  });

  it("caps wrong codes sent in parallel too", async () => {
    const guesses = await Promise.all(Array.from({ length: 20 }, () => approve("AAAA-AAAA", BOB)));
    expect(guesses.filter((r) => r.status === 404)).toHaveLength(5);
    expect(guesses.filter((r) => r.status === 429)).toHaveLength(15);
  });

  it("approves a code once when two players race for it, and issues one session", async () => {
    const { deviceCode, userCode } = await start();
    const results = await Promise.all([approve(userCode, ALICE), approve(userCode, BOB), approve(userCode, ALICE)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404]);
    const polls = await Promise.all([poll(deviceCode), poll(deviceCode), poll(deviceCode)]);
    const bodies = await Promise.all(polls.map((r) => r.json() as Promise<{ status?: string }>));
    expect(bodies.filter((b) => b.status === "approved")).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM mod_sessions")).rowCount).toBe(1);
  });

  it("geo-blocks approvals from blocked countries", async () => {
    const { userCode } = await start();
    const res = await app.request(
      "/v1/auth/device/approve",
      json({ userCode }, { ...access(ALICE), "x-country": "US" }),
    );
    expect(res.status).toBe(451);
  });

  describe("sessions", () => {
    it("are listed and revoked from the web, and a revoked token stops working", async () => {
      relay.addUser(ALICE);
      const token = await login();
      const mod = { authorization: `Bearer ${token}` };
      expect((await app.request("/v1/state", { headers: mod })).status).toBe(200);
      const list = (await (await app.request("/v1/account/sessions", { headers: access(ALICE) })).json()) as {
        sessions: { id: string; lastUsedAt: string | null }[];
      };
      expect(list.sessions).toHaveLength(1);
      expect(list.sessions[0].lastUsedAt).not.toBeNull();
      const id = list.sessions[0].id;
      expect((await app.request(`/v1/account/sessions/${id}`, { method: "DELETE", headers: access(BOB) })).status).toBe(
        404,
      );
      expect(
        (await app.request(`/v1/account/sessions/${id}`, { method: "DELETE", headers: access(ALICE) })).status,
      ).toBe(204);
      expect((await app.request("/v1/state", { headers: mod })).status).toBe(401);
    });

    it("expire after 30 days", async () => {
      relay.addUser(ALICE);
      const token = await login();
      const { rows } = await db.query<{ days: number }>(
        "SELECT round(extract(epoch FROM expires_at - created_at) / 86400) AS days FROM mod_sessions",
      );
      expect(Number(rows[0].days)).toBe(30);
      await db.query("UPDATE mod_sessions SET expires_at = now() - interval '1 second'");
      expect((await app.request("/v1/state", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    });

    it("refuse garbage and missing tokens", async () => {
      const cases: Record<string, string>[] = [
        {},
        { authorization: "Bearer nope" },
        { authorization: `Bearer tilt_${"a".repeat(43)}` },
      ];
      for (const headers of cases) {
        expect((await app.request("/v1/state", { headers })).status).toBe(401);
      }
    });

    it("cannot be used on web routes: a mod token never moves money", async () => {
      relay.addUser(ALICE);
      const token = await login();
      const mod = { authorization: `Bearer ${token}` };
      const body = { intentId: crypto.randomUUID(), amount: "5000000" };
      for (const path of ["/v1/account/deposit", "/v1/account/withdraw"]) {
        const res = await app.request(path, json(body, mod));
        expect(res.status).toBe(401);
      }
      expect((await app.request("/v1/account", { headers: mod })).status).toBe(401);
      expect(relay.intents.size).toBe(0);
    });
  });
});
