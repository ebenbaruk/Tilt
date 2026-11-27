// Typed client for apps/api. Types come from the frozen `@tilt/api/public` contract (types only).
import type {
  AccountResponse,
  ApiErrorCode,
  DepositRequest,
  DeviceApproveRequest,
  DeviceApproveResponse,
  ExcludeRequest,
  FaucetRequest,
  FaucetResponse,
  GeoResponse,
  LeaderboardResponse,
  LimitsRequest,
  MoneyIntentResponse,
  SessionsResponse,
  VerifyResponse,
  WithdrawRequest,
} from "@tilt/api/public";
import { apiUrl } from "./config";

/** API codes, plus the two failures that never reach the API's error body. */
export type ClientErrorCode = ApiErrorCode | "NETWORK_ERROR" | "BAD_RESPONSE";

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_ERROR_CODES: readonly ApiErrorCode[] = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "NOT_FOUND",
  "RATE_LIMITED",
  "PLAYER_BUSY",
  "INTENT_CONFLICT",
  "BLOCKED",
  "GEO_BLOCKED",
  "ACCOUNT_NOT_OPEN",
  "UPSTREAM_ERROR",
  "INTERNAL_ERROR",
];

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

/** Fallback when an error response has no usable body (proxy pages, crashes). */
function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  return "INTERNAL_ERROR";
}

/** Maps a non-2xx response body to an ApiError. Exported for tests. */
export function toApiError(status: number, body: unknown): ApiError {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error: unknown = body.error;
    if (typeof error === "object" && error !== null && "code" in error && isApiErrorCode(error.code)) {
      const message = "message" in error && typeof error.message === "string" ? error.message : error.code;
      return new ApiError(error.code, message, status);
    }
  }
  return new ApiError(codeForStatus(status), `Request failed with HTTP ${status}.`, status);
}

export interface Auth {
  accessToken: string;
  /** Fresh Privy identity token: required on money moves (spec §7). */
  identityToken?: string;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: Auth;
  signal?: AbortSignal;
}

type Fetch = typeof fetch;

/** Longer than the API's own relay timeout (15 s), so a slow money move gets its answer before the web gives up. */
const REQUEST_TIMEOUT_MS = 30_000;

export function createApi(
  baseUrl: string,
  fetchImpl: Fetch = (...args) => fetch(...args),
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  async function request<T>(path: string, { method = "GET", body, auth, signal }: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) headers.Authorization = `Bearer ${auth.accessToken}`;
    if (auth?.identityToken) headers["X-Privy-Identity-Token"] = auth.identityToken;

    // A hung API must end in an error the page can show, not an endless spinner.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const forwardAbort = () => deadline.abort();
    if (signal?.aborted) deadline.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: deadline.signal,
        cache: "no-store",
      });
      // The body can fail mid-stream too: the request still went out, so it is a network error like any other.
      text = await response.text();
    } catch (cause) {
      // The caller gave up (e.g. the page unmounted): nothing to show.
      if (signal?.aborted) throw cause;
      throw new ApiError("NETWORK_ERROR", "Could not reach the Tilt API.", null);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (response.ok) throw new ApiError("BAD_RESPONSE", "The API sent an unreadable response.", response.status);
      }
    }
    if (!response.ok) throw toApiError(response.status, parsed);
    // The API is ours and typed by the shared contract; its responses are trusted past this point.
    return parsed as T;
  }

  const enc = encodeURIComponent;

  return {
    geo: (signal?: AbortSignal) => request<GeoResponse>("/v1/geo", { signal }),
    leaderboard: (signal?: AbortSignal) => request<LeaderboardResponse>("/v1/leaderboard", { signal }),
    verifyRound: (signature: string, signal?: AbortSignal) =>
      request<VerifyResponse>(`/v1/rounds/${enc(signature)}/verify`, { signal }),

    approveDevice: (auth: Auth, body: DeviceApproveRequest) =>
      request<DeviceApproveResponse>("/v1/auth/device/approve", { method: "POST", body, auth }),

    account: (auth: Auth) => request<AccountResponse>("/v1/account", { auth }),
    deposit: (auth: Auth, body: DepositRequest) =>
      request<MoneyIntentResponse>("/v1/account/deposit", { method: "POST", body, auth }),
    withdraw: (auth: Auth, body: WithdrawRequest) =>
      request<MoneyIntentResponse>("/v1/account/withdraw", { method: "POST", body, auth }),
    faucet: (auth: Auth, body: FaucetRequest) =>
      request<FaucetResponse>("/v1/account/faucet", { method: "POST", body, auth }),
    moneyIntent: (auth: Auth, intentId: string) =>
      request<MoneyIntentResponse>(`/v1/account/intents/${enc(intentId)}`, { auth }),
    sessions: (auth: Auth) => request<SessionsResponse>("/v1/account/sessions", { auth }),
    revokeSession: (auth: Auth, id: string) =>
      request<unknown>(`/v1/account/sessions/${enc(id)}`, { method: "DELETE", auth }),
    setLimits: (auth: Auth, body: LimitsRequest) =>
      request<unknown>("/v1/account/limits", { method: "PUT", body, auth }),
    exclude: (auth: Auth, body: ExcludeRequest) =>
      request<unknown>("/v1/account/exclude", { method: "POST", body, auth }),
  };
}

export type Api = ReturnType<typeof createApi>;

let shared: Api | null = null;

/** The browser's client for the configured API origin. */
export function getApi(): Api {
  shared ??= createApi(apiUrl());
  return shared;
}
