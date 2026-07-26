/**
 * In-process rate limiter for draft generation (per company + actor).
 * Service-level — not an HTTP middleware (UI not wired in AI-01).
 * Buckets expire and the store is bounded to prevent unbounded growth.
 */

type Bucket = { count: number; resetAt: number };

export type QueryRateLimiterOptions = {
  windowMs: number;
  maxAttempts: number;
  store?: Map<string, Bucket>;
  now?: () => number;
  /** Max retained keys; expired entries are swept first, then oldest resetAt. */
  maxKeys?: number;
};

export type QueryRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number };

const DEFAULT_MAX_KEYS = 10_000;

export class QueryRateLimiter {
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly store: Map<string, Bucket>;
  private readonly now: () => number;
  private readonly maxKeys: number;
  private checksSinceSweep = 0;

  constructor(options: QueryRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxAttempts = options.maxAttempts;
    this.store = options.store ?? new Map();
    this.now = options.now ?? Date.now;
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
  }

  /** Visible for tests — current retained bucket count. */
  size(): number {
    return this.store.size;
  }

  check(companyId: string, actorUserId: string): QueryRateLimitResult {
    const key = `${String(companyId).trim()}::${String(actorUserId).trim()}`;
    const now = this.now();
    this.maybeSweep(now);

    const bucket = this.store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      this.enforceBound(now);
      return { allowed: true, remaining: Math.max(0, this.maxAttempts - 1) };
    }

    if (bucket.count >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxAttempts - bucket.count),
    };
  }

  reset(): void {
    this.store.clear();
    this.checksSinceSweep = 0;
  }

  /** Drop expired buckets; call periodically and before bound enforcement. */
  sweepExpired(now: number = this.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.store) {
      if (now >= bucket.resetAt) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private maybeSweep(now: number): void {
    this.checksSinceSweep += 1;
    // Sweep every check when over soft capacity, otherwise every 32 checks.
    if (this.store.size >= this.maxKeys || this.checksSinceSweep >= 32) {
      this.checksSinceSweep = 0;
      this.sweepExpired(now);
    }
  }

  private enforceBound(now: number): void {
    if (this.store.size <= this.maxKeys) return;
    this.sweepExpired(now);
    if (this.store.size <= this.maxKeys) return;

    const overflow = this.store.size - this.maxKeys;
    const ordered = [...this.store.entries()].sort(
      (a, b) => a[1].resetAt - b[1].resetAt
    );
    for (let i = 0; i < overflow; i += 1) {
      const entry = ordered[i];
      if (!entry) break;
      this.store.delete(entry[0]);
    }
  }
}
