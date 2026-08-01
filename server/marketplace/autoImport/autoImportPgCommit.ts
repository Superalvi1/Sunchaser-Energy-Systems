/**
 * Atomic commit via direct Postgres with a real statement_timeout.
 *
 * Proven mechanism (PostgreSQL 16):
 *   -- read-only authorization check (outside any txn)
 *   BEGIN;
 *   SET LOCAL ROLE mp_ceo_auto_import_runtime;  -- only when authorized member
 *   SET LOCAL statement_timeout = '<ms>';
 *   SELECT mp_ceo_auto_import_commit_batch(...);
 *   COMMIT;
 *
 * Never catches SET LOCAL ROLE inside an open transaction: a failed SET ROLE
 * aborts the PG transaction and must not be ignored.
 *
 * Does NOT use Promise.race. The caller awaits until Postgres returns.
 */
import pg from "pg";
import type { AutoImportSyncHealth } from "./autoImportTypes.ts";
import type { UpsertListingInput } from "./autoImportRepository.ts";
import {
  resolveAutoImportDatabaseUrl,
  CEO_AUTO_IMPORT_RUNTIME_ROLE,
} from "./autoImportDbUrl.ts";
import { resolveAutoImportTimeouts } from "./autoImportTimeouts.ts";
import { buildAutoImportPgClientConfig } from "./autoImportPgSsl.ts";

export type PgCommitBatchResult = {
  productsCreated: number;
  productsUpdated: number;
  raw: Record<string, unknown>;
};

export class AutoImportRoleConfigError extends Error {
  readonly code = "ROLE_SWITCH_REJECTED" as const;
  constructor(message: string) {
    super(message);
    this.name = "AutoImportRoleConfigError";
  }
}

function listingPayload(input: UpsertListingInput) {
  return {
    identityKey: input.identityKey,
    title: input.title,
    brandName: input.brandName,
    categoryName: input.categoryName,
    websitePricePkr: input.websitePricePkr,
    availability: input.availability,
    selectedSupplier: input.selectedSupplier,
    sourceUrls: input.sourceUrls,
    matchReason: input.matchReason,
    priceReason: input.priceReason,
    offers: input.offers,
    fetchedAt: input.fetchedAt,
    defaultSourceKey: input.defaultSourceKey ?? null,
  };
}

/**
 * Dedicated importer client. Parses URL then applies SSL last so
 * `?sslmode=require` cannot force verify-full against Supabase's private CA.
 */
export function createAutoImportPgClient(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): pg.Client {
  const config = buildAutoImportPgClientConfig(connectionString, {
    sslCaPem: env.MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_SSL_CA,
  });
  return new pg.Client(config);
}

type RuntimeAuth = {
  currentUser: string;
  /** True when current_user is already the runtime role. */
  alreadyRuntimeRole: boolean;
  /** True when login may SET ROLE to the runtime role. */
  canSetRuntimeRole: boolean;
};

/**
 * Read-only authorization probe — must run outside a write transaction.
 * Fail closed: only the runtime role itself or an explicit MEMBER may proceed.
 * Superuser status alone is not sufficient (avoids broad owner/superuser paths).
 */
export async function resolveRuntimeRoleAuthorization(
  client: pg.Client,
  runtimeRole: string = CEO_AUTO_IMPORT_RUNTIME_ROLE,
): Promise<RuntimeAuth> {
  const { rows } = await client.query<{
    current_user: string;
    already_runtime: boolean;
    is_member: boolean;
  }>(
    `with recursive membership as (
       select m.roleid
       from pg_catalog.pg_auth_members m
       where m.member = (
         select oid from pg_catalog.pg_roles where rolname = current_user
       )
       union
       select m.roleid
       from pg_catalog.pg_auth_members m
       join membership on membership.roleid = m.member
     )
     select
       current_user::text as current_user,
       (current_user = $1::name) as already_runtime,
       exists (
         select 1
         from membership
         join pg_catalog.pg_roles r on r.oid = membership.roleid
         where r.rolname = $1
       ) as is_member`,
    [runtimeRole],
  );
  const row = rows[0];
  if (!row) {
    throw new AutoImportRoleConfigError(
      "ROLE_SWITCH_REJECTED: unable to resolve database role authorization for CEO auto-import.",
    );
  }
  return {
    currentUser: row.current_user,
    alreadyRuntimeRole: Boolean(row.already_runtime),
    canSetRuntimeRole: Boolean(row.is_member),
  };
}

async function rollbackQuietly(client: pg.Client): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* already idle / rolled back */
  }
}

/**
 * Awaited transactional commit with SET LOCAL statement_timeout.
 * Throws on timeout / validation / SQL / role-config errors after ROLLBACK.
 */
export async function commitBatchWithStatementTimeout(input: {
  env?: NodeJS.ProcessEnv;
  listings: UpsertListingInput[];
  health: AutoImportSyncHealth;
  /** Override timeout (tests). */
  statementTimeoutMs?: number;
  /** Injected client factory (tests). */
  clientFactory?: (url: string) => pg.Client;
}): Promise<PgCommitBatchResult> {
  const env = input.env ?? process.env;
  const url = resolveAutoImportDatabaseUrl(env);
  if (!url) {
    throw new Error(
      "TIMEOUT_PROTECTION_ABSENT: durable auto-import requires DATABASE_URL or SUPABASE_DB_URL (or MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL) so statement_timeout can be SET LOCAL before mp_ceo_auto_import_commit_batch.",
    );
  }

  const { rpcTimeoutMs } = resolveAutoImportTimeouts(env);
  const timeoutMs = Math.max(
    1_000,
    Math.min(
      input.statementTimeoutMs ?? Math.min(rpcTimeoutMs * 3, 45_000),
      120_000,
    ),
  );

  const client = (input.clientFactory ?? ((u) => createAutoImportPgClient(u, env)))(
    url,
  );
  await client.connect();
  let inTransaction = false;
  try {
    // Authorize BEFORE BEGIN — never SET ROLE inside a txn unless already valid.
    const auth = await resolveRuntimeRoleAuthorization(client);
    if (!auth.alreadyRuntimeRole && !auth.canSetRuntimeRole) {
      throw new AutoImportRoleConfigError(
        `ROLE_SWITCH_REJECTED: login role is not authorized for CEO auto-import commit_batch (requires membership in ${CEO_AUTO_IMPORT_RUNTIME_ROLE}).`,
      );
    }

    await client.query("BEGIN");
    inTransaction = true;

    // Only switch when we are a member and not already the runtime role.
    // Do not catch failures — a failed SET LOCAL ROLE aborts the transaction.
    if (!auth.alreadyRuntimeRole) {
      await client.query(`SET LOCAL ROLE ${CEO_AUTO_IMPORT_RUNTIME_ROLE}`);
    }

    // Own client command — starts the statement_timeout timer for subsequent work.
    await client.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);

    const { rows } = await client.query(
      `SELECT public.mp_ceo_auto_import_commit_batch(
         $1::text, $2::text, $3::jsonb, $4::jsonb
       ) AS result`,
      [
        "system:ceo-auto-import",
        input.health.lastRunId || "mpair_unknown",
        JSON.stringify(input.listings.map(listingPayload)),
        JSON.stringify(input.health),
      ],
    );
    await client.query("COMMIT");
    inTransaction = false;
    const raw = (rows[0]?.result || {}) as Record<string, unknown>;
    return {
      productsCreated: Number(raw.productsCreated || 0),
      productsUpdated: Number(raw.productsUpdated || 0),
      raw,
    };
  } catch (err) {
    if (inTransaction) {
      await rollbackQuietly(client);
      inTransaction = false;
    }
    throw err;
  } finally {
    if (inTransaction) {
      await rollbackQuietly(client);
    }
    await client.end().catch(() => undefined);
  }
}
