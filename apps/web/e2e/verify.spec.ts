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
  choicesRecorded: true,
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

test("draws a mines board: safe tiles in reveal order and the busting mine", async ({ page }) => {
  const mines: VerifyResponse = {
    ...RESULT,
    game: "mines",
    replayed: {
      ...RESULT.replayed,
      stake: "1000000",
      payout: "0",
      fee: "0",
      net: "-1000000",
      detail: {
        game: "mines",
        mines: 3,
        revealed: [7, 0],
        pending: null,
        busted: 12,
        multiplier: "1.2857",
        nextMultiplier: null,
        canCashOut: false,
        canReveal: false,
      },
    },
    onChain: { stake: "1000000", payout: "0", fee: "0" },
  };
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, mines));
  await page.goto(`/verify/${SIGNATURE}`);
  const board = page.getByRole("img", { name: "2 safe tiles revealed, hit a mine at row 3 column 3" });
  await expect(board).toBeVisible();
  await expect(board).toHaveText(`2······1····✸${"·".repeat(12)}`);
  await expect(page.getByText("3 mines · hit a mine at row 3 column 3")).toBeVisible();
});

/** RESULT replayed as a 1 USDC round of another game. */
function replayOf(detail: VerifyResponse["replayed"]["detail"], payout: string, fee: string): VerifyResponse {
  const net = (BigInt(payout) - BigInt(fee) - 1_000_000n).toString();
  return {
    ...RESULT,
    game: detail.game,
    replayed: { ...RESULT.replayed, stake: "1000000", payout, fee, net, detail },
    onChain: { stake: "1000000", payout, fee },
  };
}

test("draws a dice roll against its target", async ({ page }) => {
  const dice = replayOf(
    { game: "dice", target: 5000, over: false, roll: 4832, multiplier: "1.9600" },
    "1960000",
    "9600",
  );
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, dice));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("48.32", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "rolled 48.32, under 50.00: win" })).toBeVisible();
  await expect(page.getByText("under 50.00 · 50.00% chance · ×1.9600")).toBeVisible();
});

test("draws a keno board: picks, drawn numbers and hits", async ({ page }) => {
  const keno = replayOf(
    {
      game: "keno",
      picks: [3, 7, 12, 25, 40],
      drawn: [7, 12, 1, 2, 5, 9, 18, 30, 33, 39],
      hits: 2,
      paytable: ["0.00", "0.00", "1.50", "4.00", "12.00", "50.00"],
    },
    "1500000",
    "5000",
  );
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, keno));
  await page.goto(`/verify/${SIGNATURE}`);
  const board = page.getByRole("img", { name: "5 picks, 2 hits" });
  await expect(board).toHaveText(Array.from({ length: 40 }, (_, i) => i + 1).join(""));
  await expect(page.getByText("5 picks, 2 hits · pays ×1.50")).toBeVisible();
});

test("draws a hilo round: the cards under the guesses that drew them", async ({ page }) => {
  const hilo = replayOf(
    {
      game: "hilo",
      cards: [
        { rank: 7, suit: "♠" },
        { rank: 10, suit: "♥" },
        { rank: 4, suit: "♦" },
        { rank: 4, suit: "♣" },
        { rank: 9, suit: "♠" },
      ],
      guesses: ["higher", "lower", "skip", "lower"],
      pending: null,
      multiplier: "3.0120",
      higherMultiplier: null,
      lowerMultiplier: null,
      skipsLeft: 9,
      canGuess: false,
      canCashOut: false,
      busted: true,
    },
    "0",
    "0",
  );
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, hilo));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByRole("img", { name: "7 of spades" })).toBeVisible();
  await expect(page.getByRole("img", { name: "9 of spades" })).toBeVisible();
  for (const label of ["start", "↑ higher", "↷ skip", "wrong guess"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("↓ lower", { exact: true })).toHaveCount(2);
});

test("draws a tower: the climbed tiles and the busting level", async ({ page }) => {
  const tower = replayOf(
    {
      game: "tower",
      difficulty: "medium",
      tiles: 3,
      levels: 9,
      climbed: [0, 2, 1],
      pending: null,
      busted: 2,
      multiplier: "3.3075",
      nextMultiplier: null,
      canClimb: false,
      canCashOut: false,
    },
    "0",
    "0",
  );
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, tower));
  await page.goto(`/verify/${SIGNATURE}`);
  const board = page.getByRole("img", { name: "3 levels climbed, fell at level 4, tile 3" });
  // Top level first: five untouched levels, the bust, then the climbed levels down to the first.
  await expect(board).toHaveText(`${"·".repeat(15)}··✸·◆···◆◆··`);
  await expect(page.getByText("medium · fell at level 4, tile 3")).toBeVisible();
});

test("draws a roulette spin with several chips: their stakes on the felt and the ones it paid", async ({ page }) => {
  // 17 lands: black, the straight and the second dozen pay; column 1 (1, 4, … 34) loses.
  const chips: VerifyResponse = {
    ...RESULT,
    game: "roulette",
    replayed: {
      ...RESULT.replayed,
      stake: "2300000",
      payout: "37900000",
      fee: "356000",
      net: "35244000",
      detail: {
        game: "roulette",
        bet: { kind: "straight", number: 17 },
        chips: [
          { bet: { kind: "straight", number: 17 }, amount: "1000000" },
          { bet: { kind: "black" }, amount: "500000" },
          { bet: { kind: "dozen", dozen: 2 }, amount: "300000" },
          { bet: { kind: "column", column: 1 }, amount: "500000" },
        ],
        number: 17,
      },
    },
    onChain: { stake: "2300000", payout: "37900000", fee: "356000" },
  };
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, chips));
  await page.goto(`/verify/${SIGNATURE}`);
  const felt = page.getByRole("img", { name: "landed on 17, 3 of 4 chips won" });
  await expect(felt).toBeVisible();
  for (const cell of ["17●1.00", "BLACK●0.50", "2nd 12●0.30", "2:1●0.50"]) {
    await expect(felt).toContainText(cell);
  }
  await expect(page.getByText("on the table 2.30 · 4 chips · landed on 17, 3 of 4 chips won")).toBeVisible();
  for (const chip of [
    "straight 17 · 1.00 · won",
    "black · 0.50 · won",
    "dozen 2 · 0.30 · won",
    "column 1 · 0.50 · lost",
  ]) {
    await expect(page.getByText(chip, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Replay matches on-chain.")).toBeVisible();
});

test("a single-bet roulette round keeps its pocket and bet", async ({ page }) => {
  const single = replayOf(
    { game: "roulette", bet: { kind: "black" }, chips: [{ bet: { kind: "black" }, amount: "1000000" }], number: 17 },
    "2000000",
    "10000",
  );
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, single));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("17", { exact: true })).toBeVisible();
  await expect(page.getByText("bet black", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /chips won/ })).toHaveCount(0);
});

test("the widest drawings stay readable on a phone", async ({ page }) => {
  const felt = replayOf(
    {
      game: "roulette",
      bet: { kind: "straight", number: 36 },
      chips: [
        { bet: { kind: "straight", number: 36 }, amount: "100000000" },
        { bet: { kind: "straight", number: 0 }, amount: "12500000" },
        { bet: { kind: "dozen", dozen: 1 }, amount: "300000" },
        { bet: { kind: "column", column: 3 }, amount: "500000" },
      ],
      number: 36,
    },
    "0",
    "0",
  );
  const wheel = replayOf(
    {
      game: "wheel",
      segments: 50,
      risk: "high",
      multipliers: Array.from({ length: 50 }, (_, i) => (i === 0 ? "49.00" : "0.00")),
      segment: 0,
    },
    "0",
    "0",
  );
  await page.setViewportSize({ width: 375, height: 800 });
  for (const [round, name] of [
    [felt, "landed on 36, 2 of 4 chips won"],
    [wheel, "50 segments · high risk · landed on segment 1, ×49.00"],
  ] as const) {
    await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, round));
    await page.goto(`/verify/${SIGNATURE}`);
    const drawing = page.getByRole("img", { name });
    await expect(drawing).toBeVisible();
    // Every cell's label and stake fit inside it, and only the drawing itself may scroll sideways.
    const clipped = await drawing.evaluate((el) =>
      [...el.children].filter((cell) => cell.scrollWidth > cell.clientWidth).map((cell) => cell.textContent),
    );
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    await page.unroute(`**/v1/rounds/${SIGNATURE}/verify`);
  }
});

test("flags a mismatch", async ({ page }) => {
  const mismatch: VerifyResponse = { ...RESULT, onChain: { ...RESULT.onChain, payout: "6500000" }, matches: false };
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, mismatch));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("Replay does not match on-chain.")).toBeVisible();
  await expect(page.getByLabel("differs")).toHaveText("✗");
});

test("says when the player's choices weren't recorded", async ({ page }) => {
  const unrecorded: VerifyResponse = { ...RESULT, choicesRecorded: false };
  await page.route(`**/v1/rounds/${SIGNATURE}/verify`, (route) => json(route, 200, unrecorded));
  await page.goto(`/verify/${SIGNATURE}`);
  await expect(page.getByText("the player's choices weren't recorded")).toBeVisible();
  await expect(page.getByText("Replay matches on-chain.")).toHaveCount(0);
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
