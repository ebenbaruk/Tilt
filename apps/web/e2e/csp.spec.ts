import { expect, json, test } from "./fixtures";

for (const path of ["/", "/connect?code=WDJB-MJHT"]) {
  test(`${path} runs under a nonce-based CSP without violations`, async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });
    await page.route("**/v1/geo", (route) => json(route, 200, { allowed: true, country: "DE" }));
    const response = await page.goto(path);
    const csp = response?.headers()["content-security-policy"] ?? "";
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    // Hydrated: client components ran (the geo check answered), so Next's scripts were allowed.
    if (path !== "/") await expect(page.getByLabel("code")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
}

test("a fresh nonce on every request", async ({ request }) => {
  const nonce = async () =>
    (await request.get("/")).headers()["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
  const [a, b] = [await nonce(), await nonce()];
  expect(a).toBeTruthy();
  expect(a).not.toBe(b);
});
