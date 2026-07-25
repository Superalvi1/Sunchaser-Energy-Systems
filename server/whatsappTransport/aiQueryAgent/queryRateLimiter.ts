/**
 * In-process rate limiter for draft generation (per company + actor).
 * Service-level — not an HTTP middleware (UI not wired in AI-01).
 */

type Bucket = { count: number; resetAt: number };

export type QueryRateLimiterOptions = {
  windowMs: number;
  maxAttempts: number;
  store?: Map<string, Bucket>;
  now?: () => number;
};

export type QueryRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSec: number };

export class QueryRateLimiter {
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly store: Map<string, Bucket>;
  private readonly now: () => number;

  constructor(options: QueryRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxAttempts = options.maxAttempts;
    this.store = options.store ?? new Map();
    this.now = options.now ?? Date.now;
  }

  check(companyId: string, actorUserId: string): QueryRateLimitResult {
    const key = `${String(companyId).trim()}::${String(actorUserId).trim()}`;
    const now = this.now();
    const bucket = this.store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
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
  }
}
