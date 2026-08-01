/**
 * Atomic DB-style session lease + lease-loss enforcement concurrency tests.
 * Uses an in-memory CAS store with identical fencing semantics to SQL.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  __resetWhatsAppWebConnectionDiagnostics,
  getWhatsAppWebConnectionDiagnostics,
  noteConnectionUpdateDiagnostic,
  noteCredentialsUpdateDiagnostic,
  noteSocketCreatedDiagnostic,
  noteAuthenticatedUserJidHash,
  refreshAuthSessionIntegrity,
  WHATSAPP_WEB_LISTENING_SILENT_MS,
} from "./whatsappWebConnectionDiagnostics.ts";
import { hashOpaqueId } from "./whatsappWebProcessIdentity.ts";
import { WhatsAppWebSessionLease } from "./whatsappWebSessionLease.ts";
import {
  createInMemoryWhatsAppWebSessionLeaseStore,
  resolveWhatsAppWebSessionLeaseKey,
  __resetSharedInMemoryWhatsAppWebSessionLeaseStore,
  type WhatsAppWebSessionLeaseStore,
} from "./whatsappWebSessionLeaseStore.ts";
import { WhatsAppWebSession } from "./whatsappWebSession.ts";
import { resolveWhatsAppWebAuthPaths } from "./whatsappWebAuthDir.ts";

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-web-lease-"));
}

function noopInterval(): {
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
} {
  return {
    setIntervalFn: ((fn: () => void) =>
      1 as unknown as NodeJS.Timeout) as typeof setInterval,
    clearIntervalFn: (() => undefined) as typeof clearInterval,
  };
}

function makeLease(
  ownerId: string,
  store: WhatsAppWebSessionLeaseStore,
  opts: {
    staleMs?: number;
    onLeaseLost?: (reason: "ownership_lost" | "heartbeat_failed") => void;
    testHooks?: {
      beforeHeartbeatMutate?: () => Promise<void>;
      beforeReleaseMutate?: () => Promise<void>;
    };
  } = {}
): WhatsAppWebSessionLease {
  return new WhatsAppWebSessionLease(ownerId, {
    staleMs: opts.staleMs ?? 60_000,
    heartbeatMs: 60_000,
    store,
    ...noopInterval(),
    onLeaseLost: opts.onLeaseLost,
    testHooks: opts.testHooks,
  });
}

async function plantExpiredRow(
  store: WhatsAppWebSessionLeaseStore,
  paths: { sessionDir: string; authRoot: string },
  ownerId: string,
  timed: { nowMs: number; advance: (ms: number) => void }
): Promise<void> {
  const planter = makeLease(ownerId, store, { staleMs: 1_000 });
  await planter.acquire(paths);
  timed.advance(5_000);
}

{
  __resetWhatsAppWebConnectionDiagnostics();
  __resetSharedInMemoryWhatsAppWebSessionLeaseStore();

  // 1) Two simultaneous absent-lease acquisitions: exactly one held.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    const store = createInMemoryWhatsAppWebSessionLeaseStore();

    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const a = makeLease("owner-a", store);
    const b = makeLease("owner-b", store);

    const p1 = (async () => {
      await barrier;
      return a.acquire(paths);
    })();
    const p2 = (async () => {
      await barrier;
      return b.acquire(paths);
    })();
    releaseBarrier();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal([a, b].filter((l) => l.isHeld()).length, 1);
    assert.equal([r1, r2].filter((r) => r.status === "contested").length, 1);
    assert.equal(
      [r1, r2].filter((r) => r.status === "held" || r.status === "stale_reclaimed")
        .length,
      1
    );

    await a.release();
    await b.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 2) Two simultaneous stale-reclaim attempts: exactly one winner.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    let nowMs = Date.parse("2020-01-01T00:00:00.000Z");
    const store = createInMemoryWhatsAppWebSessionLeaseStore({
      now: () => new Date(nowMs),
    });
    await plantExpiredRow(store, paths, "dead-owner", {
      nowMs,
      advance: (ms) => {
        nowMs += ms;
      },
    });

    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const a = makeLease("reclaim-a", store, { staleMs: 1_000 });
    const b = makeLease("reclaim-b", store, { staleMs: 1_000 });

    const p1 = (async () => {
      await barrier;
      return a.acquire(paths);
    })();
    const p2 = (async () => {
      await barrier;
      return b.acquire(paths);
    })();
    releaseBarrier();
    await Promise.all([p1, p2]);

    assert.equal([a, b].filter((l) => l.isHeld()).length, 1);
    await a.release();
    await b.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 3) Heartbeat pauses after verify → replacement acquires → old beat cannot overwrite.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    let nowMs = Date.parse("2020-01-01T00:00:00.000Z");
    const store = createInMemoryWhatsAppWebSessionLeaseStore({
      now: () => new Date(nowMs),
    });

    let resumeBeat!: () => void;
    const beatPaused = new Promise<void>((resolve) => {
      resumeBeat = resolve;
    });
    let beatEnteredBarrier!: () => void;
    const atBarrier = new Promise<void>((resolve) => {
      beatEnteredBarrier = resolve;
    });

    let lost = 0;
    const oldOwner = makeLease("original", store, {
      staleMs: 1_000,
      onLeaseLost: () => {
        lost += 1;
      },
      testHooks: {
        beforeHeartbeatMutate: async () => {
          beatEnteredBarrier();
          await beatPaused;
        },
      },
    });
    await oldOwner.acquire(paths);
    const oldToken = oldOwner.__testGetFencingToken();
    const oldVersion = oldOwner.__testGetFencingVersion();
    assert.ok(oldToken);
    assert.ok(oldVersion != null);

    nowMs += 5_000;

    const beatPromise = oldOwner.__testBeatNow();
    await atBarrier;

    const replacement = makeLease("replacement", store, { staleMs: 1_000 });
    const reclaimed = await replacement.acquire(paths);
    assert.equal(replacement.isHeld(), true);
    assert.equal(reclaimed.status, "stale_reclaimed");
    const replacementToken = replacement.__testGetFencingToken();
    const replacementVersion = replacement.__testGetFencingVersion();
    assert.ok(replacementToken);
    assert.notEqual(replacementToken, oldToken);
    assert.ok((replacementVersion ?? 0) > (oldVersion ?? 0));

    resumeBeat();
    await beatPromise;
    assert.equal(oldOwner.isHeld(), false);
    assert.equal(lost, 1);

    const after = await store.read(
      resolveWhatsAppWebSessionLeaseKey(paths.sessionDir)
    );
    assert.ok(after);
    assert.equal(after.ownerToken, replacementToken);
    assert.equal(after.fencingVersion, replacementVersion);
    assert.equal(after.ownerId, "replacement");

    await replacement.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 4) Release pauses after verify → replacement acquires → old release cannot delete it.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    let nowMs = Date.parse("2020-01-01T00:00:00.000Z");
    const store = createInMemoryWhatsAppWebSessionLeaseStore({
      now: () => new Date(nowMs),
    });

    let resumeRelease!: () => void;
    const releasePaused = new Promise<void>((resolve) => {
      resumeRelease = resolve;
    });
    let releaseAtBarrier!: () => void;
    const atBarrier = new Promise<void>((resolve) => {
      releaseAtBarrier = resolve;
    });

    const original = makeLease("original-rel", store, {
      staleMs: 1_000,
      testHooks: {
        beforeReleaseMutate: async () => {
          releaseAtBarrier();
          await releasePaused;
        },
      },
    });
    await original.acquire(paths);

    nowMs += 5_000;

    const releasePromise = original.release();
    await atBarrier;

    const replacement = makeLease("replacement-rel", store, { staleMs: 1_000 });
    await replacement.acquire(paths);
    assert.equal(replacement.isHeld(), true);
    const replacementToken = replacement.__testGetFencingToken();
    const replacementVersion = replacement.__testGetFencingVersion();

    resumeRelease();
    await releasePromise;

    assert.equal(replacement.isHeld(), true);
    const after = await store.read(
      resolveWhatsAppWebSessionLeaseKey(paths.sessionDir)
    );
    assert.ok(after);
    assert.equal(after.ownerId, "replacement-rel");
    assert.equal(after.ownerToken, replacementToken);
    assert.equal(after.fencingVersion, replacementVersion);

    await replacement.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 5) In-flight heartbeat during intentional release: no late onLeaseLost / no overwrite.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    const store = createInMemoryWhatsAppWebSessionLeaseStore();

    let lostCalls = 0;
    let resumeBeat!: () => void;
    const beatPaused = new Promise<void>((resolve) => {
      resumeBeat = resolve;
    });
    let beatAtBarrier!: () => void;
    const atBarrier = new Promise<void>((resolve) => {
      beatAtBarrier = resolve;
    });

    const lease = makeLease("release-hb", store, {
      onLeaseLost: () => {
        lostCalls += 1;
      },
      testHooks: {
        beforeHeartbeatMutate: async () => {
          beatAtBarrier();
          await beatPaused;
        },
      },
    });
    await lease.acquire(paths);
    const tokenBefore = lease.__testGetFencingToken();

    const beatPromise = lease.__testBeatNow();
    await atBarrier;
    await lease.release();
    assert.equal(lease.isHeld(), false);

    resumeBeat();
    await beatPromise;
    assert.equal(lostCalls, 0);

    const next = makeLease("successor", store);
    const snap = await next.acquire(paths);
    assert.equal(snap.status, "held");
    assert.notEqual(next.__testGetFencingToken(), tokenBefore);

    await next.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 6) Repeated concurrent acquisition stress test.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    const store = createInMemoryWhatsAppWebSessionLeaseStore();

    for (let round = 0; round < 8; round += 1) {
      const leases = Array.from({ length: 6 }, (_, i) =>
        makeLease(`stress-${round}-${i}`, store)
      );
      await Promise.all(leases.map((l) => l.acquire(paths)));
      assert.equal(leases.filter((l) => l.isHeld()).length, 1);
      await Promise.all(leases.map((l) => l.release()));
    }

    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 7) Heartbeat ownership loss immediately ends the active socket.
  {
    const authDir = tmpAuthDir();
    let nowMs = Date.now();
    const store = createInMemoryWhatsAppWebSessionLeaseStore({
      now: () => new Date(nowMs),
    });
    let endCalls = 0;
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "loss-owner",
      sessionLeaseStaleMs: 1_000,
      sessionLeaseHeartbeatMs: 60_000,
      sessionLeaseStore: store,
      socketFactory: async (input) => {
        queueMicrotask(() => {
          input.onConnectionUpdate({
            connection: "open",
            userId: "923001112233@s.whatsapp.net",
          });
        });
        return {
          end: () => {
            endCalls += 1;
          },
          logout: async () => undefined,
          sendText: async () => ({ providerMessageId: "X" }),
          getUserId: () => "923001112233@s.whatsapp.net",
          getInboundListenerCount: () => 1,
        };
      },
    });

    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(session.getSafeStatus().state, "CONNECTED");
    const genBefore = session.__testGetSocketGeneration();
    const lease = session.__testGetSessionLease();
    assert.ok(lease);

    nowMs += 5_000;
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    const thief = makeLease("thief", store, { staleMs: 1_000 });
    await thief.acquire(paths);
    assert.equal(thief.isHeld(), true);

    await lease.__testBeatNow();
    assert.equal(session.getSafeStatus().state, "ERROR");
    assert.equal(session.getSafeStatus().socketOpen, false);
    assert.equal(session.getSafeStatus().inboundListenerOperational, false);
    assert.equal(session.getSafeStatus().sessionLeaseOwnerMatch, false);
    assert.equal(session.__testGetSocketGeneration() > genBefore, true);
    assert.equal(endCalls >= 1, true);
    assert.equal(session.__testIsConnectionDesired(), false);
    assert.equal(session.__testHasReconnectTimer(), false);

    await thief.release();
    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 8) Heartbeat write failure fails closed and ends the socket.
  {
    const authDir = tmpAuthDir();
    const base = createInMemoryWhatsAppWebSessionLeaseStore();
    const failingStore: WhatsAppWebSessionLeaseStore = {
      tryAcquire: (i) => base.tryAcquire(i),
      release: (i) => base.release(i),
      read: (k) => base.read(k),
      heartbeat: async () => "error",
    };
    let endCalls = 0;
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "hb-fail-owner",
      sessionLeaseStore: failingStore,
      sessionLeaseHeartbeatMs: 60_000,
      sessionLeaseStaleMs: 60_000,
      socketFactory: async (input) => {
        queueMicrotask(() => {
          input.onConnectionUpdate({
            connection: "open",
            userId: "923001112233@s.whatsapp.net",
          });
        });
        return {
          end: () => {
            endCalls += 1;
          },
          logout: async () => undefined,
          sendText: async () => ({ providerMessageId: "X" }),
          getUserId: () => "923001112233@s.whatsapp.net",
          getInboundListenerCount: () => 1,
        };
      },
    });

    await session.connect();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(session.getSafeStatus().state, "CONNECTED");

    await session.__testGetSessionLease()!.__testBeatNow();
    assert.equal(session.getSafeStatus().state, "ERROR");
    assert.equal(session.getSafeStatus().socketOpen, false);
    assert.equal(endCalls >= 1, true);
    assert.equal(session.__testIsConnectionDesired(), false);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 9) Lease loss cannot schedule reconnect.
  {
    const authDir = tmpAuthDir();
    const store = createInMemoryWhatsAppWebSessionLeaseStore();
    const scheduled: number[] = [];
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "no-reconnect",
      sessionLeaseStore: store,
      setTimeoutFn: ((fn: () => void, ms: number) => {
        scheduled.push(ms);
        return setTimeout(fn, ms);
      }) as typeof setTimeout,
      socketFactory: async (input) => {
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
    session.__testHandleLeaseLost("ownership_lost");
    assert.equal(session.getSafeStatus().state, "ERROR");
    assert.equal(session.__testIsConnectionDesired(), false);
    assert.equal(session.__testHasReconnectTimer(), false);
    const afterLoss = scheduled.length;
    await session.__testHandleConnectionUpdate({
      connection: "close",
      statusCode: 428,
    });
    assert.equal(session.getSafeStatus().reconnectScheduled, false);
    assert.equal(session.__testHasReconnectTimer(), false);
    assert.equal(scheduled.length, afterLoss);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 10) Only the winning process calls socketFactory.
  {
    const authDir = tmpAuthDir();
    const store = createInMemoryWhatsAppWebSessionLeaseStore();
    let factoryCalls = 0;
    const mk = (id: string) =>
      new WhatsAppWebSession({
        env: {
          WHATSAPP_WEB_QR_ENABLED: "true",
          WHATSAPP_WEB_AUTH_DIR: authDir,
        },
        processInstanceId: id,
        sessionLeaseStore: store,
        socketFactory: async () => {
          factoryCalls += 1;
          return {
            end: () => undefined,
            logout: async () => undefined,
            sendText: async () => ({ providerMessageId: "X" }),
            getUserId: () => null,
            getInboundListenerCount: () => 0,
          };
        },
      });

    const a = mk("win-a");
    const b = mk("win-b");
    const results = await Promise.allSettled([a.connect(), b.connect()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(factoryCalls, 1);

    await a.shutdown();
    await b.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 11) Sequential release followed by acquisition still works.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    const store = createInMemoryWhatsAppWebSessionLeaseStore();
    const a = makeLease("seq-a", store);
    const b = makeLease("seq-b", store);
    assert.equal((await a.acquire(paths)).status, "held");
    await a.release();
    assert.equal((await b.acquire(paths)).status, "held");
    await b.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 12) Diagnostics remain sanitized.
  {
    __resetWhatsAppWebConnectionDiagnostics();
    noteSocketCreatedDiagnostic();
    noteConnectionUpdateDiagnostic({ state: "open", reason: "open" });
    noteCredentialsUpdateDiagnostic();
    noteAuthenticatedUserJidHash("923001112233@s.whatsapp.net");
    const authDir = tmpAuthDir();
    await refreshAuthSessionIntegrity(
      resolveWhatsAppWebAuthPaths({ authDir }).sessionDir
    );
    const snap = getWhatsAppWebConnectionDiagnostics({
      env: { WHATSAPP_WEB_AUTH_DIR: authDir },
      lease: {
        status: "held",
        ownerMatch: true,
        ownerIdHash: hashOpaqueId("owner")!.slice(0, 24),
        fencingTokenHash: "abcdef0123456789abcdef01",
        acquiredAt: "2026-08-01T00:00:00.000Z",
        heartbeatAt: "2026-08-01T00:00:10.000Z",
      },
      connected: true,
      lastRawUpsertAt: null,
      nowMs: Date.now() + WHATSAPP_WEB_LISTENING_SILENT_MS + 1,
    });
    const blob = JSON.stringify(snap);
    assert.equal(blob.includes("923001112233"), false);
    assert.equal(blob.includes(authDir), false);
    assert.ok(snap.sessionLeaseFencingTokenHash);
    assert.equal(snap.listeningSilent, true);
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  console.log(
    "PASS: exclusive CAS session lease + lease-loss enforcement"
  );
}
