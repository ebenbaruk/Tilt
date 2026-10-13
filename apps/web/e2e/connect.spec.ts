import { expect, json, test } from "./fixtures";

// Privy's network is blocked, so these cover every state reachable before a live login.

test("never pre-fills the code from the link: the player types the one in their terminal", async ({ page }) => {
  await page.route("**/v1/geo", (route) => json(route, 200, { allowed: true, country: "DE" }));
  await page.goto("/connect?code=wdjb-mjht");
  await expect(page.getByText("Only approve if you just ran /tilt login in your own terminal")).toBeVisible();
  const input = page.getByLabel("code");
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("link-code")).toHaveText("WDJB-MJHT");
  await expect(page.getByText("Make sure this matches your terminal")).toBeVisible();
  await input.fill("wdjb-mjh0");
  await expect(page.getByText("That isn't a code")).toBeVisible();
  await input.fill("wdjb mjht");
  await expect(page.getByText("That isn't a code")).toHaveCount(0);
});

test("ignores a malformed code in the link", async ({ page }) => {
  await page.route("**/v1/geo", (route) => json(route, 200, { allowed: true, country: "DE" }));
  await page.goto("/connect?code=<script>");
  await expect(page.getByLabel("code")).toHaveValue("");
  await expect(page.getByTestId("link-code")).toHaveCount(0);
});

test("blocks restricted regions before any login", async ({ page }) => {
  await page.route("**/v1/geo", (route) => json(route, 200, { allowed: false, country: "FR" }));
  await page.goto("/connect?code=WDJB-MJHT");
  await expect(page.getByText("not available in your region")).toBeVisible();
  await expect(page.getByText("(FR)")).toBeVisible();
  await expect(page.getByLabel("code")).toHaveCount(0);
});

test("fails closed when the region check errors", async ({ page }) => {
  await page.route("**/v1/geo", (route) => route.abort());
  await page.goto("/account");
  await expect(page.getByText("region check failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "retry" })).toBeVisible();
});
