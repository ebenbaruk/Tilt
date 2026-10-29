import { expect, json, test } from "./fixtures";

const GAMES = [
  ["Blackjack", "≈ 99.2%"],
  ["Roulette", "97.30%"],
  ["Baccarat", "98.94%"],
  ["Slots", "96.16%"],
  ["Mines", "99.00%"],
  ["Dice", "98.00%"],
  ["Limbo", "≤ 98.00%"],
  ["Flip", "98.00%"],
  ["Keno", "94.90–95.00%"],
  ["Wheel", "98.00%"],
  ["Hilo", "98.00%"],
  ["Tower", "98.00%"],
] as const;

test("landing shows the pitch, the waitlist and key sections", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The casino you play while your agent codes");

  await expect(page.getByLabel("Email")).toBeVisible();

  for (const name of [
    "The most fun way to wait on your agent.",
    "The games",
    "How it works",
    "Provably fair",
    "Be the name next to the prize pool.",
    "Questions",
    "Play with what you can afford to lose.",
    "Get in early",
  ]) {
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }
  await expect(page.getByText("1% of the gain, on winning rounds only")).toBeVisible();
  await expect(page.getByText("Wins are capped at 10,000× the stake.")).toBeVisible();
  // The game tables are scripted: the page says so, beside them and in the showcase.
  await expect(page.getByText("The tables below are scripted demos")).toBeVisible();
  await expect(page.locator("#showcase")).toContainText("Demo round, on a loop:");
  // Waitlist mode: no way into the app pages from the landing.
  for (const path of ["/account", "/verify", "/leaderboard"]) {
    await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
  }
  await expect(page.locator("#responsible")).toContainText("United Kingdom, France");
});

test("previews all twelve games with their rtp", async ({ page }) => {
  await page.goto("/");
  const games = page.locator("#games");
  await expect(games.getByRole("tab")).toHaveCount(GAMES.length);
  const cards = games.getByRole("listitem");
  await expect(cards).toHaveCount(GAMES.length);
  for (const [i, [name, rtp]] of GAMES.entries()) {
    const card = cards.nth(i);
    await expect(card.getByRole("heading", { name, level: 3 })).toBeVisible();
    await expect(card).toContainText(rtp);
    // Each card draws its game's table (decorative) next to the text alternative.
    await expect(card.locator('[aria-hidden="true"]').first()).toBeAttached();
    await expect(card).toContainText("Demo round:");
  }
  // The demos stay monospace whatever font the titles use.
  expect(await page.locator("#showcase").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/JetBrains|mono/i);
});

test("switches games in the showcase with the keyboard and the grid", async ({ page }) => {
  await page.goto("/");
  const tabs = page.locator("#games").getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("3");
  await expect(page.getByRole("tab", { name: "Baccarat" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Baccarat" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Slots" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Top win 250×");
  await page.getByRole("button", { name: "Watch the Tower demo in the big terminal" }).click();
  await expect(page.getByRole("tab", { name: "Tower" })).toHaveAttribute("aria-selected", "true");
});

test("the first landing stays reachable as an archive", async ({ page }) => {
  await page.goto("/archive/landing-v1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The casino you play while your agent codes");
  await expect(page.getByRole("heading", { name: "Get in early", level: 2 })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
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
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
  }
});

test("legal pages are marked as drafts", async ({ page }) => {
  for (const path of ["/legal/terms", "/legal/privacy", "/legal/responsible-gaming"]) {
    await page.goto(path);
    await expect(page.getByText("working draft pending review by counsel")).toBeVisible();
  }
});
