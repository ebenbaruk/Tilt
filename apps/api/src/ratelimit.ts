// Token buckets kept in memory (spec §10.4). One instance per limit; keys are IPs, users or
// sessions. Behind several api instances the effective limit multiplies by their number, which
// the relay's own per-player rule (one intent in flight) and the program bound anyway.

export interface BucketOptions {
  /** Burst size. */
  capacity: number;
  /** Tokens added back per second. */
  refillPerSecond: number;
  /** Clock, for tests. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/** Above this many keys, full buckets are dropped (they carry no information). */
const PRUNE_THRESHOLD = 10_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: BucketOptions) {
    if (options.capacity <= 0 || options.refillPerSecond <= 0) throw new Error("rate limit must be positive");
    this.now = options.now ?? Date.now;
  }

  /** Per-minute limit with a burst of the same size. */
  static perMinute(limit: number, now?: () => number): RateLimiter {
    return new RateLimiter({ capacity: limit, refillPerSecond: limit / 60, now });
  }

  /** Takes `cost` tokens from `key`'s bucket; false (and nothing taken) when there are not enough. */
  take(key: string, cost = 1): boolean {
    const bucket = this.refilled(key);
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }

  /** Whether `key` could take `cost` tokens now, without taking them. */
  has(key: string, cost = 1): boolean {
    return this.refilled(key).tokens >= cost;
  }

  private refilled(key: string): Bucket {
    const now = this.now();
    if (this.buckets.size > PRUNE_THRESHOLD) this.prune(now);
    const bucket = this.buckets.get(key) ?? { tokens: this.options.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.options.capacity, bucket.tokens + elapsed * this.options.refillPerSecond);
    bucket.updatedAt = now;
    this.buckets.set(key, bucket);
    return bucket;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      const tokens = bucket.tokens + ((now - bucket.updatedAt) / 1000) * this.options.refillPerSecond;
      if (tokens >= this.options.capacity) this.buckets.delete(key);
    }
  }
}
