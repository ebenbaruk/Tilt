import type { AccountResponse } from "@tilt/api/public";

export type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** `refreshError`: the last refresh failed, the account shown is the last one loaded. */
  | { kind: "ready"; account: AccountResponse; refreshError?: string };

/** A failed refresh keeps a loaded account on screen: replacing it with an error would unmount the money panels
 *  and hide the outcome of the deposit or withdrawal that triggered the refresh. */
export function refreshFailed(previous: Load, message: string): Load {
  return previous.kind === "ready" ? { ...previous, refreshError: message } : { kind: "error", message };
}
