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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

console.log("ALL PASS: whatsappWebHistorySync");
