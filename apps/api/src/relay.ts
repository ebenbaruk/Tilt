// Typed client of the relay (`apps/wallet`, spec §7). Requests and responses are checked with
// the shared `@tilt/contract` schemas; upstream text never reaches players.
import {
  ErrorResponse,
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
}

/** Refusals of the request itself: the relay recorded nothing, the same id may be sent again. */
export const NOT_RECORDED = new Set(["PLAYER_BUSY", "BLOCKED", "FORBIDDEN"]);

const ANCHOR_ERROR_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

const SAFE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  ACCOUNT_NOT_OPEN: "no account yet: deposit on the web first",
  ACCOUNT_ALREADY_OPEN: "account already open",
  TABLE_NOT_READY: "the blackjack table is not ready yet, try again",
  NETWORK_ERROR: "network error, try again",
  LIMIT_EXCEEDED: "deposit cap reached",
  PLAYER_BUSY: "another move is still in flight",
  INTENT_CONFLICT: "intent id already used for another action",
};

/** A failed intent's error, reduced to what players may see (Anchor error names are safe). */
export function safeIntentError(error: IntentResponse["error"]): { code: string; message: string } | null {
  if (!error) return null;
  if (error.code === "PROGRAM_ERROR") {
    return { code: error.code, message: ANCHOR_ERROR_NAME.test(error.message) ? error.message : "program error" };
  }
  return { code: error.code, message: SAFE_MESSAGES[error.code] ?? "intent failed" };
}

const upstream = () => new ApiError("UPSTREAM_ERROR", "relay unavailable, retry with the same id");

/** HTTP refusals of the relay, as api errors. */
function refusal(status: number, body: unknown): ApiError {
  const parsed = ErrorResponse.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  if (status === 409 && code === "PLAYER_BUSY") return new ApiError("PLAYER_BUSY", SAFE_MESSAGES.PLAYER_BUSY ?? "");
  if (status === 409 && code === "INTENT_CONFLICT") {
    return new ApiError("INTENT_CONFLICT", SAFE_MESSAGES.INTENT_CONFLICT ?? "");
  }
  if (status === 422 && code === "LIMIT_EXCEEDED") return new ApiError("BLOCKED", "deposit cap reached, try less");
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

  /** One relay call. With `notFound`, a 404 carrying that code resolves to null. */
  private async call<T>(
    method: "GET",
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body: undefined,
    notFound: ErrorCode,
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
  ): Promise<T | null> {
    let response: Response;
    let json: unknown;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
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
