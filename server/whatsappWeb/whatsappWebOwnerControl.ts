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

export const WHATSAPP_WEB_OWNER_DIAGNOSTICS_UNAVAILABLE_MESSAGE =
  "Lease owner diagnostics are not yet published for the current fence.";

export function isLeaseRowActive(
  row: WhatsAppWebLeaseRow | null | undefined,
  nowMs: number
): row is WhatsAppWebLeaseRow {
  if (!row) return false;
  const exp = Date.parse(row.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

/** Diagnostics may be used only when they match the active durable lease fence. */
export function diagnosticsMatchesActiveLease(
  diagnostics: WhatsAppWebOwnerDiagnosticsRow | null | undefined,
  lease: WhatsAppWebLeaseRow | null | undefined
): diagnostics is WhatsAppWebOwnerDiagnosticsRow {
  if (!diagnostics || !lease) return false;
  return (
    diagnostics.sessionKey === lease.sessionKey &&
    diagnostics.ownerToken === lease.ownerToken &&
    diagnostics.fencingVersion === lease.fencingVersion &&
    diagnostics.ownerId === lease.ownerId
  );
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

function asLifecycle(
  value: string | null | undefined,
  fallback: WhatsAppWebLifecycleState
): WhatsAppWebLifecycleState {
  const allowed = [
    "DISCONNECTED",
    "QR_READY",
    "CONNECTING",
    "CONNECTED",
    "RECONNECTING",
    "LOGGED_OUT",
    "ERROR",
  ] as const;
  return (allowed as readonly string[]).includes(String(value ?? ""))
    ? (value as WhatsAppWebLifecycleState)
    : fallback;
}

export function mergeOwnerAwareSafeStatus(input: {
  local: WhatsAppWebSafeStatus;
  servingProcessInstanceId: string;
  durableLease: WhatsAppWebLeaseRow | null;
  durableDiagnostics: WhatsAppWebOwnerDiagnosticsRow | null;
  nowMs: number;
  env?: NodeJS.ProcessEnv;
  /** Live inbound confirmation scoped to the current socket generation. */
  liveInboundConfirmed?: boolean;
}): WhatsAppWebSafeStatus {
  const {
    local,
    servingProcessInstanceId,
    durableLease,
    durableDiagnostics,
    nowMs,
    env = process.env,
    liveInboundConfirmed = false,
  } = input;
  const active = isLeaseRowActive(durableLease, nowMs);
  const durableOwnerMatch =
    active === true && durableLease.ownerId === servingProcessInstanceId;
  const matchedDiagnostics = diagnosticsMatchesActiveLease(
    durableDiagnostics,
    durableLease
  )
    ? durableDiagnostics
    : null;
  const buildIdentity =
    matchedDiagnostics?.buildIdentity ?? getWhatsAppWebBuildIdentity(env);

  if (durableOwnerMatch) {
    const inboundHealth = deriveWhatsAppWebInboundHealth({
      leaseOwned: true,
      socketOpen: local.socketOpen,
      inboundListenerOperational: local.inboundListenerOperational,
      liveInboundConfirmed,
      lastRawUpsertAt: liveInboundConfirmed ? local.lastRawUpsertAt : null,
      lastStoredMessageAt: liveInboundConfirmed ? local.lastInboundStoredAt : null,
      protocolEventActive:
        local.protocolReadiness.lastProtocolEventAt !== null &&
        local.protocolReadiness.protocolEventCounts["messages.upsert"] === 0,
    });
    return {
      ...local,
      // Generation-scoped: never surface predecessor live clocks as current.
      lastRawUpsertAt: liveInboundConfirmed ? local.lastRawUpsertAt : null,
      lastInboundEventAt: liveInboundConfirmed ? local.lastInboundEventAt : null,
      lastInboundStoredAt: liveInboundConfirmed
        ? local.lastInboundStoredAt
        : null,
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
        inboundHealth === "AWAITING_PROTOCOL_SYNC" ||
        inboundHealth === "CONNECTED_SOCKET" ||
        inboundHealth === "INBOUND_SILENT",
      buildIdentity,
      leaseRetryGuidance: null,
    };
  }

  // Non-owner with matched current-fence diagnostics: report owner truth.
  if (active && matchedDiagnostics) {
    const inboundHealth = deriveWhatsAppWebInboundHealth({
      leaseOwned: false,
      socketOpen: matchedDiagnostics.socketOpen,
      inboundListenerOperational:
        matchedDiagnostics.inboundListenerOperational,
      liveInboundConfirmed:
        matchedDiagnostics.inboundHealth === "LIVE_INBOUND_CONFIRMED",
      lastRawUpsertAt: matchedDiagnostics.lastRawUpsertAt,
      lastAcceptedEventAt: matchedDiagnostics.lastAcceptedEventAt,
      lastStoredMessageAt: matchedDiagnostics.lastStoredMessageAt,
      protocolEventActive: matchedDiagnostics.lastProtocolEventAt !== null &&
        (matchedDiagnostics.protocolEventCounts?.["messages.upsert"] ?? 0) === 0,
    });
    return {
      ...local,
      qrAvailable: false,
      qrExpiresAt: null,
      state: asLifecycle(matchedDiagnostics.lifecycleState, local.state),
      socketOpen: matchedDiagnostics.socketOpen,
      inboundListenerAttached: matchedDiagnostics.inboundListenerAttached,
      inboundListenerOperational:
        matchedDiagnostics.inboundListenerOperational,
      activeSocketGeneration: matchedDiagnostics.connectionGeneration,
      lastRawUpsertAt: matchedDiagnostics.lastRawUpsertAt,
      lastInboundEventAt: matchedDiagnostics.lastAcceptedEventAt,
      lastInboundStoredAt: matchedDiagnostics.lastStoredMessageAt,
      lastPersistFailureCode: matchedDiagnostics.lastFailureCode,
      lastConnectionUpdateAt: matchedDiagnostics.lastConnectionAt,
      sessionLeaseStatus: "contested",
      sessionLeaseOwnerMatch: false,
      sessionLeaseOwnerId: durableLease.ownerId.slice(0, 24),
      sessionLeaseHeartbeatAt: durableLease.heartbeatAt,
      processInstanceId: servingProcessInstanceId,
      servingProcessInstanceId,
      ownerProcessInstanceId: durableLease.ownerId,
      fencingVersion: durableLease.fencingVersion,
      durableOwnerMatch: false,
      protocolReadiness: {
        ...local.protocolReadiness,
        connectionOpenAt: matchedDiagnostics.connectionOpenAt,
        receivedPendingNotifications: matchedDiagnostics.receivedPendingNotifications,
        pendingNotificationsReceivedAt: matchedDiagnostics.pendingNotificationsReceivedAt,
        isOnline: matchedDiagnostics.isOnline,
        isNewLogin: matchedDiagnostics.isNewLogin,
        phoneConnected: matchedDiagnostics.phoneConnected,
        lastProtocolEventAt: matchedDiagnostics.lastProtocolEventAt,
        protocolEventCounts: matchedDiagnostics.protocolEventCounts != null
          ? matchedDiagnostics.protocolEventCounts as import("./whatsappWebConnectionDiagnostics.ts").WhatsAppWebProtocolEventCounts
          : local.protocolReadiness.protocolEventCounts,
      },
      inboundHealth: "LEASE_NOT_OWNED",
      listeningSilent: false,
      buildIdentity,
      safeMessage: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
      leaseRetryGuidance: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
    };
  }

  // Active foreign lease but diagnostics missing or from a predecessor fence.
  if (active) {
    return {
      ...local,
      qrAvailable: false,
      qrExpiresAt: null,
      state: "DISCONNECTED",
      socketOpen: false,
      inboundListenerAttached: false,
      inboundListenerOperational: false,
      lastRawUpsertAt: null,
      lastInboundEventAt: null,
      lastInboundStoredAt: null,
      lastPersistFailureCode: null,
      lastConnectionUpdateAt: null,
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
      buildIdentity: getWhatsAppWebBuildIdentity(env),
      safeMessage: WHATSAPP_WEB_OWNER_DIAGNOSTICS_UNAVAILABLE_MESSAGE,
      leaseRetryGuidance: WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
    };
  }

  // No active foreign lease — local view with generation-scoped health.
  const inboundHealth = deriveWhatsAppWebInboundHealth({
    leaseOwned: local.sessionLeaseOwnerMatch === true,
    socketOpen: local.socketOpen,
    inboundListenerOperational: local.inboundListenerOperational,
    liveInboundConfirmed,
    lastRawUpsertAt: liveInboundConfirmed ? local.lastRawUpsertAt : null,
    lastStoredMessageAt: liveInboundConfirmed ? local.lastInboundStoredAt : null,
    protocolEventActive:
      local.protocolReadiness.lastProtocolEventAt !== null &&
      local.protocolReadiness.protocolEventCounts["messages.upsert"] === 0,
  });
  return {
    ...local,
    lastRawUpsertAt: liveInboundConfirmed ? local.lastRawUpsertAt : null,
    lastInboundEventAt: liveInboundConfirmed ? local.lastInboundEventAt : null,
    lastInboundStoredAt: liveInboundConfirmed
      ? local.lastInboundStoredAt
      : null,
    servingProcessInstanceId,
    ownerProcessInstanceId: local.sessionLeaseOwnerId,
    fencingVersion: null,
    durableOwnerMatch: local.sessionLeaseOwnerMatch === true,
    inboundHealth,
    buildIdentity,
    leaseRetryGuidance: null,
  };
}
