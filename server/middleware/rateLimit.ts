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
