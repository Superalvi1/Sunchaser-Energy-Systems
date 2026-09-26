export const CRM_TICKET_ISSUER = 'sunchaser-crm';
export const CRM_TICKET_AUDIENCE = 'sunchaser-learning';
export const LEARNING_SESSION_ISSUER = 'sunchaser-learning';
export const LEARNING_SESSION_AUDIENCE = 'sunchaser-learning-session';
export const LEARNING_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SunchaserIdentity = {
  sub: string;
  username: string;
  name?: string;
  email?: string;
  role: string;
  customerId?: string;
};

type SignedClaims = SunchaserIdentity & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti?: string;
};

function secret(): string {
  const value = String(process.env.LEARNING_SSO_SECRET || '').trim();
  if (!value) throw new Error('LEARNING_SSO_SECRET is not configured');
  if (process.env.NODE_ENV === 'production' && value.length < 32) {
    throw new Error('LEARNING_SSO_SECRET must be at least 32 characters');
  }
  return value;
}

function toBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
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
    toBytes(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signUnsigned(unsigned: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), toBytes(unsigned));
  return encodeBase64Url(new Uint8Array(signature));
}

async function verifyUnsigned(unsigned: string, signature: string): Promise<boolean> {
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    decodeBase64Url(signature),
    toBytes(unsigned),
  );
}

function parsePayload<T>(encoded: string): T {
  const bytes = decodeBase64Url(encoded);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function validateIdentity(claims: SignedClaims): SunchaserIdentity {
  if (!claims.sub || !claims.username || !claims.role) throw new Error('Missing SSO identity claims');
  return {
    sub: claims.sub,
    username: claims.username,
    name: claims.name,
    email: claims.email,
    role: claims.role,
    ...(claims.customerId ? { customerId: claims.customerId } : {}),
  };
}

async function verifyToken(
  token: string,
  expectedIssuer: string,
  expectedAudience: string,
): Promise<SignedClaims> {
  const [version, payloadEncoded, signature, ...extra] = String(token || '').split('.');
  if (version !== 'v1' || !payloadEncoded || !signature || extra.length) {
    throw new Error('Invalid SSO token format');
  }
  const unsigned = version + '.' + payloadEncoded;
  if (!(await verifyUnsigned(unsigned, signature))) throw new Error('Invalid SSO token signature');
  const claims = parsePayload<SignedClaims>(payloadEncoded);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== expectedIssuer || claims.aud !== expectedAudience) {
    throw new Error('Invalid SSO token issuer or audience');
  }
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.exp <= claims.iat) {
    throw new Error('Invalid SSO token timestamps');
  }
  if (claims.exp < now) throw new Error('SSO token expired');
  if (claims.iat > now + 30) throw new Error('SSO token issued in the future');
  validateIdentity(claims);
  return claims;
}

export async function verifyCrmSsoTicket(token: string): Promise<SunchaserIdentity> {
  return validateIdentity(await verifyToken(token, CRM_TICKET_ISSUER, CRM_TICKET_AUDIENCE));
}

export async function signLearningSession(identity: SunchaserIdentity): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SignedClaims = {
    ...identity,
    iss: LEARNING_SESSION_ISSUER,
    aud: LEARNING_SESSION_AUDIENCE,
    iat: now,
    exp: now + LEARNING_SESSION_TTL_SECONDS,
  };
  const payloadEncoded = encodeBase64Url(toBytes(JSON.stringify(claims)));
  const unsigned = 'v1.' + payloadEncoded;
  return unsigned + '.' + (await signUnsigned(unsigned));
}

export async function verifyLearningSession(token: string): Promise<SunchaserIdentity> {
  return validateIdentity(
    await verifyToken(token, LEARNING_SESSION_ISSUER, LEARNING_SESSION_AUDIENCE),
  );
}

export async function stableOwnerUuid(userId: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), toBytes('owner:' + userId));
  const bytes = new Uint8Array(signature).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
  return next;
}
