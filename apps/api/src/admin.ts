// Admin CLI: `pnpm --filter @tilt/api admin <command> [--flag value …]`. Every action is
// written to the audit log under ADMIN_ACTOR (a named person, spec §10.7).
import { parseArgs } from "node:util";
import { revokeAllSessions } from "./auth/sessions";
import { approvePrizes, listPrizes, payPrizes, type PrizeStatus } from "./competitions/payouts";
import { closeCompetition, createCampaign, openCompetition } from "./competitions/store";
import { audit, createDb, migrate, type Db } from "./db";
import { HttpRelay } from "./relay";

const USAGE = `commands:
  campaign:create     --sponsor NAME --budget UNITS --commission-bps N [--tagline TEXT]
  competition:open    --campaign ID|SPONSOR --name NAME --hours H --pool UNITS [--starts ISO]
                      [--split 5000,2500,1000] [--shared-ranks 7] [--min-stake UNITS]
                      [--drop-pool UNITS] [--drop-count N] [--tickets-per-hour N]
  competition:close   --id ID
  prize:list          [--status pending_review|approved|paid|failed]
  prize:approve       --id PRIZE_ID | --competition ID
  prize:pay           (needs RELAY_URL and RELAY_API_KEY)
  session:revoke-user --user DID
env: DATABASE_URL, ADMIN_ACTOR (who runs the command)`;

const OPTIONS = {
  sponsor: { type: "string" },
  tagline: { type: "string" },
  budget: { type: "string" },
  "commission-bps": { type: "string" },
  campaign: { type: "string" },
  name: { type: "string" },
  hours: { type: "string" },
  starts: { type: "string" },
  pool: { type: "string" },
  split: { type: "string" },
  "shared-ranks": { type: "string" },
  "min-stake": { type: "string" },
  "drop-pool": { type: "string" },
  "drop-count": { type: "string" },
  "tickets-per-hour": { type: "string" },
  id: { type: "string" },
  competition: { type: "string" },
  status: { type: "string" },
  user: { type: "string" },
} as const;

type Flags = Partial<Record<keyof typeof OPTIONS, string>>;

function required(flags: Flags, name: keyof Flags): string {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function units(value: string, name: string): bigint {
  if (!/^\d{1,20}$/.test(value)) throw new Error(`--${name} must be an integer in USDC base units`);
  return BigInt(value);
}

function int(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}

const PRIZE_STATUSES: readonly PrizeStatus[] = ["pending_review", "approved", "paid", "failed"];

function relayFromEnv(): HttpRelay {
  const url = process.env.RELAY_URL;
  const key = process.env.RELAY_API_KEY;
  if (!url || !key) throw new Error("RELAY_URL and RELAY_API_KEY are required to pay prizes");
  return new HttpRelay(url, key, 30_000);
}

async function run(db: Db, command: string, flags: Flags, actor: string): Promise<unknown> {
  switch (command) {
    case "campaign:create":
      return createCampaign(
        db,
        {
          sponsor: required(flags, "sponsor"),
          tagline: flags.tagline ?? null,
          budget: units(required(flags, "budget"), "budget"),
          commissionBps: int(required(flags, "commission-bps"), "commission-bps"),
        },
        actor,
      );
    case "competition:open": {
      const startsAt = flags.starts ? new Date(flags.starts) : new Date();
      if (Number.isNaN(startsAt.getTime())) throw new Error("--starts must be an ISO date");
      const hours = int(required(flags, "hours"), "hours");
      return openCompetition(
        db,
        {
          campaign: required(flags, "campaign"),
          name: required(flags, "name"),
          startsAt,
          endsAt: new Date(startsAt.getTime() + hours * 3_600_000),
          pool: units(required(flags, "pool"), "pool"),
          splitBps: (flags.split ?? "5000,2500,1000").split(",").map((s) => int(s.trim(), "split")),
          sharedRanks: int(flags["shared-ranks"] ?? "7", "shared-ranks"),
          minStake: units(flags["min-stake"] ?? "0", "min-stake"),
          dropPool: units(flags["drop-pool"] ?? "0", "drop-pool"),
          dropCount: int(flags["drop-count"] ?? "0", "drop-count"),
          ticketsPerHour: int(flags["tickets-per-hour"] ?? "20", "tickets-per-hour"),
        },
        actor,
      );
    }
    case "competition:close":
      return closeCompetition(db, required(flags, "id"), actor);
    case "prize:list": {
      const status = flags.status as PrizeStatus | undefined;
      if (status && !PRIZE_STATUSES.includes(status)) throw new Error(`--status must be one of ${PRIZE_STATUSES}`);
      return listPrizes(db, status);
    }
    case "prize:approve":
      return approvePrizes(db, flags.id ? { id: flags.id } : { competitionId: required(flags, "competition") }, actor);
    case "prize:pay":
      return payPrizes(db, relayFromEnv(), actor);
    case "session:revoke-user": {
      const user = required(flags, "user");
      const revoked = await revokeAllSessions(db, user);
      await audit(db, actor, "session:revoke-user", { user, revoked });
      return { revoked };
    }
    default:
      throw new Error(`unknown command\n${USAGE}`);
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [command] = positionals;
  const databaseUrl = process.env.DATABASE_URL;
  const actor = process.env.ADMIN_ACTOR;
  if (!command) throw new Error(USAGE);
  if (!databaseUrl || !actor) throw new Error("DATABASE_URL and ADMIN_ACTOR are required");
  const db = createDb(databaseUrl);
  try {
    await migrate(db);
    const result = await run(db, command, values, actor);
    console.info(JSON.stringify(result, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2));
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
