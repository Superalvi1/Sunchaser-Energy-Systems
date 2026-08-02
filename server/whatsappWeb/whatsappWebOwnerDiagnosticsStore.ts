/**
 * Durable WhatsApp Web owner diagnostics (CAS-fenced).
 *
 * Writes require session_key + owner_token + fencing_version matching the
 * current lease grant. Old/non-owner processes must never overwrite successors.
 *
 * Never stores phones, message text, credentials, QR, or secrets.
 */
import type { SqlExecutor } from "../unifiedMessaging/messagingSql.ts";

export const WHATSAPP_WEB_OWNER_DIAGNOSTICS_TABLE =
  "whatsapp_web_owner_diagnostics";

export const WHATSAPP_WEB_INBOUND_HEALTH_STATES = [
  "CONNECTED_SOCKET",
  "LISTENER_READY",
  /** Socket open, listener operational, at least one non-upsert protocol event received but no live messages.upsert confirmed yet. Observability only. */
  "AWAITING_PROTOCOL_SYNC",
  /** Socket open, listener operational, raw messages.upsert arrived but no stored message accepted into inbox yet. Observability only. */
  "PROTOCOL_ACTIVE_INBOUND_UNCONFIRMED",
  "LIVE_INBOUND_CONFIRMED",
  "INBOUND_SILENT",
  "LEASE_NOT_OWNED",
] as const;

export type WhatsAppWebInboundHealth =
  (typeof WHATSAPP_WEB_INBOUND_HEALTH_STATES)[number];

export type WhatsAppWebOwnerDiagnosticsRow = {
  sessionKey: string;
  ownerId: string;
  ownerToken: string;
  fencingVersion: number;
  ownerProcessInstanceId: string;
  connectionGeneration: number;
  lifecycleState: string;
  socketOpen: boolean;
  inboundListenerAttached: boolean;
  inboundListenerOperational: boolean;
  inboundHealth: WhatsAppWebInboundHealth;
  lastConnectionAt: string | null;
  lastHeartbeatAt: string | null;
  lastRawUpsertAt: string | null;
  lastAcceptedEventAt: string | null;
  lastStoredMessageAt: string | null;
  lastFailureCode: string | null;
  buildIdentity: string | null;
  updatedAt: string;
  connectionOpenAt: string | null;
  receivedPendingNotifications: boolean | null;
  pendingNotificationsReceivedAt: string | null;
  isOnline: boolean | null;
  isNewLogin: boolean | null;
  phoneConnected: boolean | null;
  lastProtocolEventAt: string | null;
  protocolEventCounts: Record<string, number> | null;
};

export type WhatsAppWebOwnerDiagnosticsFence = {
  sessionKey: string;
  ownerToken: string;
  fencingVersion: number;
};

export type WhatsAppWebOwnerDiagnosticsPatch = {
  ownerProcessInstanceId: string;
  connectionGeneration: number;
  lifecycleState: string;
  socketOpen: boolean;
  inboundListenerAttached: boolean;
  inboundListenerOperational: boolean;
  inboundHealth: WhatsAppWebInboundHealth;
  lastConnectionAt: string | null;
  lastHeartbeatAt: string | null;
  lastRawUpsertAt: string | null;
  lastAcceptedEventAt: string | null;
  lastStoredMessageAt: string | null;
  lastFailureCode: string | null;
  buildIdentity: string | null;
  connectionOpenAt: string | null;
  receivedPendingNotifications: boolean | null;
  pendingNotificationsReceivedAt: string | null;
  isOnline: boolean | null;
  isNewLogin: boolean | null;
  phoneConnected: boolean | null;
  lastProtocolEventAt: string | null;
  protocolEventCounts: Record<string, number> | null;
};

export type WhatsAppWebOwnerDiagnosticsMutateResult =
  | "ok"
  | "not_owner"
  | "error";

export type WhatsAppWebOwnerDiagnosticsStore = {
  read(sessionKey: string): Promise<WhatsAppWebOwnerDiagnosticsRow | null>;
  write(
    fence: WhatsAppWebOwnerDiagnosticsFence,
    ownerId: string,
    patch: WhatsAppWebOwnerDiagnosticsPatch
  ): Promise<WhatsAppWebOwnerDiagnosticsMutateResult>;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}

function safeJsonCounts(raw: unknown): Record<string, number> | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const result: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number") result[k] = v;
    }
    return result;
  } catch {
    return null;
  }
}

function mapSqlRow(row: Record<string, unknown>): WhatsAppWebOwnerDiagnosticsRow {
  const healthRaw = String(row.inbound_health ?? "INBOUND_SILENT");
  const inboundHealth = (
    WHATSAPP_WEB_INBOUND_HEALTH_STATES as readonly string[]
  ).includes(healthRaw)
    ? (healthRaw as WhatsAppWebInboundHealth)
    : "INBOUND_SILENT";
  return {
    sessionKey: String(row.session_key ?? ""),
    ownerId: String(row.owner_id ?? ""),
    ownerToken: String(row.owner_token ?? ""),
    fencingVersion: Number(row.fencing_version),
    ownerProcessInstanceId: String(row.owner_process_instance_id ?? ""),
    connectionGeneration: Number(row.connection_generation ?? 0),
    lifecycleState: String(row.lifecycle_state ?? "DISCONNECTED"),
    socketOpen: row.socket_open === true,
    inboundListenerAttached: row.inbound_listener_attached === true,
    inboundListenerOperational: row.inbound_listener_operational === true,
    inboundHealth,
    lastConnectionAt: asIso(row.last_connection_at as string | Date | null),
    lastHeartbeatAt: asIso(row.last_heartbeat_at as string | Date | null),
    lastRawUpsertAt: asIso(row.last_raw_upsert_at as string | Date | null),
    lastAcceptedEventAt: asIso(
      row.last_accepted_event_at as string | Date | null
    ),
    lastStoredMessageAt: asIso(
      row.last_stored_message_at as string | Date | null
    ),
    lastFailureCode:
      row.last_failure_code == null ? null : String(row.last_failure_code),
    buildIdentity:
      row.build_identity == null ? null : String(row.build_identity),
    updatedAt: asIso(row.updated_at as string | Date) ?? new Date(0).toISOString(),
    connectionOpenAt: asIso(row.connection_open_at as string | Date | null),
    receivedPendingNotifications:
      row.received_pending_notifications == null
        ? null
        : row.received_pending_notifications === true,
    pendingNotificationsReceivedAt: asIso(
      row.pending_notifications_received_at as string | Date | null
    ),
    isOnline: row.is_online == null ? null : row.is_online === true,
    isNewLogin: row.is_new_login == null ? null : row.is_new_login === true,
    phoneConnected:
      row.phone_connected == null ? null : row.phone_connected === true,
    lastProtocolEventAt: asIso(
      row.last_protocol_event_at as string | Date | null
    ),
    protocolEventCounts: safeJsonCounts(row.protocol_event_counts),
  };
}

export function deriveWhatsAppWebInboundHealth(input: {
  leaseOwned: boolean;
  socketOpen: boolean;
  inboundListenerOperational: boolean;
  /** True only when the *current* socket generation observed live inbound. */
  liveInboundConfirmed?: boolean;
  lastRawUpsertAt?: string | null;
  lastAcceptedEventAt?: string | null;
  lastStoredMessageAt?: string | null;
  /** True when non-upsert protocol events have been observed (Phase 1 observability only). */
  protocolEventActive?: boolean;
}): WhatsAppWebInboundHealth {
  if (!input.leaseOwned) return "LEASE_NOT_OWNED";
  const liveConfirmed =
    input.liveInboundConfirmed === true ||
    (input.liveInboundConfirmed !== false &&
      Boolean(
        input.lastStoredMessageAt ||
          input.lastAcceptedEventAt ||
          input.lastRawUpsertAt
      ));
  if (liveConfirmed && input.socketOpen && input.inboundListenerOperational) {
    return "LIVE_INBOUND_CONFIRMED";
  }
  if (input.socketOpen && input.inboundListenerOperational) {
    if (input.lastRawUpsertAt && !input.lastStoredMessageAt) {
      return "PROTOCOL_ACTIVE_INBOUND_UNCONFIRMED";
    }
    if (input.protocolEventActive) {
      return "AWAITING_PROTOCOL_SYNC";
    }
    return "LISTENER_READY";
  }
  if (input.socketOpen) return "CONNECTED_SOCKET";
  return "INBOUND_SILENT";
}

export function getWhatsAppWebBuildIdentity(
  env: NodeJS.ProcessEnv = process.env
): string {
  const raw = String(
    env.RENDER_GIT_COMMIT ??
      env.SOURCE_VERSION ??
      env.GIT_COMMIT ??
      env.COMMIT_SHA ??
      ""
  ).trim();
  if (!raw) return "unknown";
  return raw.length > 40 ? raw.slice(0, 40) : raw;
}

export function createInMemoryWhatsAppWebOwnerDiagnosticsStore(): WhatsAppWebOwnerDiagnosticsStore {
  const rows = new Map<string, WhatsAppWebOwnerDiagnosticsRow>();
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
    async read(sessionKey) {
      return serialize(() => {
        const row = rows.get(sessionKey) ?? null;
        return row ? { ...row } : null;
      });
    },

    async write(fence, ownerId, patch) {
      return serialize(() => {
        const existing = rows.get(fence.sessionKey) ?? null;
        const stamp = new Date().toISOString();

        const matchesFence =
          existing &&
          existing.ownerToken === fence.ownerToken &&
          existing.fencingVersion === fence.fencingVersion;

        const canTakeOver =
          !existing || existing.fencingVersion < fence.fencingVersion;

        if (!matchesFence && !canTakeOver) {
          return "not_owner" as const;
        }

        const next: WhatsAppWebOwnerDiagnosticsRow = {
          sessionKey: fence.sessionKey,
          ownerId,
          ownerToken: fence.ownerToken,
          fencingVersion: fence.fencingVersion,
          ownerProcessInstanceId: patch.ownerProcessInstanceId,
          connectionGeneration: patch.connectionGeneration,
          lifecycleState: patch.lifecycleState,
          socketOpen: patch.socketOpen,
          inboundListenerAttached: patch.inboundListenerAttached,
          inboundListenerOperational: patch.inboundListenerOperational,
          inboundHealth: patch.inboundHealth,
          lastConnectionAt: patch.lastConnectionAt,
          lastHeartbeatAt: patch.lastHeartbeatAt,
          lastRawUpsertAt: patch.lastRawUpsertAt,
          lastAcceptedEventAt: patch.lastAcceptedEventAt,
          lastStoredMessageAt: patch.lastStoredMessageAt,
          lastFailureCode: patch.lastFailureCode,
          buildIdentity: patch.buildIdentity,
          connectionOpenAt: patch.connectionOpenAt,
          receivedPendingNotifications: patch.receivedPendingNotifications,
          pendingNotificationsReceivedAt: patch.pendingNotificationsReceivedAt,
          isOnline: patch.isOnline,
          isNewLogin: patch.isNewLogin,
          phoneConnected: patch.phoneConnected,
          lastProtocolEventAt: patch.lastProtocolEventAt,
          protocolEventCounts: patch.protocolEventCounts,
          updatedAt: stamp,
        };
        rows.set(fence.sessionKey, next);
        return "ok" as const;
      });
    },
  };
}

export function createSqlWhatsAppWebOwnerDiagnosticsStore(
  db: SqlExecutor
): WhatsAppWebOwnerDiagnosticsStore {
  const table = WHATSAPP_WEB_OWNER_DIAGNOSTICS_TABLE;

  return {
    async read(sessionKey) {
      try {
        const result = await db.query(
          `
          SELECT session_key, owner_id, owner_token, fencing_version,
                 owner_process_instance_id, connection_generation, lifecycle_state,
                 socket_open, inbound_listener_attached, inbound_listener_operational,
                 inbound_health, last_connection_at, last_heartbeat_at,
                 last_raw_upsert_at, last_accepted_event_at, last_stored_message_at,
                 last_failure_code, build_identity, updated_at,
                 connection_open_at, received_pending_notifications,
                 pending_notifications_received_at, is_online, is_new_login,
                 phone_connected, last_protocol_event_at, protocol_event_counts
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

    async write(fence, ownerId, patch) {
      try {
        return await db.withTransaction(async (tx) => {
          const updated = await tx.query(
            `
            UPDATE public.${table}
            SET
              owner_id = $4,
              owner_process_instance_id = $5,
              connection_generation = $6::bigint,
              lifecycle_state = $7,
              socket_open = $8::boolean,
              inbound_listener_attached = $9::boolean,
              inbound_listener_operational = $10::boolean,
              inbound_health = $11,
              last_connection_at = $12::timestamptz,
              last_heartbeat_at = $13::timestamptz,
              last_raw_upsert_at = $14::timestamptz,
              last_accepted_event_at = $15::timestamptz,
              last_stored_message_at = $16::timestamptz,
              last_failure_code = $17,
              build_identity = $18,
              connection_open_at = $19::timestamptz,
              received_pending_notifications = $20,
              pending_notifications_received_at = $21::timestamptz,
              is_online = $22,
              is_new_login = $23,
              phone_connected = $24,
              last_protocol_event_at = $25::timestamptz,
              protocol_event_counts = $26::jsonb,
              updated_at = clock_timestamp()
            WHERE session_key = $1
              AND owner_token = $2
              AND fencing_version = $3::bigint
            RETURNING session_key
            `,
            [
              fence.sessionKey,
              fence.ownerToken,
              fence.fencingVersion,
              ownerId,
              patch.ownerProcessInstanceId,
              patch.connectionGeneration,
              patch.lifecycleState,
              patch.socketOpen,
              patch.inboundListenerAttached,
              patch.inboundListenerOperational,
              patch.inboundHealth,
              patch.lastConnectionAt,
              patch.lastHeartbeatAt,
              patch.lastRawUpsertAt,
              patch.lastAcceptedEventAt,
              patch.lastStoredMessageAt,
              patch.lastFailureCode,
              patch.buildIdentity,
              patch.connectionOpenAt,
              patch.receivedPendingNotifications,
              patch.pendingNotificationsReceivedAt,
              patch.isOnline,
              patch.isNewLogin,
              patch.phoneConnected,
              patch.lastProtocolEventAt,
              patch.protocolEventCounts != null ? JSON.stringify(patch.protocolEventCounts) : null,
            ]
          );
          if ((updated.rowCount ?? 0) === 1) return "ok" as const;

          const inserted = await tx.query(
            `
            INSERT INTO public.${table} (
              session_key, owner_id, owner_token, fencing_version,
              owner_process_instance_id, connection_generation, lifecycle_state,
              socket_open, inbound_listener_attached, inbound_listener_operational,
              inbound_health, last_connection_at, last_heartbeat_at,
              last_raw_upsert_at, last_accepted_event_at, last_stored_message_at,
              last_failure_code, build_identity,
              connection_open_at, received_pending_notifications,
              pending_notifications_received_at, is_online, is_new_login,
              phone_connected, last_protocol_event_at, protocol_event_counts
            ) VALUES (
              $1, $2, $3, $4::bigint,
              $5, $6::bigint, $7,
              $8::boolean, $9::boolean, $10::boolean,
              $11, $12::timestamptz, $13::timestamptz, $14::timestamptz,
              $15::timestamptz, $16::timestamptz, $17, $18,
              $19::timestamptz, $20, $21::timestamptz,
              $22, $23, $24,
              $25::timestamptz, $26::jsonb
            )
            ON CONFLICT (session_key) DO UPDATE SET
              owner_id = EXCLUDED.owner_id,
              owner_token = EXCLUDED.owner_token,
              fencing_version = EXCLUDED.fencing_version,
              owner_process_instance_id = EXCLUDED.owner_process_instance_id,
              connection_generation = EXCLUDED.connection_generation,
              lifecycle_state = EXCLUDED.lifecycle_state,
              socket_open = EXCLUDED.socket_open,
              inbound_listener_attached = EXCLUDED.inbound_listener_attached,
              inbound_listener_operational = EXCLUDED.inbound_listener_operational,
              inbound_health = EXCLUDED.inbound_health,
              last_connection_at = EXCLUDED.last_connection_at,
              last_heartbeat_at = EXCLUDED.last_heartbeat_at,
              last_raw_upsert_at = EXCLUDED.last_raw_upsert_at,
              last_accepted_event_at = EXCLUDED.last_accepted_event_at,
              last_stored_message_at = EXCLUDED.last_stored_message_at,
              last_failure_code = EXCLUDED.last_failure_code,
              build_identity = EXCLUDED.build_identity,
              connection_open_at = EXCLUDED.connection_open_at,
              received_pending_notifications = EXCLUDED.received_pending_notifications,
              pending_notifications_received_at = EXCLUDED.pending_notifications_received_at,
              is_online = EXCLUDED.is_online,
              is_new_login = EXCLUDED.is_new_login,
              phone_connected = EXCLUDED.phone_connected,
              last_protocol_event_at = EXCLUDED.last_protocol_event_at,
              protocol_event_counts = EXCLUDED.protocol_event_counts,
              updated_at = clock_timestamp()
            WHERE public.${table}.fencing_version < EXCLUDED.fencing_version
            RETURNING session_key
            `,
            [
              fence.sessionKey,
              ownerId,
              fence.ownerToken,
              fence.fencingVersion,
              patch.ownerProcessInstanceId,
              patch.connectionGeneration,
              patch.lifecycleState,
              patch.socketOpen,
              patch.inboundListenerAttached,
              patch.inboundListenerOperational,
              patch.inboundHealth,
              patch.lastConnectionAt,
              patch.lastHeartbeatAt,
              patch.lastRawUpsertAt,
              patch.lastAcceptedEventAt,
              patch.lastStoredMessageAt,
              patch.lastFailureCode,
              patch.buildIdentity,
              patch.connectionOpenAt,
              patch.receivedPendingNotifications,
              patch.pendingNotificationsReceivedAt,
              patch.isOnline,
              patch.isNewLogin,
              patch.phoneConnected,
              patch.lastProtocolEventAt,
              patch.protocolEventCounts != null ? JSON.stringify(patch.protocolEventCounts) : null,
            ]
          );
          if ((inserted.rowCount ?? 0) === 1) return "ok" as const;
          return "not_owner" as const;
        });
      } catch {
        return "error";
      }
    },
  };
}

let sharedMemoryStore: WhatsAppWebOwnerDiagnosticsStore | null = null;

export function getSharedInMemoryWhatsAppWebOwnerDiagnosticsStore(): WhatsAppWebOwnerDiagnosticsStore {
  if (!sharedMemoryStore) {
    sharedMemoryStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  }
  return sharedMemoryStore;
}

export function __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore(): void {
  sharedMemoryStore = null;
}
