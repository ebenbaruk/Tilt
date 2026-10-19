import { describe, expect, test } from "claude-code/testing";

import { apiBase, trustedVerifyUrl } from "../hooks/api";
import {
  cleanText,
  compactUsdc,
  moveFailure,
  formatCountdown,
  formatDuration,
  formatSigned,
  formatUsdc,
  cashOutPayout,
  hiloChance,
  hiloGuessName,
  diceMultiplier,
  flipMultiplier,
  scaledDecimal,
  shortMultiplier,
  towerMultiplier,
  pocketColor,
  rankLabel,
  rouletteGross,
  rouletteMaxGain,
  rouletteWins,
} from "../hooks/format";
import type { RouletteBet } from "../hooks/protocol";
import { segmentColors } from "../hooks/quick";

describe("multipliers as the table shows them", () => {
  test("cut to two decimals, never rounded up past what the round pays", () => {
    expect(shortMultiplier("2.2151")).toBe("2.21");
    expect(shortMultiplier("3.9871")).toBe("3.98");
    expect(shortMultiplier("12.7400")).toBe("12.74");
    expect(shortMultiplier("2")).toBe("2.00");
  });

  test("a wheel landing under ×1 gives part of the stake back: never a win's color", () => {
    const colors = segmentColors(["0.00", "0.80", "1.20", "1.50"]);

    expect(colors.get("0.80")).not.toBe(colors.get("1.20"));
    expect(new Set([colors.get("0.00"), colors.get("0.80"), colors.get("1.20"), colors.get("1.50")]).size).toBe(4);
  });
});
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

  test("a cash-out is the stake at the multiplier, floored, in integer base units", () => {
    expect(cashOutPayout("1000000", "1.2857")).toBe("1285700");
    expect(cashOutPayout("500000", "1.0000")).toBe("500000");
    expect(cashOutPayout("3", "1.0312")).toBe("3");
    expect(cashOutPayout("25000000", "24.7500")).toBe("618750000");
    // Far past what a float holds exactly.
    expect(cashOutPayout("123456789012345678", "5200300.0000")).toBe("642012339900901229303400");
  });

  test("the new games' multipliers, in integer math, floored to 4 decimals", () => {
    expect(scaledDecimal(742n, 2)).toBe("7.42");
    expect(scaledDecimal(5n, 2)).toBe("0.05");
    expect(scaledDecimal(19_600n, 4)).toBe("1.9600");
    // 98 % over the winning rolls: 49 % pays ×2, 1 % ×98, 98 % ×1.
    expect(diceMultiplier(4_900)).toBe("2.0000");
    expect(diceMultiplier(100)).toBe("98.0000");
    expect(diceMultiplier(9_800)).toBe("1.0000");
    expect(diceMultiplier(6_600)).toBe("1.4848");
    expect(flipMultiplier(1)).toBe("1.9600");
    expect(flipMultiplier(10)).toBe("1003.5200");
    // Easy: 0.98 × (4/3)^L.
    expect(towerMultiplier(4, 3, 1)).toBe("1.3066");
    expect(towerMultiplier(4, 3, 2)).toBe("1.7422");
    expect(towerMultiplier(4, 3, 9)).toBe("13.0519");
    // Master: 0.98 × 4^9.
    expect(towerMultiplier(4, 1, 9)).toBe("256901.1200");
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
      text: "✓ agent finished in 6m 14s · your hand is saved for 6 hours",
      tone: "success",
    });
    expect(finishNotice("aborted", 31_000)?.text).toBe("agent stopped after 31s · your hand is saved for 6 hours");
    expect(finishNotice("error", 5_000)?.text).toBe("agent turn ended after 5s · your hand is saved for 6 hours");
    expect(finishNotice("refusal", 5_000)?.tone).toBe("neutral");
  });
});

describe("cards and pockets", () => {
  test("face cards and aces by letter, the rest by number", () => {
    expect([1, 11, 12, 13, 7].map(rankLabel)).toEqual(["A", "J", "Q", "K", "7"]);
  });

  test("a hilo guess is or-same, strict higher on an ace and strict lower on a king, at the ranks that win of 13", () => {
    expect(hiloGuessName("higher", 9)).toBe("higher or same");
    expect(hiloGuessName("lower", 9)).toBe("lower or same");
    expect(hiloGuessName("higher", 1)).toBe("higher");
    expect(hiloGuessName("lower", 13)).toBe("lower");
    expect(hiloGuessName("lower", 1)).toBe("lower or same");
    // 9 to K is 5 ranks, A to 9 is 9; an ace's higher is the 12 others, a king's lower too.
    expect([hiloChance("higher", 9), hiloChance("lower", 9)]).toEqual([38, 69]);
    expect([hiloChance("higher", 1), hiloChance("lower", 1)]).toEqual([92, 8]);
    expect([hiloChance("higher", 13), hiloChance("lower", 13)]).toEqual([8, 92]);
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
    expect(moveFailure("RiskPoolFull")).not.toContain("RiskPoolFull");
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

describe("roulette chips", () => {
  const chip = (bet: RouletteBet, amount: string) => ({ bet, amount });

  test("a chip's stake in as few characters as the felt has", () => {
    expect(compactUsdc("2000000")).toBe("2");
    expect(compactUsdc("2500000")).toBe("2.5");
    expect(compactUsdc("500000")).toBe(".5");
    expect(compactUsdc("250000")).toBe(".25");
    expect(compactUsdc("2050000")).toBe("2.05");
    expect(compactUsdc("1000000000")).toBe("1k");
    expect(compactUsdc("1500000000")).toBe("1500");
    expect(compactUsdc("2509999")).toBe("2.5");
  });

  test("which bets a pocket wins, as the program draws it: 0 loses every bet but a straight on it", () => {
    const bets: RouletteBet[] = [
      { kind: "red" },
      { kind: "black" },
      { kind: "odd" },
      { kind: "even" },
      { kind: "low" },
      { kind: "high" },
      { kind: "dozen", dozen: 2 },
      { kind: "column", column: 2 },
    ];
    const winning = (pocket: number) =>
      bets.filter((bet) => rouletteWins(bet, pocket)).map((bet) => JSON.stringify(bet));

    expect(winning(0)).toEqual([]);
    expect(rouletteWins({ kind: "straight", number: 0 }, 0)).toBe(true);
    // 17: black, odd, low, second dozen (13–24), second column (2, 5, … 35).
    expect(winning(17)).toEqual([
      '{"kind":"black"}',
      '{"kind":"odd"}',
      '{"kind":"low"}',
      '{"kind":"dozen","dozen":2}',
      '{"kind":"column","column":2}',
    ]);
    expect(rouletteWins({ kind: "red" }, 36)).toBe(true);
    expect(rouletteWins({ kind: "column", column: 3 }, 36)).toBe(true);
    expect(rouletteWins({ kind: "dozen", dozen: 3 }, 25)).toBe(true);
    expect(rouletteWins({ kind: "high" }, 18)).toBe(false);
  });

  test("chips pay as the program pays them: the stake back times 36, 3 or 2 on each winner", () => {
    const chips = [
      chip({ kind: "red" }, "1000000"),
      chip({ kind: "straight", number: 17 }, "500000"),
      chip({ kind: "dozen", dozen: 2 }, "800000"),
    ];

    expect(rouletteGross(chips, 17)).toBe(20_400_000n);
    expect(rouletteGross(chips, 1)).toBe(2_000_000n);
    expect(rouletteGross(chips, 0)).toBe(0n);
    // Best pocket: 17, 20.40 back on 2.30.
    expect(rouletteMaxGain(chips)).toBe(18_100_000n);
    // Red and black: no pocket wins more than the stake.
    expect(rouletteMaxGain([chip({ kind: "red" }, "1000000"), chip({ kind: "black" }, "1000000")])).toBe(0n);
  });
});
