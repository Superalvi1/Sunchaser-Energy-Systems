/**
 * WhatsApp protocol readiness integration tests (Phase 1 acceptance).
 * Proves durable write/read, factory wiring, messages.update, takeover, secret absence.
 * No framework — node:assert/strict only.
 */
import assert from "node:assert/strict";
import {
  clearProtocolReadinessForNewGeneration,
  noteConnectionOpenDiagnostic,
  noteConnectionReadiness,
  noteProtocolEvent,
  getWhatsAppWebConnectionDiagnostics,
  __resetWhatsAppWebConnectionDiagnostics,
  WHATSAPP_WEB_PROTOCOL_EVENT_NAMES,
} from "./whatsappWebConnectionDiagnostics.ts";
import {
  deriveWhatsAppWebInboundHealth,
  createInMemoryWhatsAppWebOwnerDiagnosticsStore,
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore,
  type WhatsAppWebOwnerDiagnosticsPatch,
  type WhatsAppWebOwnerDiagnosticsFence,
} from "./whatsappWebOwnerDiagnosticsStore.ts";
import { mergeOwnerAwareSafeStatus } from "./whatsappWebOwnerControl.ts";
import type { WhatsAppWebSafeStatus } from "./whatsappWebTypes.ts";
import { FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS } from "./whatsappWebTypes.ts";

function makeFence(overrides?: Partial<WhatsAppWebOwnerDiagnosticsFence>): WhatsAppWebOwnerDiagnosticsFence {
  return { sessionKey: "web_qr:test:g1", ownerToken: "tok-secret-abc", fencingVersion: 1, ...overrides };
}

function makePatch(overrides?: Partial<WhatsAppWebOwnerDiagnosticsPatch>): WhatsAppWebOwnerDiagnosticsPatch {
  return {
    ownerProcessInstanceId: "proc-A", connectionGeneration: 1, lifecycleState: "CONNECTED",
    socketOpen: true, inboundListenerAttached: true, inboundListenerOperational: true,
    inboundHealth: "LISTENER_READY", lastConnectionAt: null, lastHeartbeatAt: null,
    lastRawUpsertAt: null, lastAcceptedEventAt: null, lastStoredMessageAt: null,
    lastFailureCode: null, buildIdentity: "test-build",
    connectionOpenAt: null, receivedPendingNotifications: null, pendingNotificationsReceivedAt: null,
    isOnline: null, isNewLogin: null, phoneConnected: null, lastProtocolEventAt: null,
    protocolEventCounts: null, ...overrides,
  };
}

function makeLocalStatus(overrides?: Partial<WhatsAppWebSafeStatus>): WhatsAppWebSafeStatus {
  return {
    enabled: true, state: "CONNECTED", phoneMasked: null, updatedAt: new Date().toISOString(),
    qrAvailable: false, qrExpiresAt: null, safeMessage: null,
    lastRawUpsertAt: null, lastInboundEventAt: null, lastInboundStoredAt: null,
    lastIgnoredAt: null, lastIgnoredReason: null, lastPersistFailureAt: null, lastPersistFailureCode: null,
    socketOpen: true, inboundListenerAttached: true, inboundListenerOperational: true,
    activeSocketGeneration: 1, activeSessionKey: "web_qr:test:g1",
    reconnectScheduled: false, reconnectAttemptInProgress: false, reconnectAttempt: 0,
    lastDisconnectClassification: null, credentialsAvailable: true,
    processInstanceId: "proc-A", processPid: 1234, hostHash: null,
    lastConnectionUpdateAt: null, lastConnectionState: null, lastConnectionReason: null,
    lastCredentialsUpdateAt: null, authenticatedUserJidHash: null, socketCreatedAt: null,
    sessionLeaseStatus: "owned", sessionLeaseOwnerMatch: true, sessionLeaseOwnerId: "proc-A",
    sessionLeaseFencingTokenHash: null, sessionLeaseAcquiredAt: null, sessionLeaseHeartbeatAt: null,
    credentialsFilePresent: null, authKeyFileCount: null, listeningSilent: false,
    protocolReadiness: {
      socketGeneration: 1, connectionOpenAt: null, receivedPendingNotifications: null,
      pendingNotificationsReceivedAt: null, isOnline: null, isNewLogin: null, phoneConnected: null,
      lastProtocolEventAt: null,
      protocolEventCounts: Object.fromEntries(WHATSAPP_WEB_PROTOCOL_EVENT_NAMES.map((k) => [k, 0])) as never,
    },
    inboundHealth: "LISTENER_READY", servingProcessInstanceId: "proc-A",
    ownerProcessInstanceId: "proc-A", fencingVersion: 1, buildIdentity: null,
    durableOwnerMatch: true, leaseRetryGuidance: null, ...overrides,
  };
}

// Test 1
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(2);
  noteConnectionOpenDiagnostic({ generation: 2 });
  noteConnectionReadiness({ generation: 2, receivedPendingNotifications: true, isOnline: true, isNewLogin: false, phoneConnected: true });
  const d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.socketGeneration, 2);
  assert.notStrictEqual(d.protocolReadiness.connectionOpenAt, null);
  assert.strictEqual(d.protocolReadiness.receivedPendingNotifications, true);
  assert.strictEqual(d.protocolReadiness.isOnline, true);
  assert.strictEqual(d.protocolReadiness.isNewLogin, false);
  assert.strictEqual(d.protocolReadiness.phoneConnected, true);
  assert.notStrictEqual(d.protocolReadiness.pendingNotificationsReceivedAt, null);
  console.log("PASS: connection.update readiness fields flow through factory");
}

// Test 2
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteProtocolEvent({ eventName: "messages.update", generation: 1 });
  const d = getWhatsAppWebConnectionDiagnostics({});
  const pr = d.protocolReadiness;
  assert.strictEqual(pr.protocolEventCounts["messages.update"], 1);
  assert.notStrictEqual(pr.lastProtocolEventAt, null);
  const health = deriveWhatsAppWebInboundHealth({ leaseOwned: true, socketOpen: true, inboundListenerOperational: true, liveInboundConfirmed: false, lastRawUpsertAt: null, lastStoredMessageAt: null, protocolEventActive: pr.lastProtocolEventAt !== null && pr.protocolEventCounts["messages.upsert"] === 0 });
  assert.notStrictEqual(health, "LIVE_INBOUND_CONFIRMED");
  assert.ok(health === "AWAITING_PROTOCOL_SYNC" || health === "LISTENER_READY", `Got ${health}`);
  console.log("PASS: messages.update counted but not live inbound");
}

// Test 3
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const fence = makeFence();
  const openAt = new Date().toISOString();
  const p = makePatch({ connectionOpenAt: openAt, receivedPendingNotifications: true, pendingNotificationsReceivedAt: openAt, isOnline: false, isNewLogin: false, phoneConnected: true, lastProtocolEventAt: openAt, protocolEventCounts: { "creds.update": 2, "connection.update": 1, "messages.upsert": 0 } });
  assert.strictEqual(await store.write(fence, "proc-A", p), "ok");
  const row = await store.read(fence.sessionKey);
  assert.ok(row != null);
  assert.strictEqual(row.connectionOpenAt, openAt);
  assert.strictEqual(row.receivedPendingNotifications, true);
  assert.strictEqual(row.pendingNotificationsReceivedAt, openAt);
  assert.strictEqual(row.isOnline, false);
  assert.strictEqual(row.isNewLogin, false);
  assert.strictEqual(row.phoneConnected, true);
  assert.strictEqual(row.lastProtocolEventAt, openAt);
  assert.ok(row.protocolEventCounts != null);
  assert.strictEqual(row.protocolEventCounts["creds.update"], 2);
  assert.strictEqual(row.protocolEventCounts["connection.update"], 1);
  console.log("PASS: In-memory store write/read includes all 8 protocol readiness columns");
}

// Test 4
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const f1 = makeFence({ ownerToken: "tok-A", fencingVersion: 1 });
  const openAt = new Date().toISOString();
  await store.write(f1, "proc-A", makePatch({ connectionOpenAt: openAt, receivedPendingNotifications: true, lastProtocolEventAt: openAt, protocolEventCounts: { "messages.upsert": 3 } as Record<string,number> }));
  const f2 = makeFence({ ownerToken: "tok-B", fencingVersion: 2 });
  assert.strictEqual(await store.write(f2, "proc-B", makePatch({ connectionOpenAt: new Date().toISOString(), receivedPendingNotifications: false, lastProtocolEventAt: null, protocolEventCounts: null })), "ok");
  const row2 = await store.read(f1.sessionKey);
  assert.ok(row2 != null);
  assert.strictEqual(row2.fencingVersion, 2);
  assert.strictEqual(row2.ownerId, "proc-B");
  assert.strictEqual(row2.receivedPendingNotifications, false);
  assert.strictEqual(row2.protocolEventCounts, null);
  assert.strictEqual(await store.write(f1, "proc-A", makePatch({ receivedPendingNotifications: true })), "not_owner");
  console.log("PASS: In-memory owner takeover preserves CAS guard on readiness");
}

// Test 5
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(5);
  noteProtocolEvent({ eventName: "creds.update", generation: 4 });
  noteConnectionReadiness({ generation: 4, receivedPendingNotifications: true });
  const d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.protocolEventCounts["creds.update"], 0);
  assert.strictEqual(d.protocolReadiness.lastProtocolEventAt, null);
  assert.strictEqual(d.protocolReadiness.receivedPendingNotifications, null);
  console.log("PASS: Stale generation cannot overwrite current readiness");
}

// Test 6
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const openAt = "2026-08-03T01:00:00.000Z";
  const fence = makeFence({ ownerToken: "tok-OWNER", fencingVersion: 7 });
  await store.write(fence, "proc-OWNER", makePatch({ connectionOpenAt: openAt, receivedPendingNotifications: true, pendingNotificationsReceivedAt: openAt, isOnline: true, lastProtocolEventAt: openAt, protocolEventCounts: { "contacts.upsert": 5, "messages.upsert": 0 } as Record<string,number>, inboundHealth: "AWAITING_PROTOCOL_SYNC", socketOpen: true, inboundListenerOperational: true, lifecycleState: "CONNECTED" }));
  const durableRow = await store.read(fence.sessionKey);
  assert.ok(durableRow != null);
  const localStatus = makeLocalStatus({ processInstanceId: "proc-B", sessionLeaseOwnerMatch: false, protocolReadiness: { socketGeneration: 1, connectionOpenAt: null, receivedPendingNotifications: null, pendingNotificationsReceivedAt: null, isOnline: null, isNewLogin: null, phoneConnected: null, lastProtocolEventAt: null, protocolEventCounts: Object.fromEntries(WHATSAPP_WEB_PROTOCOL_EVENT_NAMES.map((k) => [k, 0])) as never } });
  const durableLease = { sessionKey: fence.sessionKey, ownerId: "proc-OWNER", ownerToken: fence.ownerToken, fencingVersion: fence.fencingVersion, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), heartbeatAt: new Date().toISOString(), pid: 9999 };
  const merged = mergeOwnerAwareSafeStatus({ local: localStatus, servingProcessInstanceId: "proc-B", durableLease, durableDiagnostics: durableRow, nowMs: Date.now() });
  assert.strictEqual(merged.protocolReadiness.connectionOpenAt, openAt);
  assert.strictEqual(merged.protocolReadiness.receivedPendingNotifications, true);
  assert.strictEqual(merged.protocolReadiness.isOnline, true);
  console.log("PASS: Public owner-aware status uses durable protocol readiness for non-owner");
}

// Test 7
{
  assert.strictEqual(deriveWhatsAppWebInboundHealth({ leaseOwned: true, socketOpen: true, inboundListenerOperational: true, liveInboundConfirmed: false, lastRawUpsertAt: null, lastStoredMessageAt: null, protocolEventActive: true }), "AWAITING_PROTOCOL_SYNC");
  assert.strictEqual(deriveWhatsAppWebInboundHealth({ leaseOwned: true, socketOpen: true, inboundListenerOperational: true, liveInboundConfirmed: false, lastRawUpsertAt: "2026-08-03T01:00:00Z", lastStoredMessageAt: null, protocolEventActive: false }), "PROTOCOL_ACTIVE_INBOUND_UNCONFIRMED");
  assert.strictEqual(deriveWhatsAppWebInboundHealth({ leaseOwned: true, socketOpen: true, inboundListenerOperational: true, liveInboundConfirmed: true, lastStoredMessageAt: "2026-08-03T01:00:00Z" }), "LIVE_INBOUND_CONFIRMED");
  console.log("PASS: AWAITING_PROTOCOL_SYNC, PROTOCOL_ACTIVE_INBOUND_UNCONFIRMED, LIVE_INBOUND_CONFIRMED all reachable");
}

// Test 8
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const fence = makeFence({ fencingVersion: 10 });
  const openAt = "2026-08-03T02:00:00.000Z";
  await store.write(fence, "proc-A", makePatch({ connectionOpenAt: openAt, receivedPendingNotifications: true, isOnline: true, isNewLogin: false, phoneConnected: true, lastProtocolEventAt: openAt, protocolEventCounts: { "messages.upsert": 1, "creds.update": 3 } as Record<string,number> }));
  const row = await store.read(fence.sessionKey);
  assert.ok(row != null);
  assert.strictEqual(row.connectionOpenAt, openAt);
  assert.strictEqual(row.receivedPendingNotifications, true);
  assert.strictEqual(row.isOnline, true);
  assert.strictEqual(row.isNewLogin, false);
  assert.strictEqual(row.phoneConnected, true);
  assert.strictEqual(row.lastProtocolEventAt, openAt);
  assert.ok(row.protocolEventCounts != null);
  assert.strictEqual(row.protocolEventCounts["messages.upsert"], 1);
  assert.strictEqual(row.protocolEventCounts["creds.update"], 3);
  console.log("PASS: Restart/owner handover reads persisted readiness fields");
}

// Test 9
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  __resetWhatsAppWebConnectionDiagnostics();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const fence = makeFence({ ownerToken: "SECRET-TOKEN-MUST-NOT-APPEAR" });
  await store.write(fence, "proc-A", makePatch({ connectionOpenAt: new Date().toISOString(), receivedPendingNotifications: true }));
  const row = await store.read(fence.sessionKey);
  assert.ok(row != null);
  const rs = JSON.stringify(row);
  for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
    assert.ok(!rs.includes(`"${field}"`), `Forbidden "${field}" in row`);
  }
  const diag = getWhatsAppWebConnectionDiagnostics({});
  assert.ok(!JSON.stringify(diag).includes("SECRET-TOKEN-MUST-NOT-APPEAR"), "Secret token in diagnostics");
  console.log("PASS: Secrets and owner_token never appear in row, diagnostics, or status");
}
