import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizePakistanMobile } from "../../src/lib/smartQuoteLead.ts";

/**
 * Server-signed "link token" that lets STAFF authorise a public Smart Quote submission to join one specific
 * existing lead as its next version. An anonymous visitor who merely knows a client's name and phone number
 * cannot produce one, so such a visitor can never attach a quotation to someone else's lead.
 *
 * Wire format: `v1.<base64url(payload json)>.<base64url(hmac-sha256)>`
 * Payload: { p: "smart-quote-link", l: leadId, i: issuedAtSec, e: expiresAtSec, n: nonce, ph?: canonical phone }
 *
 * The HMAC key is purpose-specific. It is SMART_QUOTE_LINK_SECRET when set, otherwise it is derived from
 * JWT_SECRET (HMAC(JWT_SECRET, "smart-quote-link-key-v1")) so the JWT secret itself is never used as a key
 * here and this token can not be replayed as, or confused with, any other signed value. With no secret
 * configured the module fails closed: nothing can be issued and nothing verifies.
 */

export const SMART_QUOTE_LINK_PURPOSE = "smart-quote-link";
export const SMART_QUOTE_LINK_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SMART_QUOTE_LINK_DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;
export const SMART_QUOTE_LINK_MAX_TOKEN_LENGTH = 1024;
const CLOCK_SKEW_SECONDS = 60;
const KEY_DERIVATION_LABEL = "smart-quote-link-key-v1";
const LEAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type Env = NodeJS.ProcessEnv;

/** The purpose-specific signing key, or null when none can be derived (production fails closed). */
export function resolveSmartQuoteLinkKey(env: Env = process.env): Buffer | null {
  const dedicated = env.SMART_QUOTE_LINK_SECRET?.trim();
  if (dedicated) {
    // A dedicated secret must be strong everywhere it is used for real traffic.
    if (dedicated.length < 32 && env.NODE_ENV === "production") return null;
    return createHmac("sha256", dedicated).update(KEY_DERIVATION_LABEL).digest();
  }
  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) return null;
  if (env.NODE_ENV === "production" && jwtSecret.length < 32) return null;
  return createHmac("sha256", jwtSecret).update(KEY_DERIVATION_LABEL).digest();
}

export type SmartQuoteLinkClaims = {
  leadId: string;
  /** Canonical phone the token was issued for; verification requires it to still match. */
  phone?: string;
  issuedAt: number;
  expiresAt: number;
};

export type SmartQuoteLinkRejection = "no_secret" | "malformed" | "bad_signature" | "bad_payload" | "expired" | "not_yet_valid" | "ttl_too_long";

export type SmartQuoteLinkVerification =
  | { ok: true; claims: SmartQuoteLinkClaims }
  | { ok: false; reason: SmartQuoteLinkRejection };

const b64 = (buf: Buffer) => buf.toString("base64url");

function sign(key: Buffer, body: string): Buffer {
  return createHmac("sha256", key).update(`${SMART_QUOTE_LINK_PURPOSE}\n${body}`).digest();
}

export class SmartQuoteLinkUnavailableError extends Error {
  constructor() {
    super("Smart Quote link signing is not configured.");
  }
}

export function issueSmartQuoteLinkToken(
  input: { leadId: string; phone?: string | null; ttlSeconds?: number },
  options: { env?: Env; now?: number } = {},
): { token: string; expiresAt: number } {
  const key = resolveSmartQuoteLinkKey(options.env ?? process.env);
  if (!key) throw new SmartQuoteLinkUnavailableError();
  if (!LEAD_ID_RE.test(input.leadId)) throw new Error("A valid lead id is required.");
  const ttl = Math.floor(input.ttlSeconds ?? SMART_QUOTE_LINK_DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > SMART_QUOTE_LINK_MAX_TTL_SECONDS) {
    throw new Error("Link lifetime must be between 1 minute and 30 days.");
  }
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  const phone = input.phone ? normalizePakistanMobile(input.phone) : null;
  const payload = {
    p: SMART_QUOTE_LINK_PURPOSE,
    l: input.leadId,
    i: issuedAt,
    e: issuedAt + ttl,
    n: randomBytes(8).toString("hex"),
    ...(phone ? { ph: phone } : {}),
  };
  const body = b64(Buffer.from(JSON.stringify(payload), "utf8"));
  return { token: `v1.${body}.${b64(sign(key, body))}`, expiresAt: payload.e * 1000 };
}

export function verifySmartQuoteLinkToken(token: unknown, options: { env?: Env; now?: number } = {}): SmartQuoteLinkVerification {
  const key = resolveSmartQuoteLinkKey(options.env ?? process.env);
  if (!key) return { ok: false, reason: "no_secret" };
  if (typeof token !== "string" || !token || token.length > SMART_QUOTE_LINK_MAX_TOKEN_LENGTH) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return { ok: false, reason: "malformed" };
  const expected = sign(key, parts[1]);
  const given = Buffer.from(parts[2], "base64url");
  // Canonical encoding only: base64url ignores the unused trailing bits, so a re-encoded copy must match exactly.
  if (b64(given) !== parts[2] || given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "bad_payload" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "bad_payload" };
  }
  const { p, l, i, e, ph } = payload;
  if (p !== SMART_QUOTE_LINK_PURPOSE || typeof l !== "string" || !LEAD_ID_RE.test(l) || !Number.isInteger(i) || !Number.isInteger(e)) return { ok: false, reason: "bad_payload" };
  if (ph !== undefined && (typeof ph !== "string" || !normalizePakistanMobile(ph))) return { ok: false, reason: "bad_payload" };
  const issuedAt = i as number;
  const expiresAt = e as number;
  // Enforced on verification too, so a token minted with a longer lifetime (a bug, or a leaked key) is still refused.
  if (expiresAt - issuedAt > SMART_QUOTE_LINK_MAX_TTL_SECONDS || expiresAt <= issuedAt) return { ok: false, reason: "ttl_too_long" };
  const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
  if (expiresAt <= nowSec) return { ok: false, reason: "expired" };
  if (issuedAt > nowSec + CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };
  return { ok: true, claims: { leadId: l, phone: typeof ph === "string" ? normalizePakistanMobile(ph) ?? undefined : undefined, issuedAt, expiresAt } };
}
