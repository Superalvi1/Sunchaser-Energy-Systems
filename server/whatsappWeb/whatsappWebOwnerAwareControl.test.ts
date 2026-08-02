/**
 * Owner-aware WhatsApp control + durable diagnostics regression tests.
 * Covers HTTP 409 non-owner gates, CAS diagnostic fencing, and inbound health.
 */
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import type { RequestActor } from "../middleware/actor.ts";
import {
  __resetWhatsAppWebInboundDiagnostics,
  getWhatsAppWebInboundDiagnostics,
  noteInboundEventReceived,
  noteInboundRawUpsert,
  noteInboundStored,
} from "./whatsappWebInboundDiagnostics.ts";
import { __resetWhatsAppWebConnectionDiagnostics } from "./whatsappWebConnectionDiagnostics.ts";
import {
  createInMemoryWhatsAppWebOwnerDiagnosticsStore,
  deriveWhatsAppWebInboundHealth,
  __resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore,
} from "./whatsappWebOwnerDiagnosticsStore.ts";
import {
  createInMemoryWhatsAppWebSessionLeaseStore,
  resolveWhatsAppWebSessionLeaseKey,
  __resetSharedInMemoryWhatsAppWebSessionLeaseStore,
} from "./whatsappWebSessionLeaseStore.ts";
import { createWhatsAppWebRouter } from "./whatsappWebRoutes.ts";
import {
  attachTrackedMessagesUpsertListener,
  WhatsAppWebSession,
  type WhatsAppWebBaileysUpsertEventBus,
  type WhatsAppWebSocketFactory,
} from "./whatsappWebSession.ts";
import { WHATSAPP_WEB_LEASE_NOT_OWNED_CODE } from "./whatsappWebTypes.ts";
import { resolveWhatsAppWebAuthPaths } from "./whatsappWebAuthDir.ts";

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-web-owner-aware-"));
}

function adminActor(): RequestActor {
  return {
    id: "admin-1",
    username: "admin",
    name: "Admin",
    email: "admin@example.com",
    role: "Admin",
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

async function withApp(
  session: WhatsAppWebSession,
  run: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: RequestActor }).actor = adminActor();
    next();
  });
  app.use("/api/whatsapp-web", createWhatsAppWebRouter({ session }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

function mockOpenFactory(opts?: {
  onEnd?: () => void;
  onFactory?: () => void;
  listenerCount?: number;
}): WhatsAppWebSocketFactory {
  return async (input) => {
    opts?.onFactory?.();
    queueMicrotask(() => {
      input.onConnectionUpdate({
        connection: "open",
        userId: "923001112233@s.whatsapp.net",
      });
    });
    return {
      end: () => {
        opts?.onEnd?.();
      },
      logout: async () => undefined,
      sendText: async () => ({ providerMessageId: "X" }),
      getUserId: () => "923001112233@s.whatsapp.net",
      getInboundListenerCount: () => opts?.listenerCount ?? 1,
    };
  };
}

function makeSession(input: {
  authDir: string;
  processInstanceId: string;
  leaseStore: ReturnType<typeof createInMemoryWhatsAppWebSessionLeaseStore>;
  diagStore: ReturnType<typeof createInMemoryWhatsAppWebOwnerDiagnosticsStore>;
  socketFactory: WhatsAppWebSocketFactory;
}): WhatsAppWebSession {
  return new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: input.authDir,
      RENDER_GIT_COMMIT: "testbuild123",
    },
    processInstanceId: input.processInstanceId,
    sessionLeaseStore: input.leaseStore,
    ownerDiagnosticsStore: input.diagStore,
    sessionLeaseHeartbeatMs: 60_000,
    sessionLeaseStaleMs: 60_000,
    socketFactory: input.socketFactory,
  });
}

__resetWhatsAppWebInboundDiagnostics();
__resetWhatsAppWebConnectionDiagnostics();
__resetSharedInMemoryWhatsAppWebSessionLeaseStore();
__resetSharedInMemoryWhatsAppWebOwnerDiagnosticsStore();

{
  // 1) HTTP connect reaches a non-owner: 409, no socketFactory.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let factoryCalls = 0;

    const owner = makeSession({
      authDir,
      processInstanceId: "owner-a",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory({
        onFactory: () => {
          factoryCalls += 1;
        },
      }),
    });
    await owner.connect();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(owner.getSafeStatus().state, "CONNECTED");
    const ownerCalls = factoryCalls;

    const nonOwner = makeSession({
      authDir,
      processInstanceId: "owner-b",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory({
        onFactory: () => {
          factoryCalls += 1;
        },
      }),
    });

    await withApp(nonOwner, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as {
        success: false;
        error: { code: string; details?: { sessionLeaseOwnerMatch?: boolean } };
      };
      assert.equal(body.error.code, WHATSAPP_WEB_LEASE_NOT_OWNED_CODE);
      assert.equal(body.error.details?.sessionLeaseOwnerMatch, false);
      assert.equal(JSON.stringify(body).includes("owner_token"), false);
    });
    assert.equal(factoryCalls, ownerCalls);

    await owner.shutdown();
    await nonOwner.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 2) Disconnect reaches a non-owner: 409; owner socket stays up.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let ownerEnded = 0;

    const owner = makeSession({
      authDir,
      processInstanceId: "disc-owner",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory({
        onEnd: () => {
          ownerEnded += 1;
        },
      }),
    });
    await owner.connect();
    await new Promise((r) => setTimeout(r, 20));
    const beforeEnds = ownerEnded;

    const nonOwner = makeSession({
      authDir,
      processInstanceId: "disc-other",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });

    await withApp(nonOwner, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, WHATSAPP_WEB_LEASE_NOT_OWNED_CODE);
    });

    assert.equal(owner.getSafeStatus().state, "CONNECTED");
    assert.equal(ownerEnded, beforeEnds);
    const sessionKey = resolveWhatsAppWebSessionLeaseKey(
      resolveWhatsAppWebAuthPaths({ authDir }).sessionDir
    );
    const lease = await leaseStore.read(sessionKey);
    assert.ok(lease);
    assert.equal(lease.ownerId, "disc-owner");

    await owner.shutdown();
    await nonOwner.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 3) Sync reaches a non-owner: 409, no sync.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const owner = makeSession({
      authDir,
      processInstanceId: "sync-owner",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    await owner.connect();
    await new Promise((r) => setTimeout(r, 20));

    const nonOwner = makeSession({
      authDir,
      processInstanceId: "sync-other",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });

    await withApp(nonOwner, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, WHATSAPP_WEB_LEASE_NOT_OWNED_CODE);
    });

    await owner.shutdown();
    await nonOwner.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 4) Diagnostics on non-owner returns durable owner view.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const owner = makeSession({
      authDir,
      processInstanceId: "status-owner",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    await owner.connect();
    await new Promise((r) => setTimeout(r, 20));
    await owner.__testPublishOwnerDiagnostics();

    const nonOwner = makeSession({
      authDir,
      processInstanceId: "status-other",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });

    await withApp(nonOwner, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/status`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        data: {
          servingProcessInstanceId: string;
          ownerProcessInstanceId: string | null;
          durableOwnerMatch: boolean;
          inboundHealth: string;
          sessionLeaseOwnerMatch: boolean;
          state: string;
        };
      };
      assert.equal(body.data.servingProcessInstanceId, "status-other");
      assert.equal(body.data.ownerProcessInstanceId, "status-owner");
      assert.equal(body.data.durableOwnerMatch, false);
      assert.equal(body.data.sessionLeaseOwnerMatch, false);
      assert.equal(body.data.inboundHealth, "LEASE_NOT_OWNED");
      assert.equal(body.data.state, "CONNECTED");
    });

    await owner.shutdown();
    await nonOwner.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 5) Old owner diagnostic update after takeover affects zero rows.
  {
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const sessionKey = "diag-takeover-key";
    const write1 = await diagStore.write(
      { sessionKey, ownerToken: "tok-a", fencingVersion: 1 },
      "owner-a",
      {
        ownerProcessInstanceId: "owner-a",
        connectionGeneration: 1,
        lifecycleState: "CONNECTED",
        socketOpen: true,
        inboundListenerAttached: true,
        inboundListenerOperational: true,
        inboundHealth: "LISTENER_READY",
        lastConnectionAt: "2026-08-02T00:00:00.000Z",
        lastHeartbeatAt: "2026-08-02T00:00:00.000Z",
        lastRawUpsertAt: null,
        lastAcceptedEventAt: null,
        lastStoredMessageAt: null,
        lastFailureCode: null,
        buildIdentity: "build-a",
        connectionOpenAt: null,
        receivedPendingNotifications: null,
        pendingNotificationsReceivedAt: null,
        isOnline: null,
        isNewLogin: null,
        phoneConnected: null,
        lastProtocolEventAt: null,
        protocolEventCounts: null,
      }
    );
    assert.equal(write1, "ok");

    const write2 = await diagStore.write(
      { sessionKey, ownerToken: "tok-b", fencingVersion: 2 },
      "owner-b",
      {
        ownerProcessInstanceId: "owner-b",
        connectionGeneration: 2,
        lifecycleState: "CONNECTED",
        socketOpen: true,
        inboundListenerAttached: true,
        inboundListenerOperational: true,
        inboundHealth: "LISTENER_READY",
        lastConnectionAt: "2026-08-02T00:01:00.000Z",
        lastHeartbeatAt: "2026-08-02T00:01:00.000Z",
        lastRawUpsertAt: null,
        lastAcceptedEventAt: null,
        lastStoredMessageAt: null,
        lastFailureCode: null,
        buildIdentity: "build-b",
        connectionOpenAt: null,
        receivedPendingNotifications: null,
        pendingNotificationsReceivedAt: null,
        isOnline: null,
        isNewLogin: null,
        phoneConnected: null,
        lastProtocolEventAt: null,
        protocolEventCounts: null,
      }
    );
    assert.equal(write2, "ok");

    const stale = await diagStore.write(
      { sessionKey, ownerToken: "tok-a", fencingVersion: 1 },
      "owner-a",
      {
        ownerProcessInstanceId: "owner-a",
        connectionGeneration: 99,
        lifecycleState: "ERROR",
        socketOpen: false,
        inboundListenerAttached: false,
        inboundListenerOperational: false,
        inboundHealth: "INBOUND_SILENT",
        lastConnectionAt: "2026-08-02T00:02:00.000Z",
        lastHeartbeatAt: "2026-08-02T00:02:00.000Z",
        lastRawUpsertAt: "2026-08-02T00:02:00.000Z",
        lastAcceptedEventAt: null,
        lastStoredMessageAt: null,
        lastFailureCode: "should_not_land",
        buildIdentity: "stale",
        connectionOpenAt: null,
        receivedPendingNotifications: null,
        pendingNotificationsReceivedAt: null,
        isOnline: null,
        isNewLogin: null,
        phoneConnected: null,
        lastProtocolEventAt: null,
        protocolEventCounts: null,
      }
    );
    assert.equal(stale, "not_owner");
    const row = await diagStore.read(sessionKey);
    assert.ok(row);
    assert.equal(row.ownerId, "owner-b");
    assert.equal(row.fencingVersion, 2);
    assert.equal(row.buildIdentity, "build-b");
    assert.equal(row.lastFailureCode, null);
  }

  // 6) Old socket cleanup after successor connects keeps successor listener.
  {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const ev: WhatsAppWebBaileysUpsertEventBus & {
      emit: (event: string, payload: unknown) => void;
    } = {
      on(event, listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener as (...args: unknown[]) => void);
      },
      off(event, listener) {
        listeners.get(event)?.delete(listener as (...args: unknown[]) => void);
      },
      emit(event, payload) {
        for (const l of listeners.get(event) ?? []) l(payload);
      },
    };

    let gen1Hits = 0;
    let gen2Hits = 0;
    const b1 = attachTrackedMessagesUpsertListener(
      ev,
      () => {
        gen1Hits += 1;
      },
      1
    );
    const b2 = attachTrackedMessagesUpsertListener(
      ev,
      () => {
        gen2Hits += 1;
      },
      2
    );
    b1.detach();
    ev.emit("messages.upsert", { type: "notify", messages: [] });
    assert.equal(gen1Hits, 0);
    assert.equal(gen2Hits, 1);
    assert.equal(b2.getInboundListenerCount(), 1);
    b2.detach();
  }

  // 7) messages.upsert on stale generation ignored without current diagnostics change.
  {
    __resetWhatsAppWebInboundDiagnostics();
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let capturedRaw: (() => boolean) | undefined;
    const session = makeSession({
      authDir,
      processInstanceId: "stale-gen",
      leaseStore,
      diagStore,
      socketFactory: async (input) => {
        capturedRaw = input.onRawUpsert;
        queueMicrotask(() => {
          input.onConnectionUpdate({
            connection: "open",
            userId: "923001112233@s.whatsapp.net",
          });
        });
        return {
          end: () => undefined,
          logout: async () => undefined,
          sendText: async () => ({ providerMessageId: "X" }),
          getUserId: () => "923001112233@s.whatsapp.net",
          getInboundListenerCount: () => 1,
        };
      },
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    noteInboundRawUpsert();
    const before = getWhatsAppWebInboundDiagnostics().lastRawUpsertAt;
    (session as unknown as { socketGeneration: number }).socketGeneration += 1;
    assert.equal(capturedRaw?.(), false);
    assert.equal(getWhatsAppWebInboundDiagnostics().lastRawUpsertAt, before);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 8) Current owner generation upsert updates raw/accepted/stored timestamps.
  {
    __resetWhatsAppWebInboundDiagnostics();
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const session = makeSession({
      authDir,
      processInstanceId: "live-upsert",
      leaseStore,
      diagStore,
      socketFactory: async (input) => {
        queueMicrotask(() => {
          input.onConnectionUpdate({
            connection: "open",
            userId: "923001112233@s.whatsapp.net",
          });
          assert.equal(input.onRawUpsert?.(), true);
          void input.onInbound({
            providerMessageId: "MSG1",
            remoteJid: "923009998877@s.whatsapp.net",
            fromMe: false,
            text: "hello",
            pushName: null,
            occurredAt: new Date().toISOString(),
            isGroup: false,
            isStatusOrNewsletter: false,
            rawType: "conversation",
            remoteJidAlt: null,
            participant: null,
            participantAlt: null,
            senderPn: null,
            senderLid: null,
            participantPn: null,
            participantLid: null,
          });
        });
        return {
          end: () => undefined,
          logout: async () => undefined,
          sendText: async () => ({ providerMessageId: "X" }),
          getUserId: () => "923001112233@s.whatsapp.net",
          getInboundListenerCount: () => 1,
        };
      },
    });
    session.setInboundHandler(async () => {
      noteInboundEventReceived();
      noteInboundStored();
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 30));
    const inbound = getWhatsAppWebInboundDiagnostics();
    assert.ok(inbound.lastRawUpsertAt);
    assert.ok(inbound.lastInboundEventAt);
    assert.ok(inbound.lastInboundStoredAt);
    await session.__testPublishOwnerDiagnostics();
    const sessionKey = resolveWhatsAppWebSessionLeaseKey(
      resolveWhatsAppWebAuthPaths({ authDir }).sessionDir
    );
    const row = await diagStore.read(sessionKey);
    assert.ok(row?.lastRawUpsertAt);
    assert.ok(row?.lastAcceptedEventAt);
    assert.ok(row?.lastStoredMessageAt);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 9) Simulated Render overlap: exactly one socketFactory + one active listener.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let factoryCalls = 0;
    const mk = (id: string) =>
      makeSession({
        authDir,
        processInstanceId: id,
        leaseStore,
        diagStore,
        socketFactory: mockOpenFactory({
          onFactory: () => {
            factoryCalls += 1;
          },
        }),
      });
    const a = mk("overlap-a");
    const b = mk("overlap-b");
    const results = await Promise.allSettled([a.connect(), b.connect()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(factoryCalls, 1);
    const winner =
      a.getSafeStatus().state === "CONNECTED"
        ? a
        : b.getSafeStatus().state === "CONNECTED"
          ? b
          : null;
    assert.ok(winner);
    assert.equal(winner.getSafeStatus().inboundListenerOperational, true);

    await a.shutdown();
    await b.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 10) Open socket with no inbound event is not LIVE_INBOUND_CONFIRMED.
  {
    __resetWhatsAppWebInboundDiagnostics();
    assert.equal(
      deriveWhatsAppWebInboundHealth({
        leaseOwned: true,
        socketOpen: true,
        inboundListenerOperational: true,
        lastRawUpsertAt: null,
        lastAcceptedEventAt: null,
        lastStoredMessageAt: null,
      }),
      "LISTENER_READY"
    );
    assert.notEqual(
      deriveWhatsAppWebInboundHealth({
        leaseOwned: true,
        socketOpen: true,
        inboundListenerOperational: true,
        lastRawUpsertAt: null,
      }),
      "LIVE_INBOUND_CONFIRMED"
    );

    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const session = makeSession({
      authDir,
      processInstanceId: "silent-open",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    const status = await session.getPublicStatus();
    assert.equal(status.socketOpen, true);
    assert.equal(status.inboundListenerOperational, true);
    assert.equal(status.inboundHealth, "LISTENER_READY");
    assert.notEqual(status.inboundHealth, "LIVE_INBOUND_CONFIRMED");

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }
}

console.log("PASS: whatsappWebOwnerAwareControl");
