import { describe, expect, it } from "vitest";
import { decodeKeys } from "../keys";

describe("decodeKeys", () => {
  it("turns letters and digits into hotkey presses", () => {
    expect(decodeKeys("b1")).toEqual([
      { kind: "press", key: "b" },
      { kind: "press", key: "1" },
    ]);
  });

  it("lowercases letters so Caps Lock still plays", () => {
    expect(decodeKeys("H")).toEqual([{ kind: "press", key: "h" }]);
  });

  it("drops punctuation, spaces and other control characters", () => {
    expect(decodeKeys(" !-\r\t\x7f")).toEqual([]);
  });

  it("quits on Ctrl+C and Ctrl+D", () => {
    expect(decodeKeys("\x03")).toEqual([{ kind: "quit" }]);
    expect(decodeKeys("\x04")).toEqual([{ kind: "quit" }]);
  });

  it("maps Ctrl+L to the account action", () => {
    expect(decodeKeys("\x0c")).toEqual([{ kind: "account" }]);
  });

  it("ignores escape sequences without leaking their letters", () => {
    const arrows = "\x1b[A\x1b[B\x1b[1;5C";
    const functionKeys = "\x1bOP\x1b[15~";
    const altKey = "\x1bh";
    expect(decodeKeys(arrows + functionKeys + altKey + "\x1b")).toEqual([]);
  });

  it("keeps the keys around an escape sequence", () => {
    expect(decodeKeys("a\x1b[Db")).toEqual([
      { kind: "press", key: "a" },
      { kind: "press", key: "b" },
    ]);
  });
});
