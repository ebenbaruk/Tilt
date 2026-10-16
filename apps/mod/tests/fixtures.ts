// StateResponses as apps/api sends them, one per screen the mod draws.
import type {
  BlackjackHandView,
  Card,
  HiloView,
  MinesView,
  RoundView,
  StateResponse,
  TowerView,
} from "../hooks/protocol";
import { NOW } from "./world";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const BASE: StateResponse = {
  accountOpen: true,
  balance: "12400000",
  round: null,
  pendingIntentId: null,
  limits: { minBet: "500000", maxBet: "25000000" },
  rtp: {
    blackjack: "99.00",
    roulette: "97.30",
    baccarat: "98.94",
    slots: "96.16",
    mines: "99.00",
    dice: "98.00",
    limbo: "98.00",
    flip: "98.00",
    keno: "98.00",
    wheel: "98.00",
    hilo: "98.00",
    tower: "98.00",
  },
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

const minesBoard = (fields: Partial<MinesView>): MinesView => ({
  game: "mines",
  mines: 3,
  revealed: [],
  pending: null,
  busted: null,
  multiplier: "1.0000",
  nextMultiplier: "1.1250",
  canCashOut: false,
  canReveal: false,
  ...fields,
});

/** Three mines, g and m safe: the next tile or a cash-out at ×1.2857. */
export const MINES_TURN: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    net: "0",
    detail: minesBoard({
      revealed: [6, 12],
      multiplier: "1.2857",
      nextMultiplier: "1.4785",
      canCashOut: true,
      canReveal: true,
    }),
  }),
};

/** m revealed after g: its draw is on its way. */
export const MINES_DRAWING: StateResponse = {
  ...BASE,
  round: round({
    phase: "drawing",
    net: "0",
    detail: minesBoard({ revealed: [6], pending: 12, multiplier: "1.1250", nextMultiplier: "1.2857" }),
  }),
};

/** g safe, then a mine on h. */
export const MINES_BUSTED: StateResponse = {
  ...BASE,
  round: round({
    detail: minesBoard({ revealed: [6], busted: 7, multiplier: "1.1250", nextMultiplier: null }),
  }),
};

/** Cashed out after g, m and s: 1.00 × 99 × C(25,3) / (100 × C(22,3)) = 1.478571, less 1% of the gain. */
export const MINES_CASHED: StateResponse = {
  ...BASE,
  round: round({
    payout: "1478571",
    fee: "4785",
    net: "473786",
    detail: minesBoard({ revealed: [6, 12, 18], multiplier: "1.4785", nextMultiplier: null }),
  }),
};

export const NOT_OPEN: StateResponse = { ...BASE, accountOpen: false, balance: "0", leaderboard: [], rank: null };

export const BLOCKED: StateResponse = { ...BASE, blocked: "Self-exclusion until 2026-11-01." };

/** Under 49.00 rolled 37.42: ×2 less 1% of the gain. */
export const DICE: StateResponse = {
  ...BASE,
  round: round({
    payout: "2000000",
    fee: "10000",
    net: "990000",
    detail: { game: "dice", target: 4900, over: false, roll: 3742, multiplier: "2.0000" },
  }),
};

/** Over 75.00 (25% to win), rolled 12.00. */
export const DICE_LOSS: StateResponse = {
  ...BASE,
  round: round({ detail: { game: "dice", target: 7500, over: true, roll: 1200, multiplier: "3.9200" } }),
};

export const DICE_DRAWING: StateResponse = {
  ...BASE,
  round: round({
    phase: "drawing",
    net: "0",
    detail: { game: "dice", target: 4900, over: false, roll: null, multiplier: "2.0000" },
  }),
};

/** ×1.53 under a ×2.00 target. */
export const LIMBO: StateResponse = {
  ...BASE,
  round: round({ detail: { game: "limbo", target: "2.00", result: "1.53" } }),
};

export const LIMBO_WIN: StateResponse = {
  ...BASE,
  round: round({
    payout: "2000000",
    fee: "10000",
    net: "990000",
    detail: { game: "limbo", target: "2.00", result: "3.12" },
  }),
};

/** Three heads on three coins: 0.98 × 2³ = ×7.84, a big win. */
export const FLIP: StateResponse = {
  ...BASE,
  round: round({
    payout: "7840000",
    fee: "68400",
    net: "5771600",
    detail: { game: "flip", side: "heads", flips: 3, results: ["heads", "heads", "heads"], multiplier: "7.8400" },
  }),
};

export const FLIP_LOSS: StateResponse = {
  ...BASE,
  round: round({
    detail: { game: "flip", side: "heads", flips: 2, results: ["heads", "tails"], multiplier: "3.9200" },
  }),
};

const KENO_PAYS = ["0.00", "0.00", "1.50", "4.00", "12.00", "50.00"];

/** Five picks, 4, 12 and 27 drawn: three hits at ×4. */
export const KENO: StateResponse = {
  ...BASE,
  round: round({
    payout: "4000000",
    fee: "30000",
    net: "2970000",
    detail: {
      game: "keno",
      picks: [4, 12, 19, 27, 35],
      drawn: [1, 4, 8, 12, 15, 22, 27, 30, 33, 40],
      hits: 3,
      paytable: KENO_PAYS,
    },
  }),
};

export const KENO_DRAWING: StateResponse = {
  ...BASE,
  round: round({
    phase: "drawing",
    net: "0",
    detail: { game: "keno", picks: [4, 12, 19, 27, 35], drawn: null, hits: null, paytable: KENO_PAYS },
  }),
};

const WHEEL_LOW_10 = ["1.50", "1.20", "1.20", "1.20", "0.00", "1.50", "1.20", "1.20", "0.80", "0.00"];

/** Ten segments at low risk, landed on the first: ×1.50. */
export const WHEEL: StateResponse = {
  ...BASE,
  round: round({
    payout: "1500000",
    fee: "5000",
    net: "495000",
    detail: { game: "wheel", segments: 10, risk: "low", multipliers: WHEEL_LOW_10, segment: 0 },
  }),
};

export const WHEEL_DRAWING: StateResponse = {
  ...BASE,
  round: round({
    phase: "drawing",
    net: "0",
    detail: { game: "wheel", segments: 10, risk: "low", multipliers: WHEEL_LOW_10, segment: null },
  }),
};

const hiloBoard = (fields: Partial<HiloView>): HiloView => ({
  game: "hilo",
  cards: [card(12, "♠"), card(9, "♥"), card(5, "♦")],
  guesses: ["lower", "lower"],
  pending: null,
  multiplier: "1.5335",
  higherMultiplier: null,
  lowerMultiplier: null,
  skipsLeft: 10,
  canGuess: false,
  canCashOut: false,
  busted: false,
  ...fields,
});

/** Q♠, lower to 9♥, lower to 5♦: the next guess or a cash-out at ×1.5335. */
export const HILO_TURN: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    net: "0",
    detail: hiloBoard({ higherMultiplier: "2.2151", lowerMultiplier: "3.9871", canGuess: true, canCashOut: true }),
  }),
};

/** An ace, no skip left: higher is certain, so only lower is offered. */
export const HILO_ACE: StateResponse = {
  ...BASE,
  round: round({
    phase: "player_turn",
    net: "0",
    detail: hiloBoard({
      cards: [card(1, "♣")],
      guesses: [],
      multiplier: "0.9800",
      lowerMultiplier: "12.7400",
      skipsLeft: 0,
      canGuess: true,
    }),
  }),
};

/** Higher after 9♥: its card is on its way. */
export const HILO_DRAWING: StateResponse = {
  ...BASE,
  round: round({
    phase: "drawing",
    net: "0",
    detail: hiloBoard({
      cards: [card(12, "♠"), card(9, "♥")],
      guesses: ["lower"],
      pending: "higher",
      multiplier: "1.0616",
    }),
  }),
};

/** Lower from 9♥, and a J♦ came. */
export const HILO_BUSTED: StateResponse = {
  ...BASE,
  round: round({
    detail: hiloBoard({ cards: [card(12, "♠"), card(9, "♥"), card(11, "♦")], multiplier: "1.0616", busted: true }),
  }),
};

export const HILO_CASHED: StateResponse = {
  ...BASE,
  round: round({ payout: "1533500", fee: "5335", net: "528165", detail: hiloBoard({}) }),
};

const towerBoard = (fields: Partial<TowerView>): TowerView => ({
  game: "tower",
  difficulty: "easy",
  tiles: 4,
  levels: 9,
  climbed: [1, 3],
  pending: null,
  busted: null,
  multiplier: "1.7422",
  nextMultiplier: "2.3229",
  canClimb: false,
  canCashOut: false,
  ...fields,
});

/** Easy, two levels up (b, then d): the next level or a cash-out at ×1.7422. */
export const TOWER_TURN: StateResponse = {
  ...BASE,
  round: round({ phase: "player_turn", net: "0", detail: towerBoard({ canClimb: true, canCashOut: true }) }),
};

/** c picked on the second level: its draw is on its way. */
export const TOWER_DRAWING: StateResponse = {
  ...BASE,
  round: round({
    phase: "drawing",
    net: "0",
    detail: towerBoard({ climbed: [1], pending: 2, multiplier: "1.3066", nextMultiplier: "1.7422" }),
  }),
};

/** Two levels up, then a fall on a of the third. */
export const TOWER_BUSTED: StateResponse = {
  ...BASE,
  round: round({ detail: towerBoard({ busted: 0, nextMultiplier: null }) }),
};

export const TOWER_CASHED: StateResponse = {
  ...BASE,
  round: round({
    payout: "1742200",
    fee: "7422",
    net: "734778",
    detail: towerBoard({ nextMultiplier: null }),
  }),
};
