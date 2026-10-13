// StateResponses as apps/api sends them, one per screen the mod draws.
import type { RoundView, StateResponse } from "../hooks/protocol";
import { NOW } from "./world";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const BASE: StateResponse = {
  accountOpen: true,
  balance: "12400000",
  round: null,
  pendingIntentId: null,
  limits: { minBet: "500000", maxBet: "25000000" },
  rtp: { blackjack: "99.00", roulette: "97.30", baccarat: "98.94", slots: "96.16" },
  sponsor: {
    name: "Northwind Cloud",
    tagline: "gpus by the minute",
    pool: "3000000000",
    endsAt: new Date(NOW + 14 * HOUR + 3.5 * MINUTE).toISOString(),
  },
  leaderboard: [
    { rank: 1, handle: "@0xkira", net: "412900000", isYou: false },
    { rank: 2, handle: "@lena", net: "388100000", isYou: false },
    { rank: 3, handle: "@rho", net: "201000000", isYou: false },
    { rank: 414, handle: "@eli", net: "17950000", isYou: true },
  ],
  rank: 414,
  blocked: null,
};

const round = (fields: Partial<RoundView> & Pick<RoundView, "detail">): RoundView => ({
  phase: "idle",
  stake: "1000000",
  payout: "0",
  fee: "0",
  net: "-1000000",
  number: 7,
  settledSignature: null,
  ...fields,
});

export const BLACKJACK_TURN: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    net: "0",
    detail: {
      game: "blackjack",
      player: [
        { rank: 3, suit: "♣" },
        { rank: 8, suit: "♦" },
      ],
      dealer: [{ rank: 9, suit: "♥" }],
      playerTotal: 11,
      dealerTotal: 9,
      playerSoft: false,
      doubled: false,
      canHit: true,
      canDouble: true,
    },
  }),
};

export const BLACKJACK_WIN: StateResponse = {
  ...BASE,
  round: round({
    payout: "2000000",
    fee: "10000",
    net: "990000",
    detail: {
      game: "blackjack",
      player: [
        { rank: 10, suit: "♠" },
        { rank: 9, suit: "♥" },
      ],
      dealer: [
        { rank: 9, suit: "♥" },
        { rank: 8, suit: "♣" },
      ],
      playerTotal: 19,
      dealerTotal: 17,
      playerSoft: false,
      doubled: false,
      canHit: false,
      canDouble: false,
    },
  }),
};

export const BLACKJACK_LOSS: StateResponse = {
  ...BASE,
  round: round({
    detail: {
      game: "blackjack",
      player: [
        { rank: 10, suit: "♠" },
        { rank: 4, suit: "♦" },
        { rank: 13, suit: "♣" },
      ],
      dealer: [{ rank: 6, suit: "♥" }],
      playerTotal: 24,
      dealerTotal: 6,
      playerSoft: false,
      doubled: false,
      canHit: false,
      canDouble: false,
    },
  }),
};

export const ROULETTE: StateResponse = {
  ...BASE,
  round: round({ detail: { game: "roulette", bet: { kind: "red" }, number: 17 } }),
};

export const BACCARAT: StateResponse = {
  ...BASE,
  round: round({
    payout: "1950000",
    fee: "9500",
    net: "940500",
    detail: {
      game: "baccarat",
      bet: "banker",
      player: [
        { rank: 2, suit: "♠" },
        { rank: 3, suit: "♥" },
      ],
      banker: [
        { rank: 13, suit: "♦" },
        { rank: 7, suit: "♣" },
      ],
      playerPoints: 5,
      bankerPoints: 7,
    },
  }),
};

export const SLOTS: StateResponse = {
  ...BASE,
  round: round({
    payout: "5000000",
    fee: "40000",
    net: "3960000",
    detail: { game: "slots", reels: ["7", "7", "★"] },
  }),
};

export const SLOTS_DRAWING: StateResponse = {
  ...BASE,
  round: round({ phase: "drawing", net: "0", detail: { game: "slots", reels: null } }),
};

export const NOT_OPEN: StateResponse = { ...BASE, accountOpen: false, balance: "0", leaderboard: [], rank: null };

export const BLOCKED: StateResponse = { ...BASE, blocked: "Self-exclusion until 2026-11-01." };
