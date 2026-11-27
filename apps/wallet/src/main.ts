// Relay entrypoint: HTTP API for `apps/api` plus the sweeper cron.
import { serve } from "@hono/node-server";
import { PrivyClient } from "@privy-io/node";
import { createApp } from "./app";
import { PrivyConsentVerifier } from "./consent";
import { TiltChain } from "./chain";
import { loadConfig } from "./config";
import { createDb, migrate } from "./db";
import { ChainExecutor } from "./executor";
import { assertDevnet, lowFaucetReserve } from "./faucet";
import { Intents } from "./intents";
import { check, logAlert } from "./monitor";
import { PrivyPlayerWallets } from "./players";
import { sweep } from "./sweeper";

/** A sweep running longer than this is reported as stuck (it is never run twice at once). */
const SWEEP_STUCK_MS = 5 * 60_000;
/** Privy calls (with one retry) stay well under the 3 min after which an unsent intent is failed. */
const PRIVY_TIMEOUT_MS = 20_000;

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);

const chain = new TiltChain({
  solanaRpcUrl: config.SOLANA_RPC_URL,
  rollupRpcUrl: config.ROLLUP_RPC_URL,
  rollupWsUrl: config.ROLLUP_WS_URL,
  vrfQueue: config.VRF_QUEUE,
  relayer: config.RELAYER_SECRET_KEY,
});
const vault = await chain.fetchVault();
if (!vault.relayer.equals(config.RELAYER_SECRET_KEY.publicKey)) {
  throw new Error(`RELAYER_SECRET_KEY is not the vault relayer (${vault.relayer.toBase58()})`);
}
const faucet = config.FAUCET_ENABLED ? { amount: config.FAUCET_AMOUNT, dailyLimit: config.FAUCET_DAILY_LIMIT } : undefined;
if (faucet) await assertDevnet(chain.base);

const privy = new PrivyClient({ appId: config.PRIVY_APP_ID, appSecret: config.PRIVY_APP_SECRET, timeout: PRIVY_TIMEOUT_MS, maxRetries: 1 });
const players = new PrivyPlayerWallets(privy, config.PRIVY_AUTHORIZATION_KEY, db);
const intents = new Intents(db, new ChainExecutor(chain, players, db), {
  faucet,
  maxDeposit: config.MAX_DEPOSIT,
  dailyDepositLimit: config.DAILY_DEPOSIT_LIMIT,
  dailyDepositLimitGlobal: config.DAILY_DEPOSIT_LIMIT_GLOBAL,
  minPromoPayout: config.MIN_PROMO_PAYOUT,
  maxPromoPayout: config.MAX_PROMO_PAYOUT,
  dailyPromoLimit: config.DAILY_PROMO_LIMIT,
});
const app = createApp({ apiKeys: config.RELAY_API_KEYS, intents, players, chain, db, consent: new PrivyConsentVerifier(privy) });

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT });
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ level: "info", msg, ...extra }));
const logError = (msg: string, e: unknown) => console.error(JSON.stringify({ level: "error", msg, error: e instanceof Error ? e.message : String(e) }));
log("relay listening", { host: config.HOST, port: config.PORT, relayer: config.RELAYER_SECRET_KEY.publicKey.toBase58(), faucet: config.FAUCET_ENABLED });

const thresholds = {
  minRelayerLamports: config.MIN_RELAYER_LAMPORTS,
  minEscrowLamports: config.MIN_ESCROW_LAMPORTS,
  minFreeBankroll: config.MIN_FREE_BANKROLL,
  minFaucetReserve: faucet && lowFaucetReserve(faucet),
};
let sweepStartedAt: number | undefined;
const sweepTimer = setInterval(() => {
  if (sweepStartedAt !== undefined) {
    if (Date.now() - sweepStartedAt > SWEEP_STUCK_MS) logError("sweep stuck", new Error(`running for ${Date.now() - sweepStartedAt} ms`));
    return;
  }
  sweepStartedAt = Date.now();
  const options = { checkpointMinLoss: config.CHECKPOINT_MIN_LOSS, checkpointIntervalMs: config.CHECKPOINT_INTERVAL_MS, riskPoolTarget: config.RISK_POOL_TARGET };
  void sweep(db, chain, intents, options)
    .then((report) => {
      if (report.reconciled || report.funded || report.expired || report.checkpointed || report.failed) {
        log("sweep", { ...report, funded: report.funded.toString() });
      }
    }, (e: unknown) => logError("sweep failed", e))
    .finally(() => {
      sweepStartedAt = undefined;
    });
}, config.CRON_INTERVAL_MS);

// Separate from the sweep, so a slow sweep (many players, slow RPC) never silences the alerts.
let monitoring = false;
const monitorTimer = setInterval(() => {
  if (monitoring) return;
  monitoring = true;
  void check(db, chain, thresholds)
    .then((alerts) => {
      alerts.forEach(logAlert);
    })
    .finally(() => {
      monitoring = false;
    });
}, config.CRON_INTERVAL_MS);

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  clearInterval(sweepTimer);
  clearInterval(monitorTimer);
  server.close(() => void db.end().then(() => process.exit(0)));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
