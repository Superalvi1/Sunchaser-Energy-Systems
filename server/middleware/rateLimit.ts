import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const loginBuckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

/** Simple in-memory rate limiter for login attempts (per IP). */
export function loginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const windowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 60_000);
  const maxAttempts = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
  const key = clientIp(req);
  const now = Date.now();
  const bucket = loginBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    loginBuckets.set(key, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }

  if (bucket.count >= maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "Too many login attempts. Please try again later." });
    return;
  }

  bucket.count += 1;
  next();
}

type UserRateLimitOptions = {
  windowMs: number;
  max: number;
  /** Shown to the client when the limit is hit. */
  message: string;
};

/**
 * In-memory fixed-window limiter keyed by the AUTHENTICATED user (req.actor.id), so it cannot be dodged by changing
 * IP or spoofing X-Forwarded-For. Mount it after requireAuth. Like loginRateLimit it is per server instance.
 */
export function createUserRateLimit(options: UserRateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return function userRateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = req.actor?.id;
    if (!key) {
      next();
      return;
    }
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
    }
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    if (bucket.count >= options.max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: options.message });
      return;
    }
    bucket.count += 1;
    next();
  };
}

/** Session renewal: one call per app start is normal; the limit only stops automated renewal loops. */
export const refreshRateLimit = createUserRateLimit({
  windowMs: Number(process.env.REFRESH_RATE_LIMIT_WINDOW_MS || 10 * 60_000),
  max: Number(process.env.REFRESH_RATE_LIMIT_MAX || 20),
  message: "Too many session renewals. Please try again later.",
});
