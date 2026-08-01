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
  sessionLeaseAcquiredAt: string | null;
  sessionLeaseHeartbeatAt: string | null;
  credentialsFilePresent: boolean | null;
  authKeyFileCount: number | null;
  listeningSilent: boolean;
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

let snapshot: Omit<
  WhatsAppWebConnectionDiagnosticsSnapshot,
  | "processInstanceId"
  | "processPid"
  | "hostHash"
  | "sessionLeaseStatus"
  | "sessionLeaseOwnerMatch"
  | "sessionLeaseOwnerId"
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
    sessionLeaseAcquiredAt: lease?.acquiredAt ?? null,
    sessionLeaseHeartbeatAt: lease?.heartbeatAt ?? null,
    credentialsFilePresent: snapshot.credentialsFilePresent,
    authKeyFileCount: snapshot.authKeyFileCount,
    listeningSilent,
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
  };
}
