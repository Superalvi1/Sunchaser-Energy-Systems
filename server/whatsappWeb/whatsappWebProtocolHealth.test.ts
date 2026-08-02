/**
 * WhatsApp Web protocol-readiness observability tests (Phase 1).
 * 12 deterministic tests covering protocol event tracking, readiness fields,
 * generation guards, and health state derivation.
 * No framework required — node:assert/strict only.
 */
import assert from "node:assert/strict";
import {
  WHATSAPP_WEB_PROTOCOL_EVENT_NAMES,
  clearProtocolReadinessForNewGeneration,
  getWhatsAppWebConnectionDiagnostics,
  noteConnectionOpenDiagnostic,
  noteConnectionReadiness,
  noteProtocolEvent,
  __resetWhatsAppWebConnectionDiagnostics,
} from "./whatsappWebConnectionDiagnostics.ts";
import { deriveWhatsAppWebInboundHealth } from "./whatsappWebOwnerDiagnosticsStore.ts";
import { FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS } from "./whatsappWebTypes.ts";

// Test 1: Readiness fields are forwarded correctly
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteConnectionOpenDiagnostic({ generation: 1 });
  noteConnectionReadiness({
    generation: 1,
    receivedPendingNotifications: true,
    isOnline: false,
    isNewLogin: true,
    phoneConnected: true,
  });
  const d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.socketGeneration, 1);
  assert.notStrictEqual(d.protocolReadiness.connectionOpenAt, null);
  assert.strictEqual(d.protocolReadiness.receivedPendingNotifications, true);
  assert.strictEqual(d.protocolReadiness.isOnline, false);
  assert.strictEqual(d.protocolReadiness.isNewLogin, true);
  assert.strictEqual(d.protocolReadiness.phoneConnected, true);
  assert.notStrictEqual(d.protocolReadiness.pendingNotificationsReceivedAt, null);
  console.log("PASS: Readiness fields are forwarded correctly");
}

// Test 2: receivedPendingNotifications can change from null to true
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  // Initially not set — observe null
  let d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.receivedPendingNotifications, null);
  assert.strictEqual(d.protocolReadiness.pendingNotificationsReceivedAt, null);

  // Set to false
  noteConnectionReadiness({ generation: 1, receivedPendingNotifications: false });
  d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.receivedPendingNotifications, false);
  assert.strictEqual(d.protocolReadiness.pendingNotificationsReceivedAt, null);

  // Set to true
  noteConnectionReadiness({ generation: 1, receivedPendingNotifications: true });
  d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.receivedPendingNotifications, true);
  assert.notStrictEqual(d.protocolReadiness.pendingNotificationsReceivedAt, null);
  console.log("PASS: receivedPendingNotifications can change from null to true");
}

// Test 3: Each allowlisted protocol event updates its own counter
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  for (const name of WHATSAPP_WEB_PROTOCOL_EVENT_NAMES) {
    noteProtocolEvent({ eventName: name, generation: 1 });
  }
  const d = getWhatsAppWebConnectionDiagnostics({});
  for (const name of WHATSAPP_WEB_PROTOCOL_EVENT_NAMES) {
    assert.strictEqual(
      d.protocolReadiness.protocolEventCounts[name],
      1,
      `Expected count 1 for event ${name}`
    );
  }
  console.log("PASS: Each allowlisted protocol event updates its own counter");
}

// Test 4: Unknown event names cannot create unbounded diagnostic keys
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteProtocolEvent({ eventName: "unknown.event", generation: 1 });
  noteProtocolEvent({ eventName: "arbitrary", generation: 1 });
  const d = getWhatsAppWebConnectionDiagnostics({});
  // No unknown events counted — lastProtocolEventAt must be null
  assert.strictEqual(d.protocolReadiness.lastProtocolEventAt, null);
  // Only allowlisted keys exist in the counts map
  const countKeys = Object.keys(d.protocolReadiness.protocolEventCounts);
  for (const key of countKeys) {
    assert.ok(
      (WHATSAPP_WEB_PROTOCOL_EVENT_NAMES as readonly string[]).includes(key),
      `Unexpected key in protocolEventCounts: ${key}`
    );
  }
  console.log("PASS: Unknown event names cannot create unbounded diagnostic keys");
}

// Test 5: A new generation starts with empty generation-scoped protocol clocks
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteConnectionOpenDiagnostic({ generation: 1 });
  noteProtocolEvent({ eventName: "messages.upsert", generation: 1 });
  noteProtocolEvent({ eventName: "creds.update", generation: 1 });

  // Now clear for new generation
  clearProtocolReadinessForNewGeneration(2);
  const d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.socketGeneration, 2);
  assert.strictEqual(d.protocolReadiness.connectionOpenAt, null);
  assert.strictEqual(d.protocolReadiness.lastProtocolEventAt, null);
  for (const name of WHATSAPP_WEB_PROTOCOL_EVENT_NAMES) {
    assert.strictEqual(
      d.protocolReadiness.protocolEventCounts[name],
      0,
      `Expected count 0 for event ${name} after generation clear`
    );
  }
  console.log("PASS: A new generation starts with empty generation-scoped protocol clocks");
}

// Test 6: A stale-generation event cannot update current diagnostics
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(5);
  // Stale generation 4 event — must be ignored
  noteProtocolEvent({ eventName: "messages.upsert", generation: 4 });
  const d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.protocolEventCounts["messages.upsert"], 0);
  assert.strictEqual(d.protocolReadiness.lastProtocolEventAt, null);
  console.log("PASS: A stale-generation event cannot update current diagnostics");
}

// Test 7: creds.update alone reports protocol activity but not LIVE_INBOUND_CONFIRMED
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteProtocolEvent({ eventName: "creds.update", generation: 1 });
  const d = getWhatsAppWebConnectionDiagnostics({});
  const pr = d.protocolReadiness;
  const health = deriveWhatsAppWebInboundHealth({
    leaseOwned: true,
    socketOpen: true,
    inboundListenerOperational: true,
    protocolEventActive: pr.lastProtocolEventAt !== null,
  });
  assert.strictEqual(health, "AWAITING_PROTOCOL_SYNC");
  assert.notStrictEqual(health, "LIVE_INBOUND_CONFIRMED");
  console.log("PASS: creds.update alone reports protocol activity but not LIVE_INBOUND_CONFIRMED");
}

// Test 8: messages.update alone does not confirm stored inbound delivery
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteProtocolEvent({ eventName: "messages.update", generation: 1 });
  const d = getWhatsAppWebConnectionDiagnostics({});
  const pr = d.protocolReadiness;
  const health = deriveWhatsAppWebInboundHealth({
    leaseOwned: true,
    socketOpen: true,
    inboundListenerOperational: true,
    lastStoredMessageAt: null,
    protocolEventActive: pr.lastProtocolEventAt !== null,
  });
  assert.strictEqual(health, "AWAITING_PROTOCOL_SYNC");
  assert.notStrictEqual(health, "LIVE_INBOUND_CONFIRMED");
  console.log("PASS: messages.update alone does not confirm stored inbound delivery");
}

// Test 9: Current-generation messages.upsert updates raw inbound evidence
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteProtocolEvent({ eventName: "messages.upsert", generation: 1 });
  const d = getWhatsAppWebConnectionDiagnostics({});
  assert.strictEqual(d.protocolReadiness.protocolEventCounts["messages.upsert"], 1);
  assert.notStrictEqual(d.protocolReadiness.lastProtocolEventAt, null);
  console.log("PASS: Current-generation messages.upsert updates raw inbound evidence");
}

// Test 10: Only accepted/stored current-generation inbound reaches LIVE_INBOUND_CONFIRMED
{
  __resetWhatsAppWebConnectionDiagnostics();
  // With liveInboundConfirmed=true and lastStoredMessageAt set
  const healthConfirmed = deriveWhatsAppWebInboundHealth({
    leaseOwned: true,
    socketOpen: true,
    inboundListenerOperational: true,
    liveInboundConfirmed: true,
    lastStoredMessageAt: "2026-08-03T00:00:00Z",
  });
  assert.strictEqual(healthConfirmed, "LIVE_INBOUND_CONFIRMED");

  // Without live confirmation
  const healthUnconfirmed = deriveWhatsAppWebInboundHealth({
    leaseOwned: true,
    socketOpen: true,
    inboundListenerOperational: true,
    liveInboundConfirmed: false,
    lastStoredMessageAt: null,
    lastRawUpsertAt: null,
  });
  assert.notStrictEqual(healthUnconfirmed, "LIVE_INBOUND_CONFIRMED");
  console.log("PASS: Only accepted/stored current-generation inbound reaches LIVE_INBOUND_CONFIRMED");
}

// Test 11: Secrets, raw errors, message contents, and owner tokens never appear in status
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(1);
  noteConnectionOpenDiagnostic({ generation: 1 });
  noteConnectionReadiness({ generation: 1, receivedPendingNotifications: true });
  const d = getWhatsAppWebConnectionDiagnostics({});
  const serialized = JSON.stringify(d);
  for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(d, field),
      `Forbidden field "${field}" must not appear as a top-level key in diagnostics`
    );
    // Also check it doesn't appear as a JSON key (covers nested)
    const pattern = `"${field}"`;
    assert.ok(
      !serialized.includes(pattern),
      `Forbidden field key "${field}" must not appear in serialized diagnostics`
    );
  }
  console.log("PASS: Secrets, raw errors, message contents, and owner tokens never appear in status");
}

// Test 12: Existing owner-aware test marker — reset produces all-null initial readiness
{
  __resetWhatsAppWebConnectionDiagnostics();
  const d = getWhatsAppWebConnectionDiagnostics({});
  const pr = d.protocolReadiness;
  assert.strictEqual(pr.socketGeneration, null);
  assert.strictEqual(pr.connectionOpenAt, null);
  assert.strictEqual(pr.receivedPendingNotifications, null);
  assert.strictEqual(pr.pendingNotificationsReceivedAt, null);
  assert.strictEqual(pr.isOnline, null);
  assert.strictEqual(pr.isNewLogin, null);
  assert.strictEqual(pr.phoneConnected, null);
  assert.strictEqual(pr.lastProtocolEventAt, null);
  for (const name of WHATSAPP_WEB_PROTOCOL_EVENT_NAMES) {
    assert.strictEqual(
      pr.protocolEventCounts[name],
      0,
      `Expected count 0 for event ${name} after reset`
    );
  }
  console.log("PASS: Existing owner-aware test marker");
}
