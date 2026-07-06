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

export function signAccessToken(claims: JwtUserClaims): string {
  const options: SignOptions = {
    expiresIn: getJwtExpiresIn() as SignOptions["expiresIn"],
  };
  return jwt.sign(claims, getJwtSecret(), options);
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
