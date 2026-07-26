/**
 * WHATSAPP-LIVE-01 — live inbox refresh, filters, navigation, AI visibility.
 * Source + pure-helper coverage (no Gemini, no WhatsApp send).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INBOX_LIVE_REFRESH_MS,
  isDocumentVisible,
} from "./inboxLiveRefresh.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const conversationsHook = read("useInboxConversations.ts");
const messagesHook = read("useInboxMessages.ts");
const detailHook = read("useInboxConversation.ts");
const liveHelper = read("inboxLiveRefresh.ts");
const inboxPage = read("../components/InboxPage.tsx");
const filters = read("../components/Filters.tsx");
const connectionPage = read("../components/WhatsAppSetupPage.tsx");
const conversationView = read("../components/ConversationView.tsx");
const aiPanel = read("../components/AiDraftPanel.tsx");
const adminNav = read("../../components/AdminModuleNav.tsx");
const adminApp = read("../../components/AdminApp.tsx");
const app = read("../../App.tsx");

await test("live refresh interval is ~2 seconds", () => {
  assert.equal(INBOX_LIVE_REFRESH_MS, 2_000);
  assert.ok(liveHelper.includes("2-second polling"));
  assert.ok(liveHelper.includes("SSE/fetch-stream push is intentionally deferred"));
});

await test("empty Inbox keeps checking via authoritative first-page refresh", () => {
  assert.ok(conversationsHook.includes("if (!since)"));
  assert.ok(conversationsHook.includes("applyAuthoritativeFirstPage"));
  assert.ok(conversationsHook.includes("Empty Inbox / missing watermark"));
  assert.equal(conversationsHook.includes("DELTA_MS = 8_000"), false);
  assert.ok(conversationsHook.includes("INBOX_LIVE_REFRESH_MS"));
});

await test("delta failure falls back to authoritative first-page refresh", () => {
  assert.ok(conversationsHook.includes("Delta failure"));
  assert.ok(conversationsHook.includes("applyAuthoritativeFirstPage"));
});

await test("selected thread refreshes latest messages on interval", () => {
  assert.ok(messagesHook.includes("INBOX_LIVE_REFRESH_MS"));
  assert.ok(messagesHook.includes("refreshLatest"));
  assert.ok(messagesHook.includes("repartitionLiveMessagePages"));
  assert.ok(detailHook.includes("refetchInterval"));
});

await test("focus, visibility and online trigger immediate refresh", () => {
  assert.ok(liveHelper.includes('addEventListener("focus"'));
  assert.ok(liveHelper.includes('addEventListener("online"'));
  assert.ok(liveHelper.includes('addEventListener("visibilitychange"'));
  assert.ok(conversationsHook.includes("subscribeImmediateRefresh"));
  assert.ok(messagesHook.includes("subscribeImmediateRefresh"));
  assert.equal(typeof isDocumentVisible(), "boolean");
});

await test("polling requests do not overlap", () => {
  assert.ok(conversationsHook.includes("inFlightRef"));
  assert.ok(conversationsHook.includes("if (inFlightRef.current) return"));
  assert.ok(messagesHook.includes("inFlightRef"));
  assert.ok(messagesHook.includes("if (inFlightRef.current) return"));
});

await test("quick filters All/Unread/Read/Open/Resolved/Archived exist", () => {
  for (const label of ["All", "Unread", "Read", "Open", "Resolved", "Archived"]) {
    assert.ok(filters.includes(`label: "${label}"`), label);
  }
  assert.ok(conversationsHook.includes("quickFilter"));
  assert.ok(conversationsHook.includes("normalizeServerFilters"));
  assert.ok(conversationsHook.includes("totalUnreadCount"));
});

await test("Connection and Inbox are separate navigation destinations", () => {
  assert.ok(adminNav.includes('title: "WhatsApp Inbox"'));
  assert.ok(adminNav.includes('title: "WhatsApp Connection"'));
  assert.ok(adminNav.includes('id: "whatsapp-connection"'));
  assert.ok(adminApp.includes('/admin/whatsapp-connection'));
  assert.ok(adminApp.includes('/admin/inbox'));
  assert.ok(app.includes("isAdminWhatsAppConnectionPath"));
  assert.ok(connectionPage.includes('data-testid="whatsapp-connection-page"'));
  assert.ok(connectionPage.includes("WhatsAppConnectionPanel"));
});

await test("connection panel is absent from Inbox", () => {
  assert.equal(inboxPage.includes("WhatsApp Coexistence"), false);
  assert.equal(inboxPage.includes("WhatsAppConnectionPanel"), false);
  assert.ok(inboxPage.includes('data-testid="whatsapp-inbox-workspace"'));
});

await test("AI Reply Assistant is visible for selected conversation", () => {
  assert.ok(aiPanel.includes("AI Reply Assistant"));
  assert.ok(aiPanel.includes("Generate AI Draft"));
  assert.ok(conversationView.includes("<AiDraftPanel"));
  assert.ok(conversationView.includes("aiStatusHint"));
  assert.ok(conversationView.includes("fetchInboxAiDraftConfig"));
  // Must not auto-generate on open — generate only via staff click handler.
  assert.ok(conversationView.includes("onGenerate={runGenerate}"));
  assert.equal(
    /useEffect\(\(\)\s*=>\s*\{\s*void aiDraft\.generate/.test(conversationView),
    false
  );
});

await test("AI draft remains editable and copy does not send", () => {
  assert.ok(aiPanel.includes("onEditableTextChange"));
  assert.ok(conversationView.includes("Copy only — never calls onSend"));
  assert.ok(conversationView.includes("setComposerSeed"));
});

if (failed > 0) {
  console.error(`\n${failed} WHATSAPP-LIVE-01 test(s) failed`);
  process.exit(1);
}
console.log("\nAll WHATSAPP-LIVE-01 UI tests passed");
