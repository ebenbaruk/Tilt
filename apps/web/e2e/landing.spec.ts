import { expect, test } from "./fixtures";

test("landing shows the pitch, install snippet and key sections", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The casino you play while your agent codes.");

  const install = page.getByLabel("Install commands");
  await expect(install).toContainText("/plugin marketplace add ebenbaruk/Tilt");
  await expect(install).toContainText("/plugin install tilt");
  await expect(install).toContainText("/tilt login");

  for (const name of [
    "How it works",
    "Games",
    "Provably fair, on-chain",
    "Be the name next to the prize pool.",
    "Fair questions",
  ]) {
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }
  await expect(page.getByRole("cell", { name: "97.30%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "96.16%" })).toBeVisible();
  await expect(page.getByText("1% of the gain, on winning rounds only")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tilt panel" })).toContainText("agent finished");
  await expect(page.getByRole("link", { name: "verify a round →" })).toHaveAttribute("href", "/verify");
  await expect(page.locator("#responsible")).toContainText("United Kingdom, France");
});

test("faq answers open with the keyboard", async ({ page }) => {
  await page.goto("/");
  const question = page.getByText("Do I need SOL for fees?");
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Tilt pays the Solana network fees.")).toBeVisible();
});

test("legal pages are marked as drafts", async ({ page }) => {
  for (const path of ["/legal/terms", "/legal/privacy", "/legal/responsible-gaming"]) {
    await page.goto(path);
    await expect(page.getByText("working draft pending review by counsel")).toBeVisible();
  }
});
