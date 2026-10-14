import type { MoneyIntentResponse } from "@tilt/api/public";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { createMoneyFlow, intentFor, pollIntent, type MoneyFlowDeps, type MoneyPhase } from "@/lib/intent";

const pending: MoneyIntentResponse = { intentId: "i1", status: "pending", signature: null, error: null };
const submitted: MoneyIntentResponse = { ...pending, status: "submitted", signature: "sig" };
const failed: MoneyIntentResponse = {
  ...pending,
  status: "failed",
  error: { code: "PROGRAM_ERROR", message: "InsufficientBalance" },
};

/** Fake clock: sleeping advances time, so timeouts are deterministic. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("intentFor", () => {
  it("reuses the id when the same request is retried", () => {
    const first = intentFor(null, "deposit:100", () => "a");
    expect(intentFor(first, "deposit:100", () => "b")).toBe(first);
  });

  it("issues a new id for a different request", () => {
    const first = intentFor(null, "deposit:100", () => "a");
    expect(intentFor(first, "deposit:200", () => "b")).toEqual({ key: "deposit:200", intentId: "b" });
  });
});

describe("pollIntent", () => {
  it("returns a terminal answer without polling", async () => {
    const fetchIntent = vi.fn();
    expect(await pollIntent(fetchIntent, submitted, clock())).toBe(submitted);
    expect(fetchIntent).not.toHaveBeenCalled();
  });

  it("polls until the intent is submitted", async () => {
    const fetchIntent = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(submitted);
    expect(await pollIntent(fetchIntent, pending, clock())).toBe(submitted);
    expect(fetchIntent).toHaveBeenCalledTimes(2);
  });

  it("surfaces a failed intent", async () => {
    const fetchIntent = vi.fn().mockResolvedValue(failed);
    expect(await pollIntent(fetchIntent, pending, clock())).toBe(failed);
  });

  it("keeps polling through transient errors", async () => {
    const fetchIntent = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "x", null))
      .mockRejectedValueOnce(new ApiError("RATE_LIMITED", "x", 429))
      .mockResolvedValueOnce(submitted);
    expect(await pollIntent(fetchIntent, pending, clock())).toBe(submitted);
  });

  it("stops on a non-transient error", async () => {
    const fetchIntent = vi.fn().mockRejectedValue(new ApiError("UNAUTHORIZED", "x", 401));
    await expect(pollIntent(fetchIntent, pending, clock())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns the last pending answer on timeout instead of failing", async () => {
    const fetchIntent = vi.fn().mockResolvedValue(pending);
    const result = await pollIntent(fetchIntent, pending, { ...clock(), intervalMs: 1_000, timeoutMs: 5_000 });
    expect(result.status).toBe("pending");
    expect(fetchIntent).toHaveBeenCalledTimes(5);
  });
});

describe("createMoneyFlow", () => {
  /** A deposit flow over mocks; `send` answers pending unless a test says otherwise. */
  function deposit(overrides: Partial<MoneyFlowDeps> = {}) {
    const phases: MoneyPhase[] = [];
    let ids = 0;
    const deps = {
      kind: "deposit" as const,
      send: vi.fn(async (intentId: string) => ({ ...pending, intentId })),
      fetchIntent: vi.fn(async (intentId: string) => ({ ...submitted, intentId })),
      onPhase: (phase: MoneyPhase) => void phases.push(phase),
      onSettled: vi.fn(),
      newId: () => `id-${++ids}`,
      poll: clock(),
      ...overrides,
    };
    const flow = createMoneyFlow(deps);
    return { flow, deps, last: () => phases.at(-1) };
  }

  it("sends one intent for a double click", async () => {
    let answer: (value: MoneyIntentResponse) => void = () => undefined;
    const send = vi.fn(() => new Promise<MoneyIntentResponse>((resolve) => (answer = resolve)));
    const { flow, deps, last } = deposit({ send });
    const first = flow.submit("1000000");
    const second = flow.submit("1000000");
    answer({ ...submitted, intentId: "id-1" });
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
    expect(last()).toEqual({ kind: "done", signature: "sig" });
  });

  it("reuses the id when a refused request is retried, a new one for another amount", async () => {
    const send = vi.fn().mockRejectedValue(new ApiError("PLAYER_BUSY", "busy", 409));
    const { flow, last } = deposit({ send });
    await flow.submit("1000000");
    expect(last()?.kind).toBe("failed");
    await flow.submit("1000000");
    await flow.submit("2000000");
    expect(send.mock.calls.map(([id]) => id)).toEqual(["id-1", "id-1", "id-2"]);
  });

  it.each(["NETWORK_ERROR", "UPSTREAM_ERROR", "INTERNAL_ERROR", "BAD_RESPONSE"] as const)(
    "never reports a deposit lost to %s as failed, and sends nothing else until it is checked",
    async (code) => {
      const send = vi.fn().mockRejectedValue(new ApiError(code, "x", null));
      const { flow, deps, last } = deposit({ send });
      await flow.submit("1000000");
      expect(last()?.kind).toBe("stillPending");

      await flow.submit("5000000");
      expect(send).toHaveBeenCalledTimes(1);

      await flow.checkAgain();
      expect(deps.fetchIntent).toHaveBeenCalledWith("id-1");
      expect(last()).toEqual({ kind: "done", signature: "sig" });
      expect(deps.onSettled).toHaveBeenCalledTimes(1);
    },
  );

  it("says nothing moved only once Tilt has no record of the intent, and resends the same id", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "x", null));
    const fetchIntent = vi.fn().mockRejectedValue(new ApiError("NOT_FOUND", "unknown intent", 404));
    const { flow, last } = deposit({ send, fetchIntent });
    await flow.submit("1000000");
    await flow.checkAgain();
    expect(last()).toMatchObject({ kind: "failed", message: expect.stringMatching(/nothing was moved/) });
    await flow.submit("1000000");
    expect(send.mock.calls.map(([id]) => id)).toEqual(["id-1", "id-1"]);
  });

  it("keeps an intent whose status check fails as unconfirmed, not failed", async () => {
    const fetchIntent = vi.fn().mockRejectedValue(new ApiError("UNAUTHORIZED", "expired", 401));
    const { flow, deps, last } = deposit({ fetchIntent });
    await flow.submit("1000000");
    expect(last()?.kind).toBe("stillPending");
    expect(deps.onSettled).not.toHaveBeenCalled();
  });

  it("sends nothing when the wallet step fails", async () => {
    const { flow, deps, last } = deposit();
    await flow.submit("1000000", async () => {
      throw new Error("user closed the Privy modal");
    });
    expect(deps.send).not.toHaveBeenCalled();
    expect(last()?.kind).toBe("failed");
  });
});
