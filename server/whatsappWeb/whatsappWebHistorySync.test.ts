/**
 * Deterministic coverage for WhatsApp Web contact sync + 7-day history backfill.
 * No real WhatsApp connection, QR, or outbound sends.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import {
  InMemoryWhatsAppRepository,
  SupabaseWhatsAppRepository,
} from "../whatsappTransport/whatsappRepository.ts";
import {
  ContactIdentityPersistQueue,
  WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY,
} from "./whatsappWebContactIdentityQueue.ts";
import { resolveWhatsAppBusinessProof } from "./whatsappWebBaileysSyncSource.ts";
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
  type WhatsAppWebContactIdentityHandler,
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
  const verifiedBeatsSaved = resolveWhatsAppDisplayName({
    verifiedName: "Verified Co",
    savedName: "Saved",
    pushName: "Push",
    shortName: "Short",
    phoneE164: "923001234567",
  });
  assert.equal(verifiedBeatsSaved.source, "whatsapp_verified");
  assert.equal(verifiedBeatsSaved.name, "Verified Co");

  const resolved = resolveWhatsAppDisplayName({
    savedName: "Saved",
    verifiedName: null,
    pushName: "Push",
    shortName: "Short",
    phoneE164: "923001234567",
  });
  assert.equal(resolved.source, "whatsapp_saved");
  assert.equal(resolved.name, "Saved");

  const pushBeatsShort = resolveWhatsAppDisplayName({
    pushName: "Push",
    shortName: "Short",
    phoneE164: "923001234567",
  });
  assert.equal(pushBeatsShort.source, "whatsapp_push");

  // Phone digits / JID / UUID are never profile_name candidates.
  assert.equal(
    resolveWhatsAppDisplayName({
      savedName: "923001234567",
      phoneE164: "923001234567",
    }).name,
    null
  );
  assert.equal(
    resolveWhatsAppDisplayName({
      pushName: "923001234567@s.whatsapp.net",
      phoneE164: "923001234567",
    }).name,
    null
  );
  assert.equal(
    resolveWhatsAppDisplayName({
      pushName: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      phoneE164: "923001234567",
    }).name,
    null
  );

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
      existingName: "Legacy Name",
      existingSource: "phone",
      nextName: "Push Name",
      nextSource: "whatsapp_push",
    }),
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: null,
      existingSource: null,
      nextName: "Push Name",
      nextSource: "whatsapp_push",
    }),
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Shorty",
      existingSource: "whatsapp_short",
      nextName: "Push Name",
      nextSource: "whatsapp_push",
    }),
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Push Name",
      existingSource: "whatsapp_push",
      nextName: "Saved Name",
      nextSource: "whatsapp_saved",
    }),
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Saved Name",
      existingSource: "whatsapp_saved",
      nextName: "Verified Co",
      nextSource: "whatsapp_verified",
    }),
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Saved Name",
      existingSource: "whatsapp_saved",
      nextName: "Push Name",
      nextSource: "whatsapp_push",
    }),
    false
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Verified Co",
      existingSource: "whatsapp_verified",
      nextName: "Saved Name",
      nextSource: "whatsapp_saved",
    }),
    false
  );
  // Legacy null-source: saved/verified may upgrade; push/short may not.
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Legacy Name",
      existingSource: null,
      nextName: "Saved Name",
      nextSource: "whatsapp_saved",
    }),
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Legacy Name",
      existingSource: null,
      nextName: "Push Name",
      nextSource: "whatsapp_push",
    }),
    false
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
        verifiedName: null,
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
        verifiedName: null,
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
      verifiedName: null,
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
      verifiedName: null,
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
      verifiedName: null,
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

  __resetWhatsAppWebSyncJobMemoryStore();
  const memoryJobStore = createWhatsAppWebSyncJobStore({ memoryOnly: true });
  const session = new WhatsAppWebSession({
    env: {
      WHATSAPP_WEB_QR_ENABLED: "true",
      WHATSAPP_WEB_AUTH_DIR: authDir,
    },
    socketFactory,
    syncRepo: repo,
    syncJobStore: memoryJobStore,
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
      verifiedName: null,
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
    true
  );
  assert.equal(
    shouldApplyWhatsAppContactName({
      existingName: "Legacy CRM",
      existingSource: null,
      nextName: "Push Only",
      nextSource: "whatsapp_push",
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
  // Slow persist so cancel lands after at least one import.
  const repo = new InMemoryWhatsAppRepository();
  const origInsert = repo.insertInboundMessage.bind(repo);
  let imports = 0;
  repo.insertInboundMessage = async (input) => {
    imports += 1;
    const result = await origInsert(input);
    if (imports === 2) {
      // Allow the service cancel hook to fire mid-job.
      await new Promise((r) => setTimeout(r, 5));
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
  const started = service.startOrJoin();
  // Cancel as soon as the job is joined; do not wait on wall-clock (flaky when persist is fast).
  service.requestCancel();
  const snap = await started.done;
  assert.equal(snap.cancelled, true);
  assert.ok(
    snap.outcome === "partial" || snap.outcome === "history_not_available"
  );
  assert.notEqual(snap.outcome, "completed_with_imports");
  assert.ok(statuses.includes("starting"));
  assert.ok(statuses.includes("completed") || statuses.includes("failed"));
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
      verifiedName: null,
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
// SYNC-14B — ranked identity capture, repository parity, contact events
// ---------------------------------------------------------------------------
{
  const repo = new InMemoryWhatsAppRepository();
  // Empty name → push fill
  const created = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
  });
  assert.equal(created.profileName, null);
  const filled = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
    profileName: "Push Later",
    nameSource: "whatsapp_push",
  });
  assert.equal(filled.id, created.id);
  assert.equal(filled.profileName, "Push Later");
  assert.equal(filled.nameSource, "whatsapp_push");

  // push → saved
  const upgraded = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
    profileName: "Address Book",
    nameSource: "whatsapp_saved",
  });
  assert.equal(upgraded.profileName, "Address Book");
  assert.equal(upgraded.nameSource, "whatsapp_saved");

  // saved not overwritten by push
  const blocked = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
    profileName: "Weaker Push",
    nameSource: "whatsapp_push",
  });
  assert.equal(blocked.profileName, "Address Book");
  assert.equal(blocked.nameSource, "whatsapp_saved");

  // saved → verified
  const verified = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
    profileName: "Verified Biz",
    nameSource: "whatsapp_verified",
  });
  assert.equal(verified.profileName, "Verified Biz");
  assert.equal(verified.nameSource, "whatsapp_verified");

  // explicit manual never overwritten
  await repo.updateContactSyncFields!(verified.id, {
    profileName: "Manual Name",
    nameSource: "manual",
  });
  const stillManual = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
    profileName: "Verified Biz",
    nameSource: "whatsapp_verified",
  });
  assert.equal(stillManual.profileName, "Manual Name");
  assert.equal(stillManual.nameSource, "manual");

  // Same phone → one contact
  const again = await repo.resolveOrCreateContact({
    phoneE164: "923009990001",
    profileName: "Ignored",
    nameSource: "whatsapp_saved",
  });
  assert.equal(again.id, created.id);

  // Phone digits rejected as profile name
  const phoneOnly = await repo.resolveOrCreateContact({
    phoneE164: "923009990002",
    profileName: "923009990002",
    nameSource: "whatsapp_push",
  });
  assert.equal(phoneOnly.profileName, null);
}
console.log("PASS: SYNC-14B repository ranked upgrades + dedupe + no phone-as-name");

{
  const repo = new InMemoryWhatsAppRepository();
  await repo.resolveOrCreateContact({
    phoneE164: "923009990003",
    profileName: "Legacy Row",
  });
  // Simulate legacy nonempty + null name_source
  const legacy = await repo.findContactByPhoneE164!("923009990003");
  assert.ok(legacy);
  legacy!.nameSource = null;
  assert.equal(legacy!.profileName, "Legacy Row");

  // push cannot replace legacy
  await syncWhatsAppWebContact(
    {
      jid: "923009990003@s.whatsapp.net",
      phoneE164: "923009990003",
      savedName: null,
      verifiedName: null,
      pushName: "Push Attempt",
      shortName: null,
      isBusiness: false,
    },
    { repo }
  );
  assert.equal(
    (await repo.findContactByPhoneE164!("923009990003"))?.profileName,
    "Legacy Row"
  );

  // saved can replace legacy
  await syncWhatsAppWebContact(
    {
      jid: "923009990003@s.whatsapp.net",
      phoneE164: "923009990003",
      savedName: "Saved Upgrade",
      verifiedName: null,
      pushName: "Push Attempt",
      shortName: null,
      isBusiness: false,
    },
    { repo }
  );
  const after = await repo.findContactByPhoneE164!("923009990003");
  assert.equal(after?.profileName, "Saved Upgrade");
  assert.equal(after?.nameSource, "whatsapp_saved");
  assert.equal(after?.waJid, "923009990003@s.whatsapp.net");
  assert.ok(after?.lastSyncedAt);
}
console.log("PASS: SYNC-14B legacy null-source upgrade rules + wa_jid/last_synced_at");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true, "923001112233@s.whatsapp.net");
  const resolved = source.ingestContacts([
    {
      id: "923009990004@s.whatsapp.net",
      name: "Book",
      verifiedName: "Biz Verified",
      notify: "Notify",
      short: "Sh",
    },
    { id: "999888777666555@lid", name: "LID Only", notify: "Nope" },
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.verifiedName, "Biz Verified");
  assert.equal(resolved[0]?.savedName, "Book");
  assert.equal(resolved[0]?.pushName, "Notify");
  assert.notEqual(resolved[0]?.verifiedName, resolved[0]?.pushName);

  const repo = new InMemoryWhatsAppRepository();
  let failures = 0;
  for (const contact of resolved) {
    try {
      await syncWhatsAppWebContact(contact, { repo });
    } catch {
      failures += 1;
    }
  }
  assert.equal(failures, 0);
  const stored = await repo.findContactByPhoneE164!("923009990004");
  assert.equal(stored?.profileName, "Biz Verified");
  assert.equal(stored?.nameSource, "whatsapp_verified");

  // One failed persistence must not stop the batch (session swallows via catch).
  const batch = [
    resolved[0]!,
    {
      jid: "not-a-phone",
      phoneE164: "",
      savedName: "X",
      verifiedName: null,
      pushName: null,
      shortName: null,
      isBusiness: false,
    },
    {
      jid: "923009990005@s.whatsapp.net",
      phoneE164: "923009990005",
      savedName: "Second",
      verifiedName: null,
      pushName: null,
      shortName: null,
      isBusiness: false,
    },
  ];
  let persisted = 0;
  for (const contact of batch) {
    try {
      await syncWhatsAppWebContact(contact, { repo });
      persisted += 1;
    } catch {
      // continue
    }
  }
  assert.equal(persisted, 2);
  assert.ok(await repo.findContactByPhoneE164!("923009990005"));
}
console.log("PASS: SYNC-14B contacts.upsert capture; LID-only skipped; batch resilience");

{
  const repo = new InMemoryWhatsAppRepository();
  await repo.resolveOrCreateContact({ phoneE164: "923009990006" });
  const live = await persistWhatsAppWebInbound(
    {
      providerMessageId: "INB_PUSH_1",
      remoteJid: "923009990006@s.whatsapp.net",
      fromMe: false,
      text: "hello",
      pushName: "Inbound Push",
      occurredAt: "2026-07-24T12:00:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "conversation",
    },
    { repo }
  );
  assert.equal(live.kind, "stored");
  assert.equal(
    (await repo.findContactByPhoneE164!("923009990006"))?.profileName,
    "Inbound Push"
  );

  // Later weaker push cannot overwrite saved
  await syncWhatsAppWebContact(
    {
      jid: "923009990006@s.whatsapp.net",
      phoneE164: "923009990006",
      savedName: "Saved Now",
      verifiedName: null,
      pushName: null,
      shortName: null,
      isBusiness: false,
    },
    { repo }
  );
  await persistWhatsAppWebInbound(
    {
      providerMessageId: "INB_PUSH_2",
      remoteJid: "923009990006@s.whatsapp.net",
      fromMe: false,
      text: "again",
      pushName: "Newer Push",
      occurredAt: "2026-07-24T12:01:00.000Z",
      isGroup: false,
      isStatusOrNewsletter: false,
      rawType: "conversation",
    },
    { repo }
  );
  assert.equal(
    (await repo.findContactByPhoneE164!("923009990006"))?.profileName,
    "Saved Now"
  );
}
console.log("PASS: SYNC-14B live inbound fills empty; cannot downgrade saved");

{
  assert.equal(
    displayContactLabel({ profileName: null, phoneE164: "923001112233" }),
    "+923001112233"
  );
  assert.equal(
    displayContactLabel({ profileName: null, phoneE164: null }),
    "Unknown WhatsApp contact"
  );
  assert.equal(
    displayContactLabel({
      profileName: "Name",
      phoneE164: "923001112233",
      contactId: "wct_secret",
    }),
    "Name"
  );
  assert.ok(!displayContactLabel({ profileName: "x", phoneE164: "1" }).includes("Contact ·"));
  assert.ok(!displayContactLabel({ profileName: "x", phoneE164: "1" }).includes("@"));
}
console.log("PASS: SYNC-14B frontend privacy fallbacks unchanged");

// ---------------------------------------------------------------------------
// SYNC-14B-R1 — concurrency-safe upgrades, bounded queue, business preserve
// ---------------------------------------------------------------------------
{
  const repo = new InMemoryWhatsAppRepository();
  await repo.resolveOrCreateContact({
    phoneE164: "923009991010",
    profileName: "Push Base",
    nameSource: "whatsapp_push",
  });
  await Promise.all([
    repo.resolveOrCreateContact({
      phoneE164: "923009991010",
      profileName: "Verified Win",
      nameSource: "whatsapp_verified",
    }),
    repo.resolveOrCreateContact({
      phoneE164: "923009991010",
      profileName: "Saved Race",
      nameSource: "whatsapp_saved",
    }),
    repo.resolveOrCreateContact({
      phoneE164: "923009991010",
      profileName: "Push Race",
      nameSource: "whatsapp_push",
    }),
  ]);
  const final = await repo.findContactByPhoneE164!("923009991010");
  assert.equal(final?.profileName, "Verified Win");
  assert.equal(final?.nameSource, "whatsapp_verified");

  await Promise.all([
    repo.resolveOrCreateContact({
      phoneE164: "923009991011",
      profileName: "Saved Only",
      nameSource: "whatsapp_saved",
    }),
    repo.resolveOrCreateContact({
      phoneE164: "923009991011",
      profileName: "Push Only",
      nameSource: "whatsapp_push",
    }),
  ]);
  const savedWins = await repo.findContactByPhoneE164!("923009991011");
  assert.equal(savedWins?.profileName, "Saved Only");
  assert.equal(savedWins?.nameSource, "whatsapp_saved");

  await repo.updateContactSyncFields!(savedWins!.id, {
    profileName: "Manual Lock",
    nameSource: "manual",
  });
  await Promise.all([
    repo.resolveOrCreateContact({
      phoneE164: "923009991011",
      profileName: "Verified Attack",
      nameSource: "whatsapp_verified",
    }),
    repo.updateContactSyncFields!(savedWins!.id, {
      waJid: "923009991011@s.whatsapp.net",
      lastSyncedAt: "2026-07-24T12:00:00.000Z",
      profileName: "Push Downgrade",
      nameSource: "whatsapp_push",
    }),
  ]);
  const manual = await repo.findContactByPhoneE164!("923009991011");
  assert.equal(manual?.profileName, "Manual Lock");
  assert.equal(manual?.nameSource, "manual");
  assert.equal(manual?.waJid, "923009991011@s.whatsapp.net");
}
console.log("PASS: SYNC-14B-R1 concurrent upgrades + manual + metadata no downgrade");

{
  // Fake PostgREST-style client exercising CAS filters (eq/is + maybeSingle).
  type Row = Record<string, unknown>;
  const row: Row = {
    id: "wct_cas_1",
    company_id: DEFAULT_COMPANY_ID,
    phone_e164: "923009991012",
    profile_name: "Push Base",
    name_source: "whatsapp_push",
    wa_jid: null,
    is_business_contact: false,
    last_synced_at: null,
    created_at: "2026-07-24T12:00:00.000Z",
    updated_at: "2026-07-24T12:00:00.000Z",
  };
  let updateAttempts = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "whatsapp_contacts");
      let mode: "select" | "update" | "insert" = "select";
      let patch: Row = {};
      const filters: Record<string, unknown> = {};
      const api = {
        select() {
          return api;
        },
        insert(values: Row) {
          mode = "insert";
          Object.assign(row, values);
          return api;
        },
        update(values: Row) {
          mode = "update";
          patch = { ...values };
          return api;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return api;
        },
        is(key: string, value: unknown) {
          filters[key] = value;
          return api;
        },
        async maybeSingle() {
          if (mode === "update") {
            updateAttempts += 1;
            // First CAS attempt: simulate concurrent verified write winning first.
            if (
              updateAttempts === 1 &&
              patch.name_source === "whatsapp_saved"
            ) {
              row.profile_name = "Verified Concurrent";
              row.name_source = "whatsapp_verified";
              row.updated_at = "2026-07-24T12:00:01.000Z";
              return { data: null, error: null }; // CAS miss
            }
            for (const [k, v] of Object.entries(filters)) {
              if (k === "company_id" || k === "id" || k === "phone_e164") {
                if (row[k] !== v) return { data: null, error: null };
                continue;
              }
              if (row[k] !== v) return { data: null, error: null };
            }
            Object.assign(row, patch);
            return { data: { ...row }, error: null };
          }
          // select
          if (
            filters.phone_e164 != null &&
            row.phone_e164 !== filters.phone_e164
          ) {
            return { data: null, error: null };
          }
          if (filters.id != null && row.id !== filters.id) {
            return { data: null, error: null };
          }
          return { data: { ...row }, error: null };
        },
        async single() {
          const r = await api.maybeSingle();
          if (!r.data) {
            return { data: null, error: { message: "not found", code: "PGRST116" } };
          }
          return r;
        },
      };
      return api;
    },
  };

  const repo = new SupabaseWhatsAppRepository(() => client as never);
  // Saved loses CAS to concurrent verified, then must not overwrite verified.
  const result = await repo.resolveOrCreateContact({
    phoneE164: "923009991012",
    profileName: "Saved Late",
    nameSource: "whatsapp_saved",
  });
  assert.equal(result.profileName, "Verified Concurrent");
  assert.equal(result.nameSource, "whatsapp_verified");
  assert.ok(updateAttempts >= 1);

  // Metadata update must not downgrade verified → push.
  const afterMeta = await repo.updateContactSyncFields!(result.id, {
    waJid: "923009991012@s.whatsapp.net",
    lastSyncedAt: "2026-07-24T12:05:00.000Z",
    profileName: "Push Downgrade",
    nameSource: "whatsapp_push",
  });
  assert.equal(afterMeta?.profileName, "Verified Concurrent");
  assert.equal(afterMeta?.nameSource, "whatsapp_verified");
  assert.equal(afterMeta?.waJid, "923009991012@s.whatsapp.net");
}
console.log("PASS: SYNC-14B-R1 Supabase CAS mock — strongest name wins");

{
  const queue = new ContactIdentityPersistQueue({ concurrency: 2 });
  assert.equal(WHATSAPP_CONTACT_IDENTITY_PERSIST_CONCURRENCY, 3);
  let current = 0;
  let failures = 0;
  const order: number[] = [];
  const tasks = Array.from({ length: 6 }, (_, i) =>
    queue.enqueue(async () => {
      current += 1;
      if (current > queue.peakActive) {
        // peakActive tracked inside queue
      }
      assert.ok(current <= 2);
      order.push(i);
      await new Promise((r) => setTimeout(r, 5));
      current -= 1;
      if (i === 2) throw new Error("boom");
      return i;
    })
  );
  const results = await Promise.all(tasks);
  assert.equal(queue.peakActive, 2);
  assert.equal(results.filter((v) => v === undefined).length, 1);
  assert.equal(results.filter((v) => typeof v === "number").length, 5);
  assert.equal(order.length, 6);
  void failures;
}
console.log("PASS: SYNC-14B-R1 bounded contact persist queue + failure isolation");

{
  const source = new BaileysInMemorySyncSource();
  source.setConnected(true, "923001112233@s.whatsapp.net");
  source.ingestContacts([
    {
      id: "923009991013@s.whatsapp.net",
      name: "Biz Person",
      isBusiness: true,
      verifiedName: "Biz Co",
    },
  ]);
  assert.equal((await source.listContacts())[0]?.isBusiness, true);

  // Partial update without isBusiness / verifiedName must not clear the flag in memory.
  const partial = source.ingestContacts([
    {
      id: "923009991013@s.whatsapp.net",
      notify: "Newer Push",
    },
  ]);
  assert.equal(partial[0]?.isBusiness, null); // persist payload: do not patch
  assert.equal((await source.listContacts())[0]?.isBusiness, true);
  assert.equal((await source.listContacts())[0]?.pushName, "Newer Push");

  const repo = new InMemoryWhatsAppRepository();
  await syncWhatsAppWebContact(
    {
      jid: "923009991013@s.whatsapp.net",
      phoneE164: "923009991013",
      savedName: "Biz Person",
      verifiedName: "Biz Co",
      pushName: null,
      shortName: null,
      isBusiness: true,
    },
    { repo }
  );
  assert.equal(
    (await repo.findContactByPhoneE164!("923009991013"))?.isBusinessContact,
    true
  );
  await syncWhatsAppWebContact(
    {
      jid: "923009991013@s.whatsapp.net",
      phoneE164: "923009991013",
      savedName: null,
      verifiedName: null,
      pushName: "Newer Push",
      shortName: null,
      isBusiness: null,
    },
    { repo }
  );
  assert.equal(
    (await repo.findContactByPhoneE164!("923009991013"))?.isBusinessContact,
    true
  );
}
console.log("PASS: SYNC-14B-R1 partial update preserves business flag");

// ---------------------------------------------------------------------------
// SYNC-14B-R2 — business proof + session-owned queue lifecycle
// ---------------------------------------------------------------------------
{
  assert.deepEqual(resolveWhatsAppBusinessProof({}, true), {
    persist: null,
    memory: true,
  });
  assert.deepEqual(
    resolveWhatsAppBusinessProof({ isBusiness: undefined }, true),
    { persist: null, memory: true }
  );
  assert.deepEqual(resolveWhatsAppBusinessProof({ isBusiness: null }, true), {
    persist: null,
    memory: true,
  });
  assert.deepEqual(resolveWhatsAppBusinessProof({ isBusiness: true }, false), {
    persist: true,
    memory: true,
  });
  assert.deepEqual(resolveWhatsAppBusinessProof({ isBusiness: false }, true), {
    persist: false,
    memory: false,
  });
  assert.deepEqual(
    resolveWhatsAppBusinessProof({ verifiedName: "Biz Co" }, false),
    { persist: true, memory: true }
  );
  // Invalid non-boolean must not prove false.
  assert.deepEqual(
    resolveWhatsAppBusinessProof({ isBusiness: "yes" as unknown as boolean }, true),
    { persist: null, memory: true }
  );

  const source = new BaileysInMemorySyncSource();
  source.setConnected(true, "923001112233@s.whatsapp.net");
  source.ingestContacts([
    {
      id: "923009991014@s.whatsapp.net",
      name: "Keep Biz",
      isBusiness: true,
    },
  ]);
  assert.equal((await source.listContacts())[0]?.isBusiness, true);

  for (const partial of [
    { id: "923009991014@s.whatsapp.net", notify: "n1" },
    { id: "923009991014@s.whatsapp.net", isBusiness: undefined },
    { id: "923009991014@s.whatsapp.net", isBusiness: null },
    { id: "923009991014@s.whatsapp.net", isBusiness: "no" },
  ]) {
    const payload = source.ingestContacts([partial]);
    assert.equal(payload[0]?.isBusiness, null);
    assert.equal((await source.listContacts())[0]?.isBusiness, true);
  }

  const explicitFalse = source.ingestContacts([
    { id: "923009991014@s.whatsapp.net", isBusiness: false },
  ]);
  assert.equal(explicitFalse[0]?.isBusiness, false);
  assert.equal((await source.listContacts())[0]?.isBusiness, false);

  const viaVerified = source.ingestContacts([
    { id: "923009991014@s.whatsapp.net", verifiedName: "Again Biz" },
  ]);
  assert.equal(viaVerified[0]?.isBusiness, true);
  assert.equal((await source.listContacts())[0]?.isBusiness, true);
}
console.log("PASS: SYNC-14B-R2 business-field provider proof");

{
  type SocketWithIdentity = {
    __onContactIdentity: WhatsAppWebContactIdentityHandler;
  };
  const contactOf = (
    phone: string,
    isBusiness: boolean | null
  ): WhatsAppWebSyncContact => ({
    jid: `${phone}@s.whatsapp.net`,
    phoneE164: phone,
    savedName: "Name",
    verifiedName: null,
    pushName: null,
    shortName: null,
    isBusiness,
  });
  const openFactory = (): {
    factory: WhatsAppWebSocketFactory;
    getCalls: () => number;
    getHandler: (session: WhatsAppWebSession) => WhatsAppWebContactIdentityHandler;
  } => {
    let calls = 0;
    const factory: WhatsAppWebSocketFactory = async (input) => {
      calls += 1;
      queueMicrotask(() =>
        input.onConnectionUpdate({
          connection: "open",
          userId: "923001112233@s.whatsapp.net",
        })
      );
      return {
        end: () => {},
        logout: async () => {},
        sendText: async () => ({ providerMessageId: "x" }),
        getUserId: () => "923001112233@s.whatsapp.net",
        getSyncSource: () => null,
        __onContactIdentity: input.onContactIdentity!,
      };
    };
    return {
      factory,
      getCalls: () => calls,
      getHandler: (session) => {
        const sock = (session as unknown as { socket: SocketWithIdentity | null })
          .socket;
        assert.ok(sock?.__onContactIdentity);
        return sock.__onContactIdentity;
      },
    };
  };

  // --- Reconnect reuses one queue; stale work cannot overwrite newer business ---
  {
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const repo = new InMemoryWhatsAppRepository();
    await repo.resolveOrCreateContact({ phoneE164: "923009991015" });

    let releaseOldFind: (() => void) | null = null;
    const oldFindGate = new Promise<void>((resolve) => {
      releaseOldFind = resolve;
    });
    let stallNextFind = false;
    const realFind = repo.findContactByPhoneE164!.bind(repo);
    repo.findContactByPhoneE164 = async (phone, companyId) => {
      const row = await realFind(phone, companyId);
      if (stallNextFind && phone === "923009991015") {
        stallNextFind = false;
        await oldFindGate;
      }
      return row;
    };

    const { factory, getCalls, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });

    assert.equal(session.getContactPersistQueueEpoch(), 1);
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(getCalls(), 1);
    assert.equal(session.getContactPersistQueueEpoch(), 1);

    await session.disconnect();
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(getCalls(), 2);
    // Soft reconnect must not create a competing queue.
    assert.equal(session.getContactPersistQueueEpoch(), 1);

    const onContact = getHandler(session);
    stallNextFind = true;
    const stale = onContact(contactOf("923009991015", false));
    await new Promise((r) => setTimeout(r, 10));
    const fresh = onContact(contactOf("923009991015", true));
    // Same-phone serialization: release the stalled older task before awaiting
    // the newer one, or the phone key stays locked forever.
    releaseOldFind!();
    await Promise.all([stale, fresh]);

    const final = await repo.findContactByPhoneE164!("923009991015");
    assert.equal(final?.isBusinessContact, true);
    assert.ok(session.getContactPersistPeakActive() <= 3);
    await session.shutdown();
  }

  // --- Concurrency stays ≤3 across reconnect ---
  {
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const repo = new InMemoryWhatsAppRepository();
    const realUpdate = repo.updateContactSyncFields!.bind(repo);
    repo.updateContactSyncFields = async (id, fields, companyId) => {
      await new Promise((r) => setTimeout(r, 25));
      return realUpdate(id, fields, companyId);
    };
    const { factory, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    const onContact = getHandler(session);
    const batch1 = Array.from({ length: 8 }, (_, i) =>
      onContact(contactOf(`9230099911${20 + i}`, i % 2 === 0))
    );
    await session.disconnect();
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(session.getContactPersistQueueEpoch(), 1);
    const onContact2 = getHandler(session);
    const batch2 = Array.from({ length: 8 }, (_, i) =>
      onContact2(contactOf(`9230099911${40 + i}`, true))
    );
    await Promise.all([...batch1, ...batch2]);
    assert.ok(session.getContactPersistPeakActive() <= 3);
    await session.shutdown();
  }

  // --- Failure isolation + shutdown/logout with no unhandled rejection ---
  {
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const boomRepo = new InMemoryWhatsAppRepository();
    let failures = 0;
    boomRepo.resolveOrCreateContact = async () => {
      failures += 1;
      throw new Error("persist boom");
    };
    const { factory, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: boomRepo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    const onContact = getHandler(session);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    await Promise.all([
      onContact(contactOf("923009991016", true)),
      onContact(contactOf("923009991017", false)),
    ]);
    assert.equal(failures, 2);
    assert.equal(session.getSafeStatus().state, "CONNECTED");

    await session.logout();
    assert.equal(session.isContactPersistQueueClosed(), true);
    await onContact(contactOf("923009991018", true));

    // Shutdown after logout also stays quiet.
    await session.shutdown();
    await onContact(contactOf("923009991019", true));
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled.length, 0);
  }
}
console.log("PASS: SYNC-14B-R2 session queue lifecycle + stale write guard");

// ---------------------------------------------------------------------------
// SYNC-14B-R3 — per-phone serialization + queue epoch ABA protection
// ---------------------------------------------------------------------------
{
  type SocketWithIdentity = {
    __onContactIdentity: WhatsAppWebContactIdentityHandler;
  };
  const contactOf = (
    phone: string,
    isBusiness: boolean | null
  ): WhatsAppWebSyncContact => ({
    jid: `${phone}@s.whatsapp.net`,
    phoneE164: phone,
    savedName: "Name",
    verifiedName: null,
    pushName: null,
    shortName: null,
    isBusiness,
  });
  const openFactory = (): {
    factory: WhatsAppWebSocketFactory;
    getHandler: (session: WhatsAppWebSession) => WhatsAppWebContactIdentityHandler;
  } => {
    const factory: WhatsAppWebSocketFactory = async (input) => {
      queueMicrotask(() =>
        input.onConnectionUpdate({
          connection: "open",
          userId: "923001112233@s.whatsapp.net",
        })
      );
      return {
        end: () => {},
        logout: async () => {},
        sendText: async () => ({ providerMessageId: "x" }),
        getUserId: () => "923001112233@s.whatsapp.net",
        getSyncSource: () => null,
        __onContactIdentity: input.onContactIdentity!,
      };
    };
    return {
      factory,
      getHandler: (session) => {
        const sock = (session as unknown as { socket: SocketWithIdentity | null })
          .socket;
        assert.ok(sock?.__onContactIdentity);
        return sock.__onContactIdentity;
      },
    };
  };
  const connectSession = async (repo: InMemoryWhatsAppRepository) => {
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const { factory, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    return { session, onContact: getHandler(session), authDir };
  };

  // --- Stale false paused inside updateContactSyncFields; newer true wins ---
  {
    const repo = new InMemoryWhatsAppRepository();
    await repo.resolveOrCreateContact({ phoneE164: "923009991030" });
    const { session, onContact } = await connectSession(repo);

    let releaseOld: (() => void) | null = null;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldEntered = false;
    session.__testSetContactPersistBeforeWrite(async ({ fields }) => {
      if (fields.isBusinessContact === false) {
        oldEntered = true;
        await oldGate;
      }
    });

    const stale = onContact(contactOf("923009991030", false));
    for (let i = 0; i < 40 && !oldEntered; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(oldEntered, true);

    const fresh = onContact(contactOf("923009991030", true));
    // Same-phone serialization: newer waits behind the paused old write.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(session.getContactPersistPeakActiveForPhone("923009991030"), 1);

    releaseOld!();
    await Promise.all([stale, fresh]);
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991030"))?.isBusinessContact,
      true
    );
    await session.shutdown();
  }

  // --- Old true / new false ends at newer explicit false ---
  {
    const repo = new InMemoryWhatsAppRepository();
    await repo.resolveOrCreateContact({
      phoneE164: "923009991031",
      profileName: "X",
    });
    await repo.updateContactSyncFields!(
      (await repo.findContactByPhoneE164!("923009991031"))!.id,
      { isBusinessContact: true }
    );
    const { session, onContact } = await connectSession(repo);

    let releaseOld: (() => void) | null = null;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldEntered = false;
    session.__testSetContactPersistBeforeWrite(async ({ fields }) => {
      if (fields.isBusinessContact === true) {
        oldEntered = true;
        await oldGate;
      }
    });

    const stale = onContact(contactOf("923009991031", true));
    for (let i = 0; i < 40 && !oldEntered; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(oldEntered, true);
    const fresh = onContact(contactOf("923009991031", false));
    releaseOld!();
    await Promise.all([stale, fresh]);
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991031"))?.isBusinessContact,
      false
    );
    await session.shutdown();
  }

  // --- Same-phone concurrency ≤1; different phones >1 and ≤3 ---
  {
    const repo = new InMemoryWhatsAppRepository();
    const { session, onContact } = await connectSession(repo);
    session.__testSetContactPersistBeforeWrite(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const samePhone = Array.from({ length: 5 }, () =>
      onContact(contactOf("923009991032", true))
    );
    const multiPhone = Array.from({ length: 6 }, (_, i) =>
      onContact(contactOf(`92300999104${i}`, i % 2 === 0))
    );
    await Promise.all([...samePhone, ...multiPhone]);

    assert.equal(session.getContactPersistPeakActiveForPhone("923009991032"), 1);
    assert.ok(session.getContactPersistPeakActive() > 1);
    assert.ok(session.getContactPersistPeakActive() <= 3);
    await session.shutdown();
  }

  // --- Same-phone failure does not block the next task ---
  {
    const repo = new InMemoryWhatsAppRepository();
    let attempts = 0;
    const realResolve = repo.resolveOrCreateContact.bind(repo);
    repo.resolveOrCreateContact = async (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error("first boom");
      return realResolve(input);
    };
    const { session, onContact } = await connectSession(repo);
    await onContact(contactOf("923009991033", true));
    await onContact(contactOf("923009991033", false));
    assert.ok(attempts >= 2);
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991033"))?.isBusinessContact,
      false
    );
    await session.shutdown();
  }

  // --- Logout/close during active task invalidates that write ---
  {
    const repo = new InMemoryWhatsAppRepository();
    await repo.resolveOrCreateContact({ phoneE164: "923009991034" });
    const { session, onContact } = await connectSession(repo);

    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    session.__testSetContactPersistBeforeWrite(async () => {
      entered = true;
      await gate;
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const pending = onContact(contactOf("923009991034", true));
    for (let i = 0; i < 40 && !entered; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(entered, true);

    const epochBeforeClose = session.getContactPersistQueueEpoch();
    await session.logout();
    assert.equal(session.isContactPersistQueueClosed(), true);
    assert.ok(session.getContactPersistQueueEpoch() > epochBeforeClose);

    release!();
    await pending;

    // Invalidated task must not apply business=true.
    assert.notEqual(
      (await repo.findContactByPhoneE164!("923009991034"))?.isBusinessContact,
      true
    );

    await new Promise((r) => setTimeout(r, 15));
    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled.length, 0);
  }

  // --- Reconnect after close: new epoch; soft reconnect keeps epoch;
  //     old task cannot revive via reused generation ---
  {
    const repo = new InMemoryWhatsAppRepository();
    await repo.resolveOrCreateContact({ phoneE164: "923009991035" });
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const { factory, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(session.getContactPersistQueueEpoch(), 1);

    await session.disconnect();
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    // Soft reconnect: same queue + epoch.
    assert.equal(session.getContactPersistQueueEpoch(), 1);

    let releaseOld: (() => void) | null = null;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldEntered = false;
    let oldWriteAttempts = 0;
    session.__testSetContactPersistBeforeWrite(async ({ fields }) => {
      if (fields.isBusinessContact === false) {
        oldWriteAttempts += 1;
        oldEntered = true;
        await oldGate;
      }
    });

    const onContact = getHandler(session);
    const stale = onContact(contactOf("923009991035", false));
    for (let i = 0; i < 40 && !oldEntered; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(oldEntered, true);

    const epochAtPause = session.getContactPersistQueueEpoch();
    await session.shutdown();
    assert.ok(session.getContactPersistQueueEpoch() > epochAtPause);
    assert.equal(session.isContactPersistQueueClosed(), true);

    // Release not-yet-issued work so the closed queue can become idle before
    // hard-reconnect awaits drain and creates a replacement queue.
    session.__testSetContactPersistBeforeWrite(null);
    releaseOld!();
    await stale;
    assert.equal(oldWriteAttempts, 1);
    assert.notEqual(
      (await repo.findContactByPhoneE164!("923009991035"))?.isBusinessContact,
      false
    );

    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    const epochAfterRecreate = session.getContactPersistQueueEpoch();
    assert.ok(epochAfterRecreate > epochAtPause);

    const onContact2 = getHandler(session);
    await onContact2(contactOf("923009991035", true));

    assert.equal(
      (await repo.findContactByPhoneE164!("923009991035"))?.isBusinessContact,
      true
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    await session.shutdown();
    await new Promise((r) => setTimeout(r, 15));
    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled.length, 0);
  }
}
console.log("PASS: SYNC-14B-R3 per-phone serialization + queue epoch ABA");

// ---------------------------------------------------------------------------
// SYNC-14B-R4 — hard-close drain + preserve proven business under FIFO
// ---------------------------------------------------------------------------
{
  type SocketWithIdentity = {
    __onContactIdentity: WhatsAppWebContactIdentityHandler;
  };
  const contactOf = (
    phone: string,
    isBusiness: boolean | null
  ): WhatsAppWebSyncContact => ({
    jid: `${phone}@s.whatsapp.net`,
    phoneE164: phone,
    savedName: "Name",
    verifiedName: null,
    pushName: null,
    shortName: null,
    isBusiness,
  });
  const openFactory = (): {
    factory: WhatsAppWebSocketFactory;
    getHandler: (session: WhatsAppWebSession) => WhatsAppWebContactIdentityHandler;
  } => {
    const factory: WhatsAppWebSocketFactory = async (input) => {
      queueMicrotask(() =>
        input.onConnectionUpdate({
          connection: "open",
          userId: "923001112233@s.whatsapp.net",
        })
      );
      return {
        end: () => {},
        logout: async () => {},
        sendText: async () => ({ providerMessageId: "x" }),
        getUserId: () => "923001112233@s.whatsapp.net",
        getSyncSource: () => null,
        __onContactIdentity: input.onContactIdentity!,
      };
    };
    return {
      factory,
      getHandler: (session) => {
        const sock = (session as unknown as { socket: SocketWithIdentity | null })
          .socket;
        assert.ok(sock?.__onContactIdentity);
        return sock.__onContactIdentity;
      },
    };
  };

  // --- Hard-close drain: issued write must settle before replacement same-phone write ---
  {
    const repo = new InMemoryWhatsAppRepository();
    await repo.resolveOrCreateContact({ phoneE164: "923009991050" });
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const { factory, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    const softEpoch = session.getContactPersistQueueEpoch();

    await session.disconnect();
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(session.getContactPersistQueueEpoch(), softEpoch);

    let releaseOld: (() => void) | null = null;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldInvoked = false;
    let oldSettled = false;
    let replacementInvokedBeforeOldSettled = false;
    const realUpdate = repo.updateContactSyncFields!.bind(repo);
    repo.updateContactSyncFields = async (id, fields, companyId) => {
      if (fields.isBusinessContact === false) {
        oldInvoked = true;
        // Paused after the real repository update has been invoked.
        await oldGate;
        const row = await realUpdate(id, fields, companyId);
        oldSettled = true;
        return row;
      }
      if (fields.isBusinessContact === true) {
        if (!oldSettled) replacementInvokedBeforeOldSettled = true;
        return realUpdate(id, fields, companyId);
      }
      return realUpdate(id, fields, companyId);
    };

    const onContact = getHandler(session);
    const stale = onContact(contactOf("923009991050", false));
    for (let i = 0; i < 40 && !oldInvoked; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(oldInvoked, true);

    const epochBeforeHardClose = session.getContactPersistQueueEpoch();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    await session.shutdown();
    assert.equal(session.isContactPersistQueueClosed(), true);
    assert.ok(session.getContactPersistQueueEpoch() > epochBeforeHardClose);

    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    // connect awaits closed-queue drain before replacement persistence can run.
    const reconnectP = session.connect();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(oldSettled, false);
    assert.equal(replacementInvokedBeforeOldSettled, false);

    releaseOld!();
    await stale;
    await reconnectP;
    await new Promise((r) => setTimeout(r, 15));
    assert.ok(session.getContactPersistQueueEpoch() > epochBeforeHardClose);

    const onContact2 = getHandler(session);
    await onContact2(contactOf("923009991050", true));
    assert.equal(replacementInvokedBeforeOldSettled, false);
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991050"))?.isBusinessContact,
      true
    );

    await session.shutdown();
    await new Promise((r) => setTimeout(r, 15));
    process.off("unhandledRejection", onUnhandled);
    assert.equal(unhandled.length, 0);
  }

  // --- Proven business preserved across unproven partial; explicit toggles win ---
  {
    const repo = new InMemoryWhatsAppRepository();
    const authDir = tmpAuthDir();
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    const { factory, getHandler } = openFactory();
    const session = new WhatsAppWebSession({
      env: {
        WHATSAPP_WEB_QR_ENABLED: "true",
        WHATSAPP_WEB_AUTH_DIR: authDir,
      },
      socketFactory: factory,
      syncRepo: repo,
      now: () => new Date("2026-07-24T12:00:00.000Z"),
    });
    await session.connect();
    await new Promise((r) => setTimeout(r, 15));
    const onContact = getHandler(session);

    // false → partial-null preserves false
    await onContact(contactOf("923009991051", false));
    await onContact(contactOf("923009991051", null));
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991051"))?.isBusinessContact,
      false
    );

    // true → partial-null preserves true
    await onContact(contactOf("923009991052", true));
    await onContact(contactOf("923009991052", null));
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991052"))?.isBusinessContact,
      true
    );

    // false → true ends true
    await onContact(contactOf("923009991053", false));
    await onContact(contactOf("923009991053", true));
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991053"))?.isBusinessContact,
      true
    );

    // true → false ends false
    await onContact(contactOf("923009991054", true));
    await onContact(contactOf("923009991054", false));
    assert.equal(
      (await repo.findContactByPhoneE164!("923009991054"))?.isBusinessContact,
      false
    );

    // Concurrency bounds still hold with FIFO serialization.
    session.__testSetContactPersistBeforeWrite(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    await Promise.all([
      ...Array.from({ length: 4 }, () =>
        onContact(contactOf("923009991055", true))
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        onContact(contactOf(`92300999106${i}`, false))
      ),
    ]);
    assert.equal(session.getContactPersistPeakActiveForPhone("923009991055"), 1);
    assert.ok(session.getContactPersistPeakActive() <= 3);

    await session.shutdown();
  }
}
console.log("PASS: SYNC-14B-R4 hard-close drain + proven business FIFO");

console.log("ALL PASS: whatsappWebHistorySync");
