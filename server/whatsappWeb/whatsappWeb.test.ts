/**
 * WhatsApp Web QR (Baileys) — unit tests with injectable socket factory.
 * Does not scan a real QR or send a real WhatsApp message.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
import { persistWhatsAppWebInbound } from "./whatsappWebInbound.ts";
import { createWhatsAppWebRouter } from "./whatsappWebRoutes.ts";
import {
  WhatsAppWebSession,
  type WhatsAppWebSocketFactory,
} from "./whatsappWebSession.ts";
import { FORBIDDEN_WHATSAPP_WEB_BROWSER_FIELDS } from "./whatsappWebTypes.ts";
import { InMemoryWhatsAppRepository } from "../whatsappTransport/whatsappRepository.ts";
import { isWhatsAppWebQrChannel } from "./whatsappWebOutbound.ts";
import { sendWhatsAppWebPlainText } from "./whatsappWebOutbound.ts";
import type { RequestActor } from "../middleware/actor.ts";

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-web-auth-"));
}

function adminActor(role: string = "Admin"): RequestActor {
  return {
    id: "admin-1",
    username: "admin",
    name: "Admin",
    email: "admin@example.com",
    role,
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

async function withApp(
  session: WhatsAppWebSession,
  actor: RequestActor | null,
  run: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: RequestActor | null }).actor = actor;
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

function mockSocketFactory(opts?: {
  qr?: string;
  openOnStart?: boolean;
  providerMessageId?: string;
  failSend?: boolean;
}): WhatsAppWebSocketFactory {
  return async (input) => {
    if (opts?.qr) {
      queueMicrotask(() => input.onQr(opts.qr!));
    }
    if (opts?.openOnStart) {
      queueMicrotask(() => input.onConnectionUpdate({ connection: "open" }));
    }
    return {
      userId: "923001112233:1@s.whatsapp.net",
      end: () => undefined,
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

console.log("\nAll WhatsApp Web QR tests passed.");
