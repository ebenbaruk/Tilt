import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/waitlist/route";
import { addToWaitlist, createRateLimiter, parseEmail } from "@/lib/waitlist";

const CONFIG = { token: "secret_test", dataSourceId: "ds-1" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseEmail", () => {
  it("trims and lowercases", () => {
    expect(parseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it.each([
    undefined,
    42,
    "",
    "ada",
    "ada@example",
    "a b@example.com",
    `${"a".repeat(250)}@x.io`,
    "=cmd@example.com",
    "+1@example.com",
  ])("rejects %s", (input) => {
    expect(parseEmail(input)).toBeNull();
  });
});

describe("addToWaitlist", () => {
  it("creates a page when the email is new", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ results: [] }))
      .mockResolvedValueOnce(json({}));
    await addToWaitlist("ada@example.com", CONFIG, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[1] ?? [];
    expect(url).toBe("https://api.notion.com/v1/pages");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret_test");
    expect(JSON.parse(init?.body as string)).toEqual({
      parent: { data_source_id: "ds-1" },
      properties: { Email: { title: [{ text: { content: "ada@example.com" } }] } },
    });
  });

  it("does nothing when the email is already there", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ results: [{ id: "p1" }] }));
    await addToWaitlist("ada@example.com", CONFIG, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when Notion refuses", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ message: "unauthorized" }, 401));
    await expect(addToWaitlist("ada@example.com", CONFIG, fetchFn)).rejects.toThrow(/401/);
  });
});

describe("createRateLimiter", () => {
  it("allows the limit per window, then resets", () => {
    let time = 0;
    const allow = createRateLimiter(2, 1000, () => time);
    expect([allow("ip"), allow("ip"), allow("ip"), allow("other")]).toEqual([true, true, false, true]);
    time = 1000;
    expect(allow("ip")).toBe(true);
  });
});

describe("createRateLimiter when its table is full", () => {
  it("drops expired keys, refuses new ones otherwise, and never resets a known key", () => {
    let time = 0;
    const allow = createRateLimiter(1, 1000, () => time, 2);
    expect([allow("a"), allow("b"), allow("c")]).toEqual([true, true, false]);
    expect(allow("a")).toBe(false);
    time = 1000;
    expect(allow("c")).toBe(true);
  });
});

describe("POST /api/waitlist", () => {
  const post = (headers: Record<string, string>) =>
    POST(
      new Request("https://tilt.test/api/waitlist", { method: "POST", headers, body: JSON.stringify({ email: "x" }) }),
    );

  it.each<Record<string, string>>([
    { "content-type": "application/json" },
    { origin: "https://evil.test", "content-type": "application/json" },
    { origin: "https://tilt.test", "content-type": "text/plain" },
  ])("refuses a request not sent by our own form: %o", async (headers) => {
    expect((await post(headers)).status).toBe(403);
  });

  it("accepts our own form's request", async () => {
    expect((await post({ origin: "https://tilt.test", "content-type": "application/json" })).status).toBe(400);
  });
});
