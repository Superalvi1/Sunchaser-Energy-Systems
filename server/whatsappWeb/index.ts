export {
  WHATSAPP_WEB_QR_FLAG,
  WHATSAPP_WEB_AUTH_DIR_ENV,
  WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  WHATSAPP_WEB_QR_CONNECTION_ID,
  WHATSAPP_WEB_AUTH_DIR_PRODUCTION_DEFAULT,
  readWhatsAppWebConfig,
  assertWhatsAppWebAuthDirReady,
} from "./whatsappWebConfig.ts";

export {
  maskPhoneNumber,
  FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS,
  WHATSAPP_WEB_LIFECYCLE_STATES,
  type WhatsAppWebLifecycleState,
  type WhatsAppWebSafeStatus,
  type WhatsAppWebQrPayload,
} from "./whatsappWebTypes.ts";

export {
  resolveWhatsAppWebAuthPaths,
  assertPathInsideRoot,
  ensureWhatsAppWebAuthDirWritable,
  deleteWhatsAppWebSessionDir,
  hasSavedBaileysCredentials,
} from "./whatsappWebAuthDir.ts";

export {
  WhatsAppWebSession,
  getSharedWhatsAppWebSession,
  __resetSharedWhatsAppWebSession,
  classifyDisconnect,
  classifyDisconnectDiagnostic,
  buildConnectionClosedDiagnostic,
  sanitizeDisconnectStatusCode,
  reconnectDelayMs,
  terminalDisconnectSafeMessage,
  WHATSAPP_WEB_LIVE_UPSERT_TYPES,
  WHATSAPP_WEB_RECONNECT_DELAYS_MS,
  attachTrackedMessagesUpsertListener,
  type WhatsAppWebSocketFactory,
  type WhatsAppWebInboundHandler,
  type WhatsAppWebBaileysUpsertEventBus,
  type TrackedMessagesUpsertBinding,
  type DisconnectDiagnosticClassification,
} from "./whatsappWebSession.ts";

export {
  normalizeBaileysInbound,
  jidToWaId,
  waIdToChatJid,
} from "./whatsappWebNormalize.ts";

export {
  collectLidJid,
  resolveWhatsAppIdentity,
  WhatsAppLidPhoneMap,
} from "./whatsappWebIdentity.ts";

export {
  getSharedWhatsAppLidPhoneMap,
  __resetSharedWhatsAppLidPhoneMap,
} from "./whatsappWebSharedLidMap.ts";

export {
  getWhatsAppWebInboundDiagnostics,
  __resetWhatsAppWebInboundDiagnostics,
  clearWhatsAppWebInboundLiveTimestamps,
} from "./whatsappWebInboundDiagnostics.ts";

export {
  getWhatsAppWebConnectionDiagnostics,
  __resetWhatsAppWebConnectionDiagnostics,
  noteConnectionUpdateDiagnostic,
  noteCredentialsUpdateDiagnostic,
  WHATSAPP_WEB_LISTENING_SILENT_MS,
} from "./whatsappWebConnectionDiagnostics.ts";

export {
  getWhatsAppWebProcessInstanceId,
  hashOpaqueId,
} from "./whatsappWebProcessIdentity.ts";

export {
  WhatsAppWebSessionLease,
  WHATSAPP_WEB_SESSION_LOCK_DIR,
  WHATSAPP_WEB_SESSION_LEASE_FILE,
  WHATSAPP_WEB_SESSION_LEASE_STALE_MS,
} from "./whatsappWebSessionLease.ts";
export {
  createInMemoryWhatsAppWebSessionLeaseStore,
  createSqlWhatsAppWebSessionLeaseStore,
  resolveWhatsAppWebSessionLeaseKey,
  WHATSAPP_WEB_SESSION_LEASE_TABLE,
} from "./whatsappWebSessionLeaseStore.ts";
export {
  createInMemoryWhatsAppWebOwnerDiagnosticsStore,
  deriveWhatsAppWebInboundHealth,
  getWhatsAppWebBuildIdentity,
  WHATSAPP_WEB_INBOUND_HEALTH_STATES,
  WHATSAPP_WEB_OWNER_DIAGNOSTICS_TABLE,
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore,
} from "./whatsappWebOwnerDiagnosticsStore.ts";
export {
  resolveDefaultWhatsAppWebOwnerDiagnosticsStore,
  tryCreateWhatsAppWebOwnerDiagnosticsSqlStore,
} from "./whatsappWebOwnerDiagnosticsSql.ts";
export {
  createLeaseNotOwnedError,
  isLeaseRowActive,
  mergeOwnerAwareSafeStatus,
  diagnosticsMatchesActiveLease,
  WHATSAPP_WEB_OWNER_DIAGNOSTICS_UNAVAILABLE_MESSAGE,
} from "./whatsappWebOwnerControl.ts";
export {
  WHATSAPP_WEB_LEASE_NOT_OWNED_CODE,
  WHATSAPP_WEB_LEASE_NOT_OWNED_MESSAGE,
} from "./whatsappWebTypes.ts";

export {
  persistWhatsAppWebInbound,
  createWhatsAppWebMessagingBridge,
} from "./whatsappWebInbound.ts";

export {
  sendWhatsAppWebPlainText,
  isWhatsAppWebQrChannel,
} from "./whatsappWebOutbound.ts";

export { createWhatsAppWebTransportAdapter } from "./whatsappWebTransportAdapter.ts";
export {
  createWhatsAppWebRouter,
  requireWhatsAppWebAdmin,
  WHATSAPP_WEB_ADMIN_ROUTES,
} from "./whatsappWebRoutes.ts";
export {
  canManageWhatsAppWebQr,
  isWhatsAppWebAdminRole,
  WHATSAPP_WEB_ADMIN_ROLES,
} from "./whatsappWebPermissions.ts";
export {
  createWhatsAppWebRateLimit,
  resetWhatsAppWebRateLimitStore,
} from "./whatsappWebRateLimit.ts";

export {
  WHATSAPP_WEB_SYNC_WINDOW_DAYS,
  resolveWhatsAppDisplayName,
  shouldApplyWhatsAppContactName,
  isEligibleSyncChat,
  isEligibleSyncContact,
  type WhatsAppWebSyncJobSnapshot,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";
export { WhatsAppWebHistorySyncService } from "./whatsappWebHistorySync.ts";
export {
  persistWhatsAppWebBackfillMessage,
  syncWhatsAppWebContact,
  isBackfillMetadata,
  WHATSAPP_WEB_BACKFILL_SOURCE,
} from "./whatsappWebHistoryPersist.ts";
export {
  BaileysInMemorySyncSource,
  type BaileysHistorySetPayload,
} from "./whatsappWebBaileysSyncSource.ts";
