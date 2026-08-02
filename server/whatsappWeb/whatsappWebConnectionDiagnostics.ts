/**
 * Privacy-safe WhatsApp Web connection/session diagnostics.
 * Never stores phones, message text, credentials, QR, JWTs, or cookies.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import {
  getWhatsAppWebHostHash,
  getWhatsAppWebProcessInstanceId,
  getWhatsAppWebProcessPid,
  hashOpaqueId,
} from "./whatsappWebProcessIdentity.ts";
import type { WhatsAppWebSessionLeaseSnapshot } from "./whatsappWebSessionLease.ts";

/**
 * Allowlisted Baileys event names tracked for protocol-activity evidence.
 * Bounded set — unknown event names are rejected, preventing unbounded storage.
 */
export const WHATSAPP_WEB_PROTOCOL_EVENT_NAMES = [
  "messages.upsert",
  "messages.update",
  "messaging-history.set",
  "contacts.upsert",
  "contacts.update",
  "chats.upsert",
  "chats.update",
  "creds.update",
  "connection.update",
] as const;

export type WhatsAppWebProtocolEventName =
  (typeof WHATSAPP_WEB_PROTOCOL_EVENT_NAMES)[number];

/** Sanitized per-event count map. Keys are strictly allowlisted. */
export type WhatsAppWebProtocolEventCounts = {
  readonly [K in WhatsAppWebProtocolEventName]: number;
};

/** Generation-scoped protocol readiness diagnostics. */
export type WhatsAppWebProtocolReadiness = {
  /** Socket generation for which these counts apply. */
  socketGeneration: number | null;
  /** ISO timestamp when Baileys emitted connection: "open" for this generation. */
  connectionOpenAt: string | null;
  /**
   * Last observed value of receivedPendingNotifications from connection.update.
   * null = never observed, false = observed false, true = observed true.
   */
  receivedPendingNotifications: boolean | null;
  /** ISO timestamp when receivedPendingNotifications first became true for this generation. */
  pendingNotificationsReceivedAt: string | null;
  /**
   * Last observed isOnline from connection.update.
   * null = never observed.
   */
  isOnline: boolean | null;
  /**
   * Last observed isNewLogin from connection.update.
   * null = never observed.
   */
  isNewLogin: boolean | null;
  /**
   * Last observed legacy.phoneConnected from connection.update.
   * null = never observed.
   */
  phoneConnected: boolean | null;
  /**
   * ISO timestamp of the last protocol event from any allowlisted Baileys event.
   * Includes events from the current generation only.
   */
  lastProtocolEventAt: string | null;
  /** Bounded per-event counts for the current generation. */
  protocolEventCounts: WhatsAppWebProtocolEventCounts;
};

export type WhatsAppWebConnectionDiagnosticsSnapshot = {
  processInstanceId: string;
  processPid: number;
  hostHash: string | null;
  lastConnectionUpdateAt: string | null;
  lastConnectionState: string | null;
  lastConnectionReason: string | null;
  lastCredentialsUpdateAt: string | null;
  authenticatedUserJidHash: string | null;
  socketCreatedAt: string | null;
  sessionLeaseStatus: string | null;
  sessionLeaseOwnerMatch: boolean;
  sessionLeaseOwnerId: string | null;
  sessionLeaseFencingTokenHash: string | null;
  sessionLeaseAcquiredAt: string | null;
  sessionLeaseHeartbeatAt: string | null;
  credentialsFilePresent: boolean | null;
  authKeyFileCount: number | null;
  listeningSilent: boolean;
  /** Protocol readiness diagnostics for the current socket generation. */
  protocolReadiness: WhatsAppWebProtocolReadiness;
};

const ALLOWED_CONNECTION_STATES = new Set([
  "open",
  "close",
  "logged_out",
  "connecting",
]);

const ALLOWED_CONNECTION_REASONS = new Set([
  "open",
  "logged_out",
  "restart_required",
  "connection_closed",
  "timed_out",
  "bad_session",
  "connection_replaced",
  "retryable",
  "unknown",
  "stale_generation",
  "not_desired",
  "shutdown",
]);

/** CONNECTED with zero raw upserts older than this is marked listeningSilent. */
export const WHATSAPP_WEB_LISTENING_SILENT_MS = 60_000;

const PROTOCOL_EVENT_NAME_SET = new Set<string>(
  WHATSAPP_WEB_PROTOCOL_EVENT_NAMES
);

function makeEmptyProtocolCounts(): WhatsAppWebProtocolEventCounts {
  return Object.fromEntries(
    WHATSAPP_WEB_PROTOCOL_EVENT_NAMES.map((k) => [k, 0])
  ) as WhatsAppWebProtocolEventCounts;
}

let snapshot: Omit<
  WhatsAppWebConnectionDiagnosticsSnapshot,
  | "processInstanceId"
  | "processPid"
  | "hostHash"
  | "sessionLeaseStatus"
  | "sessionLeaseOwnerMatch"
  | "sessionLeaseOwnerId"
  | "sessionLeaseFencingTokenHash"
  | "sessionLeaseAcquiredAt"
  | "sessionLeaseHeartbeatAt"
  | "listeningSilent"
> = {
  lastConnectionUpdateAt: null,
  lastConnectionState: null,
  lastConnectionReason: null,
  lastCredentialsUpdateAt: null,
  authenticatedUserJidHash: null,
  socketCreatedAt: null,
  credentialsFilePresent: null,
  authKeyFileCount: null,
  protocolReadiness: {
    socketGeneration: null,
    connectionOpenAt: null,
    receivedPendingNotifications: null,
    pendingNotificationsReceivedAt: null,
    isOnline: null,
    isNewLogin: null,
    phoneConnected: null,
    lastProtocolEventAt: null,
    protocolEventCounts: makeEmptyProtocolCounts(),
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

export function noteConnectionUpdateDiagnostic(input: {
  state: string;
  reason?: string | null;
}): void {
  const state = ALLOWED_CONNECTION_STATES.has(input.state)
    ? input.state
    : "unknown";
  const reasonRaw = String(input.reason ?? state);
  const reason = ALLOWED_CONNECTION_REASONS.has(reasonRaw)
    ? reasonRaw
    : "unknown";
  snapshot = {
    ...snapshot,
    lastConnectionUpdateAt: nowIso(),
    lastConnectionState: state,
    lastConnectionReason: reason,
  };
}

export function noteCredentialsUpdateDiagnostic(): void {
  snapshot = {
    ...snapshot,
    lastCredentialsUpdateAt: nowIso(),
  };
}

export function noteSocketCreatedDiagnostic(): void {
  snapshot = {
    ...snapshot,
    socketCreatedAt: nowIso(),
  };
}

export function noteAuthenticatedUserJidHash(
  userId: string | null | undefined
): void {
  snapshot = {
    ...snapshot,
    authenticatedUserJidHash: hashOpaqueId(userId),
  };
}

/**
 * Record the timestamp when Baileys emits connection: "open" for a generation.
 * Must be called before noteConnectionReadiness for accuracy.
 * Stale-generation calls are silently ignored.
 */
export function noteConnectionOpenDiagnostic(input: {
  generation: number;
}): void {
  const current = snapshot.protocolReadiness;
  // Only update if same generation or starting fresh.
  if (
    current.socketGeneration !== null &&
    current.socketGeneration !== input.generation
  ) {
    return;
  }
  snapshot = {
    ...snapshot,
    protocolReadiness: {
      ...current,
      socketGeneration: input.generation,
      connectionOpenAt: nowIso(),
    },
  };
}

/**
 * Record Baileys readiness fields from a connection.update event.
 * Only called from defaultSocketFactory for the current generation.
 * Must not capture phones, credentials, raw errors, or secrets.
 *
 * Generation guard: if the stored socketGeneration doesn't match the calling
 * generation, the update is silently ignored to prevent stale updates from
 * overwriting current readiness.
 */
export function noteConnectionReadiness(input: {
  generation: number;
  receivedPendingNotifications?: boolean | null;
  isOnline?: boolean | null;
  isNewLogin?: boolean | null;
  phoneConnected?: boolean | null;
}): void {
  const current = snapshot.protocolReadiness;
  // Reject stale-generation updates.
  if (
    current.socketGeneration !== null &&
    current.socketGeneration !== input.generation
  ) {
    return;
  }

  const at = nowIso();
  const rpn =
    input.receivedPendingNotifications != null
      ? Boolean(input.receivedPendingNotifications)
      : current.receivedPendingNotifications;

  // Record the first time pendingNotifications became true for this generation.
  const pendingNotificationsReceivedAt =
    input.receivedPendingNotifications === true &&
    current.pendingNotificationsReceivedAt === null
      ? at
      : current.pendingNotificationsReceivedAt;

  snapshot = {
    ...snapshot,
    protocolReadiness: {
      ...current,
      socketGeneration: input.generation,
      receivedPendingNotifications: rpn,
      pendingNotificationsReceivedAt,
      isOnline:
        input.isOnline != null ? Boolean(input.isOnline) : current.isOnline,
      isNewLogin:
        input.isNewLogin != null
          ? Boolean(input.isNewLogin)
          : current.isNewLogin,
      phoneConnected:
        input.phoneConnected != null
          ? Boolean(input.phoneConnected)
          : current.phoneConnected,
    },
  };
}

/**
 * Clear generation-scoped protocol readiness when a new socket generation begins.
 * Prevents stale readiness/counts from the previous generation persisting.
 */
export function clearProtocolReadinessForNewGeneration(
  generation: number
): void {
  snapshot = {
    ...snapshot,
    protocolReadiness: {
      socketGeneration: generation,
      connectionOpenAt: null,
      receivedPendingNotifications: null,
      pendingNotificationsReceivedAt: null,
      isOnline: null,
      isNewLogin: null,
      phoneConnected: null,
      lastProtocolEventAt: null,
      protocolEventCounts: makeEmptyProtocolCounts(),
    },
  };
}

/**
 * Record a Baileys protocol event. Only allowlisted event names are counted.
 * Unknown names are silently ignored (no unbounded key creation).
 * Stale-generation events are silently ignored.
 *
 * @param eventName - Must be one of WHATSAPP_WEB_PROTOCOL_EVENT_NAMES.
 * @param generation - Socket generation that emitted the event.
 */
export function noteProtocolEvent(input: {
  eventName: string;
  generation: number;
}): void {
  const current = snapshot.protocolReadiness;
  // Reject stale-generation events.
  if (
    current.socketGeneration !== null &&
    current.socketGeneration !== input.generation
  ) {
    return;
  }
  // Reject unknown event names — no unbounded storage.
  if (!PROTOCOL_EVENT_NAME_SET.has(input.eventName)) return;

  const safeName = input.eventName as WhatsAppWebProtocolEventName;
  const counts = { ...current.protocolEventCounts };
  counts[safeName] = (counts[safeName] ?? 0) + 1;

  snapshot = {
    ...snapshot,
    protocolReadiness: {
      ...current,
      lastProtocolEventAt: nowIso(),
      protocolEventCounts: counts as WhatsAppWebProtocolEventCounts,
    },
  };
}

export async function refreshAuthSessionIntegrity(
  sessionDir: string | null | undefined
): Promise<void> {
  if (!sessionDir) {
    snapshot = {
      ...snapshot,
      credentialsFilePresent: null,
      authKeyFileCount: null,
    };
    return;
  }
  try {
    const resolved = path.resolve(sessionDir);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    let keyFileCount = 0;
    let credsPresent = false;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name === "creds.json") {
        credsPresent = true;
        continue;
      }
      if (
        name.endsWith(".json") &&
        name !== ".session-owner.lease" &&
        !name.includes(".tmp")
      ) {
        keyFileCount += 1;
      }
    }
    snapshot = {
      ...snapshot,
      credentialsFilePresent: credsPresent,
      authKeyFileCount: keyFileCount,
    };
  } catch {
    snapshot = {
      ...snapshot,
      credentialsFilePresent: false,
      authKeyFileCount: null,
    };
  }
}

export function getWhatsAppWebConnectionDiagnostics(input: {
  env?: NodeJS.ProcessEnv;
  lease?: WhatsAppWebSessionLeaseSnapshot | null;
  connected?: boolean;
  lastRawUpsertAt?: string | null;
  nowMs?: number;
  silentAfterMs?: number;
}): WhatsAppWebConnectionDiagnosticsSnapshot {
  const env = input.env ?? process.env;
  const lease = input.lease ?? null;
  const nowMs = input.nowMs ?? Date.now();
  const silentAfterMs = input.silentAfterMs ?? WHATSAPP_WEB_LISTENING_SILENT_MS;
  const openAt = snapshot.socketCreatedAt
    ? Date.parse(snapshot.socketCreatedAt)
    : NaN;
  const listeningSilent =
    input.connected === true &&
    !input.lastRawUpsertAt &&
    Number.isFinite(openAt) &&
    nowMs - openAt >= silentAfterMs;

  return {
    processInstanceId: getWhatsAppWebProcessInstanceId(env),
    processPid: getWhatsAppWebProcessPid(),
    hostHash: getWhatsAppWebHostHash(),
    lastConnectionUpdateAt: snapshot.lastConnectionUpdateAt,
    lastConnectionState: snapshot.lastConnectionState,
    lastConnectionReason: snapshot.lastConnectionReason,
    lastCredentialsUpdateAt: snapshot.lastCredentialsUpdateAt,
    authenticatedUserJidHash: snapshot.authenticatedUserJidHash,
    socketCreatedAt: snapshot.socketCreatedAt,
    sessionLeaseStatus: lease?.status ?? null,
    sessionLeaseOwnerMatch: lease?.ownerMatch === true,
    sessionLeaseOwnerId: lease?.ownerIdHash ?? null,
    sessionLeaseFencingTokenHash: lease?.fencingTokenHash ?? null,
    sessionLeaseAcquiredAt: lease?.acquiredAt ?? null,
    sessionLeaseHeartbeatAt: lease?.heartbeatAt ?? null,
    credentialsFilePresent: snapshot.credentialsFilePresent,
    authKeyFileCount: snapshot.authKeyFileCount,
    listeningSilent,
    protocolReadiness: { ...snapshot.protocolReadiness },
  };
}

/** Test-only reset. */
export function __resetWhatsAppWebConnectionDiagnostics(): void {
  snapshot = {
    lastConnectionUpdateAt: null,
    lastConnectionState: null,
    lastConnectionReason: null,
    lastCredentialsUpdateAt: null,
    authenticatedUserJidHash: null,
    socketCreatedAt: null,
    credentialsFilePresent: null,
    authKeyFileCount: null,
    protocolReadiness: {
      socketGeneration: null,
      connectionOpenAt: null,
      receivedPendingNotifications: null,
      pendingNotificationsReceivedAt: null,
      isOnline: null,
      isNewLogin: null,
      phoneConnected: null,
      lastProtocolEventAt: null,
      protocolEventCounts: makeEmptyProtocolCounts(),
    },
  };
}
