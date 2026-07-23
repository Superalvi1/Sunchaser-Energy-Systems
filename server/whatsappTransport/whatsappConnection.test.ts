import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestActor } from "../middleware/actor.ts";
import {
  computeTokenHealth,
  computeWebhookHealth,
  disconnectWhatsApp,
  getWhatsAppConnectionStatus,
  maskId,
  maskPhone,
  processEmbeddedSignupOnboarding,
  recordWebhookPing,
  resetConnectionStoreForTests,
} from "./whatsappConnectionService.ts";
import { InMemoryWhatsAppInboxConversationRepository } from "./whatsappInboxConversationRepository.ts";
import { WhatsAppInboxMemoryStore } from "./whatsappInboxRepoSupport.ts";

const adminActor: RequestActor = {
  id: "u-admin-1",
  email: "admin@sunchaser.pk",
  role: "Super Admin",
  status: "Approved",
  allowedModules: ["crm_leads"],
};

const salesActor: RequestActor = {
  id: "u-sales-1",
  email: "sales@sunchaser.pk",
  role: "Sales Representative",
  status: "Approved",
  allowedModules: ["crm_leads"],
};

await test("maskId and maskPhone redact sensitive identifiers", () => {
  assert.equal(maskId(null), null);
  assert.equal(maskId(""), null);
  assert.equal(maskId("123456789098765"), "12****8765");

  assert.equal(maskPhone(null), null);
  assert.equal(maskPhone("923007776655"), "+92 300 **** 655");
});

await test("disconnected state when no credentials present", () => {
  resetConnectionStoreForTests({
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    stateOverride: null,
  });

  const status = getWhatsAppConnectionStatus();
  assert.equal(status.status, "NOT_CONNECTED");
  assert.equal(status.connectionMode, "COEXISTENCE");
  assert.equal(status.wabaIdMasked, null);
  assert.equal(status.phoneNumberIdMasked, null);
  assert.equal(status.phoneNumberMasked, null);
});

await test("successful Coexistence Embedded Signup onboarding", async () => {
  resetConnectionStoreForTests({
    wabaId: null,
    phoneNumberId: null,
    phoneNumber: null,
    accessToken: null,
    stateOverride: null,
  });

  const status = await processEmbeddedSignupOnboarding({
    code: "valid_meta_embedded_code_123",
    wabaId: "123456789098765",
    phoneNumberId: "987654321012345",
    actor: adminActor,
  });

  assert.equal(status.status, "CONNECTED");
  assert.equal(status.connectionMode, "COEXISTENCE");
  assert.equal(status.wabaIdMasked, "12****8765");
  assert.equal(status.phoneNumberIdMasked, "98****2345");
  assert.equal(status.phoneNumberMasked, "+92 300 **** 655");
  assert.equal(status.tokenHealth, "valid");
});

await test("cancelled/invalid onboarding code throws invalid_argument", async () => {
  resetConnectionStoreForTests();
  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding({
        code: "   ",
        actor: adminActor,
      }),
    (err: any) => err.code === "invalid_argument"
  );
});

await test("non-admin actor onboarding is forbidden", async () => {
  resetConnectionStoreForTests();
  await assert.rejects(
    () =>
      processEmbeddedSignupOnboarding({
        code: "valid_code",
        actor: salesActor,
      }),
    (err: any) => err.code === "forbidden"
  );
});

await test("non-admin disconnect is forbidden", () => {
  resetConnectionStoreForTests();
  assert.throws(
    () => disconnectWhatsApp(salesActor),
    (err: any) => err.code === "forbidden"
  );
});

await test("secret redaction: access token is never leaked in status payload", () => {
  resetConnectionStoreForTests({
    accessToken: "EAAG_secret_token_never_expose",
    phoneNumberId: "987654321012345",
    wabaId: "123456789098765",
  });

  const status = getWhatsAppConnectionStatus();
  assert.equal("accessToken" in status, false);
  assert.equal(JSON.stringify(status).includes("EAAG_secret_token"), false);
});

await test("webhook health and timestamp recording", () => {
  resetConnectionStoreForTests();
  const now = new Date().toISOString();
  recordWebhookPing(now);

  const status = getWhatsAppConnectionStatus();
  assert.equal(status.lastWebhookAt, now);
  assert.equal(status.webhookHealth, "healthy");

  assert.equal(computeWebhookHealth(null), "unknown");
  assert.equal(
    computeWebhookHealth(new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString()),
    "degraded"
  );
  assert.equal(
    computeWebhookHealth(new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString()),
    "failing"
  );
});

await test("token health evaluation", () => {
  assert.equal(computeTokenHealth(null, null, null), "reauth_required");
  assert.equal(computeTokenHealth("valid_token", null, null), "valid");
  assert.equal(
    computeTokenHealth("valid_token", Date.now() - 1000, null),
    "expired"
  );
  assert.equal(
    computeTokenHealth("valid_token", Date.now() + 1000 * 60 * 60 * 24 * 2, null),
    "expiring_soon"
  );
});

await test("human takeover sets aiOwnershipState to HUMAN_HANDLING and halts AI replies", async () => {
  const store = new WhatsAppInboxMemoryStore();
  const repo = new InMemoryWhatsAppInboxConversationRepository(store);
  const companyId = "00000000-0000-0000-0000-000000000001";

  store.conversations.set("c_1", {
    id: "c_1",
    companyId,
    customerPhone: "923007776655",
    customerName: "Customer",
    channelId: "default",
    status: "UNASSIGNED",
    assignedUserId: null,
    assignedAt: null,
    assignedBy: null,
    aiOwnershipState: "AI_SHADOW",
    lockVersion: 1,
    lastMessageAt: new Date().toISOString(),
    lastMessagePreview: "Hello",
    lastMessageDirection: "inbound",
    hasFailedMessage: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const res = await repo.applyAssignmentChangeAtomic({
    conversationId: "c_1",
    expectedLockVersion: 1,
    assignedUserId: "u-sales-1",
    assignedAt: new Date().toISOString(),
    assignedBy: "u-admin-1",
    companyId,
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.row.assignedUserId, "u-sales-1");
    assert.equal(res.row.aiOwnershipState, "HUMAN_HANDLING");
  }
});
