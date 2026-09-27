export const LEARNING_SESSION_ISSUER = 'sunchaser-learning';
export const LEARNING_SESSION_AUDIENCE = 'sunchaser-learning-session';
export const LEARNING_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type LearningIdentity = {
  sub: string;
  username: string;
  name?: string;
  email?: string;
  role: string;
};

type SignedClaims = LearningIdentity & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function secret(): string {
  const value = String(
    process.env.LEARNING_AUTH_SECRET || process.env.LEARNING_SSO_SECRET || '',
  ).trim();
  if (!value) throw new Error('LEARNING_AUTH_SECRET is not configured');
  if (process.env.NODE_ENV === 'production' && value.length < 32) {
    throw new Error('LEARNING_AUTH_SECRET must be at least 32 characters');
  }
  return value;
}

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(toBytes(secret())),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signUnsigned(unsigned: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(),
    toArrayBuffer(toBytes(unsigned)),
  );
  return encodeBase64Url(new Uint8Array(signature));
}

function validateIdentity(claims: SignedClaims): LearningIdentity {
  if (!claims.sub || !claims.username || !claims.role) {
    throw new Error('Missing Learning Studio identity claims');
  }
  return {
    sub: claims.sub,
    username: claims.username,
    name: claims.name,
    email: claims.email,
    role: claims.role,
  };
}

export async function signLearningSession(identity: LearningIdentity): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SignedClaims = {
    ...identity,
    iss: LEARNING_SESSION_ISSUER,
    aud: LEARNING_SESSION_AUDIENCE,
    iat: now,
    exp: now + LEARNING_SESSION_TTL_SECONDS,
  };
  const payload = encodeBase64Url(toBytes(JSON.stringify(claims)));
  const unsigned = `v1.${payload}`;
  return `${unsigned}.${await signUnsigned(unsigned)}`;
}

export async function verifyLearningSession(token: string): Promise<LearningIdentity> {
  const [version, payload, signature, ...extra] = String(token || '').split('.');
  if (version !== 'v1' || !payload || !signature || extra.length) {
    throw new Error('Invalid Learning Studio session');
  }

  const unsigned = `${version}.${payload}`;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    toArrayBuffer(decodeBase64Url(signature)),
    toArrayBuffer(toBytes(unsigned)),
  );
  if (!valid) throw new Error('Invalid Learning Studio session signature');

  const claims = JSON.parse(
    new TextDecoder().decode(decodeBase64Url(payload)),
  ) as SignedClaims;
  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== LEARNING_SESSION_ISSUER ||
    claims.aud !== LEARNING_SESSION_AUDIENCE ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    claims.iat > now + 30
  ) {
    throw new Error('Expired or invalid Learning Studio session');
  }
  return validateIdentity(claims);
}

export async function stableOwnerUuid(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    toArrayBuffer(toBytes(`sunchaser-learning-owner-v1:${userId}`)),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function normalizeNextPath(value: unknown): string {
  const next = typeof value === 'string' ? value.trim() : '';
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/auth') || next.startsWith('/api/')) return '/';
  return next;
}
