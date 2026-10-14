import type { AccountResponse } from "@tilt/api/public";
import { describe, expect, it } from "vitest";
import { limitField } from "@/app/(site)/(wallet)/account/limitField";
import { refreshFailed } from "@/app/(site)/(wallet)/account/load";

const account = { userId: "u", balance: "5000000" } as AccountResponse;

describe("refreshFailed", () => {
  it("keeps the loaded account (and its money panels) when a refresh after a deposit fails", () => {
    expect(refreshFailed({ kind: "ready", account }, "Too many requests.")).toEqual({
      kind: "ready",
      account,
      refreshError: "Too many requests.",
    });
  });

  it("shows the error when nothing was loaded yet", () => {
    expect(refreshFailed({ kind: "loading" }, "down")).toEqual({ kind: "error", message: "down" });
  });
});

describe("limitField", () => {
  it("starts on the raise waiting, so saving the other limit does not cancel it, and says when it applies", () => {
    const field = limitField("5000000", { value: "9000000", at: "2026-10-15T08:00:00.000Z" });
    expect(field.initial).toBe("9.00");
    expect(field.hint).toMatch(/^5\.00 USDC until .+, then 9\.00 USDC\.$/);
    expect(limitField("5000000", { value: null, at: "2026-10-15T08:00:00.000Z" }).hint).toContain("then no limit");
    expect(limitField("5000000", null)).toEqual({ initial: "5.00" });
  });
});
