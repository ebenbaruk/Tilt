// StateResponses as apps/api sends them, one per screen the mod draws.
import type { BlackjackHandView, Card, RoundView, StateResponse } from "../hooks/protocol";
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
  ahead: { rank: 413, handle: "@sol", net: "21150000", isYou: false },
  webUrl: "https://tilt.example",
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

const card = (rank: number, suit: Card["suit"]): Card => ({ rank, suit });

const hand = (cards: Card[], total: number, fields: Partial<BlackjackHandView> = {}): BlackjackHandView => ({
  cards,
  total,
  soft: false,
  doubled: false,
  split: false,
  stake: "1000000",
  result: null,
  ...fields,
});

export const BLACKJACK_TURN: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    net: "0",
    detail: {
      game: "blackjack",
      hands: [hand([card(3, "♣"), card(8, "♦")], 11)],
      activeHand: 0,
      dealer: [card(9, "♥")],
      dealerTotal: 9,
      canHit: true,
      canDouble: true,
      canSplit: false,
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
      hands: [hand([card(10, "♠"), card(9, "♥")], 19, { result: "win" })],
      activeHand: null,
      dealer: [card(9, "♥"), card(8, "♣")],
      dealerTotal: 17,
      canHit: false,
      canDouble: false,
      canSplit: false,
    },
  }),
};

export const BLACKJACK_LOSS: StateResponse = {
  ...BASE,
  round: round({
    detail: {
      game: "blackjack",
      hands: [hand([card(10, "♠"), card(4, "♦"), card(13, "♣")], 24, { result: "lose" })],
      activeHand: null,
      dealer: [card(6, "♥")],
      dealerTotal: 6,
      canHit: false,
      canDouble: false,
      canSplit: false,
    },
  }),
};

/** Six hands, the third to play: the first stood on 20, the second is a natural. */
export const BLACKJACK_SIX_TURN: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    stake: "6000000",
    net: "0",
    number: 8,
    detail: {
      game: "blackjack",
      hands: [
        hand([card(10, "♠"), card(13, "♥")], 20),
        hand([card(1, "♠"), card(13, "♦")], 21),
        hand([card(5, "♣"), card(6, "♥")], 11),
        hand([card(1, "♦"), card(6, "♣")], 17, { soft: true }),
        hand([card(9, "♠"), card(7, "♦")], 16),
        hand([card(2, "♥"), card(3, "♠")], 5),
      ],
      activeHand: 2,
      dealer: [card(9, "♥")],
      dealerTotal: 9,
      canHit: true,
      canDouble: true,
      canSplit: false,
    },
  }),
};

/** Four hands settled against a dealer 18: a natural, a bust, a doubled win and a push. */
export const BLACKJACK_MIXED: StateResponse = {
  ...BASE,
  round: round({
    stake: "5000000",
    payout: "7500000",
    fee: "25000",
    net: "2475000",
    number: 9,
    detail: {
      game: "blackjack",
      hands: [
        hand([card(1, "♥"), card(12, "♣")], 21, { result: "blackjack" }),
        hand([card(10, "♦"), card(5, "♠"), card(9, "♣")], 24, { result: "lose" }),
        hand([card(5, "♦"), card(6, "♣"), card(9, "♥")], 20, { doubled: true, stake: "2000000", result: "win" }),
        hand([card(9, "♠"), card(9, "♦")], 18, { result: "push" }),
      ],
      activeHand: null,
      dealer: [card(10, "♠"), card(8, "♥")],
      dealerTotal: 18,
      canHit: false,
      canDouble: false,
      canSplit: false,
    },
  }),
};

/** One hand, a pair of eights: it can split. */
export const BLACKJACK_PAIR: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    net: "0",
    detail: {
      game: "blackjack",
      hands: [hand([card(8, "♠"), card(8, "♥")], 16)],
      activeHand: 0,
      dealer: [card(6, "♦")],
      dealerTotal: 6,
      canHit: true,
      canDouble: true,
      canSplit: true,
    },
  }),
};

const split = { split: true };

/** Six hands dealt and four splits, the most a round holds: aces split once (one card each, the
 * second a 21 that is no blackjack), queens once, eights twice; the third eight is to play. */
export const BLACKJACK_TEN_TURN: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    stake: "10000000",
    net: "0",
    number: 10,
    detail: {
      game: "blackjack",
      hands: [
        hand([card(10, "♠"), card(13, "♥")], 20),
        hand([card(1, "♠"), card(9, "♦")], 20, { ...split, soft: true }),
        hand([card(1, "♥"), card(13, "♣")], 21, split),
        hand([card(12, "♠"), card(2, "♦"), card(7, "♣")], 19, split),
        hand([card(12, "♥"), card(10, "♦")], 20, split),
        hand([card(8, "♠"), card(10, "♣")], 18, split),
        hand([card(8, "♦"), card(5, "♥"), card(9, "♣")], 22, split),
        hand([card(8, "♣"), card(3, "♦")], 11, split),
        hand([card(5, "♣"), card(6, "♥")], 11),
        hand([card(2, "♥"), card(3, "♠")], 5),
      ],
      activeHand: 7,
      dealer: [card(9, "♥")],
      dealerTotal: 9,
      canHit: true,
      canDouble: true,
      canSplit: false,
    },
  }),
};

/** Split aces settled against a dealer 18: the ace and king pay 1:1 (a win, not a blackjack), the
 * other ace pushes; the dealt 19 wins. */
export const BLACKJACK_SPLIT_SETTLED: StateResponse = {
  ...BASE,
  round: round({
    stake: "3000000",
    payout: "5000000",
    fee: "20000",
    net: "1980000",
    number: 11,
    detail: {
      game: "blackjack",
      hands: [
        hand([card(1, "♠"), card(13, "♦")], 21, { ...split, result: "win" }),
        hand([card(1, "♥"), card(7, "♣")], 18, { ...split, soft: true, result: "push" }),
        hand([card(10, "♣"), card(9, "♦")], 19, { result: "win" }),
      ],
      activeHand: null,
      dealer: [card(10, "♠"), card(8, "♥")],
      dealerTotal: 18,
      canHit: false,
      canDouble: false,
      canSplit: false,
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
