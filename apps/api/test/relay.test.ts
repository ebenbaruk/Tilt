// HttpRelay against the fake relay server: contract parsing, error mapping, timeouts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpRelay } from "../src/relay";
import { FakeRelay } from "./helpers";

const relay = new FakeRelay();
beforeAll(() => relay.start());
afterAll(() => relay.stop());
beforeEach(() => {
  relay.intents.clear();
  relay.delayMs = 0;
  relay.down = false;
});

const USER = "did:privy:cmalice00000000000000000a";
const spin = { type: "slots_spin" as const, amount: "1000000" };

describe("HttpRelay", () => {
  it("reads users, and null for unknown ones", async () => {
    const address = relay.addUser(USER);
    expect(await relay.client().getUser(USER)).toEqual({
      userId: USER,
      solanaAddress: address.toBase58(),
      accountOpen: false,
    });
    expect(await relay.client().getUser("did:privy:cmnobody000000000000000n")).toBeNull();
  });

  it("submits and reads intents, null for one the relay never received", async () => {
    const intentId = randomUUID();
    expect(await relay.client().submitIntent({ intentId, userId: USER, action: spin })).toMatchObject({
      status: "submitted",
    });
    expect(await relay.client().getIntent(intentId)).toMatchObject({ intentId, status: "submitted" });
    expect(await relay.client().getIntent(randomUUID())).toBeNull();
  });

  it("maps refusals to api errors without upstream text", async () => {
    const intentId = randomUUID();
    await relay.client().submitIntent({ intentId, userId: USER, action: spin });
    await expect(
      relay.client().submitIntent({ intentId, userId: USER, action: { ...spin, amount: "2" } }),
    ).rejects.toMatchObject({ code: "INTENT_CONFLICT" });
    await expect(new HttpRelay(relay.url, "wrong-key".repeat(4), 1_000).getUser(USER)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      message: "relay unavailable, retry with the same id",
    });
  });

  it("gives up after its timeout", async () => {
    relay.delayMs = 300;
    await expect(relay.client(50).getUser(USER)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("refuses to send a request that breaks the contract", async () => {
    await expect(relay.client().submitIntent({ intentId: "not-a-uuid", userId: USER, action: spin })).rejects.toThrow();
    expect(relay.intents.size).toBe(0);
  });

  it("pays promos and reads them back", async () => {
    const payoutId = randomUUID();
    const request = { payoutId, userId: USER, amount: "5000000", poolId: "c1", reason: "rank #1" };
    expect(await relay.client().payPromo(request)).toMatchObject({ payoutId, status: "submitted" });
    expect(await relay.client().getPromo(payoutId)).toMatchObject({ payoutId, status: "submitted" });
    expect(await relay.client().getPromo(randomUUID())).toBeNull();
  });
});
