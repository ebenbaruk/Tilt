// Every refusal the api returns, as one error type mapped to its HTTP status.
import type { ApiErrorCode, ErrorBody } from "@tilt/mod/protocol";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PLAYER_BUSY: 409,
  INTENT_CONFLICT: 409,
  BLOCKED: 403,
  GEO_BLOCKED: 451,
  ACCOUNT_NOT_OPEN: 409,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

/** `message` is shown to players as is: keep it short and free of internal details. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }

  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }

  body(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}
