// Protocol between the Claude Code mod and `apps/api` (spec §5, §7).
// Pure types with no imports: the mod can only load files inside its own folder, and
// `apps/api` imports this file as `@tilt/mod/protocol` and checks its zod schemas against it.
// Amounts are integer USDC base units (6 decimals) as decimal strings, never floats.

export type Amount = string;
export type Game = "blackjack" | "roulette" | "baccarat" | "slots";

/** Same shape as `RouletteBet` in `@tilt/contract` (relay schema). */
export type RouletteBet =
  | { kind: "straight"; number: number }
  | { kind: "red" }
  | { kind: "black" }
  | { kind: "odd" }
  | { kind: "even" }
  | { kind: "low" }
  | { kind: "high" }
  | { kind: "dozen"; dozen: 1 | 2 | 3 }
  | { kind: "column"; column: 1 | 2 | 3 };

export type BaccaratBet = "player" | "banker" | "tie";

/** Game moves only. Deposits, withdrawals and account opening are web-only (spec §10.5). */
export type PlayAction =
  /** `amount` is the bet on EACH hand; `hands` is 1 to 6, all against one dealer. */
  | { type: "blackjack_bet"; amount: Amount; hands: number }
  | { type: "blackjack_hit" }
  | { type: "blackjack_stand" }
  | { type: "blackjack_double" }
  | { type: "roulette_spin"; amount: Amount; bet: RouletteBet }
  | { type: "baccarat_deal"; amount: Amount; bet: BaccaratBet }
  | { type: "slots_spin"; amount: Amount };

// ---- Auth: device-code login (`/tilt login`) ----

/** POST /v1/auth/device (no auth). */
export interface DeviceStartResponse {
  /** Secret the mod polls with; never shown. */
  deviceCode: string;
  /** Short code the player checks in the browser, e.g. "WDJB-MJHT". */
  userCode: string;
  /** Web page that approves this code, user code included. */
  verifyUrl: string;
  /** Seconds before the codes expire. */
  expiresIn: number;
  /** Minimum seconds between two polls. */
  interval: number;
}

/** POST /v1/auth/device/token { deviceCode } (no auth). */
export type DeviceTokenResponse =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "approved"; token: string; expiresAt: string };

// ---- Game state (GET /v1/state, mod token) ----

/** A card as drawn on-chain: rank 1 (ace) to 13 (king). Suits are cosmetic, derived by the api. */
export interface Card {
  rank: number;
  suit: "♠" | "♥" | "♦" | "♣";
}

export type RoundPhase =
  /** No round, or the last one is settled. */
  | "idle"
  /** Waiting for the VRF draw; poll again shortly. */
  | "drawing"
  /** Blackjack: waiting for hit, stand or double. */
  | "player_turn";

/** How a blackjack hand ended against the dealer; null until the round is settled. */
export type BlackjackResult = "blackjack" | "win" | "push" | "lose";

export interface BlackjackHandView {
  cards: Card[];
  total: number;
  /** Totals with a usable ace are soft, e.g. "soft 17". */
  soft: boolean;
  doubled: boolean;
  /** This hand's stake, the double included. */
  stake: Amount;
  result: BlackjackResult | null;
}

export interface BlackjackView {
  game: "blackjack";
  /** One to six hands, played left to right against the same dealer. */
  hands: BlackjackHandView[];
  /** The hand that hit, stand and double act on while the phase is player_turn; null otherwise. */
  activeHand: number | null;
  dealer: Card[];
  dealerTotal: number;
  /** For the active hand. */
  canHit: boolean;
  canDouble: boolean;
}

export interface RouletteView {
  game: "roulette";
  bet: RouletteBet;
  /** Winning pocket once settled. */
  number: number | null;
}

export interface BaccaratView {
  game: "baccarat";
  bet: BaccaratBet;
  player: Card[];
  banker: Card[];
  playerPoints: number;
  bankerPoints: number;
}

export interface SlotsView {
  game: "slots";
  /** Symbol per reel once settled: "7" | "◆" | "★" | "♣" | "¤" | … ; null while drawing. */
  reels: [string, string, string] | null;
}

export interface RoundView {
  phase: RoundPhase;
  stake: Amount;
  /** Gross return of a settled round (0 when lost). */
  payout: Amount;
  /** Tilt's 1% fee on the gain of a winning round. */
  fee: Amount;
  /** payout − fee − stake, signed decimal string, e.g. "-500000". */
  net: string;
  /** Round number on-chain; also the key for /verify. */
  number: number;
  /** Signature of the settling transaction, once indexed. */
  settledSignature: string | null;
  detail: BlackjackView | RouletteView | BaccaratView | SlotsView;
}

export interface SponsorView {
  name: string;
  tagline: string | null;
  /** Prize pool of the running competition, in USDC base units. */
  pool: Amount;
  /** ISO time the running competition ends. */
  endsAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  /** Net gain over the competition window, signed decimal string. */
  net: string;
  isYou: boolean;
}

export interface Limits {
  minBet: Amount;
  maxBet: Amount;
}

export interface StateResponse {
  /** False until the first deposit on the web; the mod then shows a "deposit on <web>" hint. */
  accountOpen: boolean;
  balance: Amount;
  /** Current or last round; null before the first round. */
  round: RoundView | null;
  /** Set while an intent of this player is in flight. */
  pendingIntentId: string | null;
  limits: Limits;
  /** RTP per game before Tilt's 1% (spec §4.3), as percent strings, e.g. "97.30". */
  rtp: Record<Game, string>;
  sponsor: SponsorView | null;
  leaderboard: LeaderboardEntry[];
  /** Player's rank in the running competition; null when not ranked. */
  rank: number | null;
  /** Self-exclusion or a responsible-gaming limit blocks play; the reason is shown as is. */
  blocked: string | null;
}

// ---- Playing (POST /v1/play, mod token) ----

export interface PlayRequest {
  /** UUID generated by the mod; resend the same id to retry, never a new one. */
  intentId: string;
  action: PlayAction;
}

export type IntentStatus = "pending" | "submitted" | "failed";

/** POST /v1/play and GET /v1/intents/:intentId. */
export interface IntentResponse {
  intentId: string;
  status: IntentStatus;
  /** Machine code and a short message safe to show, e.g. "InsufficientBalance". */
  error: { code: string; message: string } | null;
}

/** POST /v1/impressions { sponsor, seconds } (mod token): sponsor panel time on screen. */
export interface ImpressionRequest {
  sponsor: string;
  /** Seconds the sponsor block was visible since the last report, 1–60. */
  seconds: number;
}

/** Every error response body. */
export interface ErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "PLAYER_BUSY"
  | "INTENT_CONFLICT"
  | "BLOCKED"
  | "GEO_BLOCKED"
  | "ACCOUNT_NOT_OPEN"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";
