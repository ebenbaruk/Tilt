import { describe, expect, it, vi } from "vitest";
import { addToWaitlist, createRateLimiter, parseEmail } from "@/lib/waitlist";

const CONFIG = { token: "secret_test", dataSourceId: "ds-1" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("parseEmail", () => {
  it("trims and lowercases", () => {
    expect(parseEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it.each([undefined, 42, "", "ada", "ada@example", "a b@example.com", `${"a".repeat(250)}@x.io`])(
    "rejects %s",
    (input) => {
      expect(parseEmail(input)).toBeNull();
    },
  );
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
