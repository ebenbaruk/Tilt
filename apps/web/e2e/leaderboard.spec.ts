import type { LeaderboardResponse } from "@tilt/api/public";
import { expect, json, test } from "./fixtures";

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const BOARD: LeaderboardResponse = {
  competition: { id: "c1", name: "Daily sprint", startsAt: inHours(-10), endsAt: inHours(14), pool: "3000000000" },
  sponsor: { name: "Northwind Cloud", tagline: "GPUs by the minute", pool: "3000000000", endsAt: inHours(14) },
  entries: [
    { rank: 1, handle: "@0xkira", net: "412900000", isYou: false },
    { rank: 2, handle: "@mira.builds", net: "288150000", isYou: false },
    { rank: 414, handle: "@me", net: "-500000", isYou: true },
  ],
  dropSeedHash: "c0ffee00".repeat(8),
  dropSeed: null,
};

test("shows the ranking, the sponsor and the drop commitment", async ({ page }) => {
  await page.route("**/v1/leaderboard", (route) => json(route, 200, BOARD));
  await page.goto("/leaderboard");
  await expect(page.getByRole("row", { name: /1 @0xkira \+412\.90/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /414 @me \(you\) −0\.50/ })).toBeVisible();
  await expect(page.getByText("Northwind Cloud")).toBeVisible();
  await expect(page.getByText("PRESENTED BY · SPONSORED")).toBeVisible();
  await expect(page.getByText(/pool \$3,000\.00/).first()).toBeVisible();
  await expect(page.getByTestId("seed-hash")).toHaveText(BOARD.dropSeedHash ?? "");
  await expect(page.getByTestId("seed")).toHaveText("revealed when the competition ends");
});

test("reports an API failure", async ({ page }) => {
  await page.route("**/v1/leaderboard", (route) =>
    json(route, 503, { error: { code: "UPSTREAM_ERROR", message: "rpc down" } }),
  );
  await page.goto("/leaderboard");
  await expect(page.getByText(/slow to answer/)).toBeVisible();
});

test("hostile handles stay plain text and wrap on a phone", async ({ page }) => {
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });
  await page.setViewportSize({ width: 360, height: 640 });
  const board: LeaderboardResponse = {
    ...BOARD,
    sponsor: { name: "S".repeat(300), tagline: null, pool: "1000000", endsAt: inHours(-1) },
    entries: [
      { rank: 1, handle: "<img src=x onerror=alert(1)>", net: "999999999999999999999999", isYou: false },
      { rank: 2, handle: "\u202Eexe.txt", net: "-1", isYou: true },
      { rank: 3, handle: "W".repeat(500), net: "0", isYou: false },
    ],
  };
  await page.route("**/v1/leaderboard", (route) => json(route, 200, board));
  await page.goto("/leaderboard");
  await expect(page.getByRole("cell", { name: "<img src=x onerror=alert(1)>" })).toBeVisible();
  await expect(page.getByText("+999,999,999,999,999,999.999999")).toBeVisible();
  // The right-to-left mark is isolated: "(you)" stays outside the handle.
  await expect(page.locator("tr", { hasText: "(you)" }).locator("bdi")).toHaveText("\u202Eexe.txt");
  // An ended campaign shows no countdown instead of "ends in ended".
  await expect(page.getByText("ends in ended")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  expect(dialogs).toBe(0);
});
