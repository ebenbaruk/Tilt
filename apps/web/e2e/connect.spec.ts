import { expect, json, test } from "./fixtures";

// Privy's network is blocked, so these cover every state reachable before a live login.

test("shows the code from the terminal once the region is allowed", async ({ page }) => {
  await page.route("**/v1/geo", (route) => json(route, 200, { allowed: true, country: "DE" }));
  await page.goto("/connect?code=wdjb-mjht");
  await expect(page.getByTestId("user-code")).toHaveText("WDJB-MJHT");
  await expect(page.getByText("Only approve if it matches")).toBeVisible();
});

test("rejects a malformed code", async ({ page }) => {
  await page.route("**/v1/geo", (route) => json(route, 200, { allowed: true, country: "DE" }));
  await page.goto("/connect?code=<script>");
  await expect(page.getByText("no valid code")).toBeVisible();
  await expect(page.getByTestId("user-code")).toHaveCount(0);
});

test("blocks restricted regions before any login", async ({ page }) => {
  await page.route("**/v1/geo", (route) => json(route, 200, { allowed: false, country: "FR" }));
  await page.goto("/connect?code=WDJB-MJHT");
  await expect(page.getByText("not available in your region")).toBeVisible();
  await expect(page.getByText("(FR)")).toBeVisible();
  await expect(page.getByTestId("user-code")).toHaveCount(0);
});

test("fails closed when the region check errors", async ({ page }) => {
  await page.route("**/v1/geo", (route) => route.abort());
  await page.goto("/account");
  await expect(page.getByText("region check failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "retry" })).toBeVisible();
});
