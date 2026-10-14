import { describe, expect, test } from "claude-code/testing";

import { isStateResponse } from "../hooks/guards";
import type { StateResponse } from "../hooks/protocol";
import { BASE } from "./fixtures";

describe("state guard", () => {
  test("accepts the player above and the web url", () => {
    expect(isStateResponse(BASE)).toBe(true);
    expect(isStateResponse({ ...BASE, ahead: null })).toBe(true);
  });

  test("accepts an older api that sends neither", () => {
    const older: Partial<StateResponse> = { ...BASE };
    delete older.ahead;
    delete older.webUrl;
    expect(isStateResponse(older)).toBe(true);
  });

  test("refuses a malformed player above or web url", () => {
    expect(isStateResponse({ ...BASE, ahead: { rank: 1, handle: "@x", net: "1.5", isYou: false } })).toBe(false);
    expect(isStateResponse({ ...BASE, ahead: "@lena" })).toBe(false);
    expect(isStateResponse({ ...BASE, webUrl: 42 })).toBe(false);
  });
});
