/**
 * Session lease + connection diagnostics — multi-instance ownership safety.
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
  WHATSAPP_WEB_SESSION_LEASE_FILE,
} from "./whatsappWebSessionLease.ts";
import { WhatsAppWebSession } from "./whatsappWebSession.ts";
import { resolveWhatsAppWebAuthPaths } from "./whatsappWebAuthDir.ts";

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-web-lease-"));
}

{
  __resetWhatsAppWebConnectionDiagnostics();

  // Lease: first owner wins; second process is contested.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });

    const a = new WhatsAppWebSessionLease("owner-a", {
      staleMs: 60_000,
      heartbeatMs: 60_000,
      setIntervalFn: ((fn: () => void) =>
        1 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    const b = new WhatsAppWebSessionLease("owner-b", {
      staleMs: 60_000,
      heartbeatMs: 60_000,
      setIntervalFn: ((fn: () => void) =>
        1 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });

    const first = await a.acquire(paths);
    assert.equal(first.status === "held" || first.status === "stale_reclaimed", true);
    assert.equal(a.isHeld(), true);
    assert.equal(first.ownerMatch, true);

    const second = await b.acquire(paths);
    assert.equal(second.status, "contested");
    assert.equal(b.isHeld(), false);
    assert.equal(second.ownerMatch, false);

    await a.release();
    const afterRelease = await b.acquire(paths);
    assert.equal(b.isHeld(), true);
    assert.ok(
      afterRelease.status === "held" || afterRelease.status === "stale_reclaimed"
    );

    await b.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // Stale lease can be reclaimed by a replacement process.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    const leaseFile = path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LEASE_FILE);
    await fsp.writeFile(
      leaseFile,
      JSON.stringify({
        ownerId: "dead-owner",
        acquiredAt: "2026-01-01T00:00:00.000Z",
        heartbeatAt: "2026-01-01T00:00:00.000Z",
        pid: 1,
      }),
      "utf8"
    );

    const alive = new WhatsAppWebSessionLease("alive-owner", {
      staleMs: 1,
      heartbeatMs: 60_000,
      now: () => new Date("2026-08-01T12:00:00.000Z"),
      setIntervalFn: ((fn: () => void) =>
        1 as unknown as NodeJS.Timeout) as typeof setInterval,
      clearIntervalFn: (() => undefined) as typeof clearInterval,
    });
    const snap = await alive.acquire(paths);
    assert.equal(alive.isHeld(), true);
    assert.equal(snap.status, "stale_reclaimed");
    await alive.release();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // Connection diagnostics are sanitized and support listeningSilent.
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
    await fsp.writeFile(path.join(paths.sessionDir, "app-state-sync-key-1.json"), "{}", "utf8");
    await refreshAuthSessionIntegrity(paths.sessionDir);

    const silentNow =
      Date.now() + WHATSAPP_WEB_LISTENING_SILENT_MS + 1_000;
    const diag = getWhatsAppWebConnectionDiagnostics({
      connected: true,
      lastRawUpsertAt: null,
      nowMs: silentNow,
      lease: {
        status: "held",
        ownerMatch: true,
        ownerIdHash: "owner-a",
        acquiredAt: "2026-08-01T12:00:00.000Z",
        heartbeatAt: "2026-08-01T12:00:10.000Z",
      },
    });
    assert.equal(diag.lastConnectionState, "open");
    assert.equal(diag.lastConnectionReason, "open");
    assert.ok(diag.lastCredentialsUpdateAt);
    assert.equal(
      diag.authenticatedUserJidHash,
      hashOpaqueId("923001112233@s.whatsapp.net")
    );
    assert.equal(diag.credentialsFilePresent, true);
    assert.equal(diag.authKeyFileCount, 1);
    assert.equal(diag.listeningSilent, true);
    assert.equal(diag.sessionLeaseStatus, "held");
    assert.equal(diag.sessionLeaseOwnerMatch, true);
    // Never expose raw phone/jid.
    const blob = JSON.stringify(diag);
    assert.equal(blob.includes("923001112233"), false);
    assert.equal(blob.includes("@s.whatsapp.net"), false);

    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // Session refuses to start Baileys when lease is contested.
  {
    const authDir = tmpAuthDir();
    const paths = resolveWhatsAppWebAuthPaths({ authDir });
    await fsp.mkdir(paths.sessionDir, { recursive: true });
    await fsp.writeFile(
      path.join(paths.sessionDir, WHATSAPP_WEB_SESSION_LEASE_FILE),
      JSON.stringify({
        ownerId: "other-instance",
        acquiredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        pid: 999,
      }),
      "utf8"
    );

    let factoryCalls = 0;
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      processInstanceId: "this-instance",
      sessionLeaseStaleMs: 60_000,
      sessionLeaseHeartbeatMs: 60_000,
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
      (err: { code?: string }) => {
        assert.equal(err.code, "session_lease_contested");
        return true;
      }
    );
    assert.equal(factoryCalls, 0);
    const status = session.getSafeStatus();
    assert.equal(status.state, "ERROR");
    assert.equal(status.sessionLeaseStatus, "contested");
    assert.equal(status.sessionLeaseOwnerMatch, false);
    assert.match(String(status.safeMessage), /single Render instance/i);

    await session.shutdown();
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // Owner process can connect; status exposes process/lease/connection fields.
  {
    __resetWhatsAppWebConnectionDiagnostics();
    const authDir = tmpAuthDir();
    let opened = false;
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
          opened = true;
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
    assert.equal(opened, true);
    const status = session.getSafeStatus();
    assert.equal(status.state, "CONNECTED");
    assert.equal(status.processInstanceId, "solo-instance");
    assert.equal(status.sessionLeaseOwnerMatch, true);
    assert.ok(
      status.sessionLeaseStatus === "held" ||
        status.sessionLeaseStatus === "stale_reclaimed"
    );
    assert.equal(status.lastConnectionState, "open");
    assert.equal(status.authenticatedUserJidHash, hashOpaqueId("923001112233@s.whatsapp.net"));
    assert.ok(status.socketCreatedAt);
    assert.equal(status.phoneMasked?.includes("*"), true);
    // Raw jid/phone must not appear in status JSON.
    const json = JSON.stringify(status);
    assert.equal(json.includes("923001112233@s.whatsapp.net"), false);

    await session.shutdown();
    assert.equal(session.getSafeStatus().sessionLeaseStatus, "released");
    await fsp.rm(authDir, { recursive: true, force: true });
  }
}

console.log("PASS: session ownership lease + connection diagnostics");
