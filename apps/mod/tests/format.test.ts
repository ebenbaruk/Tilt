import { describe, expect, test } from "claude-code/testing";

import { apiBase, trustedVerifyUrl } from "../hooks/api";
import {
  cleanText,
  moveFailure,
  formatCountdown,
  formatDuration,
  formatSigned,
  formatUsdc,
  minesPayout,
  pocketColor,
  rankLabel,
} from "../hooks/format";
import { finishNotice } from "../hooks/register";

describe("money", () => {
  test("base units to cents with en-US grouping, never through floats", () => {
    expect(formatUsdc("0")).toBe("0.00");
    expect(formatUsdc("12400000")).toBe("12.40");
    expect(formatUsdc("500000")).toBe("0.50");
    expect(formatUsdc("3000000000")).toBe("3,000.00");
    expect(formatUsdc("1234567890123456789")).toBe("1,234,567,890,123.45");
  });

  test("sub-cent dust is truncated toward zero, so a balance is never overstated", () => {
    expect(formatUsdc("9999")).toBe("0.00");
    expect(formatUsdc("1239999")).toBe("1.23");
    expect(formatUsdc("-1239999")).toBe("−1.23");
    expect(formatUsdc("-9999")).toBe("0.00");
  });

  test("signed deltas use a real minus sign and always show their sign", () => {
    expect(formatSigned("990000")).toBe("+0.99");
    expect(formatSigned("-500000")).toBe("−0.50");
    expect(formatSigned("0")).toBe("0.00");
    expect(formatSigned("5000")).toBe("0.00");
    expect(formatSigned("412900000")).toBe("+412.90");
  });

  test("a Mines cash-out is the stake at the multiplier, floored, in integer base units", () => {
    expect(minesPayout("1000000", "1.2857")).toBe("1285700");
    expect(minesPayout("500000", "1.0000")).toBe("500000");
    expect(minesPayout("3", "1.0312")).toBe("3");
    expect(minesPayout("25000000", "24.7500")).toBe("618750000");
    // Far past what a float holds exactly.
    expect(minesPayout("123456789012345678", "5200300.0000")).toBe("642012339900901229303400");
  });
});

describe("time", () => {
  test("turn durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(31_400)).toBe("31s");
    expect(formatDuration(59_999)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m 0s");
    expect(formatDuration(374_000)).toBe("6m 14s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
  });

  test("competition countdowns", () => {
    expect(formatCountdown(-1)).toBe("ended");
    expect(formatCountdown(20_000)).toBe("1m");
    expect(formatCountdown(12 * 60_000)).toBe("12m");
    expect(formatCountdown((14 * 60 + 3) * 60_000)).toBe("14h 3m");
    expect(formatCountdown((52 * 60 + 10) * 60_000)).toBe("2d 4h");
  });

  test("the finish notice, and neutral words when the turn did not answer", () => {
    expect(finishNotice("answer", 374_000)).toEqual({
      text: "✓ agent finished in 6m 14s · your hand is saved",
      tone: "success",
    });
    expect(finishNotice("aborted", 31_000)?.text).toBe("agent stopped after 31s · your hand is saved");
    expect(finishNotice("error", 5_000)?.text).toBe("agent turn ended after 5s · your hand is saved");
    expect(finishNotice("refusal", 5_000)?.tone).toBe("neutral");
  });
});

describe("cards and pockets", () => {
  test("face cards and aces by letter, the rest by number", () => {
    expect([1, 11, 12, 13, 7].map(rankLabel)).toEqual(["A", "J", "Q", "K", "7"]);
  });

  test("european wheel colors", () => {
    expect(pocketColor(0)).toBe("green");
    expect(pocketColor(17)).toBe("black");
    expect(pocketColor(32)).toBe("red");
  });
});

describe("boundaries", () => {
  test("server text cannot carry terminal escape sequences", () => {
    expect(cleanText("\u001b[31mred\u0007 team")).toBe("[31mred team");
  });

  test("a refusal of the program reads as a sentence, anything else as sent", () => {
    expect(moveFailure("VaultTooSmall")).toBe("The casino cannot cover a bet this size right now: try a smaller one.");
    expect(moveFailure("WinCapReached")).not.toContain("WinCapReached");
    expect(moveFailure("network error, try again")).toBe("network error, try again");
  });

  test("server text cannot reorder or hide what follows, and long text is cut between characters", () => {
    expect(cleanText("\u202Egnp.exe")).toBe("gnp.exe");
    expect(cleanText("@k\u200Bi\u2066ra\u2069")).toBe("@kira");

    const cut = cleanText("😀".repeat(300));

    expect(Array.from(cut)).toEqual(Array.from("😀".repeat(200)));
  });

  test("the api url must be https, or plain http on loopback only", () => {
    expect(apiBase("https://api.tilt.example/")).toBe("https://api.tilt.example");
    expect(apiBase("http://127.0.0.1:8788")).toBe("http://127.0.0.1:8788");
    expect(apiBase("http://localhost:8788/")).toBe("http://localhost:8788");
    expect(apiBase("http://api.tilt.example")).toBeNull();
    expect(apiBase("file:///etc/passwd")).toBeNull();
    expect(apiBase("not a url")).toBeNull();
    expect(apiBase(42)).toBeNull();
  });

  test("the login page must be on the api's own site", () => {
    const api = "https://api.tilt.example";

    expect(trustedVerifyUrl("https://tilt.example/connect?code=WDJB-MJHT", api)).toBe(
      "https://tilt.example/connect?code=WDJB-MJHT",
    );
    expect(trustedVerifyUrl("https://api.tilt.example/connect", api)).toBe("https://api.tilt.example/connect");
    expect(trustedVerifyUrl("https://evil.example/connect", api)).toBeNull();
    expect(trustedVerifyUrl("https://tilt.example.evil.test/connect", api)).toBeNull();
    expect(trustedVerifyUrl("https://eviltilt.example/connect", api)).toBeNull();
    expect(trustedVerifyUrl("https://www.tilt.example/connect", api)).toBeNull();
    expect(trustedVerifyUrl("https://example/connect", api)).toBeNull();
    expect(trustedVerifyUrl("http://tilt.example/connect", api)).toBeNull();
    expect(trustedVerifyUrl("https://user@tilt.example/connect", api)).toBeNull();
    expect(trustedVerifyUrl("javascript:alert(1)", api)).toBeNull();
    expect(trustedVerifyUrl("http://localhost:3000/connect", "http://127.0.0.1:8080")).toBe(
      "http://localhost:3000/connect",
    );
    expect(trustedVerifyUrl("http://evil.example/connect", "http://127.0.0.1:8080")).toBeNull();
    expect(trustedVerifyUrl("http://localhost:3000/connect", api)).toBeNull();
  });
});
