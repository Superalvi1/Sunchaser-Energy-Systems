/**
 * Atomic WhatsApp Web session lease store.
 *
 * Production: Postgres conditional INSERT/UPDATE/DELETE (see migration script).
 * Tests: in-memory store with identical CAS fencing semantics.
 *
 * Never stores credentials, phones, QR, or message content.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { SqlExecutor } from "../unifiedMessaging/messagingSql.ts";

export const WHATSAPP_WEB_SESSION_LEASE_TABLE = "whatsapp_web_session_lease";

export type WhatsAppWebLeaseRow = {
  sessionKey: string;
  ownerId: string;
  ownerToken: string;
  fencingVersion: number;
  expiresAt: string;
  acquiredAt: string;
  heartbeatAt: string;
  pid: number;
};

export type WhatsAppWebLeaseAcquireResult =
  | {
      outcome: "held" | "stale_reclaimed";
      row: WhatsAppWebLeaseRow;
    }
  | {
      outcome: "contested";
      row: WhatsAppWebLeaseRow | null;
    }
  | {
      outcome: "unavailable";
      row: null;
    };

export type WhatsAppWebLeaseMutateResult = "ok" | "not_owner" | "error";

export type WhatsAppWebSessionLeaseStore = {
  tryAcquire(input: {
    sessionKey: string;
    ownerId: string;
    ownerToken: string;
    staleMs: number;
    pid: number;
    /** When re-acquiring while still holding locally. */
    currentOwnerToken?: string | null;
    currentFencingVersion?: number | null;
  }): Promise<WhatsAppWebLeaseAcquireResult>;
  heartbeat(input: {
    sessionKey: string;
    ownerToken: string;
    fencingVersion: number;
    staleMs: number;
    pid: number;
  }): Promise<WhatsAppWebLeaseMutateResult>;
  release(input: {
    sessionKey: string;
    ownerToken: string;
    fencingVersion: number;
  }): Promise<WhatsAppWebLeaseMutateResult>;
  read(sessionKey: string): Promise<WhatsAppWebLeaseRow | null>;
};

/** Stable opaque session key derived from the auth session directory. */
export function resolveWhatsAppWebSessionLeaseKey(sessionDir: string): string {
  const resolved = path.resolve(sessionDir);
  return createHash("sha256").update(resolved).digest("hex").slice(0, 32);
}

function asIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}

function mapSqlRow(row: Record<string, unknown>): WhatsAppWebLeaseRow {
  return {
    sessionKey: String(row.session_key ?? ""),
    ownerId: String(row.owner_id ?? ""),
    ownerToken: String(row.owner_token ?? ""),
    fencingVersion: Number(row.fencing_version),
    expiresAt: asIso(row.expires_at as string | Date),
    acquiredAt: asIso(row.acquired_at as string | Date),
    heartbeatAt: asIso(row.heartbeat_at as string | Date),
    pid: Number(row.pid),
  };
}

/** In-memory CAS store (shared within a process; keyed by session_key). */
export function createInMemoryWhatsAppWebSessionLeaseStore(options?: {
  now?: () => Date;
}): WhatsAppWebSessionLeaseStore {
  const now = options?.now ?? (() => new Date());
  const rows = new Map<string, WhatsAppWebLeaseRow>();
  let chain: Promise<unknown> = Promise.resolve();

  const serialize = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return {
    async tryAcquire(input) {
      return serialize(() => {
        const existing = rows.get(input.sessionKey) ?? null;
        const nowMs = now().getTime();
        const expiresAt = new Date(nowMs + input.staleMs).toISOString();
        const stamp = now().toISOString();

        if (
          existing &&
          input.currentOwnerToken &&
          input.currentFencingVersion != null &&
          existing.ownerToken === input.currentOwnerToken &&
          existing.fencingVersion === input.currentFencingVersion
        ) {
          const refreshed: WhatsAppWebLeaseRow = {
            ...existing,
            expiresAt,
            heartbeatAt: stamp,
            pid: input.pid,
          };
          rows.set(input.sessionKey, refreshed);
          return { outcome: "held" as const, row: refreshed };
        }

        if (!existing) {
          const row: WhatsAppWebLeaseRow = {
            sessionKey: input.sessionKey,
            ownerId: input.ownerId,
            ownerToken: input.ownerToken,
            fencingVersion: 1,
            expiresAt,
            acquiredAt: stamp,
            heartbeatAt: stamp,
            pid: input.pid,
          };
          rows.set(input.sessionKey, row);
          return { outcome: "held" as const, row };
        }

        const expMs = Date.parse(existing.expiresAt);
        if (Number.isFinite(expMs) && expMs < nowMs) {
          const row: WhatsAppWebLeaseRow = {
            sessionKey: input.sessionKey,
            ownerId: input.ownerId,
            ownerToken: input.ownerToken,
            fencingVersion: existing.fencingVersion + 1,
            expiresAt,
            acquiredAt: stamp,
            heartbeatAt: stamp,
            pid: input.pid,
          };
          rows.set(input.sessionKey, row);
          return { outcome: "stale_reclaimed" as const, row };
        }

        return { outcome: "contested" as const, row: existing };
      });
    },

    async heartbeat(input) {
      return serialize(() => {
        const existing = rows.get(input.sessionKey);
        if (
          !existing ||
          existing.ownerToken !== input.ownerToken ||
          existing.fencingVersion !== input.fencingVersion
        ) {
          return "not_owner" as const;
        }
        const stamp = now().toISOString();
        rows.set(input.sessionKey, {
          ...existing,
          heartbeatAt: stamp,
          expiresAt: new Date(now().getTime() + input.staleMs).toISOString(),
          pid: input.pid,
        });
        return "ok" as const;
      });
    },

    async release(input) {
      return serialize(() => {
        const existing = rows.get(input.sessionKey);
        if (
          !existing ||
          existing.ownerToken !== input.ownerToken ||
          existing.fencingVersion !== input.fencingVersion
        ) {
          return "not_owner" as const;
        }
        rows.delete(input.sessionKey);
        return "ok" as const;
      });
    },

    async read(sessionKey) {
      return serialize(() => rows.get(sessionKey) ?? null);
    },
  };
}

/** Postgres store: every mutate is a single conditional statement (no TOCTOU). */
export function createSqlWhatsAppWebSessionLeaseStore(
  db: SqlExecutor
): WhatsAppWebSessionLeaseStore {
  const table = WHATSAPP_WEB_SESSION_LEASE_TABLE;

  return {
    async tryAcquire(input) {
      try {
        return await db.withTransaction(async (tx) => {
          if (
            input.currentOwnerToken &&
            input.currentFencingVersion != null
          ) {
            const refreshed = await tx.query(
              `
              UPDATE public.${table}
              SET
                heartbeat_at = clock_timestamp(),
                expires_at = clock_timestamp() + ($4::text || ' milliseconds')::interval,
                pid = $5::integer,
                updated_at = clock_timestamp()
              WHERE session_key = $1
                AND owner_token = $2
                AND fencing_version = $3::bigint
              RETURNING session_key, owner_id, owner_token, fencing_version,
                        expires_at, acquired_at, heartbeat_at, pid
              `,
              [
                input.sessionKey,
                input.currentOwnerToken,
                input.currentFencingVersion,
                String(input.staleMs),
                input.pid,
              ]
            );
            if ((refreshed.rowCount ?? 0) === 1 && refreshed.rows[0]) {
              return {
                outcome: "held" as const,
                row: mapSqlRow(refreshed.rows[0]),
              };
            }
          }

          const inserted = await tx.query(
            `
            INSERT INTO public.${table} (
              session_key, owner_id, owner_token, fencing_version,
              expires_at, acquired_at, heartbeat_at, pid
            ) VALUES (
              $1, $2, $3, 1,
              clock_timestamp() + ($4::text || ' milliseconds')::interval,
              clock_timestamp(), clock_timestamp(), $5::integer
            )
            ON CONFLICT (session_key) DO NOTHING
            RETURNING session_key, owner_id, owner_token, fencing_version,
                      expires_at, acquired_at, heartbeat_at, pid
            `,
            [
              input.sessionKey,
              input.ownerId,
              input.ownerToken,
              String(input.staleMs),
              input.pid,
            ]
          );
          if ((inserted.rowCount ?? 0) === 1 && inserted.rows[0]) {
            return {
              outcome: "held" as const,
              row: mapSqlRow(inserted.rows[0]),
            };
          }

          const takeover = await tx.query(
            `
            UPDATE public.${table}
            SET
              owner_id = $2,
              owner_token = $3,
              fencing_version = fencing_version + 1,
              expires_at = clock_timestamp() + ($4::text || ' milliseconds')::interval,
              acquired_at = clock_timestamp(),
              heartbeat_at = clock_timestamp(),
              pid = $5::integer,
              updated_at = clock_timestamp()
            WHERE session_key = $1
              AND expires_at < clock_timestamp()
            RETURNING session_key, owner_id, owner_token, fencing_version,
                      expires_at, acquired_at, heartbeat_at, pid
            `,
            [
              input.sessionKey,
              input.ownerId,
              input.ownerToken,
              String(input.staleMs),
              input.pid,
            ]
          );
          if ((takeover.rowCount ?? 0) === 1 && takeover.rows[0]) {
            return {
              outcome: "stale_reclaimed" as const,
              row: mapSqlRow(takeover.rows[0]),
            };
          }

          const current = await tx.query(
            `
            SELECT session_key, owner_id, owner_token, fencing_version,
                   expires_at, acquired_at, heartbeat_at, pid
            FROM public.${table}
            WHERE session_key = $1
            `,
            [input.sessionKey]
          );
          return {
            outcome: "contested" as const,
            row: current.rows[0] ? mapSqlRow(current.rows[0]) : null,
          };
        });
      } catch {
        return { outcome: "unavailable", row: null };
      }
    },

    async heartbeat(input) {
      try {
        const result = await db.query(
          `
          UPDATE public.${table}
          SET
            heartbeat_at = clock_timestamp(),
            expires_at = clock_timestamp() + ($4::text || ' milliseconds')::interval,
            pid = $5::integer,
            updated_at = clock_timestamp()
          WHERE session_key = $1
            AND owner_token = $2
            AND fencing_version = $3::bigint
          `,
          [
            input.sessionKey,
            input.ownerToken,
            input.fencingVersion,
            String(input.staleMs),
            input.pid,
          ]
        );
        return (result.rowCount ?? 0) === 1 ? "ok" : "not_owner";
      } catch {
        return "error";
      }
    },

    async release(input) {
      try {
        const result = await db.query(
          `
          DELETE FROM public.${table}
          WHERE session_key = $1
            AND owner_token = $2
            AND fencing_version = $3::bigint
          `,
          [input.sessionKey, input.ownerToken, input.fencingVersion]
        );
        return (result.rowCount ?? 0) === 1 ? "ok" : "not_owner";
      } catch {
        return "error";
      }
    },

    async read(sessionKey) {
      try {
        const result = await db.query(
          `
          SELECT session_key, owner_id, owner_token, fencing_version,
                 expires_at, acquired_at, heartbeat_at, pid
          FROM public.${table}
          WHERE session_key = $1
          `,
          [sessionKey]
        );
        return result.rows[0] ? mapSqlRow(result.rows[0]) : null;
      } catch {
        return null;
      }
    },
  };
}

let sharedMemoryStore: WhatsAppWebSessionLeaseStore | null = null;

/** Process-wide memory store for local/dev/tests without DATABASE_URL. */
export function getSharedInMemoryWhatsAppWebSessionLeaseStore(): WhatsAppWebSessionLeaseStore {
  if (!sharedMemoryStore) {
    sharedMemoryStore = createInMemoryWhatsAppWebSessionLeaseStore();
  }
  return sharedMemoryStore;
}

/** Test-only reset of the shared memory lease store. */
export function __resetSharedInMemoryWhatsAppWebSessionLeaseStore(): void {
  sharedMemoryStore = null;
}
