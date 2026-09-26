import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { RequestActor } from "../middleware/actor.ts";

export const LEARNING_SSO_ISSUER = "sunchaser-crm";
export const LEARNING_SSO_AUDIENCE = "sunchaser-learning";
export const LEARNING_SSO_DEFAULT_TTL_SECONDS = 90;

export type LearningSsoClaims = {
  iss: typeof LEARNING_SSO_ISSUER;
  aud: typeof LEARNING_SSO_AUDIENCE;
  sub: string;
  username: string;
  name: string;
  email: string;
  role: string;
  customerId?: string;
  iat: number;
  exp: number;
  jti: string;
};

function requireSsoSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = String(env.LEARNING_SSO_SECRET || "").trim();
  if (!secret) throw new Error("LEARNING_SSO_SECRET is not configured");
  if (env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("LEARNING_SSO_SECRET must be at least 32 characters in production");
  }
  return secret;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signatureFor(versionAndPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(versionAndPayload).digest("base64url");
}

function safeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signLearningSsoTicket(
  actor: RequestActor,
  options: { nowMs?: number; ttlSeconds?: number; env?: NodeJS.ProcessEnv } = {}
): string {
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttlSeconds = Math.max(
    30,
    Math.min(options.ttlSeconds ?? LEARNING_SSO_DEFAULT_TTL_SECONDS, 300)
  );
  const claims: LearningSsoClaims = {
    iss: LEARNING_SSO_ISSUER,
    aud: LEARNING_SSO_AUDIENCE,
    sub: actor.id,
    username: actor.username,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    ...(actor.customerId ? { customerId: actor.customerId } : {}),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    jti: randomUUID(),
  };
  const payload = base64UrlEncode(JSON.stringify(claims));
  const unsigned = "v1." + payload;
  const signature = signatureFor(unsigned, requireSsoSecret(options.env));
  return unsigned + "." + signature;
}

export function verifyLearningSsoTicket(
  token: string,
  options: { nowMs?: number; env?: NodeJS.ProcessEnv } = {}
): LearningSsoClaims {
  const [version, payloadEncoded, signature, ...extra] = String(token || "").split(".");
  if (version !== "v1" || !payloadEncoded || !signature || extra.length) {
    throw new Error("Invalid learning SSO ticket format");
  }
  const unsigned = version + "." + payloadEncoded;
  const expected = signatureFor(unsigned, requireSsoSecret(options.env));
  if (!safeEqualText(signature, expected)) throw new Error("Invalid learning SSO signature");

  let claims: LearningSsoClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadEncoded).toString("utf8")) as LearningSsoClaims;
  } catch {
    throw new Error("Invalid learning SSO payload");
  }
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (claims.iss !== LEARNING_SSO_ISSUER || claims.aud !== LEARNING_SSO_AUDIENCE) {
    throw new Error("Invalid learning SSO issuer or audience");
  }
  if (!claims.sub || !claims.username || !claims.role || !claims.jti) {
    throw new Error("Missing learning SSO identity claims");
  }
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.exp <= claims.iat) {
    throw new Error("Invalid learning SSO timestamps");
  }
  if (claims.exp < nowSeconds) throw new Error("Learning SSO ticket expired");
  if (claims.iat > nowSeconds + 30) throw new Error("Learning SSO ticket issued in the future");
  return claims;
}

export function normalizeLearningNextPath(value: unknown): string {
  const next = typeof value === "string" ? value.trim() : "";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export function getLearningStudioUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.LEARNING_STUDIO_URL || "").trim();
  if (!raw) throw new Error("LEARNING_STUDIO_URL is not configured");
  const url = new URL(raw);
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("LEARNING_STUDIO_URL must use HTTPS in production");
  }
  return url.origin;
}
