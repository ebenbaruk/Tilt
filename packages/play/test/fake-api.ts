// Dev-only fake Tilt API: smoke-tests a harness integration without the chain, the relay or Postgres.
// One in-memory player, Math.random outcomes, nothing persisted. Never deploy it.
// Run: `bun packages/play/test/fake-api.ts [port]` (or `npx tsx …`). See fake-api.md.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  ApiErrorCode,
  BlackjackHandView,
  BlackjackResult,
  BlackjackView,
  Card,
  DeviceStartResponse,
  DeviceTokenResponse,
  DiceView,
  ErrorBody,
  FlipSide,
  FlipView,
  Game,
  IntentResponse,
  KenoView,
  LeaderboardEntry,
  LimboView,
  RouletteBet,
  RouletteChip,
  RouletteView,
  RoundView,
  SlotsView,
  StateResponse,
  WheelRisk,
  WheelView,
} from "../../../apps/mod/hooks/protocol";

type Json = Record<string, unknown>;
type Detail = RoundView["detail"];
type Reply = { status: number; json?: unknown; text?: string };

const DEFAULT_PORT = 8787;
const TOKEN = "fake-token";
const USER_CODE = "TILT-TEST";
const POLLS_BEFORE_APPROVAL = 2;
const DEVICE_EXPIRES_IN_S = 600;
const TOKEN_LIFETIME_MS = 30 * 24 * 3600 * 1000;
/** How long a move stays "drawing", like the VRF round trip on the rollup. */
const SETTLE_MS = 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_INTENT_ID_LENGTH = 100;

const START_BALANCE = 100_000_000n;
const MIN_BET = 100_000n;
const MAX_BET = 10_000_000n;
/** Tilt's 1 % fee on the gain of a winning round. */
const FEE_PERCENT = 1n;

const GAMES: readonly Game[] = [
  "blackjack",
  "roulette",
  "baccarat",
  "slots",
  "mines",
  "dice",
  "limbo",
  "flip",
  "keno",
  "wheel",
  "hilo",
  "tower",
];
const SUITS: readonly Card["suit"][] = ["♠", "♥", "♦", "♣"];
const DICE_ROLLS = 10_000;
const MIN_DICE_CHANCE = 100;
const MAX_DICE_CHANCE = 9_800;
const MIN_LIMBO_TARGET = 101;
const MAX_LIMBO_TARGET = 1_000_000;
const MAX_FLIPS = 10;
const KENO_NUMBERS = 40;
const KENO_DRAWN = 10;
const MAX_KENO_PICKS = 10;
const WHEEL_SEGMENTS: readonly number[] = [10, 20, 30, 40, 50];
const WHEEL_RISKS: readonly WheelRisk[] = ["low", "medium", "high"];
const FLIP_SIDES: readonly FlipSide[] = ["heads", "tails"];
const MAX_HANDS = 6;
const DEALER_STANDS_ON = 17;
const BLACKJACK = 21;
const ROULETTE_POCKETS = 37;
const MAX_ROULETTE_CHIPS = 20;
const RED_POCKETS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const PLAIN_ROULETTE_BETS = ["red", "black", "odd", "even", "low", "high"] as const;
const SLOT_SYMBOLS: readonly string[] = ["7", "◆", "★", "♣", "¤"];
/** Three of a kind pays this many hundredths of the stake; anything else loses. */
const SLOT_TRIPLE_CENTS: Readonly<Record<string, number>> = { "7": 2500, "◆": 1000, "★": 500, "♣": 300, "¤": 200 };
const RIVALS: readonly { handle: string; net: bigint }[] = [
  { handle: "degen.sol", net: 4_200_000n },
  { handle: "lucky7", net: 1_500_000n },
  { handle: "satoshi", net: -300_000n },
];

// ---- In-memory world ----

interface Hand {
  cards: Card[];
  stake: bigint;
  doubled: boolean;
}

interface Table {
  hands: Hand[];
  active: number | null;
  /** Both dealer cards; only the first is shown while the player acts. */
  dealer: Card[];
}

interface Plan {
  stake: bigint;
  drawing: Detail;
  settle: () => { detail: Detail; payout: bigint };
}

const port = parsePort(process.argv[2]);
const webUrl = `http://127.0.0.1:${port}`;
const sponsorEndsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const devicePolls = new Map<string, number>();
const intents = new Map<string, IntentResponse>();
let balance = START_BALANCE;
let round: RoundView | null = null;
let roundNumber = 0;
let pendingIntentId: string | null = null;
let table: Table | null = null;
let playerNet = 0n;

function parsePort(arg: string | undefined): number {
  const value = arg === undefined ? DEFAULT_PORT : Number(arg);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`invalid port: ${arg}`);
    process.exit(1);
  }

  return value;
}

// ---- Small helpers ----

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => Number.isInteger(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  isInt(value) && value >= min && value <= max;
const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);
const randomInt = (below: number): number => Math.floor(Math.random() * below);

function pick<T>(items: readonly T[]): T {
  const item = items[randomInt(items.length)];

  if (item === undefined) {
    throw new Error("pick from an empty list");
  }

  return item;
}

/** "1.9600" from 19600 ten-thousandths. */
const fourDecimals = (units: number): string =>
  `${Math.floor(units / 10_000)}.${String(units % 10_000).padStart(4, "0")}`;
/** "2.00" from 200 hundredths. */
const twoDecimals = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

function parseStake(value: unknown): bigint | string {
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) {
    return "amount must be integer base units";
  }

  const stake = BigInt(value);

  return stake < MIN_BET || stake > MAX_BET ? `bet must be ${MIN_BET} to ${MAX_BET}` : stake;
}

const error = (status: number, code: ApiErrorCode, message: string): Reply => {
  const body: ErrorBody = { error: { code, message } };

  return { status, json: body };
};

// ---- Rounds ----

function openRound(stake: bigint, detail: Detail): void {
  roundNumber += 1;
  balance -= stake;
  round = {
    phase: "drawing",
    stake: stake.toString(),
    payout: "0",
    fee: "0",
    net: "0",
    number: roundNumber,
    settledSignature: null,
    detail,
  };
}

/** Shows `detail` as drawing while the intent is in flight, then applies the draw. */
function draw(intentId: string, detail: Detail, apply: () => void): void {
  if (round === null) {
    throw new Error("draw without a round");
  }

  round = { ...round, phase: "drawing", detail };
  pendingIntentId = intentId;
  setTimeout(() => {
    pendingIntentId = null;
    apply();
  }, SETTLE_MS);
}

function settleRound(stake: bigint, payout: bigint, detail: Detail): void {
  const fee = payout > stake ? ((payout - stake) * FEE_PERCENT) / 100n : 0n;
  const net = payout - fee - stake;

  balance += payout - fee;
  playerNet += net;
  table = null;
  round = {
    phase: "idle",
    stake: stake.toString(),
    payout: payout.toString(),
    fee: fee.toString(),
    net: net.toString(),
    number: roundNumber,
    settledSignature: `fake-signature-${roundNumber}`,
    detail,
  };
}

const multiplied = (stake: bigint, units: number, scale: bigint): bigint => (stake * BigInt(units)) / scale;

// ---- Instant games ----

function planDice(action: Json, stake: bigint): Plan | string {
  const { target, over } = action;

  if (!isInt(target) || typeof over !== "boolean") {
    return "dice needs an integer target and over";
  }

  const chance = over ? DICE_ROLLS - target : target;

  if (!inRange(chance, MIN_DICE_CHANCE, MAX_DICE_CHANCE)) {
    return "dice chance must be 1 % to 98 %";
  }

  // 99 % RTP: the multiplier is 0.99 × 10000 / chance, in ten-thousandths.
  const units = Math.floor(99_000_000 / chance);
  const view: DiceView = { game: "dice", target, over, roll: null, multiplier: fourDecimals(units) };

  return {
    stake,
    drawing: view,
    settle: () => {
      const roll = randomInt(DICE_ROLLS);
      const won = over ? roll >= target : roll < target;

      return { detail: { ...view, roll }, payout: won ? multiplied(stake, units, 10_000n) : 0n };
    },
  };
}

function planLimbo(action: Json, stake: bigint): Plan | string {
  const { target } = action;

  if (!inRange(target, MIN_LIMBO_TARGET, MAX_LIMBO_TARGET)) {
    return "limbo target must be 101 to 1000000";
  }

  const view: LimboView = { game: "limbo", target: twoDecimals(target), result: null };

  return {
    stake,
    drawing: view,
    settle: () => {
      const crash = Math.min(MAX_LIMBO_TARGET, Math.max(100, Math.floor(99 / (1 - Math.random()))));

      return {
        detail: { ...view, result: twoDecimals(crash) },
        payout: crash >= target ? multiplied(stake, target, 100n) : 0n,
      };
    },
  };
}

function planFlip(action: Json, stake: bigint): Plan | string {
  const { side, flips } = action;

  if (!isOneOf(side, FLIP_SIDES) || !inRange(flips, 1, MAX_FLIPS)) {
    return "flip needs a side and 1 to 10 flips";
  }

  const units = 9_800 * 2 ** flips;
  const view: FlipView = { game: "flip", side, flips, results: null, multiplier: fourDecimals(units) };

  return {
    stake,
    drawing: view,
    settle: () => {
      const results = Array.from({ length: flips }, () => pick(FLIP_SIDES));
      const won = results.every((result) => result === side);

      return { detail: { ...view, results }, payout: won ? multiplied(stake, units, 10_000n) : 0n };
    },
  };
}

/** Hundredths paid for `hits` out of `picks`: nothing below half the picks, then steeply up. */
const kenoCents = (hits: number, picks: number): number =>
  hits === 0 || 2 * hits < picks ? 0 : Math.floor(100 * 1.6 ** (2 * hits - picks + 1));

function planKeno(action: Json, stake: bigint): Plan | string {
  const { picks } = action;
  const valid =
    Array.isArray(picks) &&
    picks.every((value) => inRange(value, 1, KENO_NUMBERS)) &&
    inRange(picks.length, 1, MAX_KENO_PICKS) &&
    new Set(picks).size === picks.length;

  if (!valid) {
    return "keno needs 1 to 10 distinct numbers from 1 to 40";
  }

  const chosen = picks.filter(isInt);
  const cents = Array.from({ length: chosen.length + 1 }, (_, hits) => kenoCents(hits, chosen.length));
  const view: KenoView = { game: "keno", picks: chosen, drawn: null, hits: null, paytable: cents.map(twoDecimals) };

  return {
    stake,
    drawing: view,
    settle: () => {
      const pool = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1);
      const drawn = Array.from({ length: KENO_DRAWN }, () => pool.splice(randomInt(pool.length), 1)[0] ?? 0);
      const hits = chosen.filter((value) => drawn.includes(value)).length;

      return { detail: { ...view, drawn, hits }, payout: multiplied(stake, cents[hits] ?? 0, 100n) };
    },
  };
}

const MEDIUM_WHEEL_CENTS = [150, 200, 170, 300];

function wheelCents(segment: number, segments: number, risk: WheelRisk): number {
  if (risk === "low") {
    return segment % 5 === 3 ? 0 : segment % 5 === 0 ? 150 : 120;
  }

  if (risk === "medium") {
    return segment % 2 === 0 ? 0 : (MEDIUM_WHEEL_CENTS[((segment - 1) / 2) % MEDIUM_WHEEL_CENTS.length] ?? 0);
  }

  return segment === 0 ? segments * 99 : 0;
}

function planWheel(action: Json, stake: bigint): Plan | string {
  const { segments, risk } = action;

  if (!isInt(segments) || !WHEEL_SEGMENTS.includes(segments) || !isOneOf(risk, WHEEL_RISKS)) {
    return "wheel needs 10, 20, 30, 40 or 50 segments and a risk";
  }

  const cents = Array.from({ length: segments }, (_, segment) => wheelCents(segment, segments, risk));
  const view: WheelView = { game: "wheel", segments, risk, multipliers: cents.map(twoDecimals), segment: null };

  return {
    stake,
    drawing: view,
    settle: () => {
      const segment = randomInt(segments);

      return { detail: { ...view, segment }, payout: multiplied(stake, cents[segment] ?? 0, 100n) };
    },
  };
}

function planSlots(stake: bigint): Plan {
  const view: SlotsView = { game: "slots", reels: null };

  return {
    stake,
    drawing: view,
    settle: () => {
      const reels: [string, string, string] = [pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS)];
      const triple = reels[0] === reels[1] && reels[1] === reels[2];
      const cents = triple ? (SLOT_TRIPLE_CENTS[reels[0]] ?? 0) : 0;

      return { detail: { ...view, reels }, payout: multiplied(stake, cents, 100n) };
    },
  };
}

function parseRouletteBet(value: unknown): RouletteBet | null {
  if (!isRecord(value)) {
    return null;
  }

  const isThird = (third: unknown): third is 1 | 2 | 3 => third === 1 || third === 2 || third === 3;

  if (isOneOf(value.kind, PLAIN_ROULETTE_BETS)) {
    return { kind: value.kind };
  }

  if (value.kind === "straight" && inRange(value.number, 0, ROULETTE_POCKETS - 1)) {
    return { kind: "straight", number: value.number };
  }

  if (value.kind === "dozen" && isThird(value.dozen)) {
    return { kind: "dozen", dozen: value.dozen };
  }

  if (value.kind === "column" && isThird(value.column)) {
    return { kind: "column", column: value.column };
  }

  return null;
}

/** Gross multiple of the chip paid when the ball lands on `pocket`. */
function rouletteMultiple(bet: RouletteBet, pocket: number): bigint {
  if (bet.kind === "straight") {
    return bet.number === pocket ? 36n : 0n;
  }

  if (pocket === 0) {
    return 0n;
  }

  const wins: Record<RouletteBet["kind"], boolean> = {
    straight: false,
    red: RED_POCKETS.has(pocket),
    black: !RED_POCKETS.has(pocket),
    odd: pocket % 2 === 1,
    even: pocket % 2 === 0,
    low: pocket <= 18,
    high: pocket > 18,
    dozen: bet.kind === "dozen" && Math.ceil(pocket / 12) === bet.dozen,
    column: bet.kind === "column" && ((pocket - 1) % 3) + 1 === bet.column,
  };

  if (!wins[bet.kind]) {
    return 0n;
  }

  return bet.kind === "dozen" || bet.kind === "column" ? 3n : 2n;
}

function parseChips(value: unknown): { bet: RouletteBet; stake: bigint }[] | string {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROULETTE_CHIPS) {
    return "roulette needs 1 to 20 chips";
  }

  const chips: { bet: RouletteBet; stake: bigint }[] = [];

  for (const chip of value) {
    const bet = isRecord(chip) ? parseRouletteBet(chip.bet) : null;
    const stake = isRecord(chip) ? parseStake(chip.amount) : "chip needs an amount";

    if (bet === null) {
      return "invalid roulette bet";
    }

    if (typeof stake === "string") {
      return stake;
    }

    chips.push({ bet, stake });
  }

  // Bets are rebuilt above in one key order, so JSON tells two chips on the same bet apart.
  return new Set(chips.map((chip) => JSON.stringify(chip.bet))).size === chips.length
    ? chips
    : "two chips on the same bet";
}

function planRoulette(parsed: { bet: RouletteBet; stake: bigint }[]): Plan | string {
  const first = parsed[0];

  if (first === undefined) {
    return "roulette needs a chip";
  }

  const chips: RouletteChip[] = parsed.map((chip) => ({ bet: chip.bet, amount: chip.stake.toString() }));
  const view: RouletteView = { game: "roulette", bet: first.bet, chips, number: null };

  return {
    stake: parsed.reduce((sum, chip) => sum + chip.stake, 0n),
    drawing: view,
    settle: () => {
      const pocket = randomInt(ROULETTE_POCKETS);
      const payout = parsed.reduce((sum, chip) => sum + chip.stake * rouletteMultiple(chip.bet, pocket), 0n);

      return { detail: { ...view, number: pocket }, payout };
    },
  };
}

function planInstant(action: Json): Plan | string {
  if (action.type === "roulette_chips") {
    const chips = parseChips(action.chips);

    return typeof chips === "string" ? chips : planRoulette(chips);
  }

  const stake = parseStake(action.amount);

  if (typeof stake === "string") {
    return stake;
  }

  switch (action.type) {
    case "dice_roll":
      return planDice(action, stake);
    case "limbo_play":
      return planLimbo(action, stake);
    case "flip_play":
      return planFlip(action, stake);
    case "keno_play":
      return planKeno(action, stake);
    case "wheel_spin":
      return planWheel(action, stake);
    case "slots_spin":
      return planSlots(stake);
    case "roulette_spin": {
      const bet = parseRouletteBet(action.bet);

      return bet === null ? "invalid roulette bet" : planRoulette([{ bet, stake }]);
    }
    default:
      return `${String(action.type)} is not supported by the fake api`;
  }
}

// ---- Blackjack ----

const drawCard = (): Card => ({ rank: randomInt(13) + 1, suit: pick(SUITS) });

function score(cards: readonly Card[]): { total: number; soft: boolean } {
  const hard = cards.reduce((sum, card) => sum + Math.min(card.rank, 10), 0);
  const soft = cards.some((card) => card.rank === 1) && hard + 10 <= BLACKJACK;

  return { total: soft ? hard + 10 : hard, soft };
}

const isNatural = (cards: readonly Card[]): boolean => cards.length === 2 && score(cards).total === BLACKJACK;
const tableStake = (t: Table): bigint => t.hands.reduce((sum, hand) => sum + hand.stake, 0n);

function handView(hand: Hand, result: BlackjackResult | null): BlackjackHandView {
  return {
    cards: hand.cards,
    ...score(hand.cards),
    doubled: hand.doubled,
    split: false,
    stake: hand.stake.toString(),
    result,
  };
}

function tableView(t: Table, playerTurn: boolean, results: readonly BlackjackResult[] = []): BlackjackView {
  const dealer = playerTurn ? t.dealer.slice(0, 1) : t.dealer;
  const hand = playerTurn && t.active !== null ? t.hands[t.active] : undefined;
  const canHit = hand !== undefined && score(hand.cards).total < BLACKJACK;

  return {
    game: "blackjack",
    hands: t.hands.map((each, index) => handView(each, results[index] ?? null)),
    activeHand: playerTurn ? t.active : null,
    dealer,
    dealerTotal: score(dealer).total,
    canHit,
    canDouble: hand !== undefined && canHit && hand.cards.length === 2 && balance >= hand.stake,
    canSplit: false,
  };
}

/** The first hand from `from` on that still takes cards; null when the dealer's turn comes. */
function nextActive(t: Table, from: number): number | null {
  const index = t.hands.findIndex((hand, at) => at >= from && score(hand.cards).total < BLACKJACK);

  return index === -1 ? null : index;
}

function handResult(hand: Hand, dealer: readonly Card[]): BlackjackResult {
  const player = score(hand.cards).total;
  const house = score(dealer).total;

  if (player > BLACKJACK) {
    return "lose";
  }

  if (isNatural(hand.cards)) {
    return isNatural(dealer) ? "push" : "blackjack";
  }

  if (isNatural(dealer)) {
    return "lose";
  }

  if (house > BLACKJACK || player > house) {
    return "win";
  }

  return player === house ? "push" : "lose";
}

const RESULT_PAYOUT: Record<BlackjackResult, (stake: bigint) => bigint> = {
  blackjack: (stake) => (stake * 5n) / 2n,
  win: (stake) => stake * 2n,
  push: (stake) => stake,
  lose: () => 0n,
};

function finishTable(t: Table): void {
  const someStanding = t.hands.some((hand) => score(hand.cards).total <= BLACKJACK);

  while (someStanding && !isNatural(t.dealer) && score(t.dealer).total < DEALER_STANDS_ON) {
    t.dealer.push(drawCard());
  }

  const results = t.hands.map((hand) => handResult(hand, t.dealer));
  const payout = t.hands.reduce((sum, hand, index) => sum + RESULT_PAYOUT[results[index] ?? "lose"](hand.stake), 0n);

  settleRound(tableStake(t), payout, tableView(t, false, results));
}

function resume(t: Table): void {
  if (t.active === null || round === null) {
    finishTable(t);
    return;
  }

  round = { ...round, phase: "player_turn", detail: tableView(t, true) };
}

function dealBlackjack(intentId: string, action: Json): string | null {
  const stake = parseStake(action.amount);

  if (typeof stake === "string") {
    return stake;
  }

  if (!inRange(action.hands, 1, MAX_HANDS)) {
    return "hands must be 1 to 6";
  }

  const hands = Array.from({ length: action.hands }, (): Hand => ({ cards: [], stake, doubled: false }));
  const t: Table = { hands, active: null, dealer: [] };

  if (tableStake(t) > balance) {
    return "insufficient balance";
  }

  table = t;
  openRound(tableStake(t), tableView(t, false));
  draw(intentId, tableView(t, false), () => {
    t.hands.forEach((hand) => hand.cards.push(drawCard(), drawCard()));
    t.dealer.push(drawCard(), drawCard());
    // The dealer peeks: a dealer blackjack ends the round before any move.
    t.active = isNatural(t.dealer) ? null : nextActive(t, 0);
    resume(t);
  });

  return null;
}

type BlackjackMove = "blackjack_hit" | "blackjack_stand" | "blackjack_double";

function playBlackjack(intentId: string, move: BlackjackMove): string | null {
  const t = table;
  const active = t?.active ?? null;
  const hand = t !== null && active !== null ? t.hands[active] : undefined;

  if (t === null || active === null || hand === undefined || round?.phase !== "player_turn") {
    return "no blackjack hand to play";
  }

  if (move === "blackjack_double") {
    if (hand.cards.length !== 2 || balance < hand.stake) {
      return "double needs two cards and the balance for a second stake";
    }

    balance -= hand.stake;
    hand.stake *= 2n;
    hand.doubled = true;
    round = { ...round, stake: tableStake(t).toString() };
  }

  draw(intentId, tableView(t, true), () => {
    if (move !== "blackjack_stand") {
      hand.cards.push(drawCard());
    }

    if (move !== "blackjack_hit" || score(hand.cards).total >= BLACKJACK) {
      t.active = nextActive(t, active + 1);
    }

    resume(t);
  });

  return null;
}

/** Starts the move; a string is why it was refused. */
function startMove(intentId: string, action: Json): string | null {
  const { type } = action;

  if (type === "blackjack_hit" || type === "blackjack_stand" || type === "blackjack_double") {
    return playBlackjack(intentId, type);
  }

  if (table !== null) {
    return "finish the blackjack round first";
  }

  if (type === "blackjack_bet") {
    return dealBlackjack(intentId, action);
  }

  const plan = planInstant(action);

  if (typeof plan === "string") {
    return plan;
  }

  if (plan.stake > balance) {
    return "insufficient balance";
  }

  openRound(plan.stake, plan.drawing);
  draw(intentId, plan.drawing, () => {
    const { detail, payout } = plan.settle();

    settleRound(plan.stake, payout, detail);
  });

  return null;
}

// ---- Routes ----

function leaderboard(): LeaderboardEntry[] {
  const players = [...RIVALS.map((rival) => ({ ...rival, isYou: false })), { handle: "you", net: playerNet, isYou: true }];

  players.sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : 0));

  return players.map((player, index) => ({
    rank: index + 1,
    handle: player.handle,
    net: player.net.toString(),
    isYou: player.isYou,
  }));
}

function state(): StateResponse {
  const board = leaderboard();
  const you = board.find((entry) => entry.isYou);
  const rank = you?.rank ?? null;

  return {
    accountOpen: true,
    balance: balance.toString(),
    round,
    pendingIntentId,
    limits: { minBet: MIN_BET.toString(), maxBet: MAX_BET.toString() },
    rtp: Object.fromEntries(GAMES.map((game) => [game, "99.00"])) as Record<Game, string>,
    sponsor: { name: "Acme Cloud", tagline: "Deploys that never tilt", pool: "500000000", endsAt: sponsorEndsAt },
    leaderboard: board,
    rank,
    ahead: rank === null ? null : (board[rank - 2] ?? null),
    webUrl,
    blocked: null,
  };
}

function startDevice(): Reply {
  const deviceCode = `device-${Date.now()}-${randomInt(1_000_000)}`;
  const body: DeviceStartResponse = {
    deviceCode,
    userCode: USER_CODE,
    verifyUrl: `${webUrl}/connect`,
    expiresIn: DEVICE_EXPIRES_IN_S,
    interval: 1,
  };

  devicePolls.set(deviceCode, 0);

  return { status: 200, json: body };
}

function pollDevice(body: unknown): Reply {
  const deviceCode = isRecord(body) ? body.deviceCode : undefined;
  const polls = typeof deviceCode === "string" ? devicePolls.get(deviceCode) : undefined;

  if (typeof deviceCode !== "string" || polls === undefined) {
    const expired: DeviceTokenResponse = { status: "expired" };
    return { status: 200, json: expired };
  }

  devicePolls.set(deviceCode, polls + 1);

  const answer: DeviceTokenResponse =
    polls + 1 >= POLLS_BEFORE_APPROVAL
      ? { status: "approved", token: TOKEN, expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString() }
      : { status: "pending" };

  return { status: 200, json: answer };
}

function postPlay(body: unknown): Reply {
  const intentId = isRecord(body) ? body.intentId : undefined;
  const action = isRecord(body) ? body.action : undefined;

  if (typeof intentId !== "string" || intentId === "" || intentId.length > MAX_INTENT_ID_LENGTH || !isRecord(action)) {
    return error(400, "INVALID_REQUEST", "body must be { intentId, action }");
  }

  const known = intents.get(intentId);

  if (known !== undefined) {
    return { status: 200, json: known };
  }

  if (pendingIntentId !== null) {
    return error(409, "PLAYER_BUSY", "a move is already in flight");
  }

  const refused = startMove(intentId, action);

  if (refused !== null) {
    return error(400, "INVALID_REQUEST", refused);
  }

  const intent: IntentResponse = { intentId, status: "submitted", error: null };

  intents.set(intentId, intent);

  return { status: 200, json: intent };
}

const INDEX_TEXT = [
  "Tilt fake api (dev only): one in-memory player, random outcomes, no chain.",
  "Point a harness at it with TILT_API_URL set to this origin.",
  "Login code TILT-TEST is approved automatically on the second poll.",
].join("\n");

async function route(request: IncomingMessage): Promise<Reply> {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://fake").pathname;
  const authorized = request.headers.authorization === `Bearer ${TOKEN}`;

  if (method === "GET" && path === "/") {
    return { status: 200, text: INDEX_TEXT };
  }

  if (method === "GET" && path === "/connect") {
    return { status: 200, text: `Code ${USER_CODE} approved. Go back to your terminal.` };
  }

  if (method === "POST" && path === "/v1/auth/device") {
    return startDevice();
  }

  if (method === "POST" && path === "/v1/auth/device/token") {
    return pollDevice(await readJson(request));
  }

  if (!path.startsWith("/v1/")) {
    return error(404, "NOT_FOUND", `no route for ${method} ${path}`);
  }

  if (!authorized) {
    return error(401, "UNAUTHORIZED", "missing or unknown token");
  }

  if (method === "GET" && path === "/v1/state") {
    return { status: 200, json: state() };
  }

  if (method === "POST" && path === "/v1/play") {
    return postPlay(await readJson(request));
  }

  if (method === "POST" && path === "/v1/impressions") {
    await readJson(request);
    return { status: 204 };
  }

  const intentMatch = method === "GET" ? /^\/v1\/intents\/([^/]+)$/.exec(path) : null;
  const intent = intentMatch?.[1] === undefined ? undefined : intents.get(decodeURIComponent(intentMatch[1]));

  if (intent !== undefined) {
    return { status: 200, json: intent };
  }

  return error(404, "NOT_FOUND", `no route for ${method} ${path}`);
}

class BadBody extends Error {}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      throw new BadBody("body too large");
    }

    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");

  try {
    return text === "" ? null : JSON.parse(text);
  } catch {
    throw new BadBody("body is not JSON");
  }
}

function send(response: ServerResponse, reply: Reply): void {
  if (reply.text !== undefined) {
    response.writeHead(reply.status, { "content-type": "text/plain; charset=utf-8" }).end(`${reply.text}\n`);
    return;
  }

  if (reply.json === undefined) {
    response.writeHead(reply.status).end();
    return;
  }

  response.writeHead(reply.status, { "content-type": "application/json" }).end(JSON.stringify(reply.json));
}

const server = createServer((request, response) => {
  console.log(`${request.method ?? "GET"} ${new URL(request.url ?? "/", "http://fake").pathname}`);
  route(request).then(
    (reply) => send(response, reply),
    (failure: unknown) => {
      if (failure instanceof BadBody) {
        send(response, error(400, "INVALID_REQUEST", failure.message));
        return;
      }

      console.error(failure);
      send(response, error(500, "INTERNAL_ERROR", "fake api crashed on this request"));
    },
  );
});

server.listen(port, "127.0.0.1", () => {
  console.log(`tilt fake api on ${webUrl}`);
});
