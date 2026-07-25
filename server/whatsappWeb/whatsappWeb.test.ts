/**
 * WhatsApp Web QR (Baileys) — unit tests with injectable socket factory.
 * Does not scan a real QR or send a real WhatsApp message.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import express from "express";
import {
  assertPathInsideRoot,
  deleteWhatsAppWebSessionDir,
  ensureWhatsAppWebAuthDirWritable,
  resolveWhatsAppWebAuthPaths,
} from "./whatsappWebAuthDir.ts";
import {
  readWhatsAppWebConfig,
  WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  WHATSAPP_WEB_SESSION_DIR_NAME,
} from "./whatsappWebConfig.ts";
import {
  jidToWaId,
  normalizeBaileysInbound,
  waIdToChatJid,
} from "./whatsappWebNormalize.ts";
import {
  createWhatsAppWebMessagingBridge,
  persistWhatsAppWebInbound,
} from "./whatsappWebInbound.ts";
import {
  createWhatsAppWebRouter,
  WHATSAPP_WEB_ADMIN_ROUTES,
  type WhatsAppWebRouterDeps,
} from "./whatsappWebRoutes.ts";
import { canManageWhatsAppWebQr } from "./whatsappWebPermissions.ts";
import {
  WhatsAppWebSession,
  classifyDisconnect,
  classifyDisconnectDiagnostic,
  buildConnectionClosedDiagnostic,
  reconnectDelayMs,
  WHATSAPP_WEB_RECONNECT_DELAYS_MS,
  type WhatsAppWebSocketFactory,
} from "./whatsappWebSession.ts";
import { logWhatsAppWeb } from "./whatsappWebLog.ts";
import {
  FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS,
  maskPhoneNumber,
} from "./whatsappWebTypes.ts";
import { InMemoryWhatsAppRepository } from "../whatsappTransport/whatsappRepository.ts";
import { isWhatsAppWebQrChannel } from "./whatsappWebOutbound.ts";
import { sendWhatsAppWebPlainText } from "./whatsappWebOutbound.ts";
import type { RequestActor } from "../middleware/actor.ts";

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-web-auth-"));
}

function staffActor(opts: {
  role?: string;
  accountStatus?: string;
  id?: string;
} = {}): RequestActor {
  return {
    id: opts.id ?? "staff-1",
    username: "staff",
    name: "Staff",
    email: "staff@example.com",
    role: opts.role ?? "Admin",
    accountStatus: opts.accountStatus ?? "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

/** Backward-compatible helper used by earlier tests. */
function adminActor(role: string = "Admin"): RequestActor {
  return staffActor({ role, accountStatus: "Approved" });
}

async function withApp(
  session: WhatsAppWebSession,
  actor: RequestActor | null,
  run: (base: string) => Promise<void>,
  routerDeps: Omit<WhatsAppWebRouterDeps, "session"> = {}
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: RequestActor | null }).actor = actor;
    next();
  });
  app.use(
    "/api/whatsapp-web",
    createWhatsAppWebRouter({ session, ...routerDeps })
  );
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

function assertNoSensitiveLeak(payload: unknown): void {
  const json = JSON.stringify(payload);
  for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
    assert.equal(json.includes(`"${field}"`), false, field);
  }
  assert.equal(/\bcreds\b|\bnoiseKey\b/i.test(json), false);
  assert.equal(json.includes("data:image/png"), false);
}

function mockSocketFactory(opts?: {
  qr?: string;
  openOnStart?: boolean;
  providerMessageId?: string;
  failSend?: boolean;
  userId?: string | null;
  onEnd?: () => void;
}): WhatsAppWebSocketFactory {
  return async (input) => {
    if (opts?.qr) {
      queueMicrotask(() => input.onQr(opts.qr!));
    }
    if (opts?.openOnStart) {
      queueMicrotask(() =>
        input.onConnectionUpdate({
          connection: "open",
          userId: opts.userId ?? "923001112233:1@s.whatsapp.net",
        })
      );
    }
    return {
      getUserId: () => opts?.userId ?? "923001112233:1@s.whatsapp.net",
      end: () => {
        opts?.onEnd?.();
      },
      logout: async () => undefined,
      sendText: async () => {
        if (opts?.failSend) throw new Error("send failed");
        return { providerMessageId: opts?.providerMessageId ?? "BAILEYS_MSG_1" };
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Config / feature flag
// ---------------------------------------------------------------------------

{
  const cfg = readWhatsAppWebConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.authDir, null);
}

{
  const cfg = readWhatsAppWebConfig({
    WHATSAPP_WEB_QR_ENABLED: "true",
    WHATSAPP_WEB_AUTH_DIR: "/tmp/wa-auth-test",
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.authDir, "/tmp/wa-auth-test");
}

{
  const cfg = readWhatsAppWebConfig({
    NODE_ENV: "production",
    WHATSAPP_WEB_QR_ENABLED: "false",
  });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.authDir, "/var/data/whatsapp-web-auth");
}

console.log("PASS: feature-flag-off defaults");

// ---------------------------------------------------------------------------
// Auth directory containment
// ---------------------------------------------------------------------------

{
  const root = tmpAuthDir();
  const paths = resolveWhatsAppWebAuthPaths({ authDir: root });
  assert.equal(path.basename(paths.sessionDir), WHATSAPP_WEB_SESSION_DIR_NAME);
  assertPathInsideRoot(paths.sessionDir, paths.authRoot);
  await ensureWhatsAppWebAuthDirWritable(paths);
  await fsp.writeFile(path.join(paths.sessionDir, "creds.json"), "{}", "utf8");
  const del = await deleteWhatsAppWebSessionDir(paths);
  assert.equal(del.deleted, true);
  assert.equal(fs.existsSync(paths.sessionDir), false);
  // Root remains
  assert.equal(fs.existsSync(paths.authRoot), true);

  assert.throws(() => {
    assertPathInsideRoot(path.join(root, "..", "escape"), root);
  });
  await fsp.rm(root, { recursive: true, force: true });
}

console.log("PASS: auth-directory containment + logout delete");

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

{
  const ok = normalizeBaileysInbound({
    providerMessageId: "MSG1",
    remoteJid: "923001112233@s.whatsapp.net",
    fromMe: false,
    text: "Hello",
    pushName: "Ali",
    occurredAt: new Date().toISOString(),
    isGroup: false,
    isStatusOrNewsletter: false,
    rawType: "conversation",
  });
  assert.equal(ok.kind, "accept");
  if (ok.kind === "accept") {
    assert.equal(ok.event.waMessageId, "MSG1");
    assert.equal(ok.event.fromWaId, "923001112233");
    assert.equal(ok.event.phoneNumberId, WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID);
  }

  assert.equal(
    normalizeBaileysInbound({
      providerMessageId: "M",
      remoteJid: "x@g.us",
      fromMe: false,
      text: "g",
      pushName: null,
      occurredAt: new Date().toISOString(),
      isGroup: true,
      isStatusOrNewsletter: false,
      rawType: null,
    }).kind,
    "ignore"
  );
  assert.equal(
    normalizeBaileysInbound({
      providerMessageId: "M",
      remoteJid: "status@broadcast",
      fromMe: false,
      text: "s",
      pushName: null,
      occurredAt: new Date().toISOString(),
      isGroup: false,
      isStatusOrNewsletter: true,
      rawType: null,
    }).kind,
    "ignore"
  );
  assert.equal(
    normalizeBaileysInbound({
      providerMessageId: "M",
      remoteJid: "92300@s.whatsapp.net",
      fromMe: true,
      text: "me",
      pushName: null,
      occurredAt: new Date().toISOString(),
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: null,
    }).kind,
    "ignore"
  );
  assert.equal(jidToWaId("923001112233@s.whatsapp.net"), "923001112233");
  assert.equal(waIdToChatJid("923001112233"), "923001112233@s.whatsapp.net");
  assert.equal(isWhatsAppWebQrChannel(WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID), true);
  assert.equal(isWhatsAppWebQrChannel("meta-phone"), false);
}

console.log("PASS: inbound normalization + fromMe/group/status ignored");

// ---------------------------------------------------------------------------
// Inbound persist + provider-id dedupe
// ---------------------------------------------------------------------------

{
  const repo = new InMemoryWhatsAppRepository();
  const msg = {
    providerMessageId: "DEDUP_1",
    remoteJid: "923009998877@s.whatsapp.net",
    fromMe: false,
    text: "Quote please",
    pushName: "Customer",
    occurredAt: new Date().toISOString(),
    isGroup: false,
    isStatusOrNewsletter: false,
    rawType: "conversation",
  };
  const first = await persistWhatsAppWebInbound(msg, { repo });
  assert.equal(first.kind, "stored");
  if (first.kind === "stored") assert.equal(first.created, true);
  const second = await persistWhatsAppWebInbound(msg, { repo });
  assert.equal(second.kind, "stored");
  if (second.kind === "stored") assert.equal(second.created, false);

  const ignored = await persistWhatsAppWebInbound(
    { ...msg, fromMe: true, providerMessageId: "DEDUP_ME" },
    { repo }
  );
  assert.equal(ignored.kind, "ignored");
}

console.log("PASS: inbound persist + provider-id deduplication");

// ---------------------------------------------------------------------------
// QR lifecycle / expiry / reconnect / logout
// ---------------------------------------------------------------------------

{
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({ qr: "otp-payload-for-qr" }),
    qrTtlMs: 50,
  });

  // Flag-off path on a different session
  const disabled = new WhatsAppWebSession({
    env: { WHATSAPP_WEB_QR_ENABLED: "false" },
  });
  await assert.rejects(() => disabled.connect(), (err: { code?: string }) => {
    assert.equal(err.code, "feature_disabled");
    return true;
  });

  const status = await session.connect();
  // Allow QR microtask
  await new Promise((r) => setTimeout(r, 20));
  const afterQr = session.getSafeStatus();
  assert.equal(afterQr.state, "QR_READY");
  assert.equal(afterQr.qrAvailable, true);
  const qr = await session.getQrPayload();
  assert.ok(qr?.qrDataUrl?.startsWith("data:image/png"));
  // No credential fields on status/qr
  for (const payload of [afterQr, qr]) {
    const json = JSON.stringify(payload);
    for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
      assert.equal(json.includes(`"${field}"`), false, field);
    }
  }

  // Expiry
  await new Promise((r) => setTimeout(r, 60));
  const expired = session.getSafeStatus();
  assert.equal(expired.qrAvailable, false);

  // Reconnect scheduling via connection close
  session.__testSetState("CONNECTED", { phoneRaw: "923001112233" });
  // Simulate factory reconnect path: disconnect keeps session
  await session.disconnect();
  assert.equal(session.getSafeStatus().state, "DISCONNECTED");

  // Logout deletes session dir
  await fsp.mkdir(path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME, "creds.json"),
    "{}",
    "utf8"
  );
  await session.logout();
  assert.equal(session.getSafeStatus().state, "LOGGED_OUT");
  assert.equal(
    fs.existsSync(path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME)),
    false
  );

  // Multiple socket start protection
  const locking = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: async (input) => {
      await new Promise((r) => setTimeout(r, 80));
      input.onQr("slow-qr");
      return mockSocketFactory({})(input);
    },
  });
  const p1 = locking.connect();
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(() => locking.connect(), (err: { code?: string }) => {
    assert.equal(err.code, "start_in_progress");
    return true;
  });
  await p1;

  await session.shutdown();
  await locking.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: QR lifecycle, expiry, reconnect, logout, start mutex");

// ---------------------------------------------------------------------------
// Admin authorization + no credential exposure on API
// ---------------------------------------------------------------------------

{
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({ qr: "api-qr" }),
  });

  await withApp(session, null, async (base) => {
    const res = await fetch(`${base}/api/whatsapp-web/status`);
    assert.equal(res.status, 401);
  });

  await withApp(session, adminActor("Sales Manager"), async (base) => {
    const res = await fetch(`${base}/api/whatsapp-web/status`);
    assert.equal(res.status, 403);
  });

  await withApp(session, adminActor("Admin"), async (base) => {
    const statusRes = await fetch(`${base}/api/whatsapp-web/status`);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.headers.get("cache-control"), "no-store");
    const statusBody = (await statusRes.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    assert.equal(statusBody.success, true);
    const json = JSON.stringify(statusBody);
    for (const field of FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS) {
      assert.equal(json.includes(`"${field}"`), false, field);
    }

    const connectRes = await fetch(`${base}/api/whatsapp-web/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(connectRes.status, 200);
    await new Promise((r) => setTimeout(r, 30));
    const qrRes = await fetch(`${base}/api/whatsapp-web/qr`);
    assert.equal(qrRes.status, 200);
    assert.equal(qrRes.headers.get("cache-control"), "no-store");
    const qrBody = await qrRes.json();
    assert.equal(
      JSON.stringify(qrBody).includes("creds"),
      false
    );

    const logoutRes = await fetch(`${base}/api/whatsapp-web/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(logoutRes.status, 200);
  });

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: Admin authorization + Cache-Control + no credential exposure");

// ---------------------------------------------------------------------------
// Outbound provider-ID confirmation
// ---------------------------------------------------------------------------

{
  const authDir = tmpAuthDir();
  const repo = new InMemoryWhatsAppRepository();
  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId: WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  });
  const contact = await repo.resolveOrCreateContact({
    phoneE164: "923001234567",
    profileName: "Buyer",
  });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });

  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({
      openOnStart: true,
      providerMessageId: "OUT_PROVIDER_99",
    }),
  });
  await session.connect();
  await new Promise((r) => setTimeout(r, 30));
  session.__testSetState("CONNECTED", { phoneRaw: "923009998877" });
  // Ensure socket present for send
  (session as unknown as { socket: { sendText: Function } }).socket = {
    sendText: async () => ({ providerMessageId: "OUT_PROVIDER_99" }),
  };
  (session as unknown as { state: string }).state = "CONNECTED";

  const result = await sendWhatsAppWebPlainText(conversation.id, "Hello from CRM", {
    repo,
    session,
    actor: adminActor("Admin"),
  });
  assert.equal(result.httpStatus, 201);
  if (result.httpStatus === 201) {
    assert.equal(result.providerMessageId, "OUT_PROVIDER_99");
    assert.ok(result.messageId);
  }

  // Uncertain / failed send does not invent success
  (session as unknown as { socket: { sendText: Function } }).socket = {
    sendText: async () => {
      throw new Error("network");
    },
  };
  const failed = await sendWhatsAppWebPlainText(conversation.id, "Retry?", {
    repo,
    session,
    actor: adminActor("Admin"),
  });
  assert.equal(failed.httpStatus, 502);

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: outbound provider-ID confirmation");

// ---------------------------------------------------------------------------
// Meta package remains present; Baileys is allowed only outside unifiedMessaging
// ---------------------------------------------------------------------------

{
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
  ) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies["@whiskeysockets/baileys"], "6.7.23");
  assert.equal(pkg.dependencies["whatsapp-web.js"], undefined);
  const contractDir = path.join(process.cwd(), "server/unifiedMessaging");
  for (const file of fs.readdirSync(contractDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = fs.readFileSync(path.join(contractDir, file), "utf8");
    assert.equal(src.includes("@whiskeysockets/baileys"), false, file);
  }
}

console.log("PASS: Baileys pinned; Meta/unifiedMessaging isolation");

// ---------------------------------------------------------------------------
// QR-1A — reconnect lifecycle hardening
// ---------------------------------------------------------------------------

{
  assert.equal(classifyDisconnect(401), "logged_out");
  assert.equal(classifyDisconnect(500), "terminal");
  assert.equal(classifyDisconnect(440), "terminal");
  assert.equal(classifyDisconnect(403), "terminal");
  assert.equal(classifyDisconnect(411), "terminal");
  assert.equal(classifyDisconnect(428), "retryable");
  assert.equal(classifyDisconnect(408), "retryable");
  assert.equal(classifyDisconnect(undefined), "retryable");

  assert.equal(reconnectDelayMs(0), 2_000);
  assert.equal(reconnectDelayMs(1), 5_000);
  assert.equal(reconnectDelayMs(2), 10_000);
  assert.equal(reconnectDelayMs(3), 30_000);
  assert.equal(reconnectDelayMs(4), 60_000);
  assert.equal(reconnectDelayMs(99), 60_000);
  assert.equal(
    WHATSAPP_WEB_RECONNECT_DELAYS_MS[WHATSAPP_WEB_RECONNECT_DELAYS_MS.length - 1],
    60_000
  );
}

console.log("PASS: disconnect classification + capped reconnect delays");

{
  const authDir = tmpAuthDir();
  const scheduled: Array<{ ms: number; fn: () => void }> = [];
  let socketStarts = 0;

  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    reconnectDelaysMs: [0, 0, 0, 0, 0],
    setTimeoutFn: ((fn: () => void, ms: number) => {
      scheduled.push({ ms, fn: fn as () => void });
      return scheduled.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: ((handle: NodeJS.Timeout) => {
      const idx = (handle as unknown as number) - 1;
      if (idx >= 0 && idx < scheduled.length) scheduled[idx]!.fn = () => undefined;
    }) as typeof clearTimeout,
    socketFactory: async (input) => {
      socketStarts += 1;
      return {
        end: () => undefined,
        logout: async () => undefined,
        sendText: async () => ({ providerMessageId: "X" }),
        getUserId: () => "923001112233@s.whatsapp.net",
      };
    },
  });

  await session.connect();
  assert.equal(session.__testIsConnectionDesired(), true);

  // Temporary close → schedule reconnect
  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 428,
  });
  assert.equal(session.getSafeStatus().state, "RECONNECTING");
  assert.equal(session.__testHasReconnectTimer(), true);
  assert.equal(session.__testGetScheduledReconnectDelays().length, 1);

  // Only one timer — second schedule while timer pending is a no-op
  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 408,
  });
  assert.equal(session.__testGetScheduledReconnectDelays().length, 1);

  // Flush first timer → another socket start + may schedule again on failure path
  const first = scheduled[0]!;
  first.fn();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(socketStarts >= 2);

  // Manual disconnect never reconnects
  await session.disconnect();
  assert.equal(session.__testIsConnectionDesired(), false);
  const delaysAfterDisconnect = session.__testGetScheduledReconnectDelays().length;
  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 428,
  });
  assert.equal(session.getSafeStatus().state, "DISCONNECTED");
  assert.equal(
    session.__testGetScheduledReconnectDelays().length,
    delaysAfterDisconnect
  );
  assert.equal(session.__testHasReconnectTimer(), false);

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: manual disconnect never reconnects; single reconnect timer");

{
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    reconnectDelaysMs: [0, 0, 0],
    setTimeoutFn: ((fn: () => void) => {
      // Do not auto-run — prove logout cancels without scheduling
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    socketFactory: mockSocketFactory({ openOnStart: true }),
  });

  await session.connect();
  await new Promise((r) => setTimeout(r, 20));
  await fsp.mkdir(path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME, "creds.json"),
    '{"noiseKey":true}',
    "utf8"
  );
  await session.logout();
  assert.equal(session.__testIsConnectionDesired(), false);
  assert.equal(session.__testHasReconnectTimer(), false);
  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 428,
  });
  assert.equal(session.getSafeStatus().state, "LOGGED_OUT");
  assert.equal(session.__testHasReconnectTimer(), false);

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: logout never schedules reconnect");

{
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    reconnectDelaysMs: [0],
    setTimeoutFn: ((fn: () => void) => {
      queueMicrotask(fn);
      return 1 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    socketFactory: mockSocketFactory({}),
  });

  await session.connect();
  session.__testSetState("CONNECTED", {
    connectionDesired: true,
    phoneRaw: "923001112233",
  });

  // Logged-out must be exclusive terminal — not transient reconnect.
  await session.__testHandleConnectionUpdate({
    connection: "logged_out",
    statusCode: 401,
  });
  assert.equal(session.getSafeStatus().state, "LOGGED_OUT");
  assert.equal(session.__testIsConnectionDesired(), false);
  assert.equal(session.__testHasReconnectTimer(), false);

  // If a close with loggedOut code arrives, still terminal.
  session.__testSetState("CONNECTED", { connectionDesired: true });
  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 401,
  });
  assert.equal(session.getSafeStatus().state, "LOGGED_OUT");
  assert.equal(session.__testHasReconnectTimer(), false);

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: logged-out close is not treated as transient");

{
  const authDir = tmpAuthDir();
  const scheduledFns: Array<() => void> = [];
  let starts = 0;

  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    reconnectDelaysMs: [0, 0, 0, 0, 0],
    setTimeoutFn: ((fn: () => void) => {
      scheduledFns.push(fn as () => void);
      return scheduledFns.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: ((handle: NodeJS.Timeout) => {
      const idx = (handle as unknown as number) - 1;
      if (scheduledFns[idx]) scheduledFns[idx] = () => undefined;
    }) as typeof clearTimeout,
    socketFactory: async () => {
      starts += 1;
      // Fail start after first to force retries
      if (starts > 1) {
        throw new Error("transient");
      }
      return {
        end: () => undefined,
        logout: async () => undefined,
        sendText: async () => ({ providerMessageId: "X" }),
        getUserId: () => null,
      };
    },
  });

  await session.connect();
  assert.equal(starts, 1);

  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 428,
  });
  // Flush retries
  for (let i = 0; i < 3; i += 1) {
    const fn = scheduledFns[i];
    if (fn) {
      try {
        fn();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  assert.ok(
    session.__testGetReconnectAttempt() >= 2,
    "expected multiple reconnect attempts"
  );
  assert.ok(starts >= 2, "expected more than one socket start");

  // Successful open resets attempt counter
  await session.__testHandleConnectionUpdate({
    connection: "open",
    userId: "923009998877@s.whatsapp.net",
  });
  assert.equal(session.__testGetReconnectAttempt(), 0);
  assert.equal(session.getSafeStatus().state, "CONNECTED");
  const openMasked = session.getSafeStatus().phoneMasked;
  assert.ok(openMasked?.includes("*"));
  assert.equal(openMasked, maskPhoneNumber("923009998877"));

  await session.shutdown();
  assert.equal(session.__testIsConnectionDesired(), false);
  assert.equal(session.__testHasReconnectTimer(), false);
  const delays = session.__testGetScheduledReconnectDelays().length;
  await session.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 428,
  });
  assert.equal(session.__testGetScheduledReconnectDelays().length, delays);

  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: multi-retry, open resets counter, shutdown cancels reconnect");

{
  // Startup without credentials waits for Admin
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({ qr: "should-not-auto-qr" }),
  });
  const init = await session.initializeAtStartup();
  assert.equal(init.resumed, false);
  assert.equal(init.state, "DISCONNECTED");
  assert.equal(session.__testIsConnectionDesired(), false);
  assert.equal(session.getSafeStatus().qrAvailable, false);

  // Startup with saved credentials resumes
  await fsp.mkdir(path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(authDir, WHATSAPP_WEB_SESSION_DIR_NAME, "creds.json"),
    '{"registered":true}',
    "utf8"
  );
  const resumeSession = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({
      openOnStart: true,
      userId: "923001112233:12@s.whatsapp.net",
    }),
  });
  const resumed = await resumeSession.initializeAtStartup();
  assert.equal(resumed.resumed, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(resumeSession.getSafeStatus().state, "CONNECTED");
  assert.ok(resumeSession.getSafeStatus().phoneMasked?.includes("*"));
  assert.equal(resumeSession.__testIsConnectionDesired(), true);

  // Flag-off startup is unchanged no-op
  const off = new WhatsAppWebSession({
    env: { WHATSAPP_WEB_QR_ENABLED: "false" },
  });
  const offInit = await off.initializeAtStartup();
  assert.equal(offInit.resumed, false);
  assert.equal(off.getSafeStatus().enabled, false);

  // Enabled + unusable auth directory fails closed
  const blocker = path.join(tmpAuthDir(), "not-a-dir");
  await fsp.writeFile(blocker, "file", "utf8");
  const bad = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: path.join(blocker, "auth"),
    },
  });
  await assert.rejects(() => bad.initializeAtStartup());

  await session.shutdown();
  await resumeSession.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: startup resume / await-admin / fail-closed / flag-off");

{
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({}),
  });
  await session.connect();
  session.__testSetState("CONNECTED", {
    connectionDesired: true,
    phoneRaw: "923001112233",
  });
  await session.__testAcceptQr("stale-qr-payload");
  assert.equal(session.getSafeStatus().state, "CONNECTED");
  assert.equal(session.getSafeStatus().qrAvailable, false);

  // Newer QR generation invalidates older conversion: set connecting, accept A then B
  session.__testSetState("CONNECTING", { connectionDesired: true });
  const slow = session.__testAcceptQr("qr-a");
  const fast = session.__testAcceptQr("qr-b");
  await Promise.all([slow, fast]);
  assert.equal(session.getSafeStatus().state, "QR_READY");
  // Connected phone masking after open
  await session.__testHandleConnectionUpdate({
    connection: "open",
    userId: "923007771111@s.whatsapp.net",
  });
  const masked = session.getSafeStatus().phoneMasked;
  assert.ok(masked);
  assert.match(masked!, /^\+/);
  assert.ok(masked!.includes("*"));
  assert.equal(masked!.includes("7771111"), false);

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: stale QR cannot overwrite CONNECTED; phone masked after open");

// ---------------------------------------------------------------------------
// QR-5 — Approved-staff authorization + rate limiter + dual-write-off
// ---------------------------------------------------------------------------

{
  assert.equal(canManageWhatsAppWebQr(null), false);
  assert.equal(
    canManageWhatsAppWebQr(staffActor({ role: "Admin", accountStatus: "Pending" })),
    false
  );
  assert.equal(
    canManageWhatsAppWebQr(staffActor({ role: "Admin", accountStatus: "Rejected" })),
    false
  );
  assert.equal(
    canManageWhatsAppWebQr(staffActor({ role: "Admin", accountStatus: "Suspended" })),
    false
  );
  assert.equal(
    canManageWhatsAppWebQr(
      staffActor({ role: "Sales Manager", accountStatus: "Approved" })
    ),
    false
  );
  assert.equal(
    canManageWhatsAppWebQr(staffActor({ role: "Admin", accountStatus: "Approved" })),
    true
  );
  assert.equal(
    canManageWhatsAppWebQr(
      staffActor({ role: "Super Admin", accountStatus: "Approved" })
    ),
    true
  );
}

{
  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({}),
  });

  await withApp(session, null, async (base) => {
    const res = await fetch(`${base}/api/whatsapp-web/status`);
    assert.equal(res.status, 401);
  });

  await withApp(
    session,
    staffActor({ role: "Sales Executive", accountStatus: "Approved" }),
    async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/status`);
      assert.equal(res.status, 403);
    }
  );

  for (const status of ["Pending", "Rejected", "Suspended", "Inactive"]) {
    await withApp(
      session,
      staffActor({ role: "Admin", accountStatus: status }),
      async (base) => {
        const res = await fetch(`${base}/api/whatsapp-web/connect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountStatus: "Approved", role: "Admin" }),
        });
        assert.equal(res.status, 403, status);
        const body = await res.json();
        assertNoSensitiveLeak(body);
      }
    );
  }

  await withApp(
    session,
    staffActor({ role: "Admin", accountStatus: "Approved" }),
    async (base) => {
      // Spoof headers/body must not elevate privileges (actor already Approved Admin).
      const res = await fetch(`${base}/api/whatsapp-web/status`, {
        headers: {
          "x-account-status": "Rejected",
          "x-role": "Customer",
        },
      });
      assert.equal(res.status, 200);
    }
  );

  await withApp(
    session,
    staffActor({ role: "Super Admin", accountStatus: "Approved" }),
    async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/status`);
      assert.equal(res.status, 200);
    }
  );

  // Feature flag off: Approved Admin reaches handler, connect fails closed.
  const disabled = new WhatsAppWebSession({
    env: { WHATSAPP_WEB_QR_ENABLED: "false", WHATSAPP_WEB_AUTH_DIR: authDir },
    socketFactory: mockSocketFactory({}),
  });
  await withApp(
    disabled,
    staffActor({ role: "Admin", accountStatus: "Approved" }),
    async (base) => {
      const statusRes = await fetch(`${base}/api/whatsapp-web/status`);
      assert.equal(statusRes.status, 200);
      const statusBody = (await statusRes.json()) as {
        data: { enabled: boolean };
      };
      assert.equal(statusBody.data.enabled, false);
      const connectRes = await fetch(`${base}/api/whatsapp-web/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(connectRes.status, 503);
    }
  );

  await session.shutdown();
  await disabled.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: Approved-staff authorization + spoof resistance + flag-off");

{
  assert.equal(WHATSAPP_WEB_ADMIN_ROUTES.length, 7);

  const authDir = tmpAuthDir();
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory: mockSocketFactory({ qr: "rate-qr" }),
  });

  let clock = 1_000_000;
  const store = new Map<string, { count: number; resetAt: number }>();
  const ipForRequest = { current: "10.0.0.1" };

  await withApp(
    session,
    staffActor({ role: "Admin", accountStatus: "Approved" }),
    async (base) => {
      const hit = async (path: string, method: string) =>
        fetch(`${base}/api/whatsapp-web${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        });

      // Below limit
      for (let i = 0; i < 3; i += 1) {
        const res = await hit("/status", "GET");
        assert.equal(res.status, 200, `allowed #${i + 1}`);
      }

      // 4th exceeds max=3
      const limited = await hit("/status", "GET");
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("cache-control"), "no-store");
      const limitedBody = await limited.json();
      assert.equal(limitedBody.success, false);
      assert.equal(limitedBody.error.code, "rate_limited");
      assertNoSensitiveLeak(limitedBody);

      // Separate IP bucket is independent
      ipForRequest.current = "10.0.0.2";
      const otherIp = await hit("/status", "GET");
      assert.equal(otherIp.status, 200);

      // Window reset
      ipForRequest.current = "10.0.0.1";
      clock += 60_001;
      const afterReset = await hit("/status", "GET");
      assert.equal(afterReset.status, 200);
    },
    {
      rateLimitStore: store,
      rateLimit: {
        windowMs: 60_000,
        maxAttempts: 3,
        now: () => clock,
        getClientIp: () => ipForRequest.current,
      },
    }
  );

  // All five routes pass through the limiter (max=1 → second call 429)
  await withApp(
    session,
    staffActor({ role: "Admin", accountStatus: "Approved" }),
    async (base) => {
      for (const route of WHATSAPP_WEB_ADMIN_ROUTES) {
        clock += 60_001;
        store.clear();
        const first = await fetch(`${base}/api/whatsapp-web${route.path}`, {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.method === "GET" ? undefined : "{}",
        });
        assert.ok(
          first.status !== 429,
          `${route.method} ${route.path} first should not be 429 (got ${first.status})`
        );
        const second = await fetch(`${base}/api/whatsapp-web${route.path}`, {
          method: route.method,
          headers: { "content-type": "application/json" },
          body: route.method === "GET" ? undefined : "{}",
        });
        assert.equal(
          second.status,
          429,
          `${route.method} ${route.path} second should be 429`
        );
        assertNoSensitiveLeak(await second.json());
      }
    },
    {
      rateLimitStore: store,
      rateLimit: {
        windowMs: 60_000,
        maxAttempts: 1,
        now: () => clock,
        getClientIp: () => "10.0.0.8",
      },
    }
  );

  // Limiter does not weaken auth — unauthenticated still 401 under limit
  clock += 60_001;
  store.clear();
  await withApp(
    session,
    null,
    async (base) => {
      const res = await fetch(`${base}/api/whatsapp-web/status`);
      assert.equal(res.status, 401);
    },
    {
      rateLimitStore: store,
      rateLimit: {
        windowMs: 60_000,
        maxAttempts: 10,
        now: () => clock,
        getClientIp: () => "10.9.9.9",
      },
    }
  );

  await session.shutdown();
  await fsp.rm(authDir, { recursive: true, force: true });
}

console.log("PASS: WhatsApp Web rate-limiter regression coverage");

{
  // QR Inbox path works while Postgres dual-write is disabled.
  const repo = new InMemoryWhatsAppRepository();
  assert.equal(createWhatsAppWebMessagingBridge({ repository: null }), null);
  assert.equal(
    createWhatsAppWebMessagingBridge({ repository: undefined }),
    null
  );

  const msg = {
    providerMessageId: "PG_OFF_1",
    remoteJid: "923001112233@s.whatsapp.net",
    fromMe: false,
    text: "Hello with postgres dual-write off",
    pushName: "Customer",
    occurredAt: new Date().toISOString(),
    isGroup: false,
    isStatusOrNewsletter: false,
    rawType: "conversation",
  };
  const stored = await persistWhatsAppWebInbound(msg, {
    repo,
    messagingRepository: null,
  });
  assert.equal(stored.kind, "stored");
  if (stored.kind === "stored") {
    assert.equal(stored.created, true);
    const bundle = await repo.getConversationBundle(stored.conversationId);
    assert.ok(bundle);
    assert.equal(
      bundle!.channel.phoneNumberId,
      WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID
    );
  }
}

console.log("PASS: QR Inbox path works with Postgres dual-write off");

// ---------------------------------------------------------------------------
// QR-10 — safe disconnect diagnostics (reconnect policy unchanged)
// ---------------------------------------------------------------------------

{
  assert.equal(classifyDisconnectDiagnostic(401), "logged_out");
  assert.equal(classifyDisconnectDiagnostic(515), "restart_required");
  assert.equal(classifyDisconnectDiagnostic(428), "connection_closed");
  assert.equal(classifyDisconnectDiagnostic(408), "timed_out");
  assert.equal(classifyDisconnectDiagnostic(500), "bad_session");
  assert.equal(classifyDisconnectDiagnostic(503), "retryable");
  assert.equal(classifyDisconnectDiagnostic(undefined), "unknown");
  assert.equal(classifyDisconnectDiagnostic(null), "unknown");

  // Policy classification remains unchanged.
  assert.equal(classifyDisconnect(401), "logged_out");
  assert.equal(classifyDisconnect(428), "retryable");
  assert.equal(classifyDisconnect(undefined), "retryable");
  assert.equal(classifyDisconnect(500), "terminal");

  const loggedOutDiag = buildConnectionClosedDiagnostic({
    statusCode: 401,
    willRetry: false,
    nextState: "LOGGED_OUT",
  });
  assert.deepEqual(loggedOutDiag, {
    statusCode: 401,
    classification: "logged_out",
    willRetry: false,
    nextState: "LOGGED_OUT",
  });

  const retryableDiag = buildConnectionClosedDiagnostic({
    statusCode: 428,
    willRetry: true,
    nextState: "RECONNECTING",
  });
  assert.equal(retryableDiag.classification, "connection_closed");
  assert.equal(retryableDiag.willRetry, true);
  assert.equal(retryableDiag.nextState, "RECONNECTING");

  const unknownDiag = buildConnectionClosedDiagnostic({
    statusCode: undefined,
    willRetry: true,
    nextState: "RECONNECTING",
  });
  assert.equal(unknownDiag.statusCode, null);
  assert.equal(unknownDiag.classification, "unknown");

  const forbidden = [
    "qrDataUrl",
    "creds",
    "noiseKey",
    "phoneNumber",
    "remoteJid",
    "stack",
    "authorization",
    "cookie",
    "message content",
  ];
  const diagJson = JSON.stringify(loggedOutDiag);
  for (const field of forbidden) {
    assert.equal(diagJson.toLowerCase().includes(field.toLowerCase()), false);
  }

  // Diagnostic log line contains only safe fixed fields.
  const lines: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    logWhatsAppWeb("info", "connection_closed", {
      statusCode: 401,
      classification: "logged_out",
      willRetry: false,
      nextState: "LOGGED_OUT",
      // Attempted poison fields — logger must drop forbidden keys.
      qr: "SHOULD_NOT_APPEAR",
      creds: { noiseKey: "x" },
      phone: "923001112233",
      session: "raw-session",
      error: new Error("raw boom"),
    });
  } finally {
    console.info = originalInfo;
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.scope, "whatsapp_web_qr");
  assert.equal(parsed.event, "connection_closed");
  assert.equal(parsed.statusCode, 401);
  assert.equal(parsed.classification, "logged_out");
  assert.equal(parsed.willRetry, false);
  assert.equal(parsed.nextState, "LOGGED_OUT");
  assert.ok(typeof parsed.at === "string");
  assert.equal("qr" in parsed, false);
  assert.equal("creds" in parsed, false);
  assert.equal("phone" in parsed, false);
  assert.equal("session" in parsed, false);
  assert.equal("error" in parsed, false);
  const blob = JSON.stringify(parsed).toLowerCase();
  assert.equal(blob.includes("should_not_appear"), false);
  assert.equal(blob.includes("923001112233"), false);
  assert.equal(blob.includes("raw boom"), false);

  // LOGGED_OUT close path emits connection_closed and does not retry.
  const authDir = tmpAuthDir();
  const scheduled: Array<{ ms: number; fn: () => void }> = [];
  const infoLines: string[] = [];
  const prevInfo = console.info;
  console.info = (...args: unknown[]) => {
    infoLines.push(args.map(String).join(" "));
  };
  try {
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      reconnectDelaysMs: [2_000, 5_000],
      setTimeoutFn: ((fn: () => void, ms: number) => {
        scheduled.push({ ms, fn: fn as () => void });
        return scheduled.length as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
      socketFactory: (async () => ({
        end: () => undefined,
        logout: async () => undefined,
        sendText: async () => ({ providerMessageId: "x" }),
      })) as WhatsAppWebSocketFactory,
    });
    await session.connect();
    await session.__testHandleConnectionUpdate({
      connection: "close",
      statusCode: 401,
    });
    assert.equal(session.getSafeStatus().state, "LOGGED_OUT");
    assert.equal(scheduled.length, 0);
    const closed = infoLines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((row) => row && row.event === "connection_closed");
    assert.ok(closed.length >= 1);
    assert.equal(closed[0]!.classification, "logged_out");
    assert.equal(closed[0]!.willRetry, false);
    assert.equal(closed[0]!.nextState, "LOGGED_OUT");
    assert.equal(closed[0]!.statusCode, 401);
    await session.shutdown();
  } finally {
    console.info = prevInfo;
    await fsp.rm(authDir, { recursive: true, force: true });
  }

  // Retryable disconnect still schedules reconnect (policy unchanged).
  const authDir2 = tmpAuthDir();
  const scheduled2: Array<{ ms: number; fn: () => void }> = [];
  const session2 = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir2,
    },
    reconnectDelaysMs: [2_000, 5_000],
    setTimeoutFn: ((fn: () => void, ms: number) => {
      scheduled2.push({ ms, fn: fn as () => void });
      return scheduled2.length as unknown as NodeJS.Timeout;
    }) as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    socketFactory: (async () => ({
      end: () => undefined,
      logout: async () => undefined,
      sendText: async () => ({ providerMessageId: "x" }),
    })) as WhatsAppWebSocketFactory,
  });
  await session2.connect();
  await session2.__testHandleConnectionUpdate({
    connection: "close",
    statusCode: 428,
  });
  assert.equal(session2.getSafeStatus().state, "RECONNECTING");
  assert.equal(scheduled2.length, 1);
  assert.equal(scheduled2[0]!.ms, 2_000);
  await session2.shutdown();
  await fsp.rm(authDir2, { recursive: true, force: true });
}

console.log("PASS: safe disconnect diagnostics + unchanged reconnect policy");

console.log("\nAll WhatsApp Web QR tests passed.");
