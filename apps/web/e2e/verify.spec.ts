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
    stake: "1000000",
    payout: "2000000",
    fee: "10000",
    net: "990000",
    number: 1204,
    settledSignature: SIGNATURE,
    detail: {
      game: "blackjack",
      player: [
        { rank: 13, suit: "♠" },
        { rank: 10, suit: "♥" },
      ],
      dealer: [
        { rank: 9, suit: "♦" },
        { rank: 10, suit: "♣" },
      ],
      playerTotal: 20,
      dealerTotal: 19,
      playerSoft: false,
      doubled: false,
      canHit: false,
      canDouble: false,
    },
  },
  onChain: { stake: "1000000", payout: "2000000", fee: "10000" },
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
  await expect(page.getByRole("row", { name: /payout 2\.00 2\.00/ })).toBeVisible();
  await expect(page.getByText("+0.99")).toBeVisible();
  await expect(page.getByRole("link", { name: RESULT.player })).toHaveAttribute(
    "href",
    /explorer\.solana\.com\/address\/.*cluster=devnet/,
  );
});

test("flags a mismatch", async ({ page }) => {
  const mismatch: VerifyResponse = { ...RESULT, onChain: { ...RESULT.onChain, payout: "2500000" }, matches: false };
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
