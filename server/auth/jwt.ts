import jwt, { type SignOptions } from "jsonwebtoken";

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

export function signAccessToken(claims: JwtUserClaims & { sessionStartedAt?: number }): string {
  const options: SignOptions = {
    expiresIn: getJwtExpiresIn() as SignOptions["expiresIn"],
  };
  const { sessionStartedAt, ...userClaims } = claims;
  return jwt.sign(sessionStartedAt ? { ...userClaims, sst: sessionStartedAt } : userClaims, getJwtSecret(), options);
}

/** Absolute limit for renewing a session from its original sign-in (default 30 days). */
export function sessionMaxAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.SESSION_MAX_AGE_DAYS || 30);
  return Math.round((Number.isFinite(days) && days > 0 ? days : 30) * 86400);
}

/** Original sign-in time of an already verified token; renewals carry it forward as `sst`. */
export function sessionStartedAtSeconds(verifiedToken: string): number | null {
  const decoded = jwt.decode(verifiedToken);
  if (!decoded || typeof decoded !== "object") return null;
  const startedAt = Number((decoded as Record<string, unknown>).sst ?? decoded.iat);
  return Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null;
}

export function canRenewSession(startedAtSeconds: number | null, nowSeconds: number, maxAgeSeconds: number): boolean {
  return startedAtSeconds !== null && startedAtSeconds <= nowSeconds && nowSeconds - startedAtSeconds <= maxAgeSeconds;
}

export function verifyAccessToken(token: string): JwtUserClaims {
  const decoded = jwt.verify(token, getJwtSecret());
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
  return { userId, username, role };
}
