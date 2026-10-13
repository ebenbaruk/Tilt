// api configuration, read once from the environment and validated (spec §10.5: secrets come
// from the host's secret manager, never from the repo).
import { z } from "zod";

const Bool = z.enum(["true", "false"]).transform((s) => s === "true");
const CountryList = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 code")));
const PositiveInt = z.coerce.number().int().positive();

/** Spec §12: at least the US, the UK, France, and countries where Curaçao-licensed casinos may
 *  not operate or are blacklisted. Replace with counsel's list before real money. */
const DEFAULT_BLOCKED_COUNTRIES = "US,GB,FR,NL,ES,IT,DE,BE,PT,AU,SG,HK,CW,AW,BQ,SX,IR,KP,CU,SY,RU,BY";

const Env = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: PositiveInt.default(8080),
  DATABASE_URL: z.string().min(1),
  RELAY_URL: z.string().url(),
  /** Shared secret for the relay (`RELAY_API_KEYS` there). */
  RELAY_API_KEY: z.string().min(32),
  RELAY_TIMEOUT_MS: PositiveInt.default(15_000),
  SOLANA_RPC_URL: z.string().url(),
  ROLLUP_RPC_URL: z.string().url(),
  ROLLUP_WS_URL: z.string().url(),
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  /** Signer and policy the web attaches to the player's embedded wallet (spec §7). */
  PRIVY_KEY_QUORUM_ID: z.string().min(1),
  PRIVY_POLICY_ID: z.string().min(1),
  /** The web app's origin, the only one allowed by CORS. */
  WEB_ORIGIN: z.string().url(),
  /** Public web URL, for the device-login link. */
  WEB_URL: z.string().url(),
  BLOCKED_COUNTRIES: CountryList.default(DEFAULT_BLOCKED_COUNTRIES),
  /** Header the edge proxy sets with the caller's country (Vercel's by default). */
  COUNTRY_HEADER: z.string().min(1).default("x-vercel-ip-country"),
  /** Without a country header, refuse (fail closed) unless this is true (local development). */
  GEO_ALLOW_UNKNOWN: Bool.default("false"),
  /** Trust X-Forwarded-For for the client IP (only behind a proxy that overwrites it). */
  TRUST_PROXY: Bool.default("false"),
  /** Token buckets: requests per minute. */
  RATE_GLOBAL_PER_MIN: PositiveInt.default(6_000),
  RATE_IP_PER_MIN: PositiveInt.default(240),
  RATE_TOKEN_PER_MIN: PositiveInt.default(180),
  RATE_AUTH_PER_MIN: PositiveInt.default(10),
  RATE_PLAY_PER_MIN: PositiveInt.default(60),
  RATE_MONEY_PER_MIN: PositiveInt.default(6),
  /** Indexer backfill period. */
  INDEXER_BACKFILL_MS: PositiveInt.default(30_000),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid api configuration: ${fields}`);
  }
  return parsed.data;
}
