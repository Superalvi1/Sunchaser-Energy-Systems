/**
 * WhatsApp Phase 1 Final Acceptance Tests.
 *
 * Section A — Socket Factory Flow
 *   Exercises the actual defaultSocketFactory event handler logic through the
 *   exported __registerDefaultSocketHandlersForTest seam (same diagnostic calls,
 *   no Baileys import required).
 *
 * Section B — SQL Store Column/Binding Verification
 *   Uses a RecordingSqlExecutor to assert SELECT/UPDATE/INSERT column sets and
 *   parameter bindings without a live database.
 *
 * Section C — Public Security
 *   Serializes getSafeStatus / mergeOwnerAwareSafeStatus output and asserts that
 *   ownerToken, owner_token, credentials, raw errors, phone numbers, and message
 *   content are all absent.
 *
 * No framework — node:assert/strict only.
 */
import assert from "node:assert/strict";
import {
  clearProtocolReadinessForNewGeneration,
  getWhatsAppWebConnectionDiagnostics,
  noteProtocolEvent,
  __resetWhatsAppWebConnectionDiagnostics,
  WHATSAPP_WEB_PROTOCOL_EVENT_NAMES,
} from "./whatsappWebConnectionDiagnostics.ts";
import {
  getWhatsAppWebInboundDiagnostics,
  __resetWhatsAppWebInboundDiagnostics,
} from "./whatsappWebInboundDiagnostics.ts";
import {
  createSqlWhatsAppWebOwnerDiagnosticsStore,
  createInMemoryWhatsAppWebOwnerDiagnosticsStore,
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore,
  type WhatsAppWebOwnerDiagnosticsFence,
  type WhatsAppWebOwnerDiagnosticsPatch,
} from "./whatsappWebOwnerDiagnosticsStore.ts";
import { mergeOwnerAwareSafeStatus } from "./whatsappWebOwnerControl.ts";
import {
  FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS,
  type WhatsAppWebSafeStatus,
} from "./whatsappWebTypes.ts";
import {
  __registerDefaultSocketHandlersForTest,
  type TestBaileysEventBus,
  type WhatsAppWebConnectionUpdate,
} from "./whatsappWebSession.ts";
import type { SqlExecutor } from "../unifiedMessaging/messagingSql.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal synchronous event bus for test event simulation. */
function makeTestBus(): TestBaileysEventBus & {
  emit(event: string, ...args: unknown[]): void;
  listenerCount(event: string): number;
} {
  const map = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(event, handler) {
      const arr = map.get(event) ?? [];
      arr.push(handler);
      map.set(event, arr);
    },
    emit(event, ...args) {
      for (const fn of map.get(event) ?? []) fn(...args);
    },
    listenerCount(event) {
      return map.get(event)?.length ?? 0;
    },
  };
}

function makeFence(
  overrides?: Partial<WhatsAppWebOwnerDiagnosticsFence>
): WhatsAppWebOwnerDiagnosticsFence {
  return {
    sessionKey: "web_qr:final:g1",
    ownerToken: "SECRET-CAS-TOKEN",
    fencingVersion: 1,
    ...overrides,
  };
}

function makePatch(
  overrides?: Partial<WhatsAppWebOwnerDiagnosticsPatch>
): WhatsAppWebOwnerDiagnosticsPatch {
  return {
    ownerProcessInstanceId: "proc-A",
    connectionGeneration: 1,
    lifecycleState: "CONNECTED",
    socketOpen: true,
    inboundListenerAttached: true,
    inboundListenerOperational: true,
    inboundHealth: "LISTENER_READY",
    lastConnectionAt: null,
    lastHeartbeatAt: null,
    lastRawUpsertAt: null,
    lastAcceptedEventAt: null,
    lastStoredMessageAt: null,
    lastFailureCode: null,
    buildIdentity: "sha-test",
    connectionOpenAt: null,
    receivedPendingNotifications: null,
    pendingNotificationsReceivedAt: null,
    isOnline: null,
    isNewLogin: null,
    phoneConnected: null,
    lastProtocolEventAt: null,
    protocolEventCounts: null,
    ...overrides,
  };
}

function makeLocalStatus(
  overrides?: Partial<WhatsAppWebSafeStatus>
): WhatsAppWebSafeStatus {
  return {
    enabled: true,
    state: "CONNECTED",
    phoneMasked: null,
    updatedAt: new Date().toISOString(),
    qrAvailable: false,
    qrExpiresAt: null,
    safeMessage: null,
    lastRawUpsertAt: null,
    lastInboundEventAt: null,
    lastInboundStoredAt: null,
    lastIgnoredAt: null,
    lastIgnoredReason: null,
    lastPersistFailureAt: null,
    lastPersistFailureCode: null,
    socketOpen: true,
    inboundListenerAttached: true,
    inboundListenerOperational: true,
    activeSocketGeneration: 1,
    activeSessionKey: "web_qr:final:g1",
    reconnectScheduled: false,
    reconnectAttemptInProgress: false,
    reconnectAttempt: 0,
    lastDisconnectClassification: null,
    credentialsAvailable: true,
    processInstanceId: "proc-A",
    processPid: 9001,
    hostHash: null,
    lastConnectionUpdateAt: null,
    lastConnectionState: null,
    lastConnectionReason: null,
    lastCredentialsUpdateAt: null,
    authenticatedUserJidHash: null,
    socketCreatedAt: null,
    sessionLeaseStatus: "owned",
    sessionLeaseOwnerMatch: true,
    sessionLeaseOwnerId: "proc-A",
    sessionLeaseFencingTokenHash: null,
    sessionLeaseAcquiredAt: null,
    sessionLeaseHeartbeatAt: null,
    credentialsFilePresent: null,
    authKeyFileCount: null,
    listeningSilent: false,
    protocolReadiness: {
      socketGeneration: 1,
      connectionOpenAt: null,
      receivedPendingNotifications: null,
      pendingNotificationsReceivedAt: null,
      isOnline: null,
      isNewLogin: null,
      phoneConnected: null,
      lastProtocolEventAt: null,
      protocolEventCounts: Object.fromEntries(
        WHATSAPP_WEB_PROTOCOL_EVENT_NAMES.map((k) => [k, 0])
      ) as never,
    },
    inboundHealth: "LISTENER_READY",
    servingProcessInstanceId: "proc-A",
    ownerProcessInstanceId: "proc-A",
    fencingVersion: 1,
    buildIdentity: null,
    durableOwnerMatch: true,
    leaseRetryGuidance: null,
    ...overrides,
  };
}

type RecordedQuery = { sql: string; params: unknown[] };

/** Mock SqlExecutor that records every query for assertion. */
function makeRecordingSqlExecutor(overrides?: {
  updateRowCount?: number;
  insertRowCount?: number;
  throwOnQuery?: boolean;
}): SqlExecutor & { queries: RecordedQuery[]; txQueries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const txQueries: RecordedQuery[] = [];
  const updateRowCount = overrides?.updateRowCount ?? 0;
  const insertRowCount = overrides?.insertRowCount ?? 1;
  const throwOnQuery = overrides?.throwOnQuery ?? false;

  return {
    queries,
    txQueries,
    async query(sql: string, params: unknown[] = []) {
      if (throwOnQuery) throw new Error("DB_INTERNAL_SECRET: connection refused");
      queries.push({ sql, params });
      // Simulate SELECT returning one row with all required columns
      return {
        rows: [
          {
            session_key: "web_qr:final:g1",
            owner_id: "proc-A",
            owner_token: "SECRET-CAS-TOKEN",
            fencing_version: 1,
            owner_process_instance_id: "proc-A",
            connection_generation: 1,
            lifecycle_state: "CONNECTED",
            socket_open: true,
            inbound_listener_attached: true,
            inbound_listener_operational: true,
            inbound_health: "LISTENER_READY",
            last_connection_at: null,
            last_heartbeat_at: null,
            last_raw_upsert_at: null,
            last_accepted_event_at: null,
            last_stored_message_at: null,
            last_failure_code: null,
            build_identity: "sha-test",
            updated_at: new Date().toISOString(),
            connection_open_at: "2026-08-03T12:00:00.000Z",
            received_pending_notifications: true,
            pending_notifications_received_at: "2026-08-03T12:00:00.000Z",
            is_online: false,
            is_new_login: false,
            phone_connected: true,
            last_protocol_event_at: "2026-08-03T12:00:01.000Z",
            protocol_event_counts: JSON.stringify({
              "connection.update": 2,
              "messages.upsert": 0,
            }),
          },
        ],
        rowCount: 1,
      };
    },
    async withTransaction(fn) {
      const tx: SqlExecutor = {
        queries: txQueries,
        txQueries: [],
        async query(sql: string, params: unknown[] = []) {
          if (throwOnQuery)
            throw new Error("DB_INTERNAL_SECRET: connection refused");
          txQueries.push({ sql, params });
          // Simulate UPDATE returning 0 rows (to trigger INSERT path)
          if (sql.trim().toUpperCase().startsWith("UPDATE")) {
            return { rows: [], rowCount: updateRowCount };
          }
          // Simulate INSERT returning 1 row
          return { rows: [{ session_key: "web_qr:final:g1" }], rowCount: insertRowCount };
        },
        async withTransaction(innerFn) {
          return innerFn(this);
        },
      } as unknown as SqlExecutor;
      return fn(tx);
    },
  } as unknown as SqlExecutor & {
    queries: RecordedQuery[];
    txQueries: RecordedQuery[];
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION A — SOCKET FACTORY FLOW
// ═════════════════════════════════════════════════════════════════════════════

// A-1: connection.update with connection="open" wires readiness into diagnostics
{
  __resetWhatsAppWebConnectionDiagnostics();
  __resetWhatsAppWebInboundDiagnostics();
  clearProtocolReadinessForNewGeneration(3);

  const bus = makeTestBus();
  const received: WhatsAppWebConnectionUpdate[] = [];
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 3,
    onConnectionUpdate: (u) => received.push(u),
  });

  bus.emit("connection.update", {
    connection: "open",
    receivedPendingNotifications: true,
    isOnline: false,
    isNewLogin: false,
    legacy: { phoneConnected: true },
  });

  const diag = getWhatsAppWebConnectionDiagnostics({});
  const pr = diag.protocolReadiness;

  assert.strictEqual(pr.socketGeneration, 3, "socketGeneration must be 3");
  assert.notStrictEqual(pr.connectionOpenAt, null, "connectionOpenAt must be set");
  assert.strictEqual(pr.receivedPendingNotifications, true, "receivedPendingNotifications");
  assert.strictEqual(pr.isOnline, false, "isOnline");
  assert.strictEqual(pr.isNewLogin, false, "isNewLogin");
  assert.strictEqual(pr.phoneConnected, true, "phoneConnected");
  assert.notStrictEqual(pr.pendingNotificationsReceivedAt, null, "pendingNotificationsReceivedAt");
  assert.strictEqual(pr.protocolEventCounts["connection.update"], 1);

  assert.strictEqual(received.length, 1, "onConnectionUpdate called once");
  assert.strictEqual(received[0].connection, "open");
  assert.strictEqual(received[0].receivedPendingNotifications, true);
  assert.strictEqual(received[0].phoneConnected, true);

  console.log("PASS A-1: connection.update open wires all readiness fields through handler");
}

// A-2: Subsequent connection.update (no connection field) propagates readiness updates
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(4);

  const bus = makeTestBus();
  const received: WhatsAppWebConnectionUpdate[] = [];
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 4,
    onConnectionUpdate: (u) => received.push(u),
  });

  // First "open"
  bus.emit("connection.update", {
    connection: "open",
    receivedPendingNotifications: false,
    isOnline: false,
  });

  // Subsequent update with pending notifications now true
  bus.emit("connection.update", {
    receivedPendingNotifications: true,
  });

  const pr = getWhatsAppWebConnectionDiagnostics({}).protocolReadiness;
  assert.strictEqual(pr.receivedPendingNotifications, true, "subsequent update must set receivedPendingNotifications");
  assert.notStrictEqual(pr.pendingNotificationsReceivedAt, null, "pendingNotificationsReceivedAt must be set");
  // connection.update was emitted twice → count = 2
  assert.strictEqual(pr.protocolEventCounts["connection.update"], 2);
  assert.strictEqual(received.length, 2, "onConnectionUpdate called for both events");
  assert.strictEqual(received[1].receivedPendingNotifications, true);

  console.log("PASS A-2: Subsequent readiness-only connection.update propagates correctly");
}

// A-3: messages.update is registered, counted, does NOT set lastRawUpsertAt
{
  __resetWhatsAppWebConnectionDiagnostics();
  __resetWhatsAppWebInboundDiagnostics();
  clearProtocolReadinessForNewGeneration(5);

  const bus = makeTestBus();
  let inboundCalls = 0;
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 5,
    onConnectionUpdate: () => {},
    onInbound: async () => {
      inboundCalls++;
    },
  });

  // Verify messages.update listener is registered before emitting
  assert.strictEqual(bus.listenerCount("messages.update"), 1, "messages.update listener must be registered");

  // Emit three messages.update events
  bus.emit("messages.update");
  bus.emit("messages.update");
  bus.emit("messages.update");

  const pr = getWhatsAppWebConnectionDiagnostics({}).protocolReadiness;
  assert.strictEqual(pr.protocolEventCounts["messages.update"], 3, "messages.update count = 3");
  assert.notStrictEqual(pr.lastProtocolEventAt, null, "lastProtocolEventAt set by messages.update");

  // Must NOT create raw upsert evidence
  const inboundDiag = getWhatsAppWebInboundDiagnostics();
  assert.strictEqual(inboundDiag.lastRawUpsertAt, null, "lastRawUpsertAt must remain null");
  assert.strictEqual(inboundCalls, 0, "onInbound must NOT be called by messages.update");

  console.log("PASS A-3: messages.update counted but creates no accepted/stored inbound evidence");
}

// A-4: messages.upsert IS counted and calls onInbound
{
  __resetWhatsAppWebConnectionDiagnostics();
  __resetWhatsAppWebInboundDiagnostics();
  clearProtocolReadinessForNewGeneration(6);

  const bus = makeTestBus();
  let inboundCalls = 0;
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 6,
    onConnectionUpdate: () => {},
    onInbound: async () => {
      inboundCalls++;
    },
  });

  bus.emit("messages.upsert", { messages: [], type: "notify" });

  const pr = getWhatsAppWebConnectionDiagnostics({}).protocolReadiness;
  assert.strictEqual(pr.protocolEventCounts["messages.upsert"], 1);
  assert.strictEqual(inboundCalls, 1, "onInbound must be called by messages.upsert");

  console.log("PASS A-4: messages.upsert counted and calls onInbound");
}

// A-5: onRawUpsert returning false drops the upsert:
//      - noteProtocolEvent is NOT called (guard fires BEFORE it)
//      - onInbound is NOT called
//      - lastRawUpsertAt remains null
{
  __resetWhatsAppWebConnectionDiagnostics();
  __resetWhatsAppWebInboundDiagnostics();
  clearProtocolReadinessForNewGeneration(7);

  const bus = makeTestBus();
  let inboundCalls = 0;
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 7,
    onConnectionUpdate: () => {},
    onRawUpsert: () => false, // stale generation guard
    onInbound: async () => {
      inboundCalls++;
    },
  });

  bus.emit("messages.upsert", { messages: [], type: "notify" });

  const pr = getWhatsAppWebConnectionDiagnostics({}).protocolReadiness;

  // Guard fires BEFORE noteProtocolEvent — stale upserts must NOT increment the count.
  assert.strictEqual(
    pr.protocolEventCounts["messages.upsert"],
    0,
    "guard fires before noteProtocolEvent: stale upsert must not be counted"
  );
  assert.strictEqual(
    pr.lastProtocolEventAt,
    null,
    "no protocol events emitted when upsert is dropped"
  );
  // onInbound must also not be called
  assert.strictEqual(inboundCalls, 0, "onInbound dropped by onRawUpsert=false");

  // lastRawUpsertAt must remain null (no noteInboundRawUpsert call)
  const inboundDiag = getWhatsAppWebInboundDiagnostics();
  assert.strictEqual(inboundDiag.lastRawUpsertAt, null, "lastRawUpsertAt must remain null");

  console.log("PASS A-5: Stale-generation guard drops upsert; noteProtocolEvent NOT called (guard-before-count ordering proven)");
}

// A-6: Stale-generation events (gen mismatch) do not overwrite current readiness
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(10);
  // Wire handlers for gen=8 (stale)
  const bus = makeTestBus();
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 8,
    onConnectionUpdate: () => {},
  });

  // Emit connection.update from stale gen=8 handlers while current gen=10
  bus.emit("connection.update", {
    connection: "open",
    receivedPendingNotifications: true,
    isOnline: true,
  });
  // Also fire protocol event with stale gen=8
  noteProtocolEvent({ eventName: "creds.update", generation: 8 });

  const pr = getWhatsAppWebConnectionDiagnostics({}).protocolReadiness;
  assert.strictEqual(pr.socketGeneration, 10, "generation must remain 10");
  assert.strictEqual(pr.receivedPendingNotifications, null, "stale gen must not overwrite readiness");
  assert.strictEqual(pr.connectionOpenAt, null, "stale gen must not set connectionOpenAt");
  assert.strictEqual(pr.protocolEventCounts["creds.update"], 0, "stale gen event must not increment count");

  console.log("PASS A-6: Stale-generation handlers cannot overwrite current-generation readiness");
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION B — SQL STORE COLUMN / BINDING VERIFICATION
// ═════════════════════════════════════════════════════════════════════════════

const EIGHT_NEW_COLUMNS = [
  "connection_open_at",
  "received_pending_notifications",
  "pending_notifications_received_at",
  "is_online",
  "is_new_login",
  "phone_connected",
  "last_protocol_event_at",
  "protocol_event_counts",
] as const;

// B-1: SELECT contains all eight new protocol readiness columns
{
  const db = makeRecordingSqlExecutor();
  const store = createSqlWhatsAppWebOwnerDiagnosticsStore(db);
  await store.read("web_qr:final:g1");

  assert.strictEqual(db.queries.length, 1, "one SELECT query");
  const sql = db.queries[0].sql;
  for (const col of EIGHT_NEW_COLUMNS) {
    assert.ok(sql.includes(col), `SELECT must include column: ${col}`);
  }

  console.log("PASS B-1: SELECT contains all eight new protocol readiness columns");
}

// B-2: UPDATE binds the eight new columns at $19–$26
{
  const db = makeRecordingSqlExecutor({ updateRowCount: 1 }); // make UPDATE succeed
  const store = createSqlWhatsAppWebOwnerDiagnosticsStore(db);
  const fence = makeFence();
  const now = "2026-08-03T13:00:00.000Z";
  const counts = { "connection.update": 3, "messages.upsert": 0 } as Record<string, number>;
  await store.write(
    fence,
    "proc-A",
    makePatch({
      connectionOpenAt: now,
      receivedPendingNotifications: true,
      pendingNotificationsReceivedAt: now,
      isOnline: false,
      isNewLogin: false,
      phoneConnected: true,
      lastProtocolEventAt: now,
      protocolEventCounts: counts,
    })
  );

  const updateQuery = db.txQueries.find((q) =>
    q.sql.trim().toUpperCase().startsWith("UPDATE")
  );
  assert.ok(updateQuery, "UPDATE query must be recorded");

  // Verify column assignments $19–$26 in SQL text
  const updateSql = updateQuery!.sql;
  assert.ok(updateSql.includes("connection_open_at = $19"), "UPDATE must set connection_open_at = $19");
  assert.ok(updateSql.includes("received_pending_notifications = $20"), "UPDATE must set $20");
  assert.ok(updateSql.includes("pending_notifications_received_at = $21"), "UPDATE must set $21");
  assert.ok(updateSql.includes("is_online = $22"), "UPDATE must set $22");
  assert.ok(updateSql.includes("is_new_login = $23"), "UPDATE must set $23");
  assert.ok(updateSql.includes("phone_connected = $24"), "UPDATE must set $24");
  assert.ok(updateSql.includes("last_protocol_event_at = $25"), "UPDATE must set $25");
  assert.ok(updateSql.includes("protocol_event_counts = $26"), "UPDATE must set $26");

  // Verify param positions 19–26 (1-indexed → array index 18–25)
  const params = updateQuery!.params;
  assert.strictEqual(params[18], now, "$19 = connectionOpenAt");
  assert.strictEqual(params[19], true, "$20 = receivedPendingNotifications");
  assert.strictEqual(params[20], now, "$21 = pendingNotificationsReceivedAt");
  assert.strictEqual(params[21], false, "$22 = isOnline");
  assert.strictEqual(params[22], false, "$23 = isNewLogin");
  assert.strictEqual(params[23], true, "$24 = phoneConnected");
  assert.strictEqual(params[24], now, "$25 = lastProtocolEventAt");
  // $26 must be JSON-serialized protocolEventCounts
  assert.strictEqual(typeof params[25], "string", "$26 must be JSON string");
  const parsed = JSON.parse(params[25] as string) as Record<string, unknown>;
  assert.strictEqual(parsed["connection.update"], 3, "$26 connection.update count");
  assert.strictEqual(parsed["messages.upsert"], 0, "$26 messages.upsert count");

  console.log("PASS B-2: UPDATE binds $19–$26 correctly and JSON-serializes protocolEventCounts");
}

// B-3: INSERT/ON CONFLICT contains all eight new columns
{
  const db = makeRecordingSqlExecutor({ updateRowCount: 0, insertRowCount: 1 });
  const store = createSqlWhatsAppWebOwnerDiagnosticsStore(db);
  const fence = makeFence();
  const now = "2026-08-03T14:00:00.000Z";
  await store.write(
    fence,
    "proc-A",
    makePatch({
      connectionOpenAt: now,
      receivedPendingNotifications: false,
      pendingNotificationsReceivedAt: null,
      isOnline: true,
      isNewLogin: false,
      phoneConnected: false,
      lastProtocolEventAt: now,
      protocolEventCounts: { "messages.upsert": 1 } as Record<string, number>,
    })
  );

  const insertQuery = db.txQueries.find((q) =>
    q.sql.trim().toUpperCase().startsWith("INSERT")
  );
  assert.ok(insertQuery, "INSERT query must be recorded");
  const insertSql = insertQuery!.sql;

  for (const col of EIGHT_NEW_COLUMNS) {
    assert.ok(insertSql.includes(col), `INSERT must include column: ${col}`);
  }
  // ON CONFLICT DO UPDATE must also reference excluded new columns
  assert.ok(
    insertSql.includes("connection_open_at = EXCLUDED.connection_open_at"),
    "ON CONFLICT must update connection_open_at"
  );
  assert.ok(
    insertSql.includes("protocol_event_counts = EXCLUDED.protocol_event_counts"),
    "ON CONFLICT must update protocol_event_counts"
  );

  // $26 in INSERT params should be JSON string
  const insertParams = insertQuery!.params;
  assert.strictEqual(typeof insertParams[25], "string", "INSERT $26 must be JSON string");
  const pc = JSON.parse(insertParams[25] as string) as Record<string, unknown>;
  assert.strictEqual(pc["messages.upsert"], 1);

  console.log("PASS B-3: INSERT/ON CONFLICT contains all eight new columns");
}

// B-4: protocolEventCounts round-trip — JSON serialized in, safeJsonCounts maps back
{
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const fence = makeFence({ fencingVersion: 99 });
  const counts: Record<string, number> = {
    "messages.upsert": 7,
    "creds.update": 3,
    "connection.update": 5,
    "contacts.upsert": 0,
  };
  await store.write(fence, "proc-A", makePatch({ protocolEventCounts: counts }));
  const row = await store.read(fence.sessionKey);
  assert.ok(row != null);
  assert.ok(row.protocolEventCounts != null, "protocolEventCounts must be non-null after round-trip");
  assert.strictEqual(row.protocolEventCounts["messages.upsert"], 7);
  assert.strictEqual(row.protocolEventCounts["creds.update"], 3);
  assert.strictEqual(row.protocolEventCounts["connection.update"], 5);

  // Ensure non-numeric values are filtered out by safeJsonCounts (simulate bad JSONB)
  // We test via the SQL path: pass a raw JSON string that contains a non-numeric
  const dbWithMixedJson = makeRecordingSqlExecutor();
  // Override the query to return malformed protocol_event_counts
  const storeSql = createSqlWhatsAppWebOwnerDiagnosticsStore({
    ...dbWithMixedJson,
    async query(_sql: string, _params: unknown[] = []) {
      return {
        rows: [
          {
            session_key: "web_qr:final:g1",
            owner_id: "proc-A",
            owner_token: "t",
            fencing_version: 1,
            owner_process_instance_id: "p",
            connection_generation: 1,
            lifecycle_state: "CONNECTED",
            socket_open: true,
            inbound_listener_attached: true,
            inbound_listener_operational: true,
            inbound_health: "LISTENER_READY",
            last_connection_at: null,
            last_heartbeat_at: null,
            last_raw_upsert_at: null,
            last_accepted_event_at: null,
            last_stored_message_at: null,
            last_failure_code: null,
            build_identity: null,
            updated_at: new Date().toISOString(),
            connection_open_at: null,
            received_pending_notifications: null,
            pending_notifications_received_at: null,
            is_online: null,
            is_new_login: null,
            phone_connected: null,
            last_protocol_event_at: null,
            // mixed: numeric and non-numeric values — non-numeric must be filtered
            protocol_event_counts: JSON.stringify({
              "messages.upsert": 4,
              badField: "not-a-number",
              anotherBad: null,
            }),
          },
        ],
        rowCount: 1,
      };
    },
    async withTransaction(fn) {
      return fn(this as unknown as SqlExecutor);
    },
  } as unknown as SqlExecutor);

  const row2 = await storeSql.read("web_qr:final:g1");
  assert.ok(row2 != null);
  assert.ok(row2.protocolEventCounts != null);
  assert.strictEqual(row2.protocolEventCounts["messages.upsert"], 4, "numeric field preserved");
  assert.ok(
    !("badField" in row2.protocolEventCounts),
    "non-numeric string field filtered by safeJsonCounts"
  );
  assert.ok(
    !("anotherBad" in row2.protocolEventCounts),
    "null field filtered by safeJsonCounts"
  );

  console.log("PASS B-4: protocolEventCounts JSON serialized in, safely mapped back, non-numeric filtered");
}

// B-5: Stale fence returns not_owner
{
  const db = makeRecordingSqlExecutor({ updateRowCount: 0, insertRowCount: 0 }); // neither UPDATE nor INSERT matches
  const store = createSqlWhatsAppWebOwnerDiagnosticsStore(db);
  const result = await store.write(
    makeFence({ ownerToken: "wrong-tok", fencingVersion: 42 }),
    "proc-A",
    makePatch()
  );
  assert.strictEqual(result, "not_owner", "stale fence must return not_owner");

  console.log("PASS B-5: Stale fence returns not_owner");
}

// B-6: SQL failure returns "error" without leaking internal error details
{
  const db = makeRecordingSqlExecutor({ throwOnQuery: true });
  const store = createSqlWhatsAppWebOwnerDiagnosticsStore(db);
  const result = await store.write(makeFence(), "proc-A", makePatch());
  assert.strictEqual(result, "error", "SQL throw must return 'error'");

  // No internal details in returned value
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("DB_INTERNAL_SECRET"), "SQL error details must not leak");
  assert.ok(!serialized.includes("connection refused"), "SQL error message must not leak");

  console.log("PASS B-6: SQL failure returns 'error' without leaking internal error details");
}

// ═════════════════════════════════════════════════════════════════════════════
// SECTION C — PUBLIC SECURITY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Checks that a serialized payload does NOT contain a field as a JSON key
 * (i.e., `"fieldName":` in the output) — prevents false positives from
 * partial substring matches like "creds" appearing inside "creds.update".
 */
function assertJsonKeyAbsent(serialized: string, key: string, label: string): void {
  assert.ok(
    !serialized.includes(`"${key}":`),
    `${label} must not contain JSON key: "${key}"`
  );
}

/**
 * Checks that a raw secret value is absent from a serialized payload.
 * Used for actual secret strings (e.g. CAS token values), not field names.
 */
function assertSecretValueAbsent(serialized: string, value: string, label: string): void {
  assert.ok(!serialized.includes(value), `${label} must not contain secret value: "${value}"`);
}

// ─── Forbidden JSON keys in public-facing payloads ────────────────────────
// These are Baileys credential/session key names that must never be surfaced.
const FORBIDDEN_PUBLIC_JSON_KEYS = [
  "ownerToken",     // CAS fencing token — only in internal durable row
  "owner_token",    // snake_case variant
  "noiseKey",
  "signedIdentityKey",
  "signedPreKey",
  "registrationId",
  "advSecretKey",
  "authState",
] as const;

// C-1: mergeOwnerAwareSafeStatus output never contains ownerToken or secrets
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const fence = makeFence({ ownerToken: "SECRET-CAS-TOKEN" });
  const now = new Date().toISOString();
  await store.write(
    fence,
    "proc-A",
    makePatch({
      connectionOpenAt: now,
      receivedPendingNotifications: true,
      isOnline: true,
      lastProtocolEventAt: now,
      protocolEventCounts: { "connection.update": 2 } as Record<string, number>,
    })
  );
  const durableRow = await store.read(fence.sessionKey);
  assert.ok(durableRow != null);

  // Verify that the INTERNAL row DOES contain ownerToken (by design for CAS fencing).
  // This is intentional — ownerToken must never reach public/browser payloads.
  assert.ok(
    "ownerToken" in durableRow,
    "internal durable row intentionally contains ownerToken (CAS fencing)"
  );
  assert.strictEqual(durableRow.ownerToken, "SECRET-CAS-TOKEN");

  // Build a durable lease matching the fence
  const durableLease = {
    sessionKey: fence.sessionKey,
    ownerId: "proc-A",
    ownerToken: fence.ownerToken,
    fencingVersion: fence.fencingVersion,
    acquiredAt: now,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    heartbeatAt: now,
    pid: 42,
  };

  const merged = mergeOwnerAwareSafeStatus({
    local: makeLocalStatus(),
    servingProcessInstanceId: "proc-A",
    durableLease,
    durableDiagnostics: durableRow,
    nowMs: Date.now(),
    liveInboundConfirmed: false,
  });

  const serialized = JSON.stringify(merged);

  // Assert forbidden JSON keys are absent
  for (const key of FORBIDDEN_PUBLIC_JSON_KEYS) {
    assertJsonKeyAbsent(serialized, key, "mergeOwnerAwareSafeStatus");
  }

  // Assert FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS keys are absent
  for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
    assertJsonKeyAbsent(serialized, field, "mergeOwnerAwareSafeStatus (browser fields)");
  }

  // Assert the actual CAS secret value is absent
  assertSecretValueAbsent(serialized, "SECRET-CAS-TOKEN", "mergeOwnerAwareSafeStatus");

  // Verify useful public fields ARE present
  assert.ok(serialized.includes('"connectionOpenAt":'), "connectionOpenAt must be in public status");
  assert.ok(serialized.includes('"receivedPendingNotifications":'), "readiness flags must be in public status");

  console.log("PASS C-1: mergeOwnerAwareSafeStatus output contains no ownerToken, secrets, or forbidden fields");
}

// C-2: getWhatsAppWebConnectionDiagnostics output never contains secrets
{
  __resetWhatsAppWebConnectionDiagnostics();
  clearProtocolReadinessForNewGeneration(20);

  const bus = makeTestBus();
  __registerDefaultSocketHandlersForTest(bus, {
    gen: 20,
    onConnectionUpdate: () => {},
  });
  bus.emit("connection.update", {
    connection: "open",
    receivedPendingNotifications: true,
    isOnline: true,
  });

  const diag = getWhatsAppWebConnectionDiagnostics({});
  const serialized = JSON.stringify(diag);

  for (const key of FORBIDDEN_PUBLIC_JSON_KEYS) {
    assertJsonKeyAbsent(serialized, key, "getWhatsAppWebConnectionDiagnostics");
  }

  // FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS must all be absent as JSON keys
  for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
    assertJsonKeyAbsent(serialized, field, "getWhatsAppWebConnectionDiagnostics (browser fields)");
  }

  // The CAS token value itself must not appear
  assertSecretValueAbsent(serialized, "SECRET-CAS-TOKEN", "getWhatsAppWebConnectionDiagnostics");

  console.log("PASS C-2: getWhatsAppWebConnectionDiagnostics output contains no secrets or forbidden fields");
}

// C-3: Non-owner mergeOwnerAwareSafeStatus path — ownerToken never surfaces
{
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const store = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
  const fence = makeFence({ ownerToken: "SECRET-CAS-TOKEN", fencingVersion: 5 });
  const now = new Date().toISOString();
  await store.write(fence, "proc-OWNER", makePatch({
    connectionOpenAt: now,
    receivedPendingNotifications: true,
    isOnline: true,
    lastProtocolEventAt: now,
    protocolEventCounts: { "contacts.upsert": 2, "messages.upsert": 0 } as Record<string, number>,
    inboundHealth: "AWAITING_PROTOCOL_SYNC",
  }));

  const durableRow = await store.read(fence.sessionKey);
  assert.ok(durableRow != null);

  const durableLease = {
    sessionKey: fence.sessionKey,
    ownerId: "proc-OWNER",
    ownerToken: fence.ownerToken,
    fencingVersion: fence.fencingVersion,
    acquiredAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    heartbeatAt: now,
    pid: 99,
  };

  // Non-owner process (proc-B) calls mergeOwnerAwareSafeStatus
  const nonOwnerMerged = mergeOwnerAwareSafeStatus({
    local: makeLocalStatus({ processInstanceId: "proc-B", sessionLeaseOwnerMatch: false }),
    servingProcessInstanceId: "proc-B",
    durableLease,
    durableDiagnostics: durableRow,
    nowMs: Date.now(),
  });

  const serialized = JSON.stringify(nonOwnerMerged);

  // ownerToken JSON key and the actual secret value must be absent
  assertJsonKeyAbsent(serialized, "ownerToken", "non-owner merged status");
  assertJsonKeyAbsent(serialized, "owner_token", "non-owner merged status");
  assertSecretValueAbsent(serialized, "SECRET-CAS-TOKEN", "non-owner merged status");

  // fencingVersion (not a secret, just a monotonic counter) is allowed
  assert.strictEqual(nonOwnerMerged.fencingVersion, 5, "fencingVersion must be 5");

  // Protocol readiness from durable row must be forwarded
  assert.strictEqual(
    nonOwnerMerged.protocolReadiness.connectionOpenAt,
    now,
    "non-owner sees durable connectionOpenAt"
  );
  assert.strictEqual(
    nonOwnerMerged.protocolReadiness.receivedPendingNotifications,
    true,
    "non-owner sees durable receivedPendingNotifications"
  );

  console.log("PASS C-3: Non-owner mergeOwnerAwareSafeStatus path never exposes ownerToken or CAS secret");
}

console.log("\nAll Phase 1 Final Acceptance Tests passed.");
