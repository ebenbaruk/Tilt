// Shape checks for what the api sends. The mod cannot import zod, so these small guards are the
// boundary: anything that fails them is shown as a one-line error instead of being drawn.
import { MAX_HANDS, MAX_TABLE_HANDS, MIN_HANDS } from "./keys";
import type {
  BaccaratBet,
  BlackjackHandView,
  Card,
  DeviceStartResponse,
  DeviceTokenResponse,
  Game,
  IntentResponse,
  LeaderboardEntry,
  PlayAction,
  RouletteBet,
  RoundView,
  SponsorView,
  StateResponse,
} from "./protocol";

type Json = Record<string, unknown>;

const GAMES: readonly string[] = ["blackjack", "roulette", "baccarat", "slots"];
const SUITS: readonly string[] = ["♠", "♥", "♦", "♣"];
const PHASES: readonly string[] = ["idle", "drawing", "player_turn"];
const BACCARAT_BETS: readonly string[] = ["player", "banker", "tie"];
const INTENT_STATUSES: readonly string[] = ["pending", "submitted", "failed"];
const PLAIN_ROULETTE_BETS: readonly string[] = ["red", "black", "odd", "even", "low", "high"];
const BLACKJACK_RESULTS: readonly string[] = ["blackjack", "win", "push", "lose"];

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isNullable = <T>(value: unknown, guard: (item: unknown) => item is T): value is T | null =>
  value === null || guard(value);
const isArrayOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

/** Unsigned integer base units as a decimal string. */
const isAmount = (value: unknown): value is string => isString(value) && /^\d{1,30}$/.test(value);
/** Signed integer base units, e.g. "-500000". */
const isSignedAmount = (value: unknown): value is string => isString(value) && /^-?\d{1,30}$/.test(value);
const isOneOf = (value: unknown, allowed: readonly string[]): value is string =>
  isString(value) && allowed.includes(value);
const isThird = (value: unknown): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3;

export const isGame = (value: unknown): value is Game => isOneOf(value, GAMES);

const isCard = (value: unknown): value is Card =>
  isRecord(value) && isInt(value.rank) && value.rank >= 1 && value.rank <= 13 && isOneOf(value.suit, SUITS);

export const isRouletteBet = (value: unknown): value is RouletteBet => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case "straight":
      return isInt(value.number) && value.number >= 0 && value.number <= 36;
    case "dozen":
      return isThird(value.dozen);
    case "column":
      return isThird(value.column);
    default:
      return isOneOf(value.kind, PLAIN_ROULETTE_BETS);
  }
};

const isBaccaratBet = (value: unknown): value is BaccaratBet => isOneOf(value, BACCARAT_BETS);

/** Base units greater than zero: a stake. */
const isStake = (value: unknown): value is string => isAmount(value) && BigInt(value) > 0n;
const isHandCount = (value: unknown): value is number => isInt(value) && value >= MIN_HANDS && value <= MAX_HANDS;
/** Hands on the table: the dealt ones plus the splits. */
const isTableHandCount = (value: unknown): value is number =>
  isInt(value) && value >= MIN_HANDS && value <= MAX_TABLE_HANDS;

export const isPlayAction = (value: unknown): value is PlayAction => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case "blackjack_hit":
    case "blackjack_stand":
    case "blackjack_double":
    case "blackjack_split":
      return true;
    case "blackjack_bet":
      return isStake(value.amount) && isHandCount(value.hands);
    case "slots_spin":
      return isStake(value.amount);
    case "roulette_spin":
      return isStake(value.amount) && isRouletteBet(value.bet);
    case "baccarat_deal":
      return isStake(value.amount) && isBaccaratBet(value.bet);
    default:
      return false;
  }
};

const isReels = (value: unknown): value is [string, string, string] =>
  Array.isArray(value) && value.length === 3 && value.every(isString);

const isBlackjackHand = (value: unknown): value is BlackjackHandView =>
  isRecord(value) &&
  isArrayOf(value.cards, isCard) &&
  isInt(value.total) &&
  isBool(value.soft) &&
  isBool(value.doubled) &&
  isBool(value.split) &&
  isAmount(value.stake) &&
  (value.result === null || isOneOf(value.result, BLACKJACK_RESULTS));

const isBlackjack = (value: Json): boolean =>
  isArrayOf(value.hands, isBlackjackHand) &&
  isTableHandCount(value.hands.length) &&
  (value.activeHand === null ||
    (isInt(value.activeHand) && value.activeHand >= 0 && value.activeHand < value.hands.length)) &&
  isArrayOf(value.dealer, isCard) &&
  isInt(value.dealerTotal) &&
  isBool(value.canHit) &&
  isBool(value.canDouble) &&
  isBool(value.canSplit);

const isDetail = (value: unknown): value is RoundView["detail"] => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.game) {
    case "blackjack":
      return isBlackjack(value);
    case "roulette":
      return isRouletteBet(value.bet) && isNullable(value.number, isInt);
    case "baccarat":
      return (
        isBaccaratBet(value.bet) &&
        isArrayOf(value.player, isCard) &&
        isArrayOf(value.banker, isCard) &&
        isInt(value.playerPoints) &&
        isInt(value.bankerPoints)
      );
    case "slots":
      return isNullable(value.reels, isReels);
    default:
      return false;
  }
};

const isRound = (value: unknown): value is RoundView =>
  isRecord(value) &&
  isOneOf(value.phase, PHASES) &&
  isAmount(value.stake) &&
  isAmount(value.payout) &&
  isAmount(value.fee) &&
  isSignedAmount(value.net) &&
  isInt(value.number) &&
  isNullable(value.settledSignature, isString) &&
  isDetail(value.detail);

const isSponsor = (value: unknown): value is SponsorView =>
  isRecord(value) &&
  isString(value.name) &&
  isNullable(value.tagline, isString) &&
  isAmount(value.pool) &&
  isString(value.endsAt) &&
  !Number.isNaN(Date.parse(value.endsAt));

const isLeaderboardEntry = (value: unknown): value is LeaderboardEntry =>
  isRecord(value) && isInt(value.rank) && isString(value.handle) && isSignedAmount(value.net) && isBool(value.isYou);

const isRtp = (value: unknown): value is Record<Game, string> =>
  isRecord(value) && GAMES.every((game) => isString(value[game]));

export function isStateResponse(value: unknown): value is StateResponse {
  return (
    isRecord(value) &&
    isBool(value.accountOpen) &&
    isAmount(value.balance) &&
    isNullable(value.round, isRound) &&
    isNullable(value.pendingIntentId, isString) &&
    isRecord(value.limits) &&
    isAmount(value.limits.minBet) &&
    isAmount(value.limits.maxBet) &&
    isRtp(value.rtp) &&
    isNullable(value.sponsor, isSponsor) &&
    isArrayOf(value.leaderboard, isLeaderboardEntry) &&
    isNullable(value.rank, isInt) &&
    (value.ahead === undefined || isNullable(value.ahead, isLeaderboardEntry)) &&
    (value.webUrl === undefined || isString(value.webUrl)) &&
    isNullable(value.blocked, isString)
  );
}

export function isIntentResponse(value: unknown): value is IntentResponse {
  return (
    isRecord(value) &&
    isString(value.intentId) &&
    isOneOf(value.status, INTENT_STATUSES) &&
    (value.error === null || (isRecord(value.error) && isString(value.error.code) && isString(value.error.message)))
  );
}

export function isDeviceStart(value: unknown): value is DeviceStartResponse {
  return (
    isRecord(value) &&
    isString(value.deviceCode) &&
    isString(value.userCode) &&
    isString(value.verifyUrl) &&
    /^https?:\/\//.test(value.verifyUrl) &&
    typeof value.expiresIn === "number" &&
    value.expiresIn > 0 &&
    typeof value.interval === "number" &&
    value.interval > 0
  );
}

export function isDeviceToken(value: unknown): value is DeviceTokenResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === "approved") {
    return isString(value.token) && value.token.length > 0 && isString(value.expiresAt);
  }

  return value.status === "pending" || value.status === "expired" || value.status === "denied";
}

/** The `{ error: { code, message } }` body of a failed call, when it has one. */
export function errorOf(value: unknown): { code: string; message: string } | null {
  if (isRecord(value) && isRecord(value.error) && isString(value.error.code) && isString(value.error.message)) {
    return { code: value.error.code, message: value.error.message };
  }

  return null;
}
