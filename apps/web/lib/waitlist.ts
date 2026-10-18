// Waitlist: emails land in a Notion database ("Tilt waitlist", title property "Email").
// Server-only: the Notion token never reaches the browser.

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_EMAIL_LENGTH = 254;
// Deliberately loose: one "@", no spaces, a dot in the domain. The confirmation is the real check.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The list gets exported to spreadsheets, where a cell starting with one of these runs as a formula.
const FORMULA_START = /^[=+\-@]/;

/** The normalized email, or null when it isn't a plausible address. */
export function parseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email) || FORMULA_START.test(email)) return null;
  return email;
}

interface NotionConfig {
  token: string;
  dataSourceId: string;
}

export function notionConfig(): NotionConfig {
  const token = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_WAITLIST_DATA_SOURCE_ID;
  if (!token || !dataSourceId) throw new Error("Missing NOTION_TOKEN or NOTION_WAITLIST_DATA_SOURCE_ID.");
  return { token, dataSourceId };
}

async function notion(config: NotionConfig, path: string, body: unknown, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(`${NOTION_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Notion ${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Adds the email once: signing up twice is a no-op, so the answer never reveals who is already on the list. */
export async function addToWaitlist(email: string, config: NotionConfig, fetchFn: typeof fetch = fetch) {
  const existing = (await notion(
    config,
    `/data_sources/${config.dataSourceId}/query`,
    { filter: { property: "Email", title: { equals: email } }, page_size: 1 },
    fetchFn,
  )) as { results: unknown[] };
  if (existing.results.length > 0) return;
  await notion(
    config,
    "/pages",
    {
      parent: { data_source_id: config.dataSourceId },
      properties: { Email: { title: [{ text: { content: email } }] } },
    },
    fetchFn,
  );
}

/** Fixed-window limit per key, in memory: per server instance, enough to slow down a script. A full
 *  table drops expired keys and otherwise refuses new ones, so flooding it never resets anyone's count. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 10_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return function allow(key: string): boolean {
    const time = now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= time) {
      if (!entry && hits.size >= maxKeys) {
        for (const [k, e] of hits) if (e.resetAt <= time) hits.delete(k);
        if (hits.size >= maxKeys) return false;
      }
      hits.set(key, { count: 1, resetAt: time + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
