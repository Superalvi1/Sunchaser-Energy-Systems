/**
 * Per-IP rate limiter for WhatsApp Web QR Admin API.
 */
import type { NextFunction, Request, Response } from "express";
import { clientIpFromRequest } from "../publicLeads/publicLeadRateLimit.ts";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type WhatsAppWebRateLimitOptions = {
  windowMs?: number;
  maxAttempts?: number;
  store?: Map<string, Bucket>;
  now?: () => number;
};

export function createWhatsAppWebRateLimit(
  options: WhatsAppWebRateLimitOptions = {}
) {
  const store = options.store ?? buckets;
  const nowFn = options.now ?? Date.now;

  return function whatsappWebRateLimit(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const windowMs =
      options.windowMs ??
      Number(process.env.WHATSAPP_WEB_RATE_LIMIT_WINDOW_MS || 60_000);
    const maxAttempts =
      options.maxAttempts ??
      Number(process.env.WHATSAPP_WEB_RATE_LIMIT_MAX || 30);

    const key = `wa_web:${clientIpFromRequest(req)}`;
    const now = nowFn();
    const bucket = store.get(key);

    if (!bucket || now >= bucket.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (bucket.count >= maxAttempts) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000)
      );
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("Cache-Control", "no-store");
      res.status(429).json({
        success: false,
        error: { code: "rate_limited", message: "Too many requests" },
      });
      return;
    }

    bucket.count += 1;
    next();
  };
}

export function resetWhatsAppWebRateLimitStore(
  store: Map<string, Bucket> = buckets
): void {
  store.clear();
}
