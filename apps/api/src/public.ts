// Types of the api's web-facing routes, consumed by `apps/web` as `@tilt/api/public`.
// Pure types: the web never imports server code. Amounts are integer USDC base units
// (6 decimals) as decimal strings, never floats.
//
// Auth: every /v1/account and /v1/auth/device/approve route takes the Privy access token as
// `Authorization: Bearer <token>`. Money moves (deposit, withdraw) also need a fresh Privy
// identity token in `X-Privy-Identity-Token`: the player's consent proof (spec §7).

export type {
  Amount,
  ApiErrorCode,
  BaccaratBet,
  ErrorBody,
  Game,
  IntentResponse,
  IntentStatus,
  LeaderboardEntry,
  RouletteBet,
  RoundView,
  SponsorView,
} from "@tilt/mod/protocol";

import type { Amount, Game, IntentStatus, LeaderboardEntry, RoundView, SponsorView } from "@tilt/mod/protocol";

/** POST /v1/auth/device/approve { userCode } (Privy access token): links the mod waiting on this code. */
export interface DeviceApproveRequest {
  userCode: string;
}
export interface DeviceApproveResponse {
  approved: true;
}

/** GET /v1/account (Privy access token). */
export interface AccountResponse {
  userId: string;
  /** Player's Solana wallet (Privy embedded wallet). */
  solanaAddress: string;
  accountOpen: boolean;
  balance: Amount;
  /** USDC in the player's own wallet, available to deposit. */
  walletUsdc: Amount;
  /** Lifetime totals from the player account. */
  totals: { deposited: Amount; withdrawn: Amount; fees: Amount; rounds: number };
  /** Minimum first deposit; the onboarding fee is taken from it (spec §6.1). */
  minFirstDeposit: Amount;
  onboardingFee: Amount;
  /** Values the web needs to add the relay's signer to the player's embedded wallet. */
  privySigner: { signerId: string; policyIds: string[] };
  limits: ResponsibleLimits;
  /** Devnet test USDC faucet; null when the relay has none (always on mainnet) or can't say. */
  faucet: { amount: Amount; nextClaimAt: string | null } | null;
}

/** POST /v1/account/deposit (access + identity token). First deposit opens the account. */
export interface DepositRequest {
  /** UUID from the web; resend the same id to retry. */
  intentId: string;
  amount: Amount;
}

/** POST /v1/account/withdraw (access + identity token). Pays to the player's own wallet. */
export interface WithdrawRequest {
  intentId: string;
  amount: Amount;
}

/** Response of deposit, withdraw and GET /v1/account/intents/:intentId. */
export interface MoneyIntentResponse {
  intentId: string;
  status: IntentStatus;
  /** Transaction signature once submitted. */
  signature: string | null;
  error: { code: string; message: string } | null;
}

/** POST /v1/account/faucet (access token), devnet only: test USDC from Tilt to the player's wallet.
 *  At most one claim per player per 24 h; a refused claim is a BLOCKED error saying when the next is. */
export interface FaucetRequest {
  /** UUID from the web; resend the same id to retry. */
  claimId: string;
}
export interface FaucetResponse {
  claimId: string;
  amount: Amount;
  status: IntentStatus;
  signature: string | null;
  error: { code: string; message: string } | null;
}

/** GET /v1/account/sessions (access token): the player's mod logins. */
export interface ModSession {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}
export interface SessionsResponse {
  sessions: ModSession[];
}
/** DELETE /v1/account/sessions/:id (access token) revokes one session. */

/** A looser limit waiting for its 24 h delay. */
export interface PendingLimit {
  /** The limit it becomes, null = no limit. */
  value: Amount | null;
  /** ISO time it takes effect. */
  at: string;
}

/** Responsible gaming (spec §4.4). Limits are enforced by the api before any intent. */
export interface ResponsibleLimits {
  /** Max deposits per rolling 24 h, null = none (the relay's own caps still apply). */
  dailyDeposit: Amount | null;
  /** A raise (or removal) of the deposit limit waiting for its delay, null = none. */
  dailyDepositNext: PendingLimit | null;
  /** Max net loss per rolling 24 h, null = none. */
  dailyLoss: Amount | null;
  /** A raise (or removal) of the loss limit waiting for its delay, null = none. */
  dailyLossNext: PendingLimit | null;
  /** ISO time until which the player is self-excluded, null = not excluded. */
  excludedUntil: string | null;
}
/**
 * PUT /v1/account/limits (access token). Lowering takes effect at once; raising after 24 h.
 * Sending the value already pending keeps it (its delay keeps running); sending the current
 * value cancels a pending raise.
 */
export interface LimitsRequest {
  dailyDeposit: Amount | null;
  dailyLoss: Amount | null;
}
/** POST /v1/account/exclude { days } (access token): 1–3650 days, cannot be undone early. */
export interface ExcludeRequest {
  days: number;
}

/** GET /v1/leaderboard (public). */
export interface LeaderboardResponse {
  competition: { id: string; name: string; startsAt: string; endsAt: string; pool: Amount } | null;
  sponsor: SponsorView | null;
  entries: LeaderboardEntry[];
  /** Drop commitment: sha256 of the seed, revealed at the end (spec §9.2). */
  dropSeedHash: string | null;
  dropSeed: string | null;
}

/** GET /v1/rounds/:signature/verify (public): replays a settled round from its VRF output. */
export interface VerifyResponse {
  signature: string;
  player: string;
  round: number;
  game: Game;
  /** VRF output (hex) taken from the RoundSettled event. */
  randomness: string;
  /** Outcome recomputed by the api from the randomness with the public game rules. */
  replayed: RoundView;
  /** What the program recorded. */
  onChain: { stake: Amount; payout: Amount; fee: Amount };
  /** True when the replay matches the on-chain payout. */
  matches: boolean;
  /** Whether the player's choices (target, picks, bets, moves) were recorded when the round
   *  settled. Without them the replay only shows that some choice explains the payout. */
  choicesRecorded: boolean;
}

/** GET /v1/geo (public): whether the caller's country may play. */
export interface GeoResponse {
  allowed: boolean;
  country: string | null;
}
