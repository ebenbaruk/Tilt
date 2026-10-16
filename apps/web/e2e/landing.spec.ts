import { expect, test } from "./fixtures";

test("landing shows the pitch, install commands and key sections", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The casino you play while your agent codes");

  const install = page.getByLabel("Install commands");
  await expect(install).toContainText("/plugin marketplace add ebenbaruk/Tilt");
  await expect(install).toContainText("/plugin install tilt");
  await expect(install).toContainText("/tilt login");

  for (const name of [
    "The most fun way to wait on your agent.",
    "Three lines to install",
    "How it works",
    "The games",
    "Provably fair",
    "Be the name next to the prize pool.",
    "Questions",
    "Play with what you can afford to lose.",
  ]) {
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }
  for (const [game, rtp] of [
    ["Blackjack", "99.00%"],
    ["Roulette", "97.30%"],
    ["Baccarat", "98.94%"],
    ["Slots", "96.16%"],
    ["Mines", "99.00%"],
    ["Dice", "98.00%"],
    ["Limbo", "98.00%"],
    ["Flip", "98.00%"],
    ["Keno", "95.00%"],
    ["Wheel", "98.00%"],
    ["Hilo", "98.00%"],
    ["Tower", "98.00%"],
  ]) {
    await expect(page.locator("#games li", { hasText: game })).toContainText(rtp);
  }
  await expect(page.getByText("1% of the gain, on winning rounds only")).toBeVisible();
  const panel = page.getByRole("region", { name: "Tilt panel" });
  await expect(panel).toContainText("[5] Mines");
  await expect(panel).toContainText("[9] Keno");
  await expect(panel).toContainText("[0] more 1/2");
  await expect(panel).toContainText("Hit, stand or double.");
  // The mock must stay monospace whatever font the landing uses.
  expect(await panel.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains|mono/i);
  await expect(page.getByRole("link", { name: "Verify a round" })).toHaveAttribute("href", "/verify");
  await expect(page.locator("#responsible")).toContainText("United Kingdom, France");
});

test("header links reach their sections", async ({ page }) => {
  await page.goto("/");
  for (const [label, id] of [
    ["How it works", "how"],
    ["Games", "games"],
    ["Fair play", "fair"],
    ["FAQ", "faq"],
  ]) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
});

test("copies the install commands", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "copy" }).click();
  await expect(page.getByRole("button", { name: "✓ copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "/plugin marketplace add ebenbaruk/Tilt\n/plugin install tilt\n/tilt login",
  );
});

test("faq answers open with the keyboard", async ({ page }) => {
  await page.goto("/");
  const question = page.getByText("Do I need SOL for fees?");
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Tilt pays the Solana network fees.")).toBeVisible();
});

test("no horizontal scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
});

test("legal pages are marked as drafts", async ({ page }) => {
  for (const path of ["/legal/terms", "/legal/privacy", "/legal/responsible-gaming"]) {
    await page.goto(path);
    await expect(page.getByText("working draft pending review by counsel")).toBeVisible();
  }
});
