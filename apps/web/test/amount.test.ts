import { describe, expect, it } from "vitest";
import { compareAmounts, formatAmount, formatSigned, parseAmount } from "@/lib/amount";

describe("parseAmount", () => {
  it.each([
    ["12.4", "12400000"],
    ["12.40", "12400000"],
    ["12", "12000000"],
    ["0.000001", "1"],
    ["  7.5 ", "7500000"],
    ["007", "7000000"],
    ["1.", "1000000"],
    ["999999999999.999999", "999999999999999999"],
  ])("parses %j as %s base units", (input, expected) => {
    expect(parseAmount(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["", "Enter an amount."],
    ["   ", "Enter an amount."],
    ["0", "Enter an amount above 0."],
    ["0.000000", "Enter an amount above 0."],
    ["1.0000001", "USDC has at most 6 decimals."],
    ["1000000000000", "That amount is too large."],
  ])("rejects %j", (input, error) => {
    expect(parseAmount(input)).toEqual({ ok: false, error });
  });

  it.each(["-1", "+1", "1e6", "1,000", "abc", ".5", "1.2.3", "0x10", "١٢", "Infinity", "NaN", "1 000"])(
    "rejects junk %j",
    (input) => {
      expect(parseAmount(input).ok).toBe(false);
    },
  );

  it("round-trips through formatAmount", () => {
    const parsed = parseAmount("1234.5");
    expect(parsed.ok && formatAmount(parsed.value)).toBe("1,234.50");
  });
});

describe("formatAmount", () => {
  it.each([
    ["0", "0.00"],
    ["1", "0.000001"],
    ["10000", "0.01"],
    ["12400000", "12.40"],
    ["12345678", "12.345678"],
    ["1000000000000", "1,000,000.00"],
    ["-500000", "−0.50"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });

  it("accepts bigint", () => {
    expect(formatAmount(2_500_000n)).toBe("2.50");
  });

  it("throws on non-integer strings instead of guessing", () => {
    expect(() => formatAmount("1.5")).toThrow();
    expect(() => formatAmount("")).toThrow();
  });
});

describe("formatSigned", () => {
  it("signs gains and uses a real minus for losses", () => {
    expect(formatSigned("1250000")).toBe("+1.25");
    expect(formatSigned("-500000")).toBe("−0.50");
    expect(formatSigned("0")).toBe("0.00");
  });
});

describe("compareAmounts", () => {
  it("compares beyond float precision", () => {
    expect(compareAmounts("9007199254740993", "9007199254740992")).toBe(1);
    expect(compareAmounts("5", "5")).toBe(0);
    expect(compareAmounts("-1", "0")).toBe(-1);
  });
});
