/**
 * Deterministic coverage for WhatsApp Web contact sync + 7-day history backfill.
 * No real WhatsApp connection, QR, or outbound sends.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { InMemoryWhatsAppRepository } from "../whatsappTransport/whatsappRepository.ts";
import { createInMemoryWhatsAppInboxRepositories } from "../whatsappTransport/whatsappInboxRepository.ts";
import { createWhatsAppInboxServices } from "../whatsappTransport/whatsappInboxServices.ts";
import type { RequestActor } from "../middleware/actor.ts";
import {
  isBackfillMetadata,
  persistWhatsAppWebBackfillMessage,
  syncWhatsAppWebContact,
} from "./whatsappWebHistoryPersist.ts";
import { WhatsAppWebHistorySyncService } from "./whatsappWebHistorySync.ts";
import {
  isEligibleSyncChat,
  isEligibleSyncContact,
  resolveWhatsAppDisplayName,
  shouldApplyWhatsAppContactName,
  syncWindowStartMs,
  type WhatsAppWebSyncChat,
  type WhatsAppWebSyncContact,
  type WhatsAppWebSyncMessage,
  type WhatsAppWebSyncSource,
} from "./whatsappWebSyncTypes.ts";
import { BaileysInMemorySyncSource } from "./whatsappWebBaileysSyncSource.ts";
import {
  WhatsAppWebSession,
  type WhatsAppWebSocketFactory,
} from "./whatsappWebSession.ts";
import { createWhatsAppWebRouter } from "./whatsappWebRoutes.ts";
import { persistWhatsAppWebInbound } from "./whatsappWebInbound.ts";
import { WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID } from "./whatsappWebConfig.ts";
import { jidToWaId } from "./whatsappWebNormalize.ts";
import { DEFAULT_COMPANY_ID } from "../whatsappTransport/whatsappConstants.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Reproduces the SYNC-1 read-modify-write race (for regression contrast). */
async function racyAdvanceLastMessageAt(
  state: { lastMessageAt: string | null },
  at: string,
  yieldMs: number
): Promise<boolean> {
  const current = state.lastMessageAt;
  await new Promise((r) => setTimeout(r, yieldMs));
  if (current && current >= at) return false;
  state.lastMessageAt = at;
  return true;
}

/** Atomic max semantics matching the SQL RPC. */
function atomicAdvanceLastMessageAt(
  state: { lastMessageAt: string | null },
  at: string
): boolean {
  if (state.lastMessageAt && state.lastMessageAt >= at) return false;
  state.lastMessageAt = at;
  return true;
}

function actor(role = "Admin"): RequestActor {
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

function tmpAuthDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wa-sync-auth-"));
}

class FakeSyncSource implements WhatsAppWebSyncSource {
  connected = true;
  selfJid = "923001112233@s.whatsapp.net";
  contacts: WhatsAppWebSyncContact[] = [];
  chats: WhatsAppWebSyncChat[] = [];
  messagesByChat = new Map<string, WhatsAppWebSyncMessage[]>();
  failChatJids = new Set<string>();
  providerHistoryEventObserved = false;
  onDemandHistorySupported = false;

  isConnected(): boolean {
    return this.connected;
  }
  getSelfJid(): string | null {
    return this.selfJid;
  }
  async listContacts(): Promise<WhatsAppWebSyncContact[]> {
    return this.contacts;
  }
  async listChats(): Promise<WhatsAppWebSyncChat[]> {
    return this.chats;
  }
  async fetchMessages(
    chatJid: string,
    opts: { limit: number; sinceMs: number }
  ): Promise<WhatsAppWebSyncMessage[]> {
    if (this.failChatJids.has(chatJid)) {
      throw new Error("chat_fetch_failed");
    }
    return (this.messagesByChat.get(chatJid) ?? [])
      .filter((m) => Date.parse(m.occurredAt) >= opts.sinceMs)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(-opts.limit);
  }
  getHistoryCoverageMeta(windowStartMs: number) {
    const stamps = [...this.messagesByChat.values()]
      .flat()
      .map((m) => Date.parse(m.occurredAt))
      .filter((n) => Number.isFinite(n));
    const oldest = stamps.length ? Math.min(...stamps) : null;
    const newest = stamps.length ? Math.max(...stamps) : null;
    const coverage =
      stamps.length === 0
        ? ("empty" as const)
        : oldest !== null && oldest <= windowStartMs
          ? ("partial" as const)
          : ("available_only" as const);
    return {
      sourceReady: stamps.length > 0 || this.providerHistoryEventObserved,
      coverage,
      providerHistoryEventObserved: this.providerHistoryEventObserved,
      oldestAvailableAt: oldest !== null ? new Date(oldest).toISOString() : null,
      newestAvailableAt: newest !== null ? new Date(newest).toISOString() : null,
      onDemandHistorySupported: this.onDemandHistorySupported,
    };
  }
}

{
  const resolved = resolveWhatsAppDisplayName({
    savedName: "Saved",
    pushName: "Push",
    shortName: "Short",
    phoneE164: "923001234567",
  });
  assert.equal(resolved.source, "whatsapp_saved");
  assert.equal(resolved.name, "Saved");

  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "CRM Manual",
      existingSource: "manual",
      nextName: "WhatsApp Saved",
      nextSource: "whatsapp_saved",
    }),
    false
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "92300",
      existingSource: "phone",
      nextName: "Push Name",
      nextSource: "whatsapp_push",
    }),
    true
  );
}
console.log("PASS: name precedence + manual preserve policy");

{
  const self = "923001112233@s.whatsapp.net";
  assert.equal(
    isEligibleSyncContact(
      {
        jid: "923009998877@s.whatsapp.net",
        phoneE164: "923009998877",
        savedName: "A",
        pushName: null,
        shortName: null,
        isBusiness: false,
      },
      self
    ),
    true
  );
  assert.equal(
    isEligibleSyncContact(
      {
        jid: self,
        phoneE164: "923001112233",
        savedName: "Me",
        pushName: null,
        shortName: null,
        isBusiness: false,
      },
      self
    ),
    false
  );
  assert.equal(
    isEligibleSyncChat(
      {
        jid: "120363@g.us",
        phoneE164: null,
        name: "Group",
        isGroup: true,
        isStatusOrBroadcast: false,
        isChannel: false,
      },
      self
    ),
    false
  );
  assert.equal(
    isEligibleSyncChat(
      {
        jid: "status@broadcast",
        phoneE164: null,
        name: null,
        isGroup: false,
        isStatusOrBroadcast: true,
        isChannel: false,
      },
      self
    ),
    false
  );
}
console.log("PASS: groups/status/self excluded");

{
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  const start = syncWindowStartMs(now, 7);
  assert.equal(start, Date.parse("2026-07-17T12:00:00.000Z"));
}
console.log("PASS: seven-day cutoff helper");

{
  const repo = new InMemoryWhatsAppRepository();
  const contact = await syncWhatsAppWebContact(
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      savedName: "Saved Contact",
      pushName: "Push",
      shortName: null,
      isBusiness: true,
    },
    { repo }
  );
  assert.equal(contact.created, true);
  assert.equal(contact.contact.profileName, "Saved Contact");
  assert.equal(contact.contact.nameSource, "whatsapp_saved");
  assert.equal(contact.contact.isBusinessContact, true);

  await repo.updateContactSyncFields!(contact.contact.id, {
    profileName: "CRM Manual Name",
    nameSource: "manual",
  });
  const again = await syncWhatsAppWebContact(
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      savedName: "Weaker WhatsApp",
      pushName: "Push",
      shortName: null,
      isBusiness: true,
    },
    { repo }
  );
  assert.equal(again.created, false);
  assert.equal(again.contact.profileName, "CRM Manual Name");
  assert.equal(again.contact.nameSource, "manual");
}
console.log("PASS: saved contacts sync + manual CRM name preserved");

{
  const repo = new InMemoryWhatsAppRepository();
  const now = new Date("2026-07-24T12:00:00.000Z");
  const source = new FakeSyncSource();
  source.contacts = [
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      savedName: "Ali",
      pushName: null,
      shortName: null,
      isBusiness: false,
    },
  ];
  source.chats = [
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      name: "Ali",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
    {
      jid: "120363@g.us",
      phoneE164: null,
      name: "Group",
      isGroup: true,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  const inWindow = "2026-07-20T10:00:00.000Z";
  const outOfWindow = "2026-07-10T10:00:00.000Z";
  source.messagesByChat.set("923009998877@s.whatsapp.net", [
    {
      providerMessageId: "IN_1",
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: "hello inbound",
      messageType: "text",
      occurredAt: inWindow,
    },
    {
      providerMessageId: "OUT_1",
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: true,
      text: "hello outbound",
      messageType: "text",
      occurredAt: "2026-07-21T10:00:00.000Z",
    },
    {
      providerMessageId: "OLD_1",
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: "too old",
      messageType: "text",
      occurredAt: outOfWindow,
    },
  ]);

  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => now,
  });
  const first = service.startOrJoin();
  assert.equal(first.accepted, true);
  assert.equal(first.joinedExisting, false);
  const snap = await first.done;
  assert.equal(snap.status, "completed");
  assert.equal(snap.messagesImported, 2);
  assert.ok(snap.contactsCreated >= 1);
  assert.equal(snap.chatsInspected, 1);

  const messages = [...repo.messages.values()];
  assert.equal(messages.length, 2);
  assert.ok(messages.every((m) => m.isBackfill === true));
  assert.ok(messages.every((m) => isBackfillMetadata(m.rawMetadata)));
  assert.ok(messages.some((m) => m.direction === "inbound"));
  assert.ok(messages.some((m) => m.direction === "outbound"));
  assert.ok(!messages.some((m) => m.waMessageId === "OLD_1"));

  const second = service.startOrJoin();
  const snap2 = await second.done;
  assert.equal(snap2.messagesImported, 0);
  assert.equal(snap2.duplicatesSkipped, 2);
  assert.equal(repo.messages.size, 2);
}
console.log("PASS: inbound/outbound import, 7-day cutoff, dedupe");

{
  const repo = new InMemoryWhatsAppRepository();
  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId: WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  });
  const contact = await repo.resolveOrCreateContact({
    phoneE164: "923009998877",
    profileName: "Existing",
  });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  await repo.advanceConversationLastMessageAt!(
    conversation.id,
    "2026-07-23T18:00:00.000Z"
  );

  const older = await persistWhatsAppWebBackfillMessage(
    {
      providerMessageId: "OLD_HIST",
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: "older history",
      messageType: "text",
      occurredAt: "2026-07-20T10:00:00.000Z",
    },
    { repo }
  );
  assert.equal(older.kind, "imported");
  const bundle = await repo.getConversationBundle(conversation.id);
  assert.equal(bundle?.conversation.lastMessageAt, "2026-07-23T18:00:00.000Z");
}
console.log("PASS: old history cannot replace newer conversation preview");

{
  let shadowCalls = 0;
  let autoLinkCalls = 0;
  const repo = new InMemoryWhatsAppRepository();
  // Backfill path must never invoke live inbound hooks — prove via separate live call.
  const live = await persistWhatsAppWebInbound(
    {
      providerMessageId: "LIVE_1",
      remoteJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: "live",
      pushName: "Ali",
      occurredAt: new Date().toISOString(),
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "conversation",
    },
    {
      repo,
      evaluateShadow: async () => {
        shadowCalls += 1;
      },
      autoLinkLead: async () => {
        autoLinkCalls += 1;
      },
    }
  );
  assert.equal(live.kind, "stored");
  assert.equal(shadowCalls, 1);
  assert.equal(autoLinkCalls, 1);

  shadowCalls = 0;
  autoLinkCalls = 0;
  const backfill = await persistWhatsAppWebBackfillMessage(
    {
      providerMessageId: "BF_1",
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: "history",
      messageType: "text",
      occurredAt: "2026-07-20T10:00:00.000Z",
    },
    { repo }
  );
  assert.equal(backfill.kind, "imported");
  assert.equal(shadowCalls, 0);
  assert.equal(autoLinkCalls, 0);
  if (backfill.kind === "imported") {
    const msg = [...repo.messages.values()].find((m) => m.waMessageId === "BF_1");
    assert.equal(msg?.isBackfill, true);
  }
}
console.log("PASS: backfill never triggers AI/auto-link; live inbound still does");

{
  const repos = createInMemoryWhatsAppInboxRepositories();
  const services = createWhatsAppInboxServices(repos);
  repos.store.conversations.set("c1", {
    id: "c1",
    companyId: "sunchaser",
    channelId: "ch1",
    contactId: "ct1",
    status: "open",
    lastMessageAt: "2026-07-20T10:00:00.000Z",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    lockVersion: 1,
    hasFailedMessage: false,
  });
  repos.store.messages.set("m_bf", {
    id: "m_bf",
    companyId: "sunchaser",
    conversationId: "c1",
    direction: "inbound",
    status: "received",
    textBody: "history",
    createdAt: "2026-07-20T10:00:00.000Z",
    occurredAt: "2026-07-20T10:00:00.000Z",
    isBackfill: true,
  });
  repos.store.messages.set("m_live", {
    id: "m_live",
    companyId: "sunchaser",
    conversationId: "c1",
    direction: "inbound",
    status: "received",
    textBody: "live",
    createdAt: "2026-07-24T10:00:00.000Z",
    occurredAt: "2026-07-24T10:00:00.000Z",
    isBackfill: false,
  });
  const unread = await services.readState.getUnreadCount("c1", actor());
  assert.equal(unread, 1);
}
console.log("PASS: backfill does not increase unread counts");

{
  const repo = new InMemoryWhatsAppRepository();
  const now = new Date("2026-07-24T12:00:00.000Z");
  const source = new FakeSyncSource();
  source.chats = [
    {
      jid: "923001111111@s.whatsapp.net",
      phoneE164: "923001111111",
      name: "Ok",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
    {
      jid: "923002222222@s.whatsapp.net",
      phoneE164: "923002222222",
      name: "Fail",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  source.failChatJids.add("923002222222@s.whatsapp.net");
  source.messagesByChat.set("923001111111@s.whatsapp.net", [
    {
      providerMessageId: "OK_1",
      chatJid: "923001111111@s.whatsapp.net",
      fromMe: false,
      text: "ok",
      messageType: "text",
      occurredAt: "2026-07-20T10:00:00.000Z",
    },
  ]);
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => now,
  });
  const snap = await service.startOrJoin().done;
  assert.equal(snap.status, "completed");
  assert.equal(snap.failedChats, 1);
  assert.equal(snap.messagesImported, 1);
}
console.log("PASS: one failed chat does not fail entire job");

{
  const repo = new InMemoryWhatsAppRepository();
  const source = new FakeSyncSource();
  source.chats = [
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      name: "Slow",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  // Large message set so cancel can interrupt mid-job.
  source.messagesByChat.set(
    "923009998877@s.whatsapp.net",
    Array.from({ length: 40 }, (_, i) => ({
      providerMessageId: `M_${i}`,
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: `msg ${i}`,
      messageType: "text",
      occurredAt: `2026-07-20T10:${String(i).padStart(2, "0")}:00.000Z`,
    }))
  );
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  const first = service.startOrJoin();
  const second = service.startOrJoin();
  assert.equal(second.joinedExisting, true);
  assert.equal(second.snapshot.jobId, first.snapshot.jobId);
  await first.done;
}
console.log("PASS: concurrent sync joins existing job");

{
  const repo = new InMemoryWhatsAppRepository();
  const source = new FakeSyncSource();
  source.chats = [
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      name: "Cancel",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  source.messagesByChat.set(
    "923009998877@s.whatsapp.net",
    Array.from({ length: 30 }, (_, i) => ({
      providerMessageId: `C_${i}`,
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: `c ${i}`,
      messageType: "text",
      occurredAt: `2026-07-20T11:${String(i).padStart(2, "0")}:00.000Z`,
    }))
  );
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const started = service.startOrJoin();
  service.requestCancel();
  const snap = await started.done;
  assert.equal(snap.status, "completed");
  assert.ok(
    snap.errorSummary?.includes("disconnect") ||
      snap.messagesImported < 30
  );
}
console.log("PASS: cancel prevents unsafe continuation");

{
  const baileys = new BaileysInMemorySyncSource();
  baileys.setConnected(true, "923001112233:1@s.whatsapp.net");
  baileys.ingestContacts([
    {
      id: "923009998877@s.whatsapp.net",
      name: "Saved",
      notify: "Push",
    },
  ]);
  baileys.ingestChats([
    { id: "923009998877@s.whatsapp.net", name: "Saved" },
    { id: "120363@g.us", name: "Group" },
    { id: "status@broadcast" },
  ]);
  baileys.ingestMessages([
    {
      key: {
        id: "MSG1",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(
        Date.parse("2026-07-20T10:00:00.000Z") / 1000
      ),
      message: { conversation: "hi" },
    },
  ]);
  const contacts = await baileys.listContacts();
  assert.equal(contacts.length, 1);
  const chats = await baileys.listChats();
  assert.equal(chats.length, 3);
  const msgs = await baileys.fetchMessages("923009998877@s.whatsapp.net", {
    limit: 10,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]?.text, "hi");
}
console.log("PASS: Baileys in-memory sync source ingest");

{
  const authDir = tmpAuthDir();
  const repo = new InMemoryWhatsAppRepository();
  const syncSource = new BaileysInMemorySyncSource();
  syncSource.setConnected(true, "923001112233@s.whatsapp.net");
  syncSource.ingestContacts([
    {
      id: "923009998877@s.whatsapp.net",
      name: "Panel Contact",
      notify: "Push",
    },
  ]);
  syncSource.ingestChats([{ id: "923009998877@s.whatsapp.net", name: "Panel Contact" }]);
  syncSource.ingestMessages([
    {
      key: {
        id: "API_IN",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(
        Date.parse("2026-07-20T10:00:00.000Z") / 1000
      ),
      message: { conversation: "from api sync" },
    },
  ]);

  const socketFactory: WhatsAppWebSocketFactory = async (input) => {
    queueMicrotask(() =>
      input.onConnectionUpdate({
        connection: "open",
        userId: "923001112233@s.whatsapp.net",
      })
    );
    return {
      end: () => syncSource.setConnected(false),
      logout: async () => {
        syncSource.setConnected(false);
      },
      sendText: async () => ({ providerMessageId: "SEND_1" }),
      getUserId: () => "923001112233@s.whatsapp.net",
      getSyncSource: () => syncSource,
    };
  };

  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory,
    syncRepo: repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  await session.connect();
  await new Promise((r) => setTimeout(r, 20));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: RequestActor }).actor = actor();
    next();
  });
  app.use("/api/whatsapp-web", createWhatsAppWebRouter({ session }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;

  const startRes = await fetch(`${base}/api/whatsapp-web/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(startRes.status, 200);
  const startBody = await startRes.json();
  assert.equal(startBody.success, true);
  assert.ok(
    startBody.data.status === "starting" ||
      startBody.data.status === "running" ||
      startBody.data.status === "completed"
  );

  // Wait for job completion
  let final = startBody.data;
  for (let i = 0; i < 40; i += 1) {
    const st = await fetch(`${base}/api/whatsapp-web/sync`);
    const body = await st.json();
    final = body.data;
    if (final.status === "completed" || final.status === "failed") break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(final.status, "completed");
  assert.ok(final.messagesImported >= 1);

  // Non-admin forbidden
  const forbiddenApp = express();
  forbiddenApp.use(express.json());
  forbiddenApp.use((req, _res, next) => {
    (req as express.Request & { actor?: RequestActor }).actor = {
      ...actor("Sales"),
      role: "Sales",
    };
    next();
  });
  forbiddenApp.use("/api/whatsapp-web", createWhatsAppWebRouter({ session }));
  const forbiddenServer = createServer(forbiddenApp);
  await new Promise<void>((resolve) =>
    forbiddenServer.listen(0, "127.0.0.1", resolve)
  );
  const fAddr = forbiddenServer.address();
  assert.ok(fAddr && typeof fAddr === "object");
  const forbidden = await fetch(
    `http://127.0.0.1:${fAddr.port}/api/whatsapp-web/sync`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
  );
  assert.equal(forbidden.status, 403);

  await session.disconnect();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await new Promise<void>((resolve, reject) =>
    forbiddenServer.close((err) => (err ? reject(err) : resolve()))
  );
  await fs.promises.rm(authDir, { recursive: true, force: true });
}
console.log("PASS: admin sync API + tenant auth unchanged (non-admin 403)");

{
  // Race: live newer timestamp interleaved with older backfill write.
  const racy = { lastMessageAt: null as string | null };
  const older = "2026-07-20T10:00:00.000Z";
  const newer = "2026-07-24T18:00:00.000Z";
  const p1 = racyAdvanceLastMessageAt(racy, older, 30);
  await new Promise((r) => setTimeout(r, 5));
  atomicAdvanceLastMessageAt(racy, newer); // live wins mid-flight
  await p1;
  assert.equal(
    racy.lastMessageAt,
    older,
    "racy path incorrectly overwrote newer with older"
  );

  const atomic = { lastMessageAt: null as string | null };
  assert.equal(atomicAdvanceLastMessageAt(atomic, older), true); // null → set
  assert.equal(atomic.lastMessageAt, older);
  assert.equal(atomicAdvanceLastMessageAt(atomic, older), false); // equal → no
  assert.equal(atomicAdvanceLastMessageAt(atomic, newer), true); // newer → yes
  assert.equal(atomicAdvanceLastMessageAt(atomic, older), false); // older → no
  assert.equal(atomic.lastMessageAt, newer);

  const repo = new InMemoryWhatsAppRepository();
  const channel = await repo.resolveOrCreateChannel({
    phoneNumberId: WHATSAPP_WEB_QR_CHANNEL_PHONE_NUMBER_ID,
  });
  const contact = await repo.resolveOrCreateContact({ phoneE164: "923009998877" });
  const conversation = await repo.resolveOrCreateOpenConversation({
    channelId: channel.id,
    contactId: contact.id,
  });
  await repo.advanceConversationLastMessageAt!(
    conversation.id,
    newer,
    DEFAULT_COMPANY_ID
  );
  const advanced = await repo.advanceConversationLastMessageAt!(
    conversation.id,
    older,
    DEFAULT_COMPANY_ID
  );
  assert.equal(advanced, false);
  const bundle = await repo.getConversationBundle(conversation.id, DEFAULT_COMPANY_ID);
  assert.equal(bundle?.conversation.lastMessageAt, newer);
  // Wrong company must not mutate.
  assert.equal(
    await repo.advanceConversationLastMessageAt!(
      conversation.id,
      "2026-07-25T00:00:00.000Z",
      "other_company"
    ),
    false
  );
  assert.equal(
    (await repo.getConversationBundle(conversation.id))?.conversation.lastMessageAt,
    newer
  );
}
console.log("PASS: atomic last_message_at max + race regression + company scope");

{
  const repo = new InMemoryWhatsAppRepository();
  const created = await syncWhatsAppWebContact(
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      savedName: "Saved",
      pushName: "Push",
      shortName: null,
      isBusiness: false,
    },
    { repo }
  );
  assert.equal(
    await repo.updateContactSyncFields!(
      created.contact.id,
      { profileName: "X" },
      "other_company"
    ),
    null
  );
  const still = await repo.findContactByPhoneE164("923009998877", DEFAULT_COMPANY_ID);
  assert.equal(still?.profileName, "Saved");
  assert.equal(
    await repo.findContactByPhoneE164("923009998877", "other_company"),
    null
  );
}
console.log("PASS: company scoping on contact sync mutations");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true, "923001112233@s.whatsapp.net");
  source.ingestContacts([
    {
      id: "923009998877@s.whatsapp.net",
      name: "AddressBook",
      notify: "PushOnly",
      short: "Shorty",
    },
  ]);
  let contacts = await source.listContacts();
  assert.equal(contacts[0]?.savedName, "AddressBook");
  assert.equal(contacts[0]?.pushName, "PushOnly");
  assert.equal(contacts[0]?.shortName, "Shorty");

  // Push-only update must not wipe savedName.
  source.ingestContacts([
    {
      id: "923009998877@s.whatsapp.net",
      notify: "NewerPush",
    },
  ]);
  contacts = await source.listContacts();
  assert.equal(contacts[0]?.savedName, "AddressBook");
  assert.equal(contacts[0]?.pushName, "NewerPush");

  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Legacy CRM",
      existingSource: null,
      nextName: "WhatsApp",
      nextSource: "whatsapp_saved",
    }),
    false
  );
}
console.log("PASS: notify stays pushName; push cannot overwrite saved; legacy protected");

{
  assert.equal(
    jidToWaId("923001112233:12@s.whatsapp.net"),
    "923001112233"
  );
  assert.equal(jidToWaId("923001112233@s.whatsapp.net"), "923001112233");
  assert.equal(jidToWaId("123456789012345@lid"), null);
  assert.equal(jidToWaId("923001112233@unknown.host"), null);
  assert.equal(jidToWaId("120363@g.us"), null);
  assert.equal(jidToWaId("status@broadcast"), null);
  assert.equal(jidToWaId("123@newsletter"), null);

  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestContacts([
    { id: "123456789012345@lid", name: "LID Person", notify: "Push" },
    { id: "999@unknown.host", name: "Unknown", notify: "X" },
  ]);
  assert.equal((await source.listContacts()).length, 0);
}
console.log("PASS: device JID normalize; @lid/unknown hosts excluded");

{
  const repo = new InMemoryWhatsAppRepository();
  const empty = new FakeSyncSource();
  empty.messagesByChat.clear();
  empty.chats = [];
  empty.contacts = [];
  const service = new WhatsAppWebHistorySyncService({
    source: empty,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const snap = await service.startOrJoin().done;
  assert.equal(snap.status, "completed");
  assert.equal(snap.historyCoverage, "empty");
  assert.equal(snap.historySourceReady, false);
  assert.equal(snap.messagesImported, 0);
  assert.ok(
    String(snap.errorSummary || "").includes("full 7-day") ||
      String(snap.errorSummary || "").includes("available")
  );

  const partial = new FakeSyncSource();
  partial.providerHistoryEventObserved = true;
  partial.chats = [
    {
      jid: "923009998877@s.whatsapp.net",
      phoneE164: "923009998877",
      name: "Ali",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  partial.messagesByChat.set("923009998877@s.whatsapp.net", [
    {
      providerMessageId: "P1",
      chatJid: "923009998877@s.whatsapp.net",
      fromMe: false,
      text: "recent only",
      messageType: "text",
      occurredAt: "2026-07-22T10:00:00.000Z",
    },
  ]);
  const service2 = new WhatsAppWebHistorySyncService({
    source: partial,
    repo: new InMemoryWhatsAppRepository(),
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const snap2 = await service2.startOrJoin().done;
  assert.equal(snap2.historyCoverage, "available_only");
  assert.equal(snap2.historyProviderEventObserved, true);
  assert.ok(snap2.historyOldestAvailableAt);
  assert.notEqual(snap2.historyCoverage as string, "complete");
}
console.log("PASS: empty/unready history cannot claim full 7-day; partial reported");

// ---------------------------------------------------------------------------
// SYNC-1B — request-ID correlation + retryable in-flight state
// ---------------------------------------------------------------------------

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true, "923001112233@s.whatsapp.net");
  source.ingestChats([{ id: "923009998877@s.whatsapp.net", name: "A" }]);
  source.ingestMessages([
    {
      key: {
        id: "CURSOR_A",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "seed" },
    },
  ]);

  let fetchCount = 0;
  source.setHistoryFetcher(async () => {
    fetchCount += 1;
    return fetchCount === 1 ? "req-A" : "req-B";
  });

  const waitA = source.requestBoundedHistory("923009998877@s.whatsapp.net", {
    limit: 50,
    waitMs: 500,
  });
  // Allow waiter registration
  await new Promise((r) => setTimeout(r, 10));

  // Unrelated / null events must not release A
  source.handleHistorySet({
    peerDataRequestSessionId: null,
    messages: [
      {
        key: {
          id: "UNRELATED",
          remoteJid: "923009998877@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: Math.floor(
          Date.parse("2026-07-21T10:00:00.000Z") / 1000
        ),
        message: { conversation: "initial" },
      },
    ],
  });
  source.handleHistorySet({
    peerDataRequestSessionId: "req-OTHER",
    messages: [],
  });
  assert.equal(source.__testPendingWaitCount(), 1);

  // Concurrent chat B must not be released by A's event either.
  source.ingestChats([{ id: "923008887766@s.whatsapp.net", name: "B" }]);
  source.ingestMessages([
    {
      key: {
        id: "CURSOR_B",
        remoteJid: "923008887766@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T11:00:00.000Z") / 1000),
      message: { conversation: "seed-b" },
    },
  ]);
  const waitB = source.requestBoundedHistory("923008887766@s.whatsapp.net", {
    limit: 50,
    waitMs: 500,
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(source.__testPendingWaitCount(), 2);

  source.handleHistorySet({
    peerDataRequestSessionId: "req-A",
    messages: [
      {
        key: {
          id: "HIST_A1",
          remoteJid: "923009998877@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: Math.floor(
          Date.parse("2026-07-20T09:00:00.000Z") / 1000
        ),
        message: { conversation: "older-a" },
      },
    ],
  });
  assert.equal(await waitA, true);
  assert.equal(source.__testPendingWaitCount(), 1);

  // B still waiting — A's event did not release it
  let bDone = false;
  void waitB.then(() => {
    bDone = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bDone, false);

  source.handleHistorySet({
    peerDataRequestSessionId: "req-B",
    messages: [
      {
        key: {
          id: "HIST_B1",
          remoteJid: "923008887766@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: Math.floor(
          Date.parse("2026-07-20T08:00:00.000Z") / 1000
        ),
        message: { conversation: "older-b" },
      },
    ],
  });
  assert.equal(await waitB, true);

  // Matching event messages were ingested before waitA resolved (before return).
  source.setHistoryFetcher(async () => {
    queueMicrotask(() =>
      source.handleHistorySet({ peerDataRequestSessionId: "req-read" })
    );
    return "req-read";
  });
  const msgs = await source.fetchMessages("923009998877@s.whatsapp.net", {
    limit: 80,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.ok(msgs.some((m) => m.providerMessageId === "HIST_A1"));
}
console.log("PASS: request-ID correlation isolates concurrent chats");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestChats([{ id: "923009998877@s.whatsapp.net" }]);
  source.ingestMessages([
    {
      key: {
        id: "CUR",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "seed" },
    },
  ]);

  // Event arrives immediately after fetch returns id, before waiter registers.
  source.setHistoryFetcher(async () => {
    queueMicrotask(() => {
      source.handleHistorySet({
        peerDataRequestSessionId: "req-race",
        messages: [
          {
            key: {
              id: "EARLY",
              remoteJid: "923009998877@s.whatsapp.net",
              fromMe: false,
            },
            messageTimestamp: Math.floor(
              Date.parse("2026-07-20T10:00:00.000Z") / 1000
            ),
            message: { conversation: "early" },
          },
        ],
      });
    });
    return "req-race";
  });

  const matched = await source.requestBoundedHistory(
    "923009998877@s.whatsapp.net",
    { limit: 50, waitMs: 300 }
  );
  assert.equal(matched, true);
  const msgs = await source.fetchMessages("923009998877@s.whatsapp.net", {
    limit: 10,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.ok(msgs.some((m) => m.providerMessageId === "EARLY"));
}
console.log("PASS: early matching history event is not lost");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestChats([{ id: "923009998877@s.whatsapp.net" }]);
  source.ingestMessages([
    {
      key: {
        id: "CUR1",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "seed" },
    },
  ]);

  const cursors: string[] = [];
  let n = 0;
  source.setHistoryFetcher(async (_count, key) => {
    cursors.push(String(key.id || ""));
    n += 1;
    return `req-${n}`;
  });

  // Timeout cleans up and permits retry
  const timedOut = await source.requestBoundedHistory(
    "923009998877@s.whatsapp.net",
    { limit: 50, waitMs: 40 }
  );
  assert.equal(timedOut, false);
  assert.equal(source.__testPendingWaitCount(), 0);
  assert.equal(source.__testHasInFlightHistory("923009998877@s.whatsapp.net"), false);

  // Provider failure cleans up and permits retry
  source.setHistoryFetcher(async () => {
    throw new Error("provider_failed");
  });
  assert.equal(
    await source.requestBoundedHistory("923009998877@s.whatsapp.net", {
      limit: 50,
      waitMs: 100,
    }),
    false
  );
  assert.equal(source.__testHasInFlightHistory("923009998877@s.whatsapp.net"), false);

  // Later sync can request next page with new oldest cursor
  source.ingestMessages([
    {
      key: {
        id: "OLDER_PAGE",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-19T10:00:00.000Z") / 1000),
      message: { conversation: "page" },
    },
  ]);
  source.setHistoryFetcher(async (_count, key) => {
    cursors.push(String(key.id || ""));
    queueMicrotask(() => {
      source.handleHistorySet({ peerDataRequestSessionId: "req-page2" });
    });
    return "req-page2";
  });
  assert.equal(
    await source.requestBoundedHistory("923009998877@s.whatsapp.net", {
      limit: 50,
      waitMs: 200,
    }),
    true
  );
  assert.ok(cursors.includes("OLDER_PAGE") || cursors.includes("CUR1"));
  assert.equal(cursors[cursors.length - 1], "OLDER_PAGE");
}
console.log("PASS: timeout/failure cleanup + retry with new oldest cursor");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestChats([{ id: "923009998877@s.whatsapp.net" }]);
  source.ingestMessages([
    {
      key: {
        id: "CUR",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "seed" },
    },
  ]);
  let providerCalls = 0;
  source.setHistoryFetcher(async () => {
    providerCalls += 1;
    return "req-dup";
  });
  const p1 = source.requestBoundedHistory("923009998877@s.whatsapp.net", {
    limit: 50,
    waitMs: 300,
  });
  const p2 = source.requestBoundedHistory("923009998877@s.whatsapp.net", {
    limit: 50,
    waitMs: 300,
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(providerCalls, 1);
  source.handleHistorySet({ peerDataRequestSessionId: "req-dup" });
  assert.deepEqual(await Promise.all([p1, p2]), [true, true]);
  assert.equal(providerCalls, 1);
}
console.log("PASS: concurrent same-chat requests do not duplicate provider calls");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestChats([{ id: "923009998877@s.whatsapp.net" }]);
  source.ingestMessages([
    {
      key: {
        id: "CUR",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "seed" },
    },
  ]);
  source.setHistoryFetcher(async () => "req-disc");
  const pending = source.requestBoundedHistory("923009998877@s.whatsapp.net", {
    limit: 50,
    waitMs: 1000,
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(source.__testPendingWaitCount(), 1);
  source.setConnected(false);
  assert.equal(await pending, false);
  assert.equal(source.__testPendingWaitCount(), 0);
  // Coverage still never reports complete
  const meta = source.getHistoryCoverageMeta(Date.parse("2026-07-17T00:00:00.000Z"));
  assert.notEqual(meta.coverage as string, "complete");
}
console.log("PASS: disconnect clears pending waits; coverage never complete");

console.log("ALL PASS: whatsappWebHistorySync");
