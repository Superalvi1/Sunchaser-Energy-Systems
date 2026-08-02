/**
 * Owner-aware WhatsApp Web control helpers.
 * Sanitized lease-not-owned errors and durable status merge.
 * Never includes owner_token, credentials, phones, or message content.
 */
import {
  WHATSAPP_WEB_LEASE_NOT_OWNED_CODE,
  WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
  type WhatsAppWebLeaseNotOwnedDetails,
  type WhatsAppWebLifecycleState,
  type WhatsAppWebSafeStatus,
} from "./whatsappWebTypes.ts";
import type { WhatsAppWebLeaseRow } from "./whatsappWebSessionLeaseStore.ts";
import {
  deriveWhatsAppWebInboundHealth,
  getWhatsAppWebBuildIdentity,
  type WhatsAppWebOwnerDiagnosticsRow,
} from "./whatsappWebOwnerDiagnosticsStore.ts";

export function isLeaseRowActive(
  row: WhatsAppWebLeaseRow | null | undefined,
  nowMs: number
): row is WhatsAppWebLeaseRow {
  if (!row) return false;
  const exp = Date.parse(row.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

export function createLeaseNotOwnedError(input: {
  servingProcessInstanceId: string;
  ownerProcessInstanceId: string | null;
  sessionLeaseStatus: string;
  fencingVersion: number | null;
}): Error & {
  code: typeof WHATSAPP_WEB_LEASE_NOT_OWNED_CODE;
  details: WhatsAppWebLeaseNotOwnedDetails;
} {
  const details: WhatsAppWebLeaseNotOwnedDetails = {
    code: WHATSAPP_WEB_LEASE_NOT_OWNED_CODE,
    servingProcessInstanceId: input.servingProcessInstanceId,
    ownerProcessInstanceId: input.ownerProcessInstanceId,
    sessionLeaseStatus: input.sessionLeaseStatus,
    sessionLeaseOwnerMatch: false,
    fencingVersion: input.fencingVersion,
    retryGuidance: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
  };
  const err = new Error(WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE) as Error & {
    code: typeof WHATSAPP_WEB_LEASE_NOT_OWNED_CODE;
    details: WhatsAppWebLeaseNotOwnedDetails;
  };
  err.code = WHATSAPP_WEB_LEASE_NOT_OWNED_CODE;
  err.details = details;
  return err;
}

export function mergeOwnerAwareSafeStatus(input: {
  local: WhatsAppWebSafeStatus;
  servingProcessInstanceId: string;
  durableLease: WhatsAppWebLeaseRow | null;
  durableDiagnostics: WhatsAppWebOwnerDiagnosticsRow | null;
  nowMs: number;
  env?: NodeJS.ProcessEnv;
}): WhatsAppWebSafeStatus {
  const {
    local,
    servingProcessInstanceId,
    durableLease,
    durableDiagnostics,
    nowMs,
    env = process.env,
  } = input;
  const active = isLeaseRowActive(durableLease, nowMs);
  const durableOwnerMatch =
    active === true && durableLease.ownerId === servingProcessInstanceId;
  const buildIdentity =
    durableDiagnostics?.buildIdentity ?? getWhatsAppWebBuildIdentity(env);

  if (durableOwnerMatch) {
    const inboundHealth = deriveWhatsAppWebInboundHealth({
      leaseOwned: true,
      socketOpen: local.socketOpen,
      inboundListenerOperational: local.inboundListenerOperational,
      lastRawUpsertAt: local.lastRawUpsertAt,
      lastAcceptedEventAt: local.lastInboundEventAt,
      lastStoredMessageAt: local.lastInboundStoredAt,
    });
    return {
      ...local,
      processInstanceId: servingProcessInstanceId,
      servingProcessInstanceId,
      ownerProcessInstanceId: durableLease.ownerId,
      fencingVersion: durableLease.fencingVersion,
      durableOwnerMatch: true,
      sessionLeaseOwnerMatch: true,
      sessionLeaseOwnerId: durableLease.ownerId.slice(0, 24),
      sessionLeaseHeartbeatAt: durableLease.heartbeatAt,
      inboundHealth,
      listeningSilent:
        inboundHealth === "LISTENER_READY" ||
        inboundHealth === "CONNECTED_SOCKET" ||
        inboundHealth === "INBOUND_SILENT"
          ? true
          : local.listeningSilent,
      buildIdentity,
      leaseRetryGuidance: null,
    };
  }

  // Non-owner (or no local ownership): prefer durable owner diagnostics.
  if (active && durableDiagnostics) {
    const lifecycle = durableDiagnostics.lifecycleState as WhatsAppWebLifecycleState;
    const inboundHealth = deriveWhatsAppWebInboundHealth({
      leaseOwned: false,
      socketOpen: durableDiagnostics.socketOpen,
      inboundListenerOperational:
        durableDiagnostics.inboundListenerOperational,
      lastRawUpsertAt: durableDiagnostics.lastRawUpsertAt,
      lastAcceptedEventAt: durableDiagnostics.lastAcceptedEventAt,
      lastStoredMessageAt: durableDiagnostics.lastStoredMessageAt,
    });
    return {
      ...local,
      // Keep QR/local secrets off non-owner responses.
      qrAvailable: false,
      qrExpiresAt: null,
      state: (
        [
          "DISCONNECTED",
          "QR_READY",
          "CONNECTING",
          "CONNECTED",
          "RECONNECTING",
          "LOGGED_OUT",
          "ERROR",
        ] as string[]
      ).includes(lifecycle)
        ? lifecycle
        : local.state,
      socketOpen: durableDiagnostics.socketOpen,
      inboundListenerAttached: durableDiagnostics.inboundListenerAttached,
      inboundListenerOperational:
        durableDiagnostics.inboundListenerOperational,
      activeSocketGeneration: durableDiagnostics.connectionGeneration,
      lastRawUpsertAt: durableDiagnostics.lastRawUpsertAt,
      lastInboundEventAt: durableDiagnostics.lastAcceptedEventAt,
      lastInboundStoredAt: durableDiagnostics.lastStoredMessageAt,
      lastPersistFailureCode: durableDiagnostics.lastFailureCode,
      lastConnectionUpdateAt: durableDiagnostics.lastConnectionAt,
      sessionLeaseStatus: "contested",
      sessionLeaseOwnerMatch: false,
      sessionLeaseOwnerId: durableLease.ownerId.slice(0, 24),
      sessionLeaseHeartbeatAt: durableLease.heartbeatAt,
      processInstanceId: servingProcessInstanceId,
      servingProcessInstanceId,
      ownerProcessInstanceId: durableLease.ownerId,
      fencingVersion: durableLease.fencingVersion,
      durableOwnerMatch: false,
      inboundHealth: "LEASE_NOT_OWNED",
      listeningSilent: false,
      buildIdentity,
      safeMessage: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
      leaseRetryGuidance: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
    };
  }

  if (active) {
    return {
      ...local,
      qrAvailable: false,
      qrExpiresAt: null,
      socketOpen: false,
      inboundListenerAttached: false,
      inboundListenerOperational: false,
      sessionLeaseStatus: "contested",
      sessionLeaseOwnerMatch: false,
      sessionLeaseOwnerId: durableLease.ownerId.slice(0, 24),
      sessionLeaseHeartbeatAt: durableLease.heartbeatAt,
      processInstanceId: servingProcessInstanceId,
      servingProcessInstanceId,
      ownerProcessInstanceId: durableLease.ownerId,
      fencingVersion: durableLease.fencingVersion,
      durableOwnerMatch: false,
      inboundHealth: "LEASE_NOT_OWNED",
      listeningSilent: false,
      buildIdentity,
      safeMessage: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
      leaseRetryGuidance: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
    };
  }

  // No active foreign lease — local view with explicit health.
  const inboundHealth = deriveWhatsAppWebInboundHealth({
    leaseOwned: local.sessionLeaseOwnerMatch === true,
    socketOpen: local.socketOpen,
    inboundListenerOperational: local.inboundListenerOperational,
    lastRawUpsertAt: local.lastRawUpsertAt,
    lastAcceptedEventAt: local.lastInboundEventAt,
    lastStoredMessageAt: local.lastInboundStoredAt,
  });
  return {
    ...local,
    servingProcessInstanceId,
    ownerProcessInstanceId: local.sessionLeaseOwnerId,
    fencingVersion: null,
    durableOwnerMatch: local.sessionLeaseOwnerMatch === true,
    inboundHealth,
    buildIdentity,
    leaseRetryGuidance: null,
  };
}
