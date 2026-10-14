// What the HTTP routes need; main.ts wires the real ones, tests inject fakes.
import type { ChainReader } from "./chain";
import type { Config } from "./config";
import type { Db } from "./db";
import type { GeoPolicy } from "./http";
import type { Intents } from "./intents";
import type { PrivyVerifier } from "./privy";
import type { RateLimiter } from "./ratelimit";
import type { Relay } from "./relay";

export interface Limiters {
  global: RateLimiter;
  ip: RateLimiter;
  token: RateLimiter;
  auth: RateLimiter;
  /** Device approvals per user, right or wrong (brute force of user codes). */
  approveAttempts: RateLimiter;
  play: RateLimiter;
  money: RateLimiter;
}

export interface AppDeps {
  db: Db;
  relay: Relay;
  chain: ChainReader;
  privy: PrivyVerifier;
  intents: Intents;
  limiters: Limiters;
  geo: GeoPolicy;
  config: Pick<
    Config,
    "WEB_ORIGIN" | "WEB_URL" | "TRUST_PROXY" | "TRUSTED_PROXY_HOPS" | "PRIVY_KEY_QUORUM_ID" | "PRIVY_POLICY_ID"
  >;
  /** Milliseconds since the epoch; injectable for token-age tests. */
  now: () => number;
}
