/**
 * Final acceptance: complete active fence + generation-scoped inbound health.
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
  noteInboundIgnored,
} from "./whatsappWebInboundDiagnostics.ts";
import { createInMemoryWhatsAppWebOwnerDiagnosticsStore } from "./whatsappWebOwnerDiagnosticsStore.ts";
import {
  createInMemoryWhatsAppWebSessionLeaseStore,
  resolveWhatsAppWebSessionLeaseKey,
} from "./whatsappWebSessionLeaseStore.ts";
import { WhatsAppWebSessionLease } from "./whatsappWebSessionLease.ts";
import { createWhatsAppWebRouter } from "./whatsappWebRoutes.ts";
import {
  WhatsAppWebSession,
  type WhatsAppWebSocketFactory,
} from "./whatsappWebSession.ts";
import { resolveWhatsAppWebAuthPaths } from "./whatsappWebAuthDir.ts";
import {
  diagnosticsMatchesActiveLease,
  mergeOwnerAwareSafeStatus,
  WHATSAPP_WEB_OWNER_DIAGNOSTICS_UNAVAILABLE_MESSAGE,
} from "./whatsappWebOwnerControl.ts";
import { WHATSAPP_WEB_LEASE_NOT_OWNED_CODE } from "./whatsappWebTypes.ts";

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-web-accept-"));
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
}): WhatsAppWebSocketFactory {
  return async (input) => {
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
      getInboundListenerCount: () => 1,
    };
  };
}

function makeSession(input: {
  authDir: string;
  processInstanceId: string;
  leaseStore: ReturnType<typeof createInMemoryWhatsAppWebSessionLeaseStore>;
  diagStore: ReturnType<typeof createInMemoryWhatsAppWebOwnerDiagnosticsStore>;
  socketFactory: WhatsAppWebSocketFactory;
  now?: () => Date;
  staleMs?: number;
}): WhatsAppWebSession {
  return new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: input.authDir,
      RENDER_GIT_COMMIT: "acceptbuild",
    },
    processInstanceId: input.processInstanceId,
    sessionLeaseStore: input.leaseStore,
    ownerDiagnosticsStore: input.diagStore,
    sessionLeaseHeartbeatMs: 60_000,
    sessionLeaseStaleMs: input.staleMs ?? 60_000,
    now: input.now,
    socketFactory: input.socketFactory,
  });
}

function noopInterval() {
  return {
    setIntervalFn: ((fn: () => void) =>
      1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => undefined) as typeof clearInterval,
  };
}

{
  // 1) Disconnect with no lease → 409, no cleanup.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let ended = 0;
    const session = makeSession({
      authDir,
      processInstanceId: "no-lease-disc",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory({
        onEnd: () => {
          ended += 1;
        },
      }),
    });
    session.__testSetState("DISCONNECTED", { connectionDesired: false });

    await withApp(session, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, WHATSAPP_WEB_LEASE_NOT_OWNED_CODE);
    });
    assert.equal(ended, 0);
    assert.equal(session.getSafeStatus().state, "DISCONNECTED");
    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 2) Sync with expired lease → 409, does not start sync.
  {
    let nowMs = Date.parse("2020-01-01T00:00:00.000Z");
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore({
      now: () => new Date(nowMs),
    });
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const session = makeSession({
      authDir,
      processInstanceId: "expired-sync",
      leaseStore,
      diagStore,
      staleMs: 1_000,
      now: () => new Date(nowMs),
      socketFactory: mockOpenFactory(),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    const fence = session.__testGetSessionLease()!.getFence()!;
    await leaseStore.release({
      sessionKey: fence.sessionKey,
      ownerToken: fence.ownerToken,
      fencingVersion: fence.fencingVersion,
    });
    nowMs += 5_000;

    await withApp(session, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, WHATSAPP_WEB_LEASE_NOT_OWNED_CODE);
    });
    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 3) Logout with no lease → 409, credentials preserved.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    await fsp.writeFile(
      path.join(paths.sessionDir, "creds.json"),
      JSON.stringify({ me: { id: "x" } }),
      "utf8"
    );
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const session = makeSession({
      authDir,
      processInstanceId: "no-lease-logout",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });

    await withApp(session, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: { code: string } };
      assert.equal(body.error.code, WHATSAPP_WEB_LEASE_NOT_OWNED_CODE);
    });
    assert.equal(
      fs.existsSync(path.join(paths.sessionDir, "creds.json")),
      true
    );
    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 4) Same ownerId but mismatched owner_token rejected.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const session = makeSession({
      authDir,
      processInstanceId: "token-mismatch",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    const fence = session.__testGetSessionLease()!.getFence()!;
    await leaseStore.release({
      sessionKey: fence.sessionKey,
      ownerToken: fence.ownerToken,
      fencingVersion: fence.fencingVersion,
    });
    const twin = new WhatsAppWebSessionLease("token-mismatch", {
      store: leaseStore,
      staleMs: 60_000,
      heartbeatMs: 60_000,
      ...noopInterval(),
    });
    await twin.acquire(resolveWhatsAppWebAuthPaths({ authDir }));
    assert.notEqual(twin.getFence()!.ownerToken, fence.ownerToken);

    await withApp(session, async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 409);
    });
    assert.equal(session.getSafeStatus().state, "CONNECTED");
    await twin.release();
    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 5) Same ownerId/token but mismatched fencing_version rejected.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const session = makeSession({
      authDir,
      processInstanceId: "version-mismatch",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    const fence = session.__testGetSessionLease()!.getFence()!;
    await leaseStore.release({
      sessionKey: fence.sessionKey,
      ownerToken: fence.ownerToken,
      fencingVersion: fence.fencingVersion,
    });
    const twin = new WhatsAppWebSessionLease("version-mismatch", {
      store: leaseStore,
      staleMs: 60_000,
      heartbeatMs: 60_000,
      ...noopInterval(),
    });
    await twin.acquire(resolveWhatsAppWebAuthPaths({ authDir }));
    assert.ok(twin.getFence()!.fencingVersion > fence.fencingVersion);

    let sendCalled = 0;
    (session as unknown as { socket: { sendText: Function } }).socket = {
      sendText: async () => {
        sendCalled += 1;
        return { providerMessageId: "NOPE" };
      },
    };
    await assert.rejects(
      () => session.sendText("923001112233@s.whatsapp.net", "hi"),
      (err: unknown) =>
        (err as { code?: string }).code === WHATSAPP_WEB_LEASE_NOT_OWNED_CODE
    );
    assert.equal(sendCalled, 0);
    await twin.release();
    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 6) Non-owner sendText never calls socket.sendText.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const owner = makeSession({
      authDir,
      processInstanceId: "send-owner",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    await owner.connect();
    await new Promise((r) => setTimeout(r, 20));

    let sendCalled = 0;
    const nonOwner = makeSession({
      authDir,
      processInstanceId: "send-other",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    });
    (nonOwner as unknown as { state: string }).state = "CONNECTED";
    (nonOwner as unknown as { socket: { sendText: Function } }).socket = {
      sendText: async () => {
        sendCalled += 1;
        return { providerMessageId: "BAD" };
      },
    };
    await assert.rejects(
      () => nonOwner.sendText("923001112233@s.whatsapp.net", "hi"),
      (err: unknown) =>
        (err as { code?: string }).code === WHATSAPP_WEB_LEASE_NOT_OWNED_CODE
    );
    assert.equal(sendCalled, 0);
    await owner.shutdown();
    await nonOwner.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 7) Status ignores diagnostics from preceding fence after takeover.
  {
    const sessionKey = "pred-fence-key";
    const lease = {
      sessionKey,
      ownerId: "owner-new",
      ownerToken: "tok-new",
      fencingVersion: 2,
      expiresAt: "2099-01-01T00:00:00.000Z",
      acquiredAt: "2026-08-02T01:00:00.000Z",
      heartbeatAt: "2026-08-02T01:00:00.000Z",
      pid: 1,
    };
    const predDiag = {
      sessionKey,
      ownerId: "owner-old",
      ownerToken: "tok-old",
      fencingVersion: 1,
      ownerProcessInstanceId: "owner-old",
      connectionGeneration: 9,
      lifecycleState: "CONNECTED",
      socketOpen: true,
      inboundListenerAttached: true,
      inboundListenerOperational: true,
      inboundHealth: "LIVE_INBOUND_CONFIRMED" as const,
      lastConnectionAt: "2026-08-02T00:00:00.000Z",
      lastHeartbeatAt: "2026-08-02T00:00:00.000Z",
      lastRawUpsertAt: "2026-08-02T00:00:00.000Z",
      lastAcceptedEventAt: "2026-08-02T00:00:00.000Z",
      lastStoredMessageAt: "2026-08-02T00:00:00.000Z",
      lastFailureCode: null,
      buildIdentity: "old",
      updatedAt: "2026-08-02T00:00:00.000Z",
      connectionOpenAt: null,
      receivedPendingNotifications: null,
      pendingNotificationsReceivedAt: null,
      isOnline: null,
      isNewLogin: null,
      phoneConnected: null,
      lastProtocolEventAt: null,
      protocolEventCounts: null,
    };
    assert.equal(diagnosticsMatchesActiveLease(predDiag, lease), false);
  }

  // 8) New owner without matching diagnostics does not display predecessor CONNECTED.
  {
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    const local = makeSession({
      authDir,
      processInstanceId: "status-reader",
      leaseStore,
      diagStore,
      socketFactory: mockOpenFactory(),
    }).getSafeStatus();

    const lease = {
      sessionKey: "sess-1",
      ownerId: "succ-owner",
      ownerToken: "tok-new",
      fencingVersion: 2,
      expiresAt: "2099-01-01T00:00:00.000Z",
      acquiredAt: "2026-08-02T01:00:00.000Z",
      heartbeatAt: "2026-08-02T01:00:00.000Z",
      pid: 1,
    };
    const predDiag = {
      sessionKey: "sess-1",
      ownerId: "pred-owner",
      ownerToken: "tok-old",
      fencingVersion: 1,
      ownerProcessInstanceId: "pred-owner",
      connectionGeneration: 1,
      lifecycleState: "CONNECTED",
      socketOpen: true,
      inboundListenerAttached: true,
      inboundListenerOperational: true,
      inboundHealth: "LIVE_INBOUND_CONFIRMED" as const,
      lastConnectionAt: "2026-08-02T00:00:00.000Z",
      lastHeartbeatAt: "2026-08-02T00:00:00.000Z",
      lastRawUpsertAt: "2026-08-02T00:00:00.000Z",
      lastAcceptedEventAt: "2026-08-02T00:00:00.000Z",
      lastStoredMessageAt: "2026-08-02T00:00:00.000Z",
      lastFailureCode: null,
      buildIdentity: "pred",
      updatedAt: "2026-08-02T00:00:00.000Z",
      connectionOpenAt: null,
      receivedPendingNotifications: null,
      pendingNotificationsReceivedAt: null,
      isOnline: null,
      isNewLogin: null,
      phoneConnected: null,
      lastProtocolEventAt: null,
      protocolEventCounts: null,
    };
    const merged = mergeOwnerAwareSafeStatus({
      local,
      servingProcessInstanceId: "status-reader",
      durableLease: lease,
      durableDiagnostics: predDiag,
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
    });
    assert.equal(merged.state, "DISCONNECTED");
    assert.equal(merged.socketOpen, false);
    assert.equal(merged.inboundHealth, "LEASE_NOT_OWNED");
    assert.equal(
      merged.safeMessage,
      WHATSAPP_WEB_OWNER_DIAGNOSTICS_UNAVAILABLE_MESSAGE
    );
    assert.equal(merged.lastRawUpsertAt, null);
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 9) Gen1 upsert then gen2 silent open → never LIVE_INBOUND_CONFIRMED.
  {
    __resetWhatsAppWebInboundDiagnostics();
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let opens = 0;
    const session = makeSession({
      authDir,
      processInstanceId: "gen-scope",
      leaseStore,
      diagStore,
      socketFactory: async (input) => {
        opens += 1;
        queueMicrotask(() => {
          input.onConnectionUpdate({
            connection: "open",
            userId: "923001112233@s.whatsapp.net",
          });
          if (opens === 1) {
            assert.equal(input.onRawUpsert?.(), true);
          }
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
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      (await session.getPublicStatus()).inboundHealth,
      "LIVE_INBOUND_CONFIRMED"
    );

    session.__testSetState("DISCONNECTED", { connectionDesired: true });
    (session as unknown as { socket: null }).socket = null;
    await session.connect();
    await new Promise((r) => setTimeout(r, 30));
    const status = await session.getPublicStatus();
    assert.ok(status.activeSocketGeneration >= 2);
    assert.equal(status.socketOpen, true);
    assert.notEqual(status.inboundHealth, "LIVE_INBOUND_CONFIRMED");

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 10) Stale-generation event then publish cannot promote current generation.
  {
    __resetWhatsAppWebInboundDiagnostics();
    const authDir = tmpAuthDir();
    const leaseStore = createInMemoryWhatsAppWebSessionLeaseStore();
    const diagStore = createInMemoryWhatsAppWebOwnerDiagnosticsStore();
    let capturedRaw: (() => boolean) | undefined;
    const session = makeSession({
      authDir,
      processInstanceId: "stale-promote",
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

    const staleRaw = capturedRaw;
    session.__testSetState("DISCONNECTED", { connectionDesired: true });
    (session as unknown as { socket: null }).socket = null;
    await session.connect();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(staleRaw?.(), false);
    noteInboundIgnored("stale_socket");
    await session.__testPublishOwnerDiagnostics();

    const status = await session.getPublicStatus();
    assert.notEqual(status.inboundHealth, "LIVE_INBOUND_CONFIRMED");
    const sessionKey = resolveWhatsAppWebSessionLeaseKey(
      resolveWhatsAppWebAuthPaths({ authDir }).sessionDir
    );
    const row = await diagStore.read(sessionKey);
    assert.equal(row?.lastRawUpsertAt ?? null, null);
    assert.notEqual(row?.inboundHealth, "LIVE_INBOUND_CONFIRMED");

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }
}

console.log("PASS: whatsappWebOwnerAwareAcceptance");
