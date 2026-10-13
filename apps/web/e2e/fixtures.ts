import { test as base, type Page, type Route } from "@playwright/test";

/** Any request leaving the app (Privy, fonts, explorers) is aborted: tests only see mocked API answers. */
async function isolate(page: Page) {
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
}

export function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await isolate(page);
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** A well-formed base58 transaction signature. */
export const SIGNATURE = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
