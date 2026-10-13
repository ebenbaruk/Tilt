import { describe, expect, it } from "vitest";
import { timeLeft } from "@/lib/time";

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("timeLeft", () => {
  it.each([
    ["2026-10-15T16:30:00Z", "2d 4h"],
    ["2026-10-14T02:03:00Z", "14h 3m"],
    ["2026-10-13T12:09:30Z", "9m"],
    ["2026-10-13T12:00:10Z", "1m"],
    ["2026-10-13T11:00:00Z", "ended"],
    ["not a date", "unknown"],
  ])("%s → %s", (endsAt, expected) => {
    expect(timeLeft(endsAt, NOW)).toBe(expected);
  });
});
