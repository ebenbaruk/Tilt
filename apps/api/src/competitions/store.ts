// Campaigns, competitions and their standings, in Postgres. Rankings are computed from the
// indexed rounds: net gain (payout − stake, the program's payout being net of the fee) over
// every round of the competition window. `min_stake` (spec §9.2) gates, on the round's initial
// bet, whether a player is ranked at all (at least one such round) and which rounds earn a drop
// ticket. It never filters the net: a player cannot pick which hands count.
import type { LeaderboardEntry, SponsorView } from "@tilt/mod/protocol";
import { audit, transaction, type Db, type Queryable } from "../db";
import * as blackjack from "../games/blackjack";
import { indexedThrough } from "../indexer";
import { MAX_SPONSOR_LENGTH } from "../schemas";
import { capTickets, drawWinners, newSeed, type Ticket } from "./drops";
import { rankPrizes, splitPool, type Standing } from "./prizes";
import { prizeId } from "./uuid";

export interface Competition {
  id: string;
  name: string;
  sponsor: string;
  tagline: string | null;
  startsAt: Date;
  endsAt: Date;
  pool: bigint;
  splitBps: number[];
  sharedRanks: number;
  minStake: bigint;
  dropPool: bigint;
  dropCount: number;
  ticketsPerHour: number;
  dropSeedHash: string;
  /** Revealed once closed. */
  dropSeed: Buffer | null;
  status: "open" | "closed";
}

interface CompetitionRow {
  id: string;
  name: string;
  sponsor: string;
  tagline: string | null;
  starts_at: Date;
  ends_at: Date;
  pool: string;
  split_bps: number[];
  shared_ranks: number;
  min_stake: string;
  drop_pool: string;
  drop_count: number;
  tickets_per_hour: number;
  drop_seed_hash: string;
  drop_seed: Buffer;
  status: "open" | "closed";
}

const SELECT_COMPETITION = `
  SELECT c.id, c.name, k.sponsor, k.tagline, c.starts_at, c.ends_at, c.pool, c.split_bps, c.shared_ranks,
         c.min_stake, c.drop_pool, c.drop_count, c.tickets_per_hour, c.drop_seed_hash, c.drop_seed, c.status
  FROM competitions c JOIN campaigns k ON k.id = c.campaign_id`;

const toCompetition = (r: CompetitionRow): Competition => ({
  id: r.id,
  name: r.name,
  sponsor: r.sponsor,
  tagline: r.tagline,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  pool: BigInt(r.pool),
  splitBps: r.split_bps,
  sharedRanks: r.shared_ranks,
  minStake: BigInt(r.min_stake),
  dropPool: BigInt(r.drop_pool),
  dropCount: r.drop_count,
  ticketsPerHour: r.tickets_per_hour,
  dropSeedHash: r.drop_seed_hash,
  // The seed is secret until the competition closes (the commitment would be worthless).
  dropSeed: r.status === "closed" ? r.drop_seed : null,
  status: r.status,
});

/** The competition running now, if any (the most recently started one). */
export async function runningCompetition(db: Queryable): Promise<Competition | null> {
  const { rows } = await db.query<CompetitionRow>(
    `${SELECT_COMPETITION} WHERE c.status = 'open' AND c.starts_at <= now() AND now() < c.ends_at
     ORDER BY c.starts_at DESC LIMIT 1`,
  );
  return rows[0] ? toCompetition(rows[0]) : null;
}

/** The running competition, else the last one that ended (its seed may be revealed). */
export async function latestCompetition(db: Queryable): Promise<Competition | null> {
  const running = await runningCompetition(db);
  if (running) return running;
  const { rows } = await db.query<CompetitionRow>(
    `${SELECT_COMPETITION} WHERE c.starts_at <= now() ORDER BY c.ends_at DESC LIMIT 1`,
  );
  return rows[0] ? toCompetition(rows[0]) : null;
}

export const sponsorView = (c: Competition): SponsorView => ({
  name: c.sponsor,
  tagline: c.tagline,
  pool: (c.pool + c.dropPool).toString(),
  endsAt: c.endsAt.toISOString(),
});

/** Short public handle of a wallet, e.g. "7xk…f3a". */
export const handle = (player: string) => `${player.slice(0, 3)}…${player.slice(-3)}`;

export interface RankedStanding extends Standing {
  rank: number;
}

/** Most base bets one dealt blackjack hand can grow to: every split taken on it, every hand
 *  doubled. */
const MOST_BETS_PER_DEALT_HAND = 2 * (1 + blackjack.MAX_SPLITS);

/** A round's initial bet. RoundSettled's stake includes blackjack doubles and splits: the
 *  initial bet is the base bet on every dealt hand (hands minus splits), as the snapshot shows.
 *  Without it, the stake is taken as one hand grown to the most bets (a player could make the
 *  snapshot miss by starting the next round at once). */
const INITIAL_BET = `CASE WHEN game <> 'blackjack' THEN stake
                          WHEN detail ? 'bet' THEN (detail->>'bet')::numeric
                            * (jsonb_array_length(detail->'hands') - (detail->>'splits')::int)
                          ELSE stake / ${MOST_BETS_PER_DEALT_HAND} END`;

/** Ranking by net gain over all the window's rounds, among players with at least one round bet
 *  at `minStake`; ties broken by wallet so the order is stable. `limit` null = everyone; with a
 *  limit, `you` and the player ranked right above `you` are returned too. */
export async function standings(
  db: Queryable,
  c: Pick<Competition, "startsAt" | "endsAt" | "minStake">,
  limit: number | null,
  you: string | null = null,
): Promise<RankedStanding[]> {
  const { rows } = await db.query<{ player: string; net: string; rank: string }>(
    `WITH totals AS (
       SELECT player, sum(payout - stake) AS net FROM rounds
       WHERE settled_at >= $1 AND settled_at < $2
       GROUP BY player HAVING bool_or(${INITIAL_BET} >= $3)
     ), ranked AS (
       SELECT player, net, row_number() OVER (ORDER BY net DESC, player) AS rank FROM totals
     )
     SELECT player, net, rank FROM ranked
     WHERE $4::int IS NULL OR rank <= $4 OR player = $5 OR rank = (SELECT rank - 1 FROM ranked WHERE player = $5)
     ORDER BY rank`,
    [c.startsAt, c.endsAt, c.minStake.toString(), limit, you],
  );
  return rows.map((r) => ({ player: r.player, net: BigInt(r.net), rank: Number(r.rank) }));
}

export const toEntry = (s: RankedStanding, you: string | null): LeaderboardEntry => ({
  rank: s.rank,
  handle: handle(s.player),
  net: s.net.toString(),
  isYou: s.player === you,
});

export interface CampaignInput {
  sponsor: string;
  tagline: string | null;
  budget: bigint;
  commissionBps: number;
}

const MAX_TAGLINE_LENGTH = 200;
const MAX_COMPETITION_NAME_LENGTH = 100;
/** Control characters (ANSI escapes, newlines) and bidi overrides: they would rewrite players'
 *  terminals or flip what the web shows. */
const UNSAFE_TEXT = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Operator-typed text shown as is to every player. */
function checkDisplayText(value: string, max: number, what: string): void {
  if (!value.trim() || value.length > max || UNSAFE_TEXT.test(value)) {
    throw new Error(`${what} must be 1 to ${max} printable characters`);
  }
}

export async function createCampaign(db: Db, input: CampaignInput, actor: string): Promise<string> {
  // The mod sends the name back with each impression, which only accepts this length.
  checkDisplayText(input.sponsor, MAX_SPONSOR_LENGTH, "sponsor");
  if (input.tagline !== null) checkDisplayText(input.tagline, MAX_TAGLINE_LENGTH, "tagline");
  return transaction(db, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "INSERT INTO campaigns (sponsor, tagline, budget, commission_bps) VALUES ($1, $2, $3, $4) RETURNING id",
      [input.sponsor, input.tagline, input.budget.toString(), input.commissionBps],
    );
    await audit(client, actor, "campaign:create", { id: rows[0].id, ...input, budget: input.budget.toString() });
    return rows[0].id;
  });
}

export interface CompetitionInput {
  campaign: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  pool: bigint;
  splitBps: number[];
  sharedRanks: number;
  minStake: bigint;
  dropPool: bigint;
  dropCount: number;
  ticketsPerHour: number;
}

const BPS = 10_000n;

/** Opens a competition; its pools must fit in what the campaign has left after Tilt's commission. */
export async function openCompetition(db: Db, input: CompetitionInput, actor: string): Promise<string> {
  checkDisplayText(input.name, MAX_COMPETITION_NAME_LENGTH, "competition name");
  splitPool(input.pool, input.splitBps, input.sharedRanks); // validates the split
  return transaction(db, async (client) => {
    const { rows: campaigns } = await client.query<{ id: string; budget: string; commission_bps: number }>(
      "SELECT id, budget, commission_bps FROM campaigns WHERE id::text = $1 OR sponsor = $1 FOR UPDATE",
      [input.campaign],
    );
    const campaign = campaigns[0];
    if (!campaign) throw new Error(`unknown campaign ${input.campaign}`);
    const { rows: used } = await client.query<{ total: string }>(
      "SELECT coalesce(sum(pool + drop_pool), 0) AS total FROM competitions WHERE campaign_id = $1",
      [campaign.id],
    );
    const available = (BigInt(campaign.budget) * (BPS - BigInt(campaign.commission_bps))) / BPS - BigInt(used[0].total);
    if (input.pool + input.dropPool > available) throw new Error(`pools exceed the campaign's remaining ${available}`);
    const { seed, hash } = newSeed();
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO competitions (campaign_id, name, starts_at, ends_at, pool, split_bps, shared_ranks, min_stake,
                                 drop_pool, drop_count, tickets_per_hour, drop_seed, drop_seed_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        campaign.id,
        input.name,
        input.startsAt,
        input.endsAt,
        input.pool.toString(),
        input.splitBps,
        input.sharedRanks,
        input.minStake.toString(),
        input.dropPool.toString(),
        input.dropCount,
        input.ticketsPerHour,
        seed,
        hash,
      ],
    );
    await audit(client, actor, "competition:open", { id: rows[0].id, name: input.name, seedHash: hash });
    return rows[0].id;
  });
}

async function eligibleTickets(db: Queryable, c: Competition): Promise<Ticket[]> {
  const { rows } = await db.query<{ signature: string; player: string; settled_at: Date }>(
    `SELECT signature, player, settled_at FROM rounds
     WHERE settled_at >= $1 AND settled_at < $2 AND ${INITIAL_BET} >= $3`,
    [c.startsAt, c.endsAt, c.minStake.toString()],
  );
  return capTickets(
    rows.map((r) => ({ signature: r.signature, player: r.player, settledAt: r.settled_at })),
    c.ticketsPerHour,
  );
}

export interface ClosedSummary {
  rankPrizes: number;
  dropPrizes: number;
  seed: string;
}

/** Closes an ended competition: ranks and drops become prizes awaiting review, the seed is revealed.
 *  Refused until the indexer has caught up with the end of the window (rounds would be missing),
 *  unless `force` (recorded in the audit log). */
export async function closeCompetition(
  db: Db,
  id: string,
  actor: string,
  { force = false }: { force?: boolean } = {},
): Promise<ClosedSummary> {
  return transaction(db, async (client) => {
    const { rows } = await client.query<CompetitionRow>(`${SELECT_COMPETITION} WHERE c.id = $1 FOR UPDATE OF c`, [id]);
    const row = rows[0];
    if (!row) throw new Error(`unknown competition ${id}`);
    if (row.status !== "open") throw new Error("competition already closed");
    if (row.ends_at > new Date()) throw new Error("competition has not ended yet");
    const indexed = await indexedThrough(client);
    const caughtUp = indexed !== null && indexed >= row.ends_at;
    if (!caughtUp && !force) {
      throw new Error(
        `indexer has not caught up with the end of the competition (indexed through ${indexed?.toISOString() ?? "nothing"}); retry later or force`,
      );
    }
    const c = toCompetition(row);
    const ranking = rankPrizes(await standings(client, c, null), splitPool(c.pool, c.splitBps, c.sharedRanks));
    const drops = c.dropCount > 0 ? drawWinners(row.drop_seed, await eligibleTickets(client, c), c.dropCount) : [];
    const dropAmount = c.dropCount > 0 ? c.dropPool / BigInt(c.dropCount) : 0n;
    const prizes = [
      ...ranking.map((p) => ({ kind: "rank" as const, rank: p.rank, player: p.player, amount: p.amount })),
      ...drops.map((t, i) => ({ kind: "drop" as const, rank: i + 1, player: t.player, amount: dropAmount })),
    ].filter((p) => p.amount > 0n);
    for (const p of prizes) {
      await client.query(
        `INSERT INTO prizes (id, competition_id, kind, rank, player, user_id, amount)
         VALUES ($1, $2, $3, $4, $5, (SELECT user_id FROM users WHERE solana_address = $5), $6)
         ON CONFLICT (id) DO NOTHING`,
        [prizeId(c.id, p.kind, p.rank), c.id, p.kind, p.rank, p.player, p.amount.toString()],
      );
    }
    await client.query("UPDATE competitions SET status = 'closed', closed_at = now() WHERE id = $1", [id]);
    const summary = {
      rankPrizes: ranking.length,
      dropPrizes: prizes.length - ranking.length,
      seed: row.drop_seed.toString("hex"),
    };
    await audit(client, actor, "competition:close", { id, ...summary, ...(caughtUp ? {} : { forced: true }) });
    return summary;
  });
}
