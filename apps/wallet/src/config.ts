// Relay configuration, read once from the environment and validated (spec §10.5: secrets
// come from the host's secret manager, never from the repo).
import { Keypair, PublicKey } from "@solana/web3.js";
import { createPrivateKey } from "node:crypto";
import { z } from "zod";

const PublicKeyString = z.string().transform((s, ctx) => {
  try {
    return new PublicKey(s);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid public key" });
    return z.NEVER;
  }
});

const SecretKey = z.string().transform((s, ctx) => {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a JSON array of 64 bytes" });
    return z.NEVER;
  }
});

/** Privy authorization private key: base64 PKCS8 P-256, optionally prefixed "wallet-auth:". */
const PrivyAuthorizationKey = z.string().refine((s) => {
  try {
    const key = createPrivateKey({ key: Buffer.from(s.replace(/^wallet-auth:/, ""), "base64"), format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}, "expected a base64 PKCS8 P-256 private key");

const UsdcAmount = z.coerce.bigint().refine((n) => n > 0n, "must be positive");

const Env = z.object({
  /** The relay is never exposed (spec §10.5): bind to loopback or the private network address. */
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.string().min(1),
  /** Shared secrets for `apps/api`, comma-separated (two during a rotation); each ≥ 32 characters. */
  RELAY_API_KEYS: z.string().transform((s) => s.split(",").map((k) => k.trim())).pipe(z.array(z.string().min(32)).min(1)),
  SOLANA_RPC_URL: z.string().url(),
  ROLLUP_RPC_URL: z.string().url(),
  ROLLUP_WS_URL: z.string().url(),
  /** MagicBlock VRF queue of the rollup the player accounts are delegated to. */
  VRF_QUEUE: PublicKeyString,
  /** The relayer key (`vault.relayer`): pays fees and plays for players. */
  RELAYER_SECRET_KEY: SecretKey,
  PRIVY_APP_ID: z.string().min(1),
  PRIVY_APP_SECRET: z.string().min(1),
  /** Private key of the Privy key quorum players add as a signer on their wallet. */
  PRIVY_AUTHORIZATION_KEY: PrivyAuthorizationKey,
  /** Largest single deposit the relay will get a player's wallet to sign (USDC base units). */
  MAX_DEPOSIT: UsdcAmount.default(1_000_000_000n),
  /** Largest total a player can deposit through the relay per rolling 24 h (USDC base units). */
  DAILY_DEPOSIT_LIMIT: UsdcAmount.default(5_000_000_000n),
  /** Smallest promo payout (USDC base units): each one costs the relayer rent. */
  MIN_PROMO_PAYOUT: UsdcAmount.default(1_000_000n),
  /** How often the cron settles intents, expires stale rounds and checkpoints losses. */
  CRON_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  /** Losses (USDC base units) worth a checkpoint; each one costs a commit. */
  CHECKPOINT_MIN_LOSS: UsdcAmount.default(1_000_000n),
  /** Minimum delay between two checkpoints of the same player. */
  CHECKPOINT_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  /** Monitoring: alert below these (lamports, lamports, USDC base units). */
  MIN_RELAYER_LAMPORTS: z.coerce.bigint().default(500_000_000n),
  MIN_ESCROW_LAMPORTS: z.coerce.bigint().default(2_000_000n),
  MIN_FREE_BANKROLL: z.coerce.bigint().default(100_000_000n),
});

export type RelayConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid relay configuration: ${fields}`);
  }
  return parsed.data;
}
