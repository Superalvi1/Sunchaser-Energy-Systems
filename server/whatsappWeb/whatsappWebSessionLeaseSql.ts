/**
 * Production SQL wiring for WhatsApp Web session lease.
 * Uses DATABASE_URL / SUPABASE_DB_URL. Never logs connection strings.
 *
 * Requires migration: scripts/whatsapp-web-session-lease-migration.sql
 * (manual apply only — do not auto-apply).
 */
import pg from "pg";
import {
  createPgPoolSqlExecutor,
  type SqlExecutor,
} from "../unifiedMessaging/messagingSql.ts";
import {
  createSqlWhatsAppWebSessionLeaseStore,
  type WhatsAppWebSessionLeaseStore,
} from "./whatsappWebSessionLeaseStore.ts";

let sharedPool: pg.Pool | null = null;
let sharedStore: WhatsAppWebSessionLeaseStore | null = null;

function readDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    String(env.DATABASE_URL ?? "").trim() ||
    String(env.SUPABASE_DB_URL ?? "").trim() ||
    null
  );
}

function createPool(connectionString: string): pg.Pool {
  const ssl = /sslmode=disable|localhost|127\.0\.0\.1/i.test(connectionString)
    ? undefined
    : { rejectUnauthorized: false };
  return new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

/**
 * Resolve a SQL lease store when a database URL is configured.
 * Returns null when no URL is present (caller may use in-memory store).
 */
export function tryCreateWhatsAppWebSessionLeaseSqlStore(
  env: NodeJS.ProcessEnv = process.env,
  options?: { sqlExecutor?: SqlExecutor }
): WhatsAppWebSessionLeaseStore | null {
  if (options?.sqlExecutor) {
    return createSqlWhatsAppWebSessionLeaseStore(options.sqlExecutor);
  }
  const url = readDatabaseUrl(env);
  if (!url) return null;
  if (!sharedStore) {
    sharedPool = createPool(url);
    sharedStore = createSqlWhatsAppWebSessionLeaseStore(
      createPgPoolSqlExecutor(sharedPool)
    );
  }
  return sharedStore;
}

/** Test-only: drop process-wide SQL lease pool. */
export async function __resetWhatsAppWebSessionLeaseSqlStore(): Promise<void> {
  sharedStore = null;
  if (sharedPool) {
    const pool = sharedPool;
    sharedPool = null;
    await pool.end().catch(() => undefined);
  }
}
