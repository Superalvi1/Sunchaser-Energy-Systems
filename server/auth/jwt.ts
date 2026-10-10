import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";

export type JwtUserClaims = {
  userId: string;
  username: string;
  role: string;
};

const JWT_SECRET_MIN_LENGTH = 32;

const WEAK_JWT_SECRETS = new Set([
  "generate-a-random-secure-alphanumeric-secret-here-32-chars",
  "your-jwt-secret",
  "changeme",
  "secret",
]);

/** Fail fast in production if JWT env is missing or too weak. */
export function assertProductionJwtConfig(): void {
  if (process.env.NODE_ENV !== "production") return;

  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is required in production.");
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters in production.`
    );
  }
  if (WEAK_JWT_SECRETS.has(secret) || WEAK_JWT_SECRETS.has(secret.toLowerCase())) {
    throw new Error("JWT_SECRET is too weak for production (placeholder or default value).");
  }

  const expiresIn = process.env.JWT_EXPIRES_IN?.trim();
  if (!expiresIn) {
    throw new Error("JWT_EXPIRES_IN is required in production.");
  }
  // A value jsonwebtoken cannot parse would make every login fail with HTTP 500 after a successful boot.
  let lifetime: number;
  try {
    lifetime = jwtLifetimeSeconds(expiresIn);
  } catch {
    throw new Error(`JWT_EXPIRES_IN "${expiresIn}" is not a valid duration (use e.g. 8h, 1d, or a number of seconds).`);
  }
  if (!(lifetime > 0)) {
    throw new Error("JWT_EXPIRES_IN must be a positive duration.");
  }
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

export function getJwtExpiresIn(): string {
  const expiresIn = process.env.JWT_EXPIRES_IN?.trim();
  if (!expiresIn) {
    throw new Error("JWT_EXPIRES_IN is not configured");
  }
  return expiresIn;
}

/**
 * jsonwebtoken reads a numeric STRING as milliseconds ("3600" would be 3.6 s), but an environment variable is
 * always a string. A bare number in JWT_EXPIRES_IN therefore means seconds, as the library documents for numbers.
 */
export function parseExpiresIn(raw: string): string | number {
  const value = String(raw ?? "").trim();
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** Token lifetime in seconds that JWT_EXPIRES_IN yields; throws if jsonwebtoken cannot parse it. */
export function jwtLifetimeSeconds(raw: string = getJwtExpiresIn()): number {
  const probe = jwt.sign({}, "x".repeat(JWT_SECRET_MIN_LENGTH), { expiresIn: parseExpiresIn(raw) as never });
  const { iat, exp } = jwt.decode(probe) as { iat: number; exp: number };
  return exp - iat;
}

/** Absolute limit for renewing a session from its original sign-in (default 30 days). */
export function sessionMaxAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.SESSION_MAX_AGE_DAYS || 30);
  return Math.round((Number.isFinite(days) && days > 0 ? days : 30) * 86400);
}

/** Tolerated difference between the clocks of two instances (a token minted a moment "in the future"). */
export const SESSION_CLOCK_SKEW_SECONDS = 30;

/**
 * Short, non-reversible version of a user's stored password hash. Every password set or reset writes a new salted
 * hash, so the version changes and tokens minted before the change stop verifying. Keyed with JWT_SECRET so the
 * claim reveals nothing about the hash; rotating the secret therefore also retires every token.
 */
export function passwordVersion(storedPassword: unknown): string | null {
  const stored = typeof storedPassword === "string" ? storedPassword : "";
  if (!stored) return null;
  return createHmac("sha256", getJwtSecret()).update(`pwv1:${stored}`).digest("hex").slice(0, 16);
}

export function passwordVersionMatches(claimed: string, current: string | null): boolean {
  if (!current) return false;
  const a = Buffer.from(claimed);
  const b = Buffer.from(current);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SignableClaims = JwtUserClaims & {
  /** Original sign-in time (seconds) carried through renewals; omitted at sign-in. */
  sessionStartedAt?: number;
  /** passwordVersion() of the user's current stored password. */
  passwordVersion?: string | null;
  /** users.session_epoch at issue time; carried as `se` only when > 0, so tokens look the same until a first revocation. */
  sessionEpoch?: number;
  /** Session family id (`sid`): minted at sign-in, carried unchanged through every renewal. */
  sessionId?: string;
};

export function signAccessToken(claims: SignableClaims, env: NodeJS.ProcessEnv = process.env): string {
  const { sessionStartedAt, passwordVersion: pwv, sessionEpoch, sessionId, ...userClaims } = claims;
  // `jti` is unique per token (refresh rotation retires the old one); `sid` is shared by every token renewed from one
  // sign-in, so logging out revokes the whole family - including tokens minted by a refresh racing the logout.
  const payload: Record<string, unknown> = { ...userClaims, jti: randomUUID(), sid: sessionId || randomUUID() };
  if (sessionEpoch && sessionEpoch > 0) payload.se = sessionEpoch;
  if (sessionStartedAt) payload.sst = sessionStartedAt;
  if (pwv) payload.pwv = pwv;

  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  // No token may outlive the session's absolute limit, whatever JWT_EXPIRES_IN says.
  const hardStop = (sessionStartedAt || now) + sessionMaxAgeSeconds(env);
  if (hardStop <= now) throw new Error("Session has reached its absolute lifetime.");

  const token = jwt.sign(payload, secret, { expiresIn: parseExpiresIn(getJwtExpiresIn()) as never });
  const { exp } = jwt.decode(token) as { exp: number };
  return exp <= hardStop ? token : jwt.sign({ ...payload, exp: hardStop }, secret);
}

/** Original sign-in time of an already verified token; renewals carry it forward as `sst`. */
export function sessionStartedAtSeconds(verifiedToken: string): number | null {
  const decoded = jwt.decode(verifiedToken);
  if (!decoded || typeof decoded !== "object") return null;
  return startedAtFromPayload(decoded as Record<string, unknown>);
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function startedAtFromPayload(payload: Record<string, unknown>): number | null {
  return positiveNumber(payload.sst ?? payload.iat);
}

export function canRenewSession(startedAtSeconds: number | null, nowSeconds: number, maxAgeSeconds: number): boolean {
  return (
    startedAtSeconds !== null &&
    startedAtSeconds <= nowSeconds + SESSION_CLOCK_SKEW_SECONDS &&
    nowSeconds - startedAtSeconds <= maxAgeSeconds
  );
}

export type SessionLimitViolation = "missing_exp" | "unknown_start" | "future_start" | "session_too_old";

/**
 * Absolute-lifetime check applied to every authenticated request (not only to /api/auth/refresh), so a token whose
 * `exp` lies beyond the session limit - e.g. issued while JWT_EXPIRES_IN was set very high - cannot be used past it.
 */
export function sessionLimitViolation(
  session: { startedAt: number | null; expiresAt: number | null },
  nowSeconds: number,
  maxAgeSeconds: number
): SessionLimitViolation | null {
  if (session.expiresAt === null) return "missing_exp";
  if (session.startedAt === null) return "unknown_start";
  if (session.startedAt > nowSeconds + SESSION_CLOCK_SKEW_SECONDS) return "future_start";
  if (nowSeconds - session.startedAt > maxAgeSeconds) return "session_too_old";
  return null;
}

export type VerifiedSession = {
  claims: JwtUserClaims;
  startedAt: number | null;
  expiresAt: number | null;
  /** passwordVersion() recorded in the token; null for tokens issued before the claim existed. */
  passwordVersion: string | null;
  /** Unique token id; null for tokens issued before it existed. */
  jti: string | null;
  /** Session family id; null for tokens issued before it existed. */
  sid: string | null;
  /** users.session_epoch recorded in the token (`se`); 0 when absent. */
  sessionEpoch: number;
};

export function verifySessionToken(token: string): VerifiedSession {
  // Tokens are only ever signed HS256; pinning the algorithm keeps verification from accepting anything else.
  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] });
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }
  const payload = decoded as Record<string, unknown>;
  const userId = String(payload.userId || payload.sub || "").trim();
  const username = String(payload.username || "").trim();
  const role = String(payload.role || "").trim();
  if (!userId || !username) {
    throw new Error("Invalid token claims");
  }
  const pwv = typeof payload.pwv === "string" && payload.pwv ? payload.pwv : null;
  return {
    claims: { userId, username, role },
    startedAt: startedAtFromPayload(payload),
    expiresAt: positiveNumber(payload.exp),
    passwordVersion: pwv,
    jti: typeof payload.jti === "string" && payload.jti ? payload.jti : null,
    sid: typeof payload.sid === "string" && payload.sid ? payload.sid : null,
    sessionEpoch: Number.isInteger(payload.se) && (payload.se as number) > 0 ? (payload.se as number) : 0,
  };
}

export function verifyAccessToken(token: string): JwtUserClaims {
  return verifySessionToken(token).claims;
}

/**
 * Keys under which a token can be revoked in public.revoked_sessions.
 *  - `checkKeys`: looked up on every request in ONE indexed query (`jti IN (...)`).
 *  - `logoutKey`: what logout records - the whole session family (`s:<sid>`) when the token has one.
 *  - `rotateKey`: what refresh retires (after a grace) - this token alone.
 * Tokens issued before `jti`/`sid` existed are keyed by a SHA-256 of the token (not reversible), so they can still be
 * logged out and rotated.
 */
export type SessionKeys = { checkKeys: string[]; logoutKey: string; rotateKey: string; family: boolean };

export function sessionKeysFor(token: string, ids: { jti: string | null; sid: string | null }): SessionKeys {
  if (!ids.jti) {
    const k = `h:${createHash("sha256").update(token).digest("hex").slice(0, 40)}`;
    return { checkKeys: [k], logoutKey: k, rotateKey: k, family: false };
  }
  if (!ids.sid) return { checkKeys: [ids.jti], logoutKey: ids.jti, rotateKey: ids.jti, family: false };
  const fam = `s:${ids.sid}`;
  return { checkKeys: [ids.jti, fam], logoutKey: fam, rotateKey: ids.jti, family: true };
}

/** Keys of a token this process just signed or is inspecting (decodes without verifying; for tests/diagnostics). */
export function sessionKeysOfToken(token: string): SessionKeys {
  const d = (jwt.decode(token) || {}) as { jti?: unknown; sid?: unknown };
  return sessionKeysFor(token, { jti: typeof d.jti === "string" ? d.jti : null, sid: typeof d.sid === "string" ? d.sid : null });
}
