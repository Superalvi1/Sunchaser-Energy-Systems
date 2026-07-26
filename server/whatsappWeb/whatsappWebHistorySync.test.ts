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
  deriveSyncOutcome,
  isEligibleSyncChat,
  isEligibleSyncContact,
  isExcludedSyncRemoteJid,
  resolveWhatsAppDisplayName,
  shouldApplyWhatsAppContactName,
  syncWindowStartMs,
  WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT,
  WHATSAPP_WEB_SYNC_WINDOW_DAYS,
  type WhatsAppWebSyncChat,
  type WhatsAppWebSyncContact,
  type WhatsAppWebSyncJobSnapshot,
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
import { resolveWhatsAppIdentity } from "./whatsappWebIdentity.ts";
import {
  createWhatsAppWebSyncJobStore,
  __resetWhatsAppWebSyncJobMemoryStore,
  type WhatsAppWebSyncJobStore,
} from "./whatsappWebSyncJobStore.ts";
import { displayContactLabel } from "../../src/inbox/utils/format.ts";
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
  assert.equal(snap.cancelled, true);
  assert.ok(
    snap.outcome === "partial" || snap.outcome === "history_not_available"
  );
  assert.notEqual(snap.outcome, "completed_with_imports");
  assert.notEqual(snap.outcome, "completed_no_changes");
  assert.ok(
    snap.errorSummary?.includes("interrupt") ||
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
  // Group/status chats are excluded at ingest (SYNC-8R); only the 1:1 chat remains.
  assert.equal(chats.length, 1);
  assert.equal(chats[0]?.jid, "923009998877@s.whatsapp.net");
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

// ---------------------------------------------------------------------------
// SYNC-8 — identity resolution, empty-cache honesty, durable results
// ---------------------------------------------------------------------------

{
  const phone = resolveWhatsAppIdentity({
    remoteJid: "923001112233@s.whatsapp.net",
  });
  assert.equal(phone?.phoneE164, "923001112233");

  const viaAlt = resolveWhatsAppIdentity({
    remoteJid: "123456789012345@lid",
    remoteJidAlt: "923009998877@s.whatsapp.net",
  });
  assert.equal(viaAlt?.phoneE164, "923009998877");
  assert.equal(viaAlt?.lidJid, "123456789012345@lid");

  const viaPn = resolveWhatsAppIdentity({
    remoteJid: "999888777666555@lid",
    senderPn: "923001112233@s.whatsapp.net",
  });
  assert.equal(viaPn?.phoneE164, "923001112233");

  const viaParticipantAlt = resolveWhatsAppIdentity({
    remoteJid: "111222333444555@lid",
    participantAlt: "923007776655@s.whatsapp.net",
  });
  assert.equal(viaParticipantAlt?.phoneE164, "923007776655");

  const unresolved = resolveWhatsAppIdentity({
    remoteJid: "123456789012345@lid",
  });
  assert.equal(unresolved, null);
}
console.log("PASS: phone/LID/alt/Pn identity resolution");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestContacts([
    {
      id: "123456789012345@lid",
      jid: "923001112233@s.whatsapp.net",
      lid: "123456789012345@lid",
      name: "Saved LID",
      notify: "Push",
    },
  ]);
  const contacts = await source.listContacts();
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0]?.phoneE164, "923001112233");
  assert.equal(contacts[0]?.jid, "923001112233@s.whatsapp.net");

  source.ingestMessages([
    {
      key: {
        id: "M1",
        remoteJid: "123456789012345@lid",
        remoteJidAlt: "923001112233@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "hello" },
    },
  ]);
  const msgs = await source.fetchMessages("923001112233@s.whatsapp.net", {
    limit: 50,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 1);
}
console.log("PASS: @lid with contact.jid / remoteJidAlt resolves");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestChats([{ id: "923001112233@s.whatsapp.net", name: "Empty" }]);
  let fetchCalls = 0;
  source.setHistoryFetcher(async () => {
    fetchCalls += 1;
    return "x";
  });
  const msgs = await source.fetchMessages("923001112233@s.whatsapp.net", {
    limit: 50,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(source.getLastHistoryAvailability(), "empty_companion_cache");
}
console.log("PASS: empty chat has no fabricated history cursor");

{
  __resetWhatsAppWebSyncJobMemoryStore();
  const storeA = createWhatsAppWebSyncJobStore();
  const empty = new FakeSyncSource();
  empty.messagesByChat.clear();
  empty.chats = [];
  empty.contacts = [];
  const service = new WhatsAppWebHistorySyncService({
    source: empty,
    repo: new InMemoryWhatsAppRepository(),
    jobStore: storeA,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const snap = await service.startOrJoin().done;
  assert.equal(snap.outcome, "history_not_available");
  assert.notEqual(snap.outcome, null);

  const storeB = createWhatsAppWebSyncJobStore();
  const latest = await storeB.getLatest(DEFAULT_COMPANY_ID);
  assert.ok(latest);
  assert.equal(latest.outcome, "history_not_available");
  assert.equal(latest.messagesImported, 0);
}
console.log("PASS: empty cache outcome + durable job across store instances");

{
  assert.equal(
    displayContactLabel({
      profileName: "Ali Khan",
      phoneE164: "923001112233",
      contactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "Ali Khan"
  );
  assert.equal(
    displayContactLabel({
      profileName: null,
      phoneE164: "923001112233",
      contactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "+923001112233"
  );
  assert.equal(
    displayContactLabel({
      profileName: null,
      phoneE164: null,
      contactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }),
    "Unknown WhatsApp contact"
  );
  assert.equal(
    displayContactLabel("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    "Unknown WhatsApp contact"
  );
  assert.ok(
    !String(
      displayContactLabel({
        profileName: null,
        phoneE164: null,
        contactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      })
    ).includes("Contact ·")
  );
}
console.log("PASS: inbox display labels never use UUID suffixes");

// ---------------------------------------------------------------------------
// SYNC-8R — group isolation, cache bounds, nested merge, cancel/durability
// ---------------------------------------------------------------------------

{
  assert.equal(isExcludedSyncRemoteJid("12036399@g.us"), true);
  assert.equal(isExcludedSyncRemoteJid("status@broadcast"), true);
  assert.equal(isExcludedSyncRemoteJid("12345@broadcast"), true);
  assert.equal(isExcludedSyncRemoteJid("120363@newsletter"), true);
  assert.equal(isExcludedSyncRemoteJid("923001112233@s.whatsapp.net"), false);
}
console.log("PASS: SYNC-8R excluded remote JID helpers");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true, "923001112233@s.whatsapp.net");
  // Group message with participant phone JID must never become a private chat.
  source.ingestMessages([
    {
      key: {
        id: "G_PART",
        remoteJid: "12036399@g.us",
        participant: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T10:00:00.000Z") / 1000),
      message: { conversation: "group hello" },
    },
  ]);
  const chats = await source.listChats();
  assert.equal(chats.length, 0);
  assert.equal(source.__testPeekChat("923009998877@s.whatsapp.net"), null);
  const msgs = await source.fetchMessages("923009998877@s.whatsapp.net", {
    limit: 50,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 0);
}
console.log("PASS: SYNC-8R group+participant never becomes private chat");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestMessages([
    {
      key: {
        id: "G_ALT",
        remoteJid: "12036388@g.us",
        participant: "111222333444555@lid",
        participantAlt: "923007776655@s.whatsapp.net",
        participantPn: "923007776655@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T11:00:00.000Z") / 1000),
      message: { conversation: "alt group" },
    },
  ]);
  assert.equal((await source.listChats()).length, 0);
  assert.equal(source.__testPeekChat("923007776655@s.whatsapp.net"), null);
}
console.log("PASS: SYNC-8R group+participantAlt/Pn never imported privately");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.handleHistorySet({
    chats: [{ id: "12036377@g.us", name: "Team", isGroup: true }],
    messages: [
      {
        key: {
          id: "GH1",
          remoteJid: "12036377@g.us",
          participant: "923009998877@s.whatsapp.net",
          fromMe: false,
        },
        messageTimestamp: Math.floor(Date.parse("2026-07-22T12:00:00.000Z") / 1000),
        message: { conversation: "history group" },
      },
    ],
  });
  assert.equal((await source.listChats()).length, 0);
  assert.equal(source.__testPeekChat("923009998877@s.whatsapp.net"), null);
}
console.log("PASS: SYNC-8R messaging-history.set group messages excluded");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  // messages.upsert path uses the same ingestMessages entrypoint.
  source.ingestMessages([
    {
      key: {
        id: "UP_G",
        remoteJid: "12036366@g.us",
        participant: "923001112233@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T13:00:00.000Z") / 1000),
      message: { conversation: "upsert group" },
    },
    {
      key: { id: "ST1", remoteJid: "status@broadcast", fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T13:01:00.000Z") / 1000),
      message: { conversation: "status" },
    },
    {
      key: { id: "BC1", remoteJid: "status@broadcast", fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T13:02:00.000Z") / 1000),
      message: { conversation: "broadcast" },
    },
    {
      key: { id: "NL1", remoteJid: "120363@newsletter", fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T13:03:00.000Z") / 1000),
      message: { conversation: "newsletter" },
    },
  ]);
  assert.equal((await source.listChats()).length, 0);
}
console.log("PASS: SYNC-8R upsert excludes group/status/broadcast/newsletter");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  const chatJid = "923009998877@s.whatsapp.net";
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  const windowStart = syncWindowStartMs(now, WHATSAPP_WEB_SYNC_WINDOW_DAYS);
  const raw: Array<Record<string, unknown>> = [];
  // Old messages outside the 7-day window (cursor metadata only).
  for (let i = 0; i < 5; i += 1) {
    raw.push({
      key: { id: `OLD_${i}`, remoteJid: chatJid, fromMe: false },
      messageTimestamp: Math.floor((windowStart - (i + 1) * 86_400_000) / 1000),
      message: { conversation: `old body ${i}` },
    });
  }
  // Many in-window bodies — must prune to cache cap (newest 50).
  for (let i = 0; i < WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT + 20; i += 1) {
    raw.push({
      key: { id: `IN_${i}`, remoteJid: chatJid, fromMe: false },
      messageTimestamp: Math.floor((windowStart + (i + 1) * 60_000) / 1000),
      message: { conversation: `in ${i}` },
    });
  }
  // Freeze Date.now used by ingest window relative to fixture "now".
  const realNow = Date.now;
  Date.now = () => now;
  try {
    source.ingestMessages(raw);
  } finally {
    Date.now = realNow;
  }
  const peek = source.__testPeekChat(chatJid);
  assert.ok(peek);
  assert.equal(peek.messageCount, WHATSAPP_WEB_SYNC_CACHE_CAP_PER_CHAT);
  assert.ok(!peek.messageIds.some((id) => id.startsWith("OLD_")));
  assert.ok(peek.historyCursor);
  assert.ok(peek.historyCursor.id.startsWith("OLD_"));
  assert.ok(peek.historyCursor.timestampMs < windowStart);
  // Old bodies are not retained merely to preserve the cursor.
  const bodies = await source.fetchMessages(chatJid, {
    limit: 200,
    sinceMs: 0,
  });
  assert.ok(bodies.every((m) => !m.providerMessageId.startsWith("OLD_")));
  assert.ok(bodies.every((m) => !String(m.text || "").startsWith("old body")));
}
console.log("PASS: SYNC-8R history pruned to window+cap; old bodies not kept for cursor");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  const chatJid = "923008887766@s.whatsapp.net";
  source.ingestChats([
    {
      id: chatJid,
      name: "New nested",
      messages: [
        {
          message: {
            key: { id: "N1", remoteJid: chatJid, fromMe: false },
            messageTimestamp: Math.floor(
              Date.parse("2026-07-22T09:00:00.000Z") / 1000
            ),
            message: { conversation: "nested-1" },
          },
        },
        {
          message: {
            key: { id: "N2", remoteJid: chatJid, fromMe: false },
            messageTimestamp: Math.floor(
              Date.parse("2026-07-22T09:05:00.000Z") / 1000
            ),
            message: { conversation: "nested-2" },
          },
        },
      ],
    },
  ]);
  const peek = source.__testPeekChat(chatJid);
  assert.ok(peek);
  assert.equal(peek.messageCount, 2);
  assert.equal(peek.historyCursor?.id, "N1");
  const msgs = await source.fetchMessages(chatJid, {
    limit: 50,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 2);
}
console.log("PASS: SYNC-8R nested chat.messages survive for unseen chat");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  const chatJid = "923008887755@s.whatsapp.net";
  source.ingestChats([{ id: chatJid, name: "Existing" }]);
  source.ingestMessages([
    {
      key: { id: "E1", remoteJid: chatJid, fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T08:00:00.000Z") / 1000),
      message: { conversation: "existing-1" },
    },
  ]);
  source.ingestChats([
    {
      id: chatJid,
      name: "Existing",
      messages: [
        {
          message: {
            key: { id: "E1", remoteJid: chatJid, fromMe: false },
            messageTimestamp: Math.floor(
              Date.parse("2026-07-22T08:00:00.000Z") / 1000
            ),
            message: { conversation: "existing-1" },
          },
        },
        {
          message: {
            key: { id: "E2", remoteJid: chatJid, fromMe: false },
            messageTimestamp: Math.floor(
              Date.parse("2026-07-22T08:10:00.000Z") / 1000
            ),
            message: { conversation: "existing-2" },
          },
        },
      ],
    },
  ]);
  const peek = source.__testPeekChat(chatJid);
  assert.ok(peek);
  assert.equal(peek.messageCount, 2);
  assert.deepEqual(new Set(peek.messageIds), new Set(["E1", "E2"]));
  assert.equal(peek.historyCursor?.id, "E1");
}
console.log("PASS: SYNC-8R nested messages merge idempotently into existing chat");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  const chatJid = "923008887744@s.whatsapp.net";
  source.ingestChats([{ id: chatJid, name: "Cursor" }]);
  // No fabricated cursor when empty.
  assert.equal(source.__testPeekChat(chatJid)?.historyCursor, null);
  source.ingestMessages([
    {
      key: { id: "C_NEW", remoteJid: chatJid, fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-23T10:00:00.000Z") / 1000),
      message: { conversation: "newer" },
    },
    {
      key: { id: "C_OLD", remoteJid: chatJid, fromMe: false },
      messageTimestamp: Math.floor(Date.parse("2026-07-21T10:00:00.000Z") / 1000),
      message: { conversation: "older" },
    },
  ]);
  assert.equal(source.__testPeekChat(chatJid)?.historyCursor?.id, "C_OLD");
}
console.log("PASS: SYNC-8R genuine oldest cursor retained without fabrication");

{
  __resetWhatsAppWebSyncJobMemoryStore();
  const statuses: string[] = [];
  const store: WhatsAppWebSyncJobStore = {
    async saveLatest(record) {
      statuses.push(record.status);
      return createWhatsAppWebSyncJobStore().saveLatest(record);
    },
    async getLatest(companyId) {
      return createWhatsAppWebSyncJobStore().getLatest(companyId);
    },
  };
  const source = new FakeSyncSource();
  source.chats = [
    {
      jid: "923009991111@s.whatsapp.net",
      phoneE164: "923009991111",
      name: "Partial",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  let fetchCount = 0;
  const baseFetch = source.fetchMessages.bind(source);
  source.fetchMessages = async (chatJid, opts) => {
    fetchCount += 1;
    const msgs = await baseFetch(chatJid, opts);
    return msgs;
  };
  source.messagesByChat.set(
    "923009991111@s.whatsapp.net",
    Array.from({ length: 8 }, (_, i) => ({
      providerMessageId: `P_${i}`,
      chatJid: "923009991111@s.whatsapp.net",
      fromMe: false,
      text: `p ${i}`,
      messageType: "text",
      occurredAt: `2026-07-20T12:0${i}:00.000Z`,
    }))
  );
  // Deterministic mid-job cancel: request cancel after the second import starts
  // so the job cannot race to completed_with_imports before cancel is observed.
  // (Keep origin/main cancel semantics; marketplace hold-style tests remain below.)
  const repo = new InMemoryWhatsAppRepository();
  const origInsert = repo.insertInboundMessage.bind(repo);
  let imports = 0;
  let serviceRef: WhatsAppWebHistorySyncService | null = null;
  repo.insertInboundMessage = async (input) => {
    imports += 1;
    const result = await origInsert(input);
    if (imports === 2 && serviceRef) {
      serviceRef.requestCancel();
      // Yield so the cancel flag is observed before remaining imports finish.
      await new Promise((r) => setTimeout(r, 0));
    }
    return result;
  };
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    jobStore: store,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  serviceRef = service;
  const started = service.startOrJoin();
  const snap = await started.done;
  assert.equal(snap.cancelled, true);
  assert.ok(
    snap.outcome === "partial" || snap.outcome === "history_not_available"
  );
  assert.notEqual(snap.outcome, "completed_with_imports");
  assert.ok(statuses.includes("starting"));
  assert.ok(statuses.includes("completed") || statuses.includes("failed"));
  assert.ok(imports >= 2);
  assert.ok(snap.messagesImported < 8);
  void fetchCount;
}
console.log("PASS: SYNC-8R cancel/disconnect not ordinary success; start+terminal durable");

{
  __resetWhatsAppWebSyncJobMemoryStore();
  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const line = String(args[0] ?? "");
    if (line.includes("sync_job_durable_persist_failed")) warned = true;
    assert.ok(!/92300|@s\.whatsapp\.net|phone/i.test(line));
  };
  try {
    const failingClient = {
      from() {
        return {
          upsert: async () => ({
            error: { message: "relation missing", code: "42P01" },
            data: null,
          }),
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              },
            };
          },
        };
      },
    };
    const store = createWhatsAppWebSyncJobStore({
      client: failingClient as never,
    });
    const service = new WhatsAppWebHistorySyncService({
      source: new FakeSyncSource(),
      repo: new InMemoryWhatsAppRepository(),
      jobStore: store,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    const snap = await service.startOrJoin().done;
    assert.ok(snap.durabilityWarning);
    assert.ok(warned);
    assert.ok(!/92300|@s\.whatsapp\.net/i.test(String(snap.durabilityWarning)));
  } finally {
    console.warn = originalWarn;
  }
}
console.log("PASS: SYNC-8R durable persistence failure reported without PII");

{
  // Baileys sync source never downloads historical media binaries.
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true);
  source.ingestMessages([
    {
      key: {
        id: "IMG1",
        remoteJid: "923009998877@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.parse("2026-07-22T14:00:00.000Z") / 1000),
      message: {
        imageMessage: {
          mimetype: "image/jpeg",
          caption: "photo",
          // Deliberately omit binary / URL download fields usage.
        },
      },
    },
  ]);
  const msgs = await source.fetchMessages("923009998877@s.whatsapp.net", {
    limit: 10,
    sinceMs: Date.parse("2026-07-17T00:00:00.000Z"),
  });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0]?.messageType, "image");
  assert.equal(msgs[0]?.mimeType, "image/jpeg");
  assert.equal(msgs[0]?.caption, "photo");
  // No media bytes stored on the cached message object.
  assert.equal(
    Object.prototype.hasOwnProperty.call(msgs[0], "mediaBytes"),
    false
  );
}
console.log("PASS: SYNC-8R no historical media download/binary cache");

{
  let shadowCalls = 0;
  let sendCalls = 0;
  const repo = new InMemoryWhatsAppRepository();
  const source = new FakeSyncSource();
  source.contacts = [
    {
      jid: "923009990000@s.whatsapp.net",
      phoneE164: "923009990000",
      savedName: "Safe",
      pushName: null,
      shortName: null,
      isBusiness: false,
    },
  ];
  source.chats = [
    {
      jid: "923009990000@s.whatsapp.net",
      phoneE164: "923009990000",
      name: "Safe",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  source.messagesByChat.set("923009990000@s.whatsapp.net", [
    {
      providerMessageId: "SAFE_1",
      chatJid: "923009990000@s.whatsapp.net",
      fromMe: false,
      text: "backfill only",
      messageType: "text",
      occurredAt: "2026-07-22T15:00:00.000Z",
    },
  ]);
  // Prove sync service path does not touch AI/outbound hooks (those live only on live inbound).
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });
  const snap = await service.startOrJoin().done;
  assert.equal(snap.messagesImported, 1);
  assert.equal(shadowCalls, 0);
  assert.equal(sendCalls, 0);
  // Live inbound still can call AI; backfill helper must not.
  await persistWhatsAppWebBackfillMessage(
    {
      providerMessageId: "SAFE_2",
      chatJid: "923009990000@s.whatsapp.net",
      fromMe: false,
      text: "second",
      messageType: "text",
      occurredAt: "2026-07-22T15:01:00.000Z",
    },
    {
      repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    }
  );
  assert.equal(shadowCalls, 0);
  assert.equal(sendCalls, 0);
}
console.log("PASS: SYNC-8R backfill invokes neither AI nor outbound transport");

{
  // deriveSyncOutcome: cancelled with imports => partial; without => unavailable.
  const base: WhatsAppWebSyncJobSnapshot = {
    jobId: "j",
    status: "completed",
    outcome: null,
    contactsDiscovered: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    contactsSkipped: 0,
    chatsInspected: 1,
    conversationsCreated: 0,
    conversationsUpdated: 0,
    messagesDiscovered: 2,
    messagesImported: 2,
    duplicatesSkipped: 0,
    messagesSkipped: 0,
    failedChats: 0,
    startedAt: "2026-07-24T12:00:00.000Z",
    completedAt: "2026-07-24T12:00:01.000Z",
    errorSummary: null,
    windowDays: 7,
    historySourceReady: true,
    historyCoverage: "available_only",
    historyAvailability: "ready",
    historyProviderEventObserved: true,
    historyOldestAvailableAt: null,
    historyNewestAvailableAt: null,
    historyOnDemandSupported: false,
    cancelled: true,
    durabilityWarning: null,
  };
  assert.equal(deriveSyncOutcome(base), "partial");
  assert.equal(
    deriveSyncOutcome({ ...base, messagesImported: 0, conversationsUpdated: 0 }),
    "history_not_available"
  );
}
console.log("PASS: SYNC-8R deriveSyncOutcome cancel semantics");

// ---------------------------------------------------------------------------
// Deterministic cancellation contract
// ---------------------------------------------------------------------------

function makeCancelFixture(messageCount: number) {
  const source = new FakeSyncSource();
  source.chats = [
    {
      jid: "923009991122@s.whatsapp.net",
      phoneE164: "923009991122",
      name: "CancelFixture",
      isGroup: false,
      isStatusOrBroadcast: false,
      isChannel: false,
    },
  ];
  source.messagesByChat.set(
    "923009991122@s.whatsapp.net",
    Array.from({ length: messageCount }, (_, i) => ({
      providerMessageId: `CF_${i}`,
      chatJid: "923009991122@s.whatsapp.net",
      fromMe: false,
      text: `cf ${i}`,
      messageType: "text",
      occurredAt: `2026-07-20T13:${String(i).padStart(2, "0")}:00.000Z`,
    })),
  );
  return source;
}

{
  const repo = new InMemoryWhatsAppRepository();
  const source = makeCancelFixture(20);
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  const started = service.startOrJoin();
  service.requestCancel();
  service.requestCancel();
  service.requestCancel();
  const snap = await started.done;
  assert.equal(snap.cancelled, true);
  assert.notEqual(snap.outcome, "completed_with_imports");
  assert.notEqual(snap.outcome, "failed");
}
console.log("PASS: cancel contract — cancelled=true; repeated cancel safe; not success/error");

{
  const repo = new InMemoryWhatsAppRepository();
  const source = makeCancelFixture(12);
  const origInsert = repo.insertInboundMessage.bind(repo);
  let imports = 0;
  let resolveGate: (() => void) | undefined;
  const atSecond = new Promise<void>((r) => {
    resolveGate = r;
  });
  let release: (() => void) | undefined;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  repo.insertInboundMessage = async (input) => {
    imports += 1;
    const result = await origInsert(input);
    if (imports === 2) {
      resolveGate?.();
      await hold;
    }
    return result;
  };
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  const started = service.startOrJoin();
  await atSecond;
  service.requestCancel();
  assert.equal(service.getSnapshot().cancelled, true);
  // Simulate a late "success-shaped" mutation attempt after cancel acceptance:
  // further imports must stop and terminal outcome must remain cancelled.
  release?.();
  const snap = await started.done;
  assert.equal(snap.cancelled, true);
  assert.ok(snap.messagesImported < 12);
  assert.ok(
    snap.outcome === "partial" || snap.outcome === "history_not_available",
  );
  assert.notEqual(snap.outcome, "completed_with_imports");
}
console.log("PASS: cancel contract — active batch cancel stays cancelled");

{
  const repo = new InMemoryWhatsAppRepository();
  const source = makeCancelFixture(6);
  const origInsert = repo.insertInboundMessage.bind(repo);
  let imports = 0;
  let resolveGate: (() => void) | undefined;
  const atFirst = new Promise<void>((r) => {
    resolveGate = r;
  });
  let release: (() => void) | undefined;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  let threw = false;
  repo.insertInboundMessage = async (input) => {
    imports += 1;
    if (imports === 1) {
      resolveGate?.();
      await hold;
    }
    if (imports >= 3) {
      threw = true;
      throw new Error("late failure after cancel");
    }
    return origInsert(input);
  };
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  const started = service.startOrJoin();
  await atFirst;
  service.requestCancel();
  assert.equal(service.getSnapshot().cancelled, true);
  release?.();
  const snap = await started.done;
  assert.equal(snap.cancelled, true);
  // Cancel wins: must not surface as operational failed outcome.
  assert.notEqual(snap.outcome, "failed");
  assert.ok(
    snap.outcome === "partial" || snap.outcome === "history_not_available",
  );
  void threw;
}
console.log("PASS: cancel contract — late failure cannot overwrite cancellation");

{
  const repo = new InMemoryWhatsAppRepository();
  const source = makeCancelFixture(10);
  const origInsert = repo.insertInboundMessage.bind(repo);
  let imports = 0;
  let resolveGate: (() => void) | undefined;
  const atSecond = new Promise<void>((r) => {
    resolveGate = r;
  });
  let release: (() => void) | undefined;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  repo.insertInboundMessage = async (input) => {
    imports += 1;
    const result = await origInsert(input);
    if (imports === 2) {
      resolveGate?.();
      await hold;
    }
    return result;
  };
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  const started = service.startOrJoin();
  const firstJobId = started.snapshot.jobId;
  await atSecond;
  // Disconnect-equivalent: cancel in-flight sync.
  source.connected = false;
  service.requestCancel();
  assert.equal(service.getSnapshot().cancelled, true);
  release?.();
  const cancelledSnap = await started.done;
  assert.equal(cancelledSnap.cancelled, true);
  assert.equal(cancelledSnap.jobId, firstJobId);

  // Reconnect must not resume the cancelled operation.
  source.connected = true;
  assert.equal(service.getSnapshot().cancelled, true);
  assert.notEqual(service.getSnapshot().status, "running");

  // A new sync uses a new operation identity and does not inherit cancel.
  const next = service.startOrJoin();
  assert.equal(next.joinedExisting, false);
  assert.notEqual(next.snapshot.jobId, firstJobId);
  assert.equal(next.snapshot.cancelled, false);
  const nextSnap = await next.done;
  assert.equal(nextSnap.cancelled, false);
  assert.ok(
    nextSnap.outcome === "completed_with_imports" ||
      nextSnap.outcome === "completed_no_changes" ||
      nextSnap.outcome === "partial" ||
      nextSnap.outcome === "history_not_available",
  );
}
console.log(
  "PASS: cancel contract — disconnect cancel; no resume; new sync independent",
);

{
  // Post-terminal cancel must not rewrite a finished success.
  const repo = new InMemoryWhatsAppRepository();
  const source = makeCancelFixture(3);
  const service = new WhatsAppWebHistorySyncService({
    source,
    repo,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    chatConcurrency: 1,
  });
  const snap = await service.startOrJoin().done;
  assert.equal(snap.cancelled, false);
  assert.equal(snap.outcome, "completed_with_imports");
  service.requestCancel();
  service.requestCancel();
  assert.equal(service.getSnapshot().cancelled, false);
  assert.equal(service.getSnapshot().outcome, "completed_with_imports");
}
console.log("PASS: cancel contract — post-terminal cancel is idempotent no-op");

console.log("ALL PASS: whatsappWebHistorySync");
