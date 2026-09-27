import 'server-only';

import { promisify } from 'node:util';
import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';

import type { LearningIdentity } from '@/lib/server/learning-session';

const scrypt = promisify(nodeScrypt);

type LearningUserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  role: string;
  status: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __sunchaserLearningAuthPool: Pool | undefined;
}

function databaseUrl(): string {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value) throw new Error('DATABASE_URL is not configured');
  return value;
}

function pool(): Pool {
  if (!globalThis.__sunchaserLearningAuthPool) {
    const connectionString = databaseUrl();
    globalThis.__sunchaserLearningAuthPool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ...(connectionString.includes('railway.internal')
        ? {}
        : { ssl: { rejectUnauthorized: false } }),
    });
  }
  return globalThis.__sunchaserLearningAuthPool;
}

let schemaPromise: Promise<void> | undefined;

function ensureSchema(): Promise<void> {
  schemaPromise ??= pool()
    .query(`
      CREATE TABLE IF NOT EXISTS learning_users (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        display_name text NOT NULL,
        password_hash text NOT NULL,
        password_salt text NOT NULL,
        role text NOT NULL DEFAULT 'learner',
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz
      )
    `)
    .then(() => undefined)
    .catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  return schemaPromise;
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function identity(row: LearningUserRow): LearningIdentity {
  return {
    sub: row.id,
    username: row.email,
    email: row.email,
    name: row.display_name,
    role: row.role,
  };
}

async function passwordHash(password: string, salt: string): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

export async function createLearningUser(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<LearningIdentity> {
  await ensureSchema();
  const email = normalizedEmail(input.email);
  const displayName = input.displayName.trim().replace(/\s+/g, ' ');
  const salt = randomBytes(24).toString('base64url');
  const hash = (await passwordHash(input.password, salt)).toString('base64url');

  const result = await pool().query<LearningUserRow>(
    `INSERT INTO learning_users (id, email, display_name, password_hash, password_salt)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, display_name, password_hash, password_salt, role, status`,
    [randomUUID(), email, displayName, hash, salt],
  );
  return identity(result.rows[0]!);
}

export async function authenticateLearningUser(
  emailValue: string,
  password: string,
): Promise<LearningIdentity | null> {
  await ensureSchema();
  const email = normalizedEmail(emailValue);
  const result = await pool().query<LearningUserRow>(
    `SELECT id, email, display_name, password_hash, password_salt, role, status
       FROM learning_users
      WHERE email = $1
      LIMIT 1`,
    [email],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'active') return null;

  const expected = Buffer.from(row.password_hash, 'base64url');
  const actual = await passwordHash(password, row.password_salt);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  await pool().query('UPDATE learning_users SET last_login_at = now() WHERE id = $1', [row.id]);
  return identity(row);
}

export function isDuplicateEmailError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}
