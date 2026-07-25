/**
 * Thin SQL executor port for normalized messaging persistence.
 * Implementations are injected (e.g. pg Pool wrapper). No connection env here.
 */

export type SqlQueryResult<T extends Record<string, unknown> = Record<string, unknown>> =
  {
    rows: T[];
    rowCount: number | null;
  };

export type SqlExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<SqlQueryResult<T>>;
  withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

/** Minimal pool shape satisfied by `pg.Pool` without importing `pg` here. */
export type PgPoolLike = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  connect: () => Promise<PgPoolClientLike>;
};

export type PgPoolClientLike = {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release: () => void;
};

/**
 * Adapt a `pg.Pool` (or compatible) into {@link SqlExecutor}.
 * Transactions use a checked-out client with BEGIN/COMMIT/ROLLBACK.
 */
export function createPgPoolSqlExecutor(pool: PgPoolLike): SqlExecutor {
  const root: SqlExecutor = {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[]
    ): Promise<SqlQueryResult<T>> {
      const result = await pool.query(text, params ? [...params] : undefined);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount,
      };
    },

    async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: SqlExecutor = {
          async query<R extends Record<string, unknown> = Record<string, unknown>>(
            text: string,
            params?: readonly unknown[]
          ): Promise<SqlQueryResult<R>> {
            const result = await client.query(
              text,
              params ? [...params] : undefined
            );
            return {
              rows: result.rows as R[],
              rowCount: result.rowCount,
            };
          },
          async withTransaction<U>(inner: (nested: SqlExecutor) => Promise<U>) {
            // Nested: reuse same client / open transaction (no savepoints).
            return inner(tx);
          },
        };
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve original error.
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return root;
}
