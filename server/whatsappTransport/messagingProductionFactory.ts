/**
 * Production factory for PostgresMessagingRepository (Task 5B).
 *
 * Lives in whatsappTransport (runtime wiring) so unifiedMessaging stays free of
 * direct `pg` imports (transport contract isolation).
 *
 * Server-only. Reuses DATABASE_URL / SUPABASE_DB_URL. One process-wide pool.
 */
import pg from "pg";
import {
  assertMessagingRuntimeStartup,
  readMessagingRuntimeConfig,
  type MessagingRuntimeConfig,
} from "../unifiedMessaging/messagingRuntimeConfig.ts";
import {
  createPostgresMessagingRepository,
  type PostgresMessagingRepositoryDeps,
} from "../unifiedMessaging/postgresMessagingRepository.ts";
import {
  createPgPoolSqlExecutor,
  type SqlExecutor,
} from "../unifiedMessaging/messagingSql.ts";
import type { MessagingRepository } from "../unifiedMessaging/messagingRepository.ts";

export type MessagingProductionWiring = {
  enabled: boolean;
  config: MessagingRuntimeConfig;
  /** Null when feature disabled. */
  repository: MessagingRepository | null;
  /** Null when feature disabled. */
  pool: pg.Pool | null;
  shutdown: () => Promise<void>;
};

export type CreateMessagingProductionWiringOptions = {
  env?: NodeJS.ProcessEnv;
  /** Test injection: skip pool construction and use this executor. */
  sqlExecutor?: SqlExecutor;
  /** Test injection: pre-built repository (implies enabled). */
  repository?: MessagingRepository;
  poolFactory?: (connectionString: string) => pg.Pool;
};

function createDefaultPool(connectionString: string): pg.Pool {
  // Hosted Supabase Postgres requires SSL; local harness URLs typically do not.
  const ssl = /sslmode=disable|localhost|127\.0\.0\.1/i.test(connectionString)
    ? undefined
    : { rejectUnauthorized: false };
  return new pg.Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

/**
 * Construct process wiring for normalized messaging persistence.
 * - Disabled → repository null (existing WhatsApp-only behavior).
 * - Enabled + injected repo/executor → no external connection.
 * - Enabled + DB URL → shared pg.Pool via createPgPoolSqlExecutor.
 * - Enabled without DB URL → throws (fail startup clearly).
 */
export function createMessagingProductionWiring(
  options: CreateMessagingProductionWiringOptions = {}
): MessagingProductionWiring {
  const env = options.env ?? process.env;
  const config = readMessagingRuntimeConfig(env);

  if (options.repository) {
    return {
      enabled: true,
      config: { ...config, enabled: true },
      repository: options.repository,
      pool: null,
      shutdown: async () => undefined,
    };
  }

  if (!config.enabled) {
    return {
      enabled: false,
      config,
      repository: null,
      pool: null,
      shutdown: async () => undefined,
    };
  }

  assertMessagingRuntimeStartup(config);

  if (options.sqlExecutor) {
    const repository = createPostgresMessagingRepository({
      db: options.sqlExecutor,
    } satisfies PostgresMessagingRepositoryDeps);
    return {
      enabled: true,
      config,
      repository,
      pool: null,
      shutdown: async () => undefined,
    };
  }

  const connectionString = config.databaseUrl!;
  const poolFactory = options.poolFactory ?? createDefaultPool;
  const pool = poolFactory(connectionString);
  const db = createPgPoolSqlExecutor(pool);
  const repository = createPostgresMessagingRepository({ db });

  let closed = false;
  return {
    enabled: true,
    config,
    repository,
    pool,
    shutdown: async () => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
