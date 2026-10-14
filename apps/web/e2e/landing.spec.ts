import { expect, json, test } from "./fixtures";

test("landing shows the pitch, the waitlist and key sections", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The casino you play while your agent codes");

  await expect(page.getByLabel("Email")).toBeVisible();

  for (const name of [
    "The most fun way to wait on your agent.",
    "Get in early",
    "How it works",
    "The games",
    "Provably fair",
    "Be the name next to the prize pool.",
    "Questions",
    "Play with what you can afford to lose.",
  ]) {
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }
  for (const rtp of ["99.00%", "97.30%", "98.94%", "96.16%"]) {
    await expect(page.locator("#games").getByText(rtp)).toBeVisible();
  }
  await expect(page.getByText("1% of the gain, on winning rounds only")).toBeVisible();
  const panel = page.getByRole("region", { name: "Tilt panel" });
  await expect(panel).toContainText("[4] Slots");
  await expect(panel).toContainText("Hit, stand or double.");
  // The mock must stay monospace whatever font the landing uses.
  expect(await panel.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains|mono/i);
  // Waitlist mode: no way into the app pages from the landing.
  for (const path of ["/account", "/verify", "/leaderboard"]) {
    await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
  }
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

test("joins the waitlist", async ({ page }) => {
  let sent: unknown;
  await page.route("**/api/waitlist", (route) => {
    sent = route.request().postDataJSON();
    return json(route, 200, {});
  });
  await page.goto("/");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByRole("status")).toContainText("You're on the list.");
  expect(sent).toEqual({ email: "ada@example.com", website: "" });
});

test("shows the waitlist error", async ({ page }) => {
  await page.route("**/api/waitlist", (route) => json(route, 400, { error: "Enter a valid email." }));
  await page.goto("/");
  await page.getByLabel("Email").fill("nope");
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page.getByText("Enter a valid email.")).toHaveAttribute("role", "alert");
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
