// Pure building blocks: UUIDv5, rate limiter, secrets, prize split, drops, limits planning.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { newSecret, newUserCode, normalizeUserCode } from "../src/auth/secrets";
import { capTickets, drawWinners, seedHash, ticketScore, type Ticket } from "../src/competitions/drops";
import { rankPrizes, splitPool } from "../src/competitions/prizes";
import { handle } from "../src/competitions/store";
import { prizeId, PRIZE_NAMESPACE, uuidv5 } from "../src/competitions/uuid";
import { planLimit } from "../src/limits";
import { RateLimiter } from "../src/ratelimit";
import { safeIntentError } from "../src/relay";

describe("uuidv5", () => {
  // Reference values from Python's uuid.uuid5.
  it("matches RFC 9562 reference implementations", () => {
    expect(uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    expect(uuidv5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "")).toBe("4ebd0208-8328-5d69-8c44-ec50939c0967");
    expect(uuidv5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", "é")).toBe("10e1d6de-dc68-53f0-883a-30ec870dd739");
    expect(PRIZE_NAMESPACE).toBe("38102b31-83b9-52c7-84ba-505b0401cdd1");
  });

  it("derives one stable payout id per prize", () => {
    const c = "0b5e8d8e-6a3b-4a8e-9a43-5a2f3c1d9e10";
    expect(prizeId(c, "rank", 1)).toBe(prizeId(c, "rank", 1));
    expect(new Set([prizeId(c, "rank", 1), prizeId(c, "rank", 2), prizeId(c, "drop", 1)]).size).toBe(3);
    expect(prizeId(c, "rank", 1)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("refuses a namespace that is not a UUID", () => {
    expect(() => uuidv5("nope", "x")).toThrow();
  });
});

describe("RateLimiter", () => {
  it("allows a burst, refuses beyond it, and refills over time", () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.take("a"))).toEqual([true, true, true, false]);
    expect(limiter.take("b")).toBe(true);
    now = 1_000;
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    now = 60_000;
    expect(limiter.has("a", 3)).toBe(true);
    expect(limiter.has("a", 4)).toBe(false);
  });

  it("never lets more through than capacity plus refill", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 500 }), { maxLength: 200 }), (gaps) => {
        let now = 0;
        const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 2, now: () => now });
        let allowed = 0;
        for (const gap of gaps) {
          now += gap;
          if (limiter.take("k")) allowed++;
        }
        expect(allowed).toBeLessThanOrEqual(5 + Math.floor((now / 1000) * 2));
      }),
    );
  });

  it("perMinute spreads the limit over a minute", () => {
    let now = 0;
    const limiter = RateLimiter.perMinute(60, () => now);
    for (let i = 0; i < 60; i++) expect(limiter.take("k")).toBe(true);
    expect(limiter.take("k")).toBe(false);
    now = 1_000;
    expect(limiter.take("k")).toBe(true);
  });
});

describe("secrets", () => {
  it("issues 256-bit url-safe secrets", () => {
    const s = newSecret("tilt_");
    expect(s).toMatch(/^tilt_[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(newSecret());
  });

  it("issues readable user codes and normalizes what players type", () => {
    for (let i = 0; i < 100; i++) expect(newUserCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeUserCode("wdjb mjht")).toBe("WDJB-MJHT");
    expect(normalizeUserCode("WDJB-MJHT")).toBe("WDJB-MJHT");
    expect(normalizeUserCode("WDJB-MJH0")).toBeNull();
    expect(normalizeUserCode("WDJB")).toBeNull();
  });
});

describe("relay error messages", () => {
  it("passes Anchor error names and hides anything else", () => {
    expect(safeIntentError({ code: "PROGRAM_ERROR", message: "InsufficientBalance" })).toEqual({
      code: "PROGRAM_ERROR",
      message: "InsufficientBalance",
    });
    expect(safeIntentError({ code: "PROGRAM_ERROR", message: '{"InstructionError":[0,{"Custom":6001}]}' })).toEqual({
      code: "PROGRAM_ERROR",
      message: "program error",
    });
    expect(safeIntentError({ code: "INTERNAL_ERROR", message: "db at 10.0.0.3 down" })?.message).toBe("intent failed");
    expect(safeIntentError(undefined)).toBeNull();
  });
});

describe("prize split", () => {
  it("gives 50/25/10 % and shares the rest", () => {
    expect(splitPool(1_000n, [5000, 2500, 1000], 3)).toEqual([500n, 250n, 100n, 50n, 50n, 50n]);
    expect(splitPool(1_000n, [5000, 2500, 1000], 0)).toEqual([500n, 250n, 100n]);
    expect(() => splitPool(1_000n, [6000, 5000], 0)).toThrow();
  });

  it("never pays more than the pool", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.array(fc.integer({ min: 0, max: 2500 }), { maxLength: 4 }),
        fc.integer({ min: 0, max: 50 }),
        (pool, split, shared) => {
          const amounts = splitPool(pool, split, shared);
          expect(amounts.reduce((a, b) => a + b, 0n)).toBeLessThanOrEqual(pool);
          expect(amounts).toHaveLength(split.length + shared);
        },
      ),
    );
  });

  it("only rewards a positive net gain", () => {
    const standings = [
      { player: "a", net: 10n },
      { player: "b", net: 0n },
      { player: "c", net: -5n },
    ];
    expect(rankPrizes(standings, [500n, 250n, 100n])).toEqual([{ rank: 1, player: "a", amount: 500n }]);
  });

  it("shortens wallets into handles", () => {
    expect(handle("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("7xK…AsU");
  });
});

const ticket = (player: string, minute: number, n: number): Ticket => ({
  player,
  signature: `${player}-${minute}-${n}`,
  settledAt: new Date(Date.UTC(2026, 9, 13, 0, minute)),
});

describe("drops", () => {
  it("commits to the seed with sha256", () => {
    expect(seedHash(Buffer.alloc(32))).toBe("66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925");
  });

  it("caps tickets per player and per clock hour, keeping the earliest", () => {
    const rounds = [ticket("a", 1, 0), ticket("a", 2, 0), ticket("a", 3, 0), ticket("a", 61, 0), ticket("b", 1, 0)];
    const kept = capTickets(rounds, 2).map((t) => t.signature);
    expect(kept).toEqual(["a-1-0", "b-1-0", "a-2-0", "a-61-0"]);
  });

  const tickets = fc.array(
    fc.record({
      player: fc.constantFrom("p1", "p2", "p3", "p4", "p5"),
      minute: fc.integer({ min: 0, max: 600 }),
      n: fc.integer({ min: 0, max: 1_000_000 }),
    }),
    { maxLength: 200 },
  );

  it("respects the hourly cap for any rounds", () => {
    fc.assert(
      fc.property(tickets, fc.integer({ min: 1, max: 5 }), (raw, cap) => {
        const kept = capTickets(
          raw.map((r) => ticket(r.player, r.minute, r.n)),
          cap,
        );
        const perHour = new Map<string, number>();
        for (const t of kept) {
          const key = `${t.player}:${Math.floor(t.settledAt.getTime() / 3_600_000)}`;
          perHour.set(key, (perHour.get(key) ?? 0) + 1);
        }
        for (const count of perHour.values()) expect(count).toBeLessThanOrEqual(cap);
      }),
    );
  });

  it("draws deterministically from the seed, one drop per player, lowest scores first", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        tickets,
        fc.integer({ min: 0, max: 6 }),
        (seed, raw, count) => {
          const all = raw.map((r) => ticket(r.player, r.minute, r.n));
          const key = Buffer.from(seed);
          const a = drawWinners(key, all, count);
          const b = drawWinners(key, [...all].reverse(), count);
          expect(a.map((t) => t.signature)).toEqual(b.map((t) => t.signature));
          expect(new Set(a.map((t) => t.player)).size).toBe(a.length);
          expect(a.length).toBe(Math.min(count, new Set(all.map((t) => t.player)).size));
          const scores = a.map((t) => ticketScore(key, t.signature));
          expect([...scores].sort()).toEqual(scores);
        },
      ),
    );
  });
});

describe("responsible limits planning", () => {
  it("applies a stricter limit now and a looser one later", () => {
    expect(planLimit(100n, 50n)).toEqual({ value: 50n });
    expect(planLimit(null, 50n)).toEqual({ value: 50n });
    expect(planLimit(100n, 200n)).toEqual({ value: 100n, next: 200n });
    expect(planLimit(100n, null)).toEqual({ value: 100n, next: null });
    expect(planLimit(100n, 100n)).toEqual({ value: 100n });
    expect(planLimit(null, null)).toEqual({ value: null });
    expect(planLimit(100n, 200n, { next: 200n })).toEqual({ value: 100n, next: 200n, keepsDelay: true });
    expect(planLimit(100n, null, { next: null })).toEqual({ value: 100n, next: null, keepsDelay: true });
    expect(planLimit(100n, 100n, { next: 200n })).toEqual({ value: 100n });
    expect(planLimit(100n, 300n, { next: 200n })).toEqual({ value: 100n, next: 300n });
  });
});
