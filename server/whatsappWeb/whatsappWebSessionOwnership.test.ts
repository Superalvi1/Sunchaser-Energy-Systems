/**
 * Exclusive mkdir session lease + lease-loss enforcement concurrency tests.
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
import {
  WhatsAppWebSessionLease,
  WHATSAPP_WEB_SESSION_LOCK_DIR,
  WHATSAPP_WEB_SESSION_LEASE_FILE,
} from "./whatsappWebSessionLease.ts";
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
  opts: {
    staleMs?: number;
    onLeaseLost?: (reason: "ownership_lost" | "heartbeat_failed") => void;
  } = {}
): WhatsAppWebSessionLease {
  return new WhatsAppWebSessionLease(ownerId, {
    staleMs: opts.staleMs ?? 60_000,
    heartbeatMs: 60_000,
    ...noopInterval(),
    onLeaseLost: opts.onLeaseLost,
  });
}

async function plantStaleLock(
  paths: { sessionDir: string; authRoot: string },
  ownerId = "dead-owner"
): Promise<void> {
  const lockDir = path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LOCK_DIR);
  await fsp.mkdir(lockDir, { recursive: true });
  await fsp.writeFile(
    path.join(lockDir, "owner.json"),
    JSON.stringify({
      ownerId,
      fencingToken: "stale-token-aaaaaaaa",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      heartbeatAt: "2026-01-01T00:00:00.000Z",
      pid: 1,
    }),
    "utf8"
  );
}

{
  __resetWhatsAppWebConnectionDiagnostics();

  // 1) Two simultaneous absent-lease acquisitions: exactly one held.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });

    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    const a = makeLease("owner-a");
    const b = makeLease("owner-b");

    // Gate both acquires behind the same barrier tick.
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

    const held = [a, b].filter((l) => l.isHeld());
    const contested = [r1, r2].filter((r) => r.status === "contested");
    assert.equal(held.length, 1);
    assert.equal(contested.length, 1);
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
    await plantStaleLock(paths);

    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const a = makeLease("reclaim-a", { staleMs: 1 });
    const b = makeLease("reclaim-b", { staleMs: 1 });
    // Force "now" far after stale heartbeat via Date override on each lease:
    // staleMs=1 with default now is enough if plant uses 2026-01-01... actually
    // current date is Aug 2026 so staleMs=1 means anything older than 1ms is stale.

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

  // 3) Heartbeat-versus-reclaim cannot overwrite the replacement owner.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });

    const original = makeLease("original");
    await original.acquire(paths);
    assert.equal(original.isHeld(), true);
    const originalToken = original.__testGetFencingToken();
    assert.ok(originalToken);

    // Simulate crash: stop heartbeat without release, plant stale by rewriting hb.
    const lockDir = path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LOCK_DIR);
    const metaPath = path.join(lockDir, "owner.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8")) as {
      ownerId: string;
      fencingToken: string;
      acquiredAt: string;
      heartbeatAt: string;
      pid: number;
    };
    meta.heartbeatAt = "2020-01-01T00:00:00.000Z";
    await fsp.writeFile(metaPath, JSON.stringify(meta), "utf8");

    const replacement = makeLease("replacement", { staleMs: 1 });
    const reclaimed = await replacement.acquire(paths);
    assert.equal(replacement.isHeld(), true);
    assert.equal(reclaimed.status, "stale_reclaimed");
    const replacementToken = replacement.__testGetFencingToken();
    assert.ok(replacementToken);
    assert.notEqual(replacementToken, originalToken);

    // Original heartbeat must fail closed and must not rewrite replacement meta.
    await original.__testBeatNow();
    assert.equal(original.isHeld(), false);
    const after = JSON.parse(await fsp.readFile(metaPath, "utf8")) as {
      fencingToken: string;
      ownerId: string;
    };
    assert.equal(after.fencingToken, replacementToken);
    assert.equal(after.ownerId, "replacement");

    await replacement.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 4) Release-versus-reclaim cannot delete the replacement lock.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });

    const original = makeLease("original-rel");
    await original.acquire(paths);
    const lockDir = path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LOCK_DIR);
    const metaPath = path.join(lockDir, "owner.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8")) as {
      heartbeatAt: string;
      fencingToken: string;
      ownerId: string;
      acquiredAt: string;
      pid: number;
    };
    meta.heartbeatAt = "2020-01-01T00:00:00.000Z";
    await fsp.writeFile(metaPath, JSON.stringify(meta), "utf8");

    const replacement = makeLease("replacement-rel", { staleMs: 1 });
    await replacement.acquire(paths);
    assert.equal(replacement.isHeld(), true);

    // Original release must not remove replacement's lock.
    await original.release();
    assert.equal(
      fs.existsSync(path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LOCK_DIR)),
      true
    );
    const after = JSON.parse(await fsp.readFile(metaPath, "utf8")) as {
      ownerId: string;
    };
    assert.equal(after.ownerId, "replacement-rel");
    assert.equal(replacement.isHeld(), true);

    await replacement.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 5) Repeated concurrent acquisition stress test.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });

    for (let round = 0; round < 8; round += 1) {
      const leases = Array.from({ length: 6 }, (_, i) =>
        makeLease(`stress-${round}-${i}`)
      );
      await Promise.all(leases.map((l) => l.acquire(paths)));
      const winners = leases.filter((l) => l.isHeld());
      assert.equal(winners.length, 1);
      await Promise.all(leases.map((l) => l.release()));
    }

    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 6) Heartbeat ownership loss immediately ends the active socket.
  {
    const authDir = tmpAuthDir();
    let endCalls = 0;
    let factoryCalls = 0;
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "loss-owner",
      sessionLeaseStaleMs: 60_000,
      sessionLeaseHeartbeatMs: 60_000,
      socketFactory: async (input) => {
        factoryCalls += 1;
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
    assert.equal(session.getSafeStatus().socketOpen, true);
    const genBefore = session.__testGetSocketGeneration();

    // Steal lock under the held lease, then beat.
    const lease = session.__testGetSessionLease();
    assert.ok(lease);
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    const lockDir = path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LOCK_DIR);
    await fsp.writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({
        ownerId: "thief",
        fencingToken: "stolen-token-bbbbbbbb",
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        pid: 2,
      }),
      "utf8"
    );
    await lease.__testBeatNow();

    assert.equal(session.getSafeStatus().state, "ERROR");
    assert.equal(session.getSafeStatus().socketOpen, false);
    assert.equal(session.getSafeStatus().inboundListenerOperational, false);
    assert.equal(session.getSafeStatus().sessionLeaseOwnerMatch, false);
    assert.ok(session.__testGetSocketGeneration() > genBefore);
    assert.ok(endCalls >= 1);
    assert.equal(session.__testIsConnectionDesired(), false);
    assert.equal(session.__testHasReconnectTimer(), false);
    assert.equal(factoryCalls, 1);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 7) Heartbeat write failure fails closed and ends the socket.
  {
    const authDir = tmpAuthDir();
    let endCalls = 0;
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "hb-fail-owner",
      sessionLeaseStaleMs: 60_000,
      sessionLeaseHeartbeatMs: 60_000,
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

    // Remove lock dir so heartbeat write/read fails closed.
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.rm(path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LOCK_DIR), {
      recursive: true,
      force: true,
    });
    await session.__testGetSessionLease()!.__testBeatNow();

    assert.equal(session.getSafeStatus().state, "ERROR");
    assert.equal(session.getSafeStatus().socketOpen, false);
    assert.ok(endCalls >= 1);
    assert.equal(session.__testHasReconnectTimer(), false);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 8) Lease loss cannot schedule reconnect.
  {
    const authDir = tmpAuthDir();
    const scheduled: number[] = [];
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "no-reconnect",
      reconnectDelaysMs: [5],
      setTimeoutFn: ((fn: () => void, ms: number) => {
        scheduled.push(ms);
        return 1 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
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
    // No new reconnect timer after lease loss.
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

  // 9) Only the winning process calls socketFactory.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });

    // Pre-hold lease as foreign owner.
    const holder = makeLease("foreign-holder");
    await holder.acquire(paths);
    assert.equal(holder.isHeld(), true);

    let factoryCalls = 0;
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "loser-instance",
      sessionLeaseStaleMs: 60_000,
      socketFactory: async () => {
        factoryCalls += 1;
        return {
          end: () => undefined,
          logout: async () => undefined,
          sendText: async () => ({ providerMessageId: "X" }),
        };
      },
    });

    await assert.rejects(
      () => session.connect(),
      (err: { code?: string }) => err.code === "session_lease_contested"
    );
    assert.equal(factoryCalls, 0);
    assert.equal(session.getSafeStatus().sessionLeaseStatus, "contested");

    await session.shutdown();
    await holder.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 10) Sequential release followed by acquisition still works.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    const a = makeLease("seq-a");
    const b = makeLease("seq-b");
    assert.equal((await a.acquire(paths)).ownerMatch, true);
    await a.release();
    assert.equal((await b.acquire(paths)).ownerMatch, true);
    assert.equal(a.isHeld(), false);
    assert.equal(b.isHeld(), true);
    await b.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // 11) Diagnostics remain sanitized + listeningSilent.
  {
    __resetWhatsAppWebConnectionDiagnostics();
    noteSocketCreatedDiagnostic();
    noteConnectionUpdateDiagnostic({ state: "open", reason: "open" });
    noteCredentialsUpdateDiagnostic();
    noteAuthenticatedUserJidHash("923001112233@s.whatsapp.net");
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    await fsp.writeFile(path.join(paths.sessionDir, "creds.json"), "{}", "utf8");
    await fsp.writeFile(
      path.join(paths.sessionDir, "app-state-sync-key-1.json"),
      "{}",
      "utf8"
    );
    await refreshAuthSessionIntegrity(paths.sessionDir);

    const diag = getWhatsAppWebConnectionDiagnostics({
      connected: true,
      lastRawUpsertAt: null,
      nowMs: Date.now() + WHATSAPP_WEB_LISTENING_SILENT_MS + 1000,
      lease: {
        status: "held",
        ownerMatch: true,
        ownerIdHash: "owner-a",
        fencingTokenHash: "fence-aaaa",
        acquiredAt: "2026-08-01T12:00:00.000Z",
        heartbeatAt: "2026-08-01T12:00:10.000Z",
      },
    });
    assert.equal(diag.listeningSilent, true);
    assert.equal(
      diag.authenticatedUserJidHash,
      hashOpaqueId("923001112233@s.whatsapp.net")
    );
    const blob = JSON.stringify(diag);
    assert.equal(blob.includes("923001112233"), false);
    assert.equal(blob.includes("@s.whatsapp.net"), false);
    assert.equal(blob.includes(WHATSAPP_WEB_SESSION_LEASE_FILE), false);

    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // Owner process can connect; status exposes process/lease fields.
  {
    __resetWhatsAppWebConnectionDiagnostics();
    const authDir = tmpAuthDir();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "solo-instance",
      sessionLeaseStaleMs: 60_000,
      sessionLeaseHeartbeatMs: 60_000,
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
    const status = session.getSafeStatus();
    assert.equal(status.state, "CONNECTED");
    assert.equal(status.processInstanceId, "solo-instance");
    assert.equal(status.sessionLeaseOwnerMatch, true);
    assert.ok(status.sessionLeaseFencingTokenHash);
    assert.ok(
      fs.existsSync(
        path.join(
          resolveWhatsAppWebAuthPaths({ authDir }).sessionDir,
          WHATSAPP_WEB_SESSION_LOCK_DIR
        )
      )
    );
    const json = JSON.stringify(status);
    assert.equal(json.includes("923001112233@s.whatsapp.net"), false);

    await session.shutdown();
    assert.equal(session.getSafeStatus().sessionLeaseStatus, "released");
    await fsp.rm(authDir, { recursive: true, force: true });
  }
}

console.log(
  "PASS: exclusive mkdir session lease + lease-loss enforcement"
);
