/**
 * Production SQL wiring for WhatsApp Web owner diagnostics.
 * Uses the same DATABASE_URL / SUPABASE_DB_URL pool pattern as the lease store.
 *
 * Requires migration: scripts/whatsapp-web-owner-diagnostics-migration.sql
 * (manual apply only — do not auto-apply).
 */
import pg from "pg";
import {
  createPgPoolSqlExecutor,
  type SqlExecutor,
} from "../unifiedMessaging/messagingSql.ts";
import {
  createSqlWhatsAppWebOwnerDiagnosticsStore,
  getSharedInMemoryWhatsAppWebOwnerDiagnosticsStore,
  type WhatsAppWebOwnerDiagnosticsStore,
} from "./whatsappWebOwnerDiagnosticsStore.ts";

let sharedPool: pg.Pool | null = null;
let sharedStore: WhatsAppWebOwnerDiagnosticsStore | null = null;

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

export function tryCreateWhatsAppWebOwnerDiagnosticsSqlStore(
  env: NodeJS.ProcessEnv = process.env,
  options?: { sqlExecutor?: SqlExecutor }
): WhatsAppWebOwnerDiagnosticsStore | null {
  if (options?.sqlExecutor) {
    return createSqlWhatsAppWebOwnerDiagnosticsStore(options.sqlExecutor);
  }
  const url = readDatabaseUrl(env);
  if (!url) return null;
  if (!sharedStore) {
    sharedPool = createPool(url);
    sharedStore = createSqlWhatsAppWebOwnerDiagnosticsStore(
      createPgPoolSqlExecutor(sharedPool)
    );
  }
  return sharedStore;
}

export function resolveDefaultWhatsAppWebOwnerDiagnosticsStore(
  env: NodeJS.ProcessEnv = process.env
): WhatsAppWebOwnerDiagnosticsStore {
  return (
    tryCreateWhatsAppWebOwnerDiagnosticsSqlStore(env) ??
    getSharedInMemoryWhatsAppWebOwnerDiagnosticsStore()
  );
}

/** Test-only: drop process-wide SQL diagnostics pool. */
export async function __resetWhatsAppWebOwnerDiagnosticsSqlStore(): Promise<void> {
  sharedStore = null;
  if (sharedPool) {
    const pool = sharedPool;
    sharedPool = null;
    await pool.end().catch(() => undefined);
  }
}
