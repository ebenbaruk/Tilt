import type { VerifyResponse } from "@tilt/api/public";
import { SIGNATURE, expect, json, test } from "./fixtures";

const RESULT: VerifyResponse = {
  signature: SIGNATURE,
  player: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  round: 1204,
  game: "blackjack",
  randomness: "9f3c0b5e7d1a2c4e6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4a71e",
  replayed: {
    phase: "idle",
    stake: "3000000",
    payout: "4000000",
    fee: "10000",
    net: "990000",
    number: 1204,
    settledSignature: SIGNATURE,
    detail: {
      game: "blackjack",
      // A pair of fives split: the first hand doubled after the split.
      hands: [
        {
          cards: [
            { rank: 5, suit: "♣" },
            { rank: 6, suit: "♠" },
            { rank: 10, suit: "♥" },
          ],
          total: 21,
          soft: false,
          doubled: true,
          split: true,
          stake: "2000000",
          result: "win",
        },
        {
          cards: [
            { rank: 5, suit: "♦" },
            { rank: 13, suit: "♠" },
          ],
          total: 15,
          soft: false,
          doubled: false,
          split: true,
          stake: "1000000",
          result: "lose",
        },
      ],
      activeHand: null,
      dealer: [
        { rank: 9, suit: "♦" },
        { rank: 10, suit: "♣" },
      ],
      dealerTotal: 19,
      canHit: false,
      canDouble: false,
      canSplit: false,
    },
  },
  onChain: { stake: "3000000", payout: "4000000", fee: "10000" },
  matches: true,
};

test("the form rejects a malformed signature and opens a valid one", async ({ page }) => {
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, RESULT));
  await page.goto("/verify");
  const input = page.getByLabel("round signature");
  await input.fill("not-a-signature");
  await page.getByRole("button", { name: "verify" }).click();
  await expect(page.getByText(/isn.t a Solana transaction signature/)).toBeVisible();

  await input.fill(SIGNATURE);
  await page.getByRole("button", { name: "verify" }).click();
  await expect(page).toHaveURL(`/verify/${SIGNATURE}`);
  await expect(page.getByText("Replay matches on-chain.")).toBeVisible();
});

test("shows the replay, the VRF randomness and the on-chain comparison", async ({ page }) => {
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, RESULT));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByTestId("randomness")).toHaveText(RESULT.randomness);
  await expect(page.getByRole("img", { name: "K of spades" })).toBeVisible();
  await expect(page.getByRole("img", { name: "9 of diamonds" })).toBeVisible();
  await expect(page.getByText("HAND 2")).toBeVisible();
  await expect(page.getByText("split · doubled · win")).toBeVisible();
  await expect(page.getByText("split · lose")).toBeVisible();
  await expect(page.getByRole("row", { name: /payout 4\.00 4\.00/ })).toBeVisible();
  await expect(page.getByText("+0.99")).toBeVisible();
  await expect(page.getByRole("link", { name: RESULT.player })).toHaveAttribute(
    "href",
    /explorer\.solana\.com\/address\/.*cluster=devnet/,
  );
});

test("flags a mismatch", async ({ page }) => {
  const mismatch: VerifyResponse = { ...RESULT, onChain: { ...RESULT.onChain, payout: "6500000" }, matches: false };
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, mismatch));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("Replay does not match on-chain.")).toBeVisible();
  await expect(page.getByLabel("differs")).toHaveText("✗");
});

test("explains an unknown round", async ({ page }) => {
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) =>
    json(route, 404, { error: { code: "NOT_FOUND", message: "unknown round" } }),
  );
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("round not found")).toBeVisible();
});

test("an answer the page can't read keeps the site and offers a retry", async ({ page }) => {
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, {}));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("this page couldn't load")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("button", { name: "retry" })).toBeVisible();
});

test("never shows an API error page's internals", async ({ page }) => {
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) =>
    route.fulfill({ status: 500, contentType: "text/html", body: "<h1>TypeError at db.ts:12</h1>" }),
  );
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("Something broke on Tilt's side.")).toBeVisible();
  await expect(page.getByText("db.ts")).toHaveCount(0);
});
