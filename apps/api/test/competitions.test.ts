// Competitions against Postgres: leaderboard sums, closing (ranks, drops, seed reveal), review
// and idempotent payouts through the fake relay.
import { Keypair } from "@solana/web3.js";
import fc from "fast-check";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capTickets, drawWinners, seedHash } from "../src/competitions/drops";
import { approvePrizes, listPrizes, payPrizes } from "../src/competitions/payouts";
import {
  closeCompetition,
  createCampaign,
  latestCompetition,
  openCompetition,
  standings,
  type CompetitionInput,
} from "../src/competitions/store";
import { prizeId } from "../src/competitions/uuid";
import { saveDetail, saveRound } from "../src/rounds";
import { ensureUser, recordWallet } from "../src/users";
import { FakeRelay, resetDb, testDb } from "./helpers";

const db = await testDb();
const HOUR = 3_600_000;
const players = Array.from({ length: 5 }, () => Keypair.generate().publicKey);

let sigCounter = 0;
const round = (player: string, at: Date, stake: bigint, payout: bigint, game: "slots" | "blackjack" = "slots") => ({
  signature: `sig${++sigCounter}`.padEnd(88, "1"),
  player,
  round: sigCounter,
  game,
  stake,
  payout,
  fee: 0n,
  requestId: BigInt(sigCounter),
  randomness: Buffer.alloc(32),
  settledAt: at,
});

describe.skipIf(!db)("competitions", () => {
  if (!db) return;
  const relay = new FakeRelay();
  beforeAll(() => relay.start());
  afterAll(async () => {
    await relay.stop();
    await db.end();
  });
  beforeEach(async () => {
    await resetDb(db);
    relay.intents.clear();
    relay.payoutCalls = 0;
    relay.delayMs = 0;
    relay.outcome = () => ({ status: "submitted", signature: `sig-${relay.intents.size + 1}` });
    await indexedUpTo(new Date());
  });

  const indexedUpTo = (at: Date) =>
    db.query(
      `INSERT INTO indexer_cursor (name, signature, indexed_through) VALUES ('rollup', 'sig', $1)
       ON CONFLICT (name) DO UPDATE SET indexed_through = EXCLUDED.indexed_through`,
      [at],
    );

  const campaign = (budget = 100_000_000n): Promise<string> =>
    createCampaign(db, { sponsor: "Northwind", tagline: null, budget, commissionBps: 4000 }, "test");

  const ended = (overrides: Partial<CompetitionInput> = {}): CompetitionInput => ({
    campaign: "Northwind",
    name: "daily",
    startsAt: new Date(Date.now() - 3 * HOUR),
    endsAt: new Date(Date.now() - 60_000),
    pool: 10_000_000n,
    splitBps: [5000, 2500, 1000],
    sharedRanks: 1,
    minStake: 100_000n,
    dropPool: 2_000_000n,
    dropCount: 2,
    ticketsPerHour: 3,
    ...overrides,
  });

  /** Saves a round; a blackjack one gets its snapshot of `hands` hands, `doubles` of them
   *  doubled, unless `table` is null (snapshot missed). */
  const saveWithDetail = async (r: ReturnType<typeof round>, table: { hands: number; doubles: number } | null) => {
    await saveRound(db, r);
    if (r.game !== "blackjack" || table === null) return;
    await saveDetail(db, r.player, r.round, r.requestId, {
      game: "blackjack",
      bet: (r.stake / BigInt(table.hands + table.doubles)).toString(),
      hands: Array.from({ length: table.hands }, (_, i) => ({ cards: [10, 9], doubled: i < table.doubles })),
      active: table.hands,
      dealer: [10, 7],
    });
  };

  it("ranks eligible players by net gain over all their rounds in the window", async () => {
    const start = new Date(Date.now() - 10 * HOUR);
    const window = { startsAt: start, endsAt: new Date(start.getTime() + 5 * HOUR), minStake: 5n };
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            player: fc.integer({ min: 0, max: 3 }),
            minute: fc.integer({ min: -60, max: 6 * 60 }),
            game: fc.constantFrom("slots" as const, "blackjack" as const),
            table: fc.option(fc.record({ hands: fc.integer({ min: 1, max: 3 }), doubles: fc.integer({ min: 0, max: 3 }) })),
            bet: fc.integer({ min: 1, max: 10 }),
            payout: fc.integer({ min: 0, max: 30 }),
          }),
          { maxLength: 40 },
        ),
        async (rows) => {
          await db.query("TRUNCATE rounds");
          const net = new Map<string, bigint>();
          const eligible = new Set<string>();
          for (const r of rows) {
            const at = new Date(start.getTime() + r.minute * 60_000);
            const player = players[r.player].toBase58();
            const table = r.table && { hands: r.table.hands, doubles: Math.min(r.table.doubles, r.table.hands) };
            // Blackjack: the bet on every hand, plus one per double; without a snapshot, any split.
            const bets = r.game === "blackjack" && table ? table.hands + table.doubles : 1;
            const stake = r.bet * bets;
            await saveWithDetail(round(player, at, BigInt(stake), BigInt(r.payout), r.game), table);
            if (at < window.startsAt || at >= window.endsAt) continue;
            net.set(player, (net.get(player) ?? 0n) + BigInt(r.payout - stake));
            // Initial bet: the bet on every hand; half the stake when the snapshot was missed.
            const initial = r.game !== "blackjack" ? stake : table ? r.bet * table.hands : stake / 2;
            if (initial >= 5) eligible.add(player);
          }
          const expected = new Map([...net].filter(([player]) => eligible.has(player)));
          const ranking = await standings(db, window, null);
          expect(new Map(ranking.map((s) => [s.player, s.net]))).toEqual(expected);
          expect(ranking.map((s) => s.rank)).toEqual(ranking.map((_, i) => i + 1));
          for (let i = 1; i < ranking.length; i++) expect(ranking[i - 1].net >= ranking[i].net).toBe(true);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("judges the minimum stake on the initial bet: every hand's bet counts, a double never does", async () => {
    const t = new Date(Date.now() - HOUR);
    const window = { startsAt: new Date(t.getTime() - HOUR), endsAt: new Date(), minStake: 10n };
    const [a, b, c, d, e] = players.map((p) => p.toBase58());
    await saveWithDetail(round(a, t, 10n, 40n, "blackjack"), { hands: 1, doubles: 1 }); // bet 5, doubled to 10
    await saveWithDetail(round(b, t, 10n, 20n, "blackjack"), { hands: 1, doubles: 0 }); // bet 10
    await saveWithDetail(round(c, t, 10n, 20n, "blackjack"), null); // snapshot missed
    await saveWithDetail(round(c, t, 3n, 0n), null); // below the minimum, still in c's net
    await saveWithDetail(round(c, t, 20n, 0n, "blackjack"), null);
    await saveWithDetail(round(d, t, 15n, 30n, "blackjack"), { hands: 2, doubles: 1 }); // 2 hands of 5, one doubled
    await saveWithDetail(round(e, t, 16n, 40n, "blackjack"), { hands: 2, doubles: 2 }); // 2 hands of 4, both doubled
    expect((await standings(db, window, null)).map((s) => [s.player, s.net])).toEqual([
      [d, 15n],
      [b, 10n],
      [c, -13n],
    ]);
  });

  it("keeps the pools within the campaign budget after commission", async () => {
    await campaign(20_000_000n); // 12 000 000 left after 40 %
    await openCompetition(db, ended({ pool: 10_000_000n, dropPool: 2_000_000n }), "test");
    await expect(openCompetition(db, ended({ pool: 1n, dropPool: 0n }), "test")).rejects.toThrow(/exceed/);
    await expect(openCompetition(db, ended({ campaign: "nobody" }), "test")).rejects.toThrow(/unknown campaign/);
    await expect(openCompetition(db, ended({ splitBps: [9000, 2000] }), "test")).rejects.toThrow();
  });

  // Shown as is in every player's terminal and on the web; the mod reports impressions by name.
  it("refuses sponsor texts the mod could not show or report back", async () => {
    const create = (sponsor: string, tagline: string | null = null) =>
      createCampaign(db, { sponsor, tagline, budget: 1_000_000n, commissionBps: 0 }, "test");
    for (const sponsor of ["", "  ", "\u001b[2JNorthwind", "North\nwind", "\u202eNorthwind", "N".repeat(101)]) {
      await expect(create(sponsor), JSON.stringify(sponsor)).rejects.toThrow(/printable/);
    }
    await expect(create("Northwind", "\u001b]8;;https://evil.test\u0007click")).rejects.toThrow(/printable/);
    await campaign();
    await expect(openCompetition(db, ended({ name: "Week\r1" }), "test")).rejects.toThrow(/printable/);
    expect((await db.query("SELECT 1 FROM campaigns")).rowCount).toBe(1);
  });

  it("closes once: ranks and drops become prizes under review, and the seed is revealed", async () => {
    await campaign();
    const id = await openCompetition(db, ended(), "test");
    const hidden = await latestCompetition(db);
    expect(hidden).toMatchObject({ id, dropSeed: null, dropSeedHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const [a, b, c, d] = players.map((p) => p.toBase58());
    const users = [
      "did:privy:cmplayera00000000000000a",
      "did:privy:cmplayerb00000000000000b",
      "did:privy:cmplayerc00000000000000c",
    ];
    for (const [i, user] of users.entries()) {
      await ensureUser(db, user);
      await recordWallet(db, user, players[i]);
    }
    const t = (minutes: number) => new Date(Date.now() - 3 * HOUR + minutes * 60_000);
    await saveRound(db, round(a, t(5), 1_000_000n, 9_000_000n)); // +8
    await saveRound(db, round(b, t(6), 1_000_000n, 3_000_000n)); // +2
    await saveRound(db, round(c, t(7), 1_000_000n, 0n)); // −1
    await saveRound(db, round(d, t(8), 50_000n, 5_000_000n)); // below min stake
    for (let i = 0; i < 6; i++) await saveRound(db, round(c, t(10 + i), 100_000n, 100_000n)); // tickets, capped at 3/h

    const summary = await closeCompetition(db, id, "test");
    expect(summary).toMatchObject({ rankPrizes: 2, dropPrizes: 2 });
    const closed = await latestCompetition(db);
    expect(closed?.dropSeed?.toString("hex")).toBe(summary.seed);
    expect(seedHash(Buffer.from(summary.seed, "hex"))).toBe(closed?.dropSeedHash);

    const prizes = await listPrizes(db);
    expect(prizes.every((p) => p.status === "pending_review")).toBe(true);
    expect(prizes.filter((p) => p.kind === "rank").map((p) => [p.rank, p.player, p.amount, p.id])).toEqual([
      [1, a, "5000000", prizeId(id, "rank", 1)],
      [2, b, "2500000", prizeId(id, "rank", 2)],
    ]);
    // Anyone can recompute the drop winners from the revealed seed and the public rounds.
    const { rows } = await db.query("SELECT signature, player, settled_at FROM rounds WHERE stake >= 100000");
    const tickets = capTickets(
      rows.map((r) => ({ signature: r.signature, player: r.player, settledAt: r.settled_at })),
      3,
    );
    const winners = drawWinners(Buffer.from(summary.seed, "hex"), tickets, 2).map((w) => w.player);
    expect(prizes.filter((p) => p.kind === "drop").map((p) => p.player)).toEqual(winners);
    expect(prizes.filter((p) => p.kind === "drop").every((p) => p.amount === "1000000")).toBe(true);

    await expect(closeCompetition(db, id, "test")).rejects.toThrow(/already closed/);
    const audit = await db.query("SELECT action FROM audit_log ORDER BY id");
    expect(audit.rows.map((r) => r.action)).toEqual(["campaign:create", "competition:open", "competition:close"]);
  });

  it("refuses to close a competition that is still running", async () => {
    await campaign();
    const id = await openCompetition(db, ended({ endsAt: new Date(Date.now() + HOUR) }), "test");
    await expect(closeCompetition(db, id, "test")).rejects.toThrow(/not ended/);
  });

  it("refuses to close before the indexer has caught up with the end, unless forced", async () => {
    await campaign();
    const id = await openCompetition(db, ended(), "test");
    await db.query("TRUNCATE indexer_cursor");
    await expect(closeCompetition(db, id, "test")).rejects.toThrow(/indexer has not caught up/);
    await indexedUpTo(new Date(Date.now() - 2 * 60_000));
    await expect(closeCompetition(db, id, "test")).rejects.toThrow(/indexer has not caught up/);
    await closeCompetition(db, id, "test", { force: true });
    const { rows } = await db.query("SELECT details FROM audit_log WHERE action = 'competition:close'");
    expect(rows[0].details).toMatchObject({ id, forced: true });
  });

  const closedWithPrizes = async (): Promise<string> => {
    await campaign();
    const id = await openCompetition(db, ended({ dropCount: 0, dropPool: 0n }), "test");
    const t = new Date(Date.now() - 2 * HOUR);
    for (const [i, p] of players.slice(0, 3).entries()) {
      await ensureUser(db, `did:privy:cmplayer${i}0000000000000000x`);
      await recordWallet(db, `did:privy:cmplayer${i}0000000000000000x`, p);
      await saveRound(db, round(p.toBase58(), t, 1_000_000n, BigInt(5 - i) * 1_000_000n));
    }
    await closeCompetition(db, id, "test");
    return id;
  };

  it("pays only approved prizes, each exactly once, even with concurrent runs", async () => {
    const id = await closedWithPrizes();
    expect(await payPrizes(db, relay.client(), "test")).toEqual({ paid: 0, pending: 0, failed: 0, skipped: 0 });
    expect(await approvePrizes(db, { competitionId: id }, "test")).toBe(3);
    relay.delayMs = 30;
    const reports = await Promise.all([1, 2, 3].map(() => payPrizes(db, relay.client(), "test")));
    expect(reports.reduce((n, r) => n + r.paid, 0)).toBe(3);
    expect(relay.payoutCalls).toBe(3);
    const prizes = await listPrizes(db, "paid");
    expect(prizes).toHaveLength(3);
    expect(prizes.every((p) => p.signature !== null)).toBe(true);
    expect(await payPrizes(db, relay.client(), "test")).toEqual({ paid: 0, pending: 0, failed: 0, skipped: 0 });
    expect(relay.payoutCalls).toBe(3);
  });

  it("asks again with the same id when a payout is still pending, and never re-issues it", async () => {
    const id = await closedWithPrizes();
    await approvePrizes(db, { id: prizeId(id, "rank", 1) }, "test");
    relay.outcome = () => ({ status: "pending" });
    expect(await payPrizes(db, relay.client(), "test")).toMatchObject({ pending: 1 });
    // A fresh claim protects the payout from a second run...
    expect(await payPrizes(db, relay.client(), "test")).toMatchObject({ skipped: 1 });
    // ...until it is considered abandoned; the replay reuses the same payout id.
    await db.query("UPDATE prizes SET pay_started_at = now() - interval '10 minutes'");
    const [stored] = relay.intents.values();
    stored.response = { ...stored.response, status: "submitted", signature: "paid-sig" };
    expect(await payPrizes(db, relay.client(), "test")).toMatchObject({ paid: 1 });
    expect(relay.intents.size).toBe(1);
    expect((await listPrizes(db, "paid"))[0]).toMatchObject({ id: prizeId(id, "rank", 1), signature: "paid-sig" });
  });

  it("fails a prize whose wallet has no Tilt user, or that the relay refuses", async () => {
    const id = await closedWithPrizes();
    await db.query("UPDATE prizes SET user_id = NULL WHERE rank = 1");
    await approvePrizes(db, { competitionId: id }, "test");
    relay.outcome = () => ({ status: "failed", error: { code: "PROGRAM_ERROR", message: "PromoPoolEmpty" } });
    expect(await payPrizes(db, relay.client(), "test")).toMatchObject({ failed: 3 });
    const failed = await listPrizes(db, "failed");
    expect(failed.map((p) => p.error).sort()).toEqual([
      "PROGRAM_ERROR: PromoPoolEmpty",
      "PROGRAM_ERROR: PromoPoolEmpty",
      "no Tilt user for this wallet",
    ]);
  });

  it("leaves prizes approved when the relay is unreachable", async () => {
    const id = await closedWithPrizes();
    await approvePrizes(db, { competitionId: id }, "test");
    relay.down = true;
    try {
      expect(await payPrizes(db, relay.client(), "test")).toMatchObject({ pending: 3 });
    } finally {
      relay.down = false;
    }
    expect(await listPrizes(db, "approved")).toHaveLength(3);
  });
});
