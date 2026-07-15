import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function clientIpFromRequest(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

export type PublicLeadRateLimitOptions = {
  windowMs?: number;
  maxAttempts?: number;
  /** Test seam — inject a dedicated Map. */
  store?: Map<string, Bucket>;
  now?: () => number;
};

/**
 * Per-IP rate limiter for POST /api/public/leads.
 * Configure via PUBLIC_LEAD_RATE_LIMIT_WINDOW_MS / PUBLIC_LEAD_RATE_LIMIT_MAX.
 */
export function createPublicLeadRateLimit(options: PublicLeadRateLimitOptions = {}) {
  const store = options.store ?? buckets;
  const nowFn = options.now ?? Date.now;

  return function publicLeadRateLimit(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const windowMs =
      options.windowMs ??
      Number(process.env.PUBLIC_LEAD_RATE_LIMIT_WINDOW_MS || 60_000);
    const maxAttempts =
      options.maxAttempts ?? Number(process.env.PUBLIC_LEAD_RATE_LIMIT_MAX || 30);

    const key = clientIpFromRequest(req);
    const now = nowFn();
    const bucket = store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= maxAttempts) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    bucket.count += 1;
    next();
  };
}

/** Reset in-memory buckets (tests only). */
export function resetPublicLeadRateLimitStore(
  store: Map<string, Bucket> = buckets
): void {
  store.clear();
}
