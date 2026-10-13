// api entrypoint: HTTP server plus the rollup indexer.
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { RpcChainReader } from "./chain";
import { loadConfig } from "./config";
import { createDb, migrate } from "./db";
import { geoPolicy } from "./http";
import { ConnectionSource, Indexer } from "./indexer";
import { Intents } from "./intents";
import { log } from "./log";
import { PrivyTokenVerifier } from "./privy";
import { RateLimiter } from "./ratelimit";
import { HttpRelay } from "./relay";

/** Wrong user codes a player may type per 10 minutes before approvals are refused. */
const APPROVE_FAILURES = 5;
const APPROVE_FAILURE_WINDOW_S = 600;
const SHUTDOWN_GRACE_MS = 10_000;

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);

const relay = new HttpRelay(config.RELAY_URL, config.RELAY_API_KEY, config.RELAY_TIMEOUT_MS);
const chain = new RpcChainReader({
  solanaRpcUrl: config.SOLANA_RPC_URL,
  rollupRpcUrl: config.ROLLUP_RPC_URL,
  rollupWsUrl: config.ROLLUP_WS_URL,
});
const app = createApp({
  db,
  relay,
  chain,
  privy: new PrivyTokenVerifier(config.PRIVY_APP_ID, config.PRIVY_APP_SECRET),
  intents: new Intents(db, relay),
  limiters: {
    global: RateLimiter.perMinute(config.RATE_GLOBAL_PER_MIN),
    ip: RateLimiter.perMinute(config.RATE_IP_PER_MIN),
    token: RateLimiter.perMinute(config.RATE_TOKEN_PER_MIN),
    auth: RateLimiter.perMinute(config.RATE_AUTH_PER_MIN),
    approveFailures: new RateLimiter({
      capacity: APPROVE_FAILURES,
      refillPerSecond: APPROVE_FAILURES / APPROVE_FAILURE_WINDOW_S,
    }),
    play: RateLimiter.perMinute(config.RATE_PLAY_PER_MIN),
    money: RateLimiter.perMinute(config.RATE_MONEY_PER_MIN),
  },
  geo: geoPolicy(config),
  config,
  now: Date.now,
});

const indexer = new Indexer(db, new ConnectionSource(chain.rollup), chain, config.INDEXER_BACKFILL_MS);
await indexer.start();

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT });
log.info("api listening", { host: config.HOST, port: config.PORT });

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info("api shutting down");
  // Hard stop if draining hangs (a stuck client or RPC call).
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await indexer.stop();
  await db.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("unhandledRejection", (e) => log.error("unhandled rejection", e));
