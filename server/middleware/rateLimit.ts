import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

const loginBuckets = new Map<string, Bucket>();
const authBuckets = new Map<string, Bucket>();

/**
 * Client IP for rate limiting.
 * Do NOT trust X-Forwarded-For unless TRUST_PROXY is explicitly enabled
 * (and Express trust proxy is configured accordingly).
 */
export function clientIp(req: Request): string {
  const trustProxy =
    process.env.TRUST_PROXY === "true" ||
    process.env.TRUST_PROXY === "1" ||
    process.env.TRUST_PROXY === "yes";

  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
      return String(forwarded[0]).split(",")[0].trim();
    }
  }

  return req.socket.remoteAddress || "unknown";
}

function applyRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: {
    buckets: Map<string, Bucket>;
    windowMs: number;
    maxAttempts: number;
    errorMessage: string;
  }
): void {
  const key = clientIp(req);
  const now = Date.now();
  const bucket = opts.buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    opts.buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    next();
    return;
  }

  if (bucket.count >= opts.maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: opts.errorMessage });
    return;
  }

  bucket.count += 1;
  next();
}

/** In-memory rate limiter for login attempts (per IP). */
export function loginRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  applyRateLimit(req, res, next, {
    buckets: loginBuckets,
    windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 60_000),
    maxAttempts: Number(process.env.LOGIN_RATE_LIMIT_MAX || 10),
    errorMessage: "Too many login attempts. Please try again later.",
  });
}

/**
 * Rate limiter for register, forgot-password, reset-password, and email-verification.
 */
export function authSensitiveRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  applyRateLimit(req, res, next, {
    buckets: authBuckets,
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60_000),
    maxAttempts: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
    errorMessage: "Too many requests. Please try again later.",
  });
}

/** Test helper — clears in-memory buckets. */
export function resetRateLimitBucketsForTests(): void {
  loginBuckets.clear();
  authBuckets.clear();
}
