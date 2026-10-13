import type { MoneyIntentResponse } from "@tilt/api/public";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { intentFor, pollIntent } from "@/lib/intent";

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
