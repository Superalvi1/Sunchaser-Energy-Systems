/**
 * Atomic commit via direct Postgres with a real statement_timeout.
 *
 * Proven mechanism (PostgreSQL 16):
 *   BEGIN;
 *   SET LOCAL statement_timeout = '<ms>';
 *   SELECT mp_ceo_auto_import_commit_batch(...);
 *   COMMIT;
 *
 * SET LOCAL is applied as its own client command before the batch statement,
 * so statement_timeout covers the complete RPC call. On timeout the server
 * cancels the statement and the transaction rolls back — including all writes
 * performed inside the SECURITY DEFINER function.
 *
 * Does NOT use Promise.race. The caller awaits until Postgres returns.
 */
import pg from "pg";
import type { AutoImportSyncHealth } from "./autoImportTypes.ts";
import type { UpsertListingInput } from "./autoImportRepository.ts";
import { resolveAutoImportDatabaseUrl, CEO_AUTO_IMPORT_RUNTIME_ROLE } from "./autoImportDbUrl.ts";
import { resolveAutoImportTimeouts } from "./autoImportTimeouts.ts";

export type PgCommitBatchResult = {
  productsCreated: number;
  productsUpdated: number;
  raw: Record<string, unknown>;
};

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
  };
}

function createClient(connectionString: string): pg.Client {
  const ssl = /sslmode=disable|localhost|127\.0\.0\.1/i.test(connectionString)
    ? undefined
    : { rejectUnauthorized: false };
  return new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    ssl,
  });
}

/**
 * Awaited transactional commit with SET LOCAL statement_timeout.
 * Throws on timeout / validation / SQL errors after ROLLBACK.
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

  const client = (input.clientFactory ?? createClient)(url);
  await client.connect();
  try {
    await client.query("BEGIN");
    // Prefer least-privilege runtime role when the login is a member of it.
    // SET LOCAL ROLE scopes only this transaction; fails closed to prior role
    // if the membership is absent (e.g. temporary owner connections).
    try {
      await client.query(`SET LOCAL ROLE ${CEO_AUTO_IMPORT_RUNTIME_ROLE}`);
    } catch {
      /* connection may already be the runtime role, or membership not granted */
    }
    // Own client command — starts the statement_timeout timer for subsequent work.
    await client.query(`SET LOCAL statement_timeout = '${timeoutMs}'`);
    try {
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
      const raw = (rows[0]?.result || {}) as Record<string, unknown>;
      return {
        productsCreated: Number(raw.productsCreated || 0),
        productsUpdated: Number(raw.productsUpdated || 0),
        raw,
      };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* transaction already aborted */
      }
      throw err;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
