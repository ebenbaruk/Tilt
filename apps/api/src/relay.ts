// Typed client of the relay (`apps/wallet`, spec §7). Requests and responses are checked with
// the shared `@tilt/contract` schemas; upstream text never reaches players.
import {
  ErrorResponse,
  FaucetClaimRequest,
  FaucetClaimResponse,
  FaucetStatusResponse,
  IntentRequest,
  IntentResponse,
  PromoPayoutRequest,
  PromoPayoutResponse,
  UserResponse,
  type ErrorCode,
} from "@tilt/contract";
import type { z } from "zod";
import { ApiError } from "./errors";
import { log } from "./log";

export interface Relay {
  /** null when Privy has no such user or the user has no Solana wallet yet. */
  getUser(userId: string): Promise<UserResponse | null>;
  submitIntent(request: IntentRequest): Promise<IntentResponse>;
  /** null when the relay never received this intent. */
  getIntent(intentId: string): Promise<IntentResponse | null>;
  payPromo(request: PromoPayoutRequest): Promise<PromoPayoutResponse>;
  getPromo(payoutId: string): Promise<PromoPayoutResponse | null>;
  /** The devnet faucet, as the relay sees it for this player. */
  faucetStatus(userId: string): Promise<FaucetStatusResponse>;
  claimFaucet(request: FaucetClaimRequest): Promise<FaucetClaimResponse>;
}

/** Refusals of the request itself: the relay recorded nothing, the same id may be sent again. */
export const NOT_RECORDED = new Set(["PLAYER_BUSY", "BLOCKED", "FORBIDDEN"]);

const ANCHOR_ERROR_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

const SAFE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  ACCOUNT_NOT_OPEN: "no account yet: deposit on the web first",
  ACCOUNT_ALREADY_OPEN: "account already open",
  TABLE_NOT_READY: "the game table is not ready yet, try again",
  NETWORK_ERROR: "network error, try again",
  LIMIT_EXCEEDED: "deposit cap reached",
  PLAYER_BUSY: "another move is still in flight",
  INTENT_CONFLICT: "intent id already used for another action",
  FAUCET_EMPTY: "the test USDC faucet is empty, try again later",
};

/** A failed intent's error, reduced to what players may see (Anchor error names are safe). */
export function safeIntentError(error: IntentResponse["error"]): { code: string; message: string } | null {
  if (!error) return null;
  if (error.code === "PROGRAM_ERROR") {
    return { code: error.code, message: ANCHOR_ERROR_NAME.test(error.message) ? error.message : "program error" };
  }
  return { code: error.code, message: SAFE_MESSAGES[error.code] ?? "intent failed" };
}

/** The account page waits on the faucet's status: a slow relay only hides the faucet, sooner. */
const FAUCET_STATUS_TIMEOUT_MS = 2_000;

const upstream = () => new ApiError("UPSTREAM_ERROR", "relay unavailable, retry with the same id");

/** HTTP refusals of the relay, as api errors. */
function refusal(status: number, body: unknown): ApiError {
  const parsed = ErrorResponse.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  if (status === 409 && code === "PLAYER_BUSY") return new ApiError("PLAYER_BUSY", SAFE_MESSAGES.PLAYER_BUSY ?? "");
  if (status === 409 && code === "INTENT_CONFLICT") {
    return new ApiError("INTENT_CONFLICT", SAFE_MESSAGES.INTENT_CONFLICT ?? "");
  }
  if (status === 422 && code === "LIMIT_EXCEEDED") {
    const retryAt = parsed.success ? parsed.data.error.retryAt : undefined;
    // Only faucet claims carry retryAt; deposits are refused by the relay's own caps.
    if (retryAt)
      return new ApiError(
        "BLOCKED",
        `test USDC limit reached, next claim after ${retryAt.slice(0, 16).replace("T", " ")} UTC`,
      );
    return new ApiError("BLOCKED", "deposit cap reached, try less");
  }
  if (status === 403 && code === "FAUCET_DISABLED") return new ApiError("NOT_FOUND", "no test USDC faucet here");
  // The relay checks the player's identity token again; it is only refused once it expired in between.
  if (status === 403 && code === "CONSENT_REQUIRED")
    return new ApiError("FORBIDDEN", "identity check expired, sign in again");
  // 400 / 401 / 5xx: our bug or the relay's; never shown, always logged.
  log.error("relay refused a request", new Error(`HTTP ${status}`), { code: code ?? "unparsed" });
  return upstream();
}

export class HttpRelay implements Relay {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async getUser(userId: string): Promise<UserResponse | null> {
    return this.call("GET", `/users/${encodeURIComponent(userId)}`, UserResponse, undefined, "UNKNOWN_USER");
  }

  async submitIntent(request: IntentRequest): Promise<IntentResponse> {
    return this.call("POST", "/intents", IntentResponse, IntentRequest.parse(request));
  }

  async getIntent(intentId: string): Promise<IntentResponse | null> {
    return this.call("GET", `/intents/${encodeURIComponent(intentId)}`, IntentResponse, undefined, "INVALID_REQUEST");
  }

  async payPromo(request: PromoPayoutRequest): Promise<PromoPayoutResponse> {
    return this.call("POST", "/payouts/promo", PromoPayoutResponse, PromoPayoutRequest.parse(request));
  }

  async getPromo(payoutId: string): Promise<PromoPayoutResponse | null> {
    const path = `/payouts/promo/${encodeURIComponent(payoutId)}`;
    return this.call("GET", path, PromoPayoutResponse, undefined, "INVALID_REQUEST");
  }

  async faucetStatus(userId: string): Promise<FaucetStatusResponse> {
    const path = `/faucet/${encodeURIComponent(userId)}`;
    const timeoutMs = Math.min(this.timeoutMs, FAUCET_STATUS_TIMEOUT_MS);
    const status = await this.call("GET", path, FaucetStatusResponse, undefined, "INVALID_REQUEST", timeoutMs);
    // The relay never answers this route with 404; were it to, "no faucet" is the safe reading.
    return status ?? { enabled: false, amount: null, nextClaimAt: null };
  }

  async claimFaucet(request: FaucetClaimRequest): Promise<FaucetClaimResponse> {
    return this.call("POST", "/faucet/claims", FaucetClaimResponse, FaucetClaimRequest.parse(request));
  }

  /** One relay call. With `notFound`, a 404 carrying that code resolves to null. */
  private async call<T>(
    method: "GET",
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body: undefined,
    notFound: ErrorCode,
    timeoutMs?: number,
  ): Promise<T | null>;
  private async call<T>(
    method: "POST",
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body: object,
  ): Promise<T>;
  private async call<T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body?: object,
    notFound?: ErrorCode,
    timeoutMs = this.timeoutMs,
  ): Promise<T | null> {
    let response: Response;
    let json: unknown;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      json = await response.json().catch(() => undefined);
    } catch (e) {
      log.error("relay unreachable", e, { method, path: path.split("/")[1] });
      throw upstream();
    }
    if (response.status === 404 && notFound) {
      const parsed = ErrorResponse.safeParse(json);
      if (parsed.success && parsed.data.error.code === notFound) return null;
    }
    if (!response.ok) throw refusal(response.status, json);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      log.error("relay response does not match the contract", new Error(parsed.error.message), { method });
      throw upstream();
    }
    return parsed.data;
  }
}
