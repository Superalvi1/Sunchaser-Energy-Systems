/**
 * AI-03 adapter + config tests.
 * Run: npm run test:whatsapp-ai-draft
 */
import assert from "node:assert/strict";
import {
  AI_DRAFT_CAN_SEND_WHATSAPP,
  createInboxAiDraftAdapter,
  createMockAiDraftAdapter,
  isAiDraftEnabled,
  MockAiDraftAdapter,
  readAiDraftConfig,
} from "./index.ts";

let failed = 0;

async function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const baseRequest = {
  companyId: "sunchaser",
  conversationId: "conv_1",
  conversationCompanyId: "sunchaser",
  actorUserId: "u-staff",
  messageText: "What panel sizes do you offer?",
};

await test("feature flag disabled by default", () => {
  const prev = process.env.WHATSAPP_AI_QUERY_DRAFT_ENABLED;
  delete process.env.WHATSAPP_AI_QUERY_DRAFT_ENABLED;
  const config = readAiDraftConfig({});
  assert.equal(config.draftEnabled, false);
  assert.equal(isAiDraftEnabled(config), false);
  assert.equal(config.autoReplyEnabled, false);
  if (prev === undefined) delete process.env.WHATSAPP_AI_QUERY_DRAFT_ENABLED;
  else process.env.WHATSAPP_AI_QUERY_DRAFT_ENABLED = prev;
});

await test("adapter never claims WhatsApp send capability", () => {
  assert.equal(AI_DRAFT_CAN_SEND_WHATSAPP, false);
});

await test("mock denies when feature disabled", async () => {
  const adapter = createMockAiDraftAdapter({
    config: {
      draftEnabled: false,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 1000,
    },
  });
  const outcome = await adapter.generateDraft(baseRequest);
  assert.equal(outcome.status, "denied");
  if (outcome.status === "denied") {
    assert.equal(outcome.reasonCode, "feature_disabled");
    assert.equal(outcome.autoSendBlocked, true);
    assert.equal(outcome.requiresHumanReview, true);
  }
});

await test("mock returns editable draft without sending", async () => {
  const adapter = new MockAiDraftAdapter({
    config: {
      draftEnabled: true,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 1000,
    },
    answer: "Suggested reply about panels.",
  });
  const outcome = await adapter.generateDraft(baseRequest);
  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.answer, "Suggested reply about panels.");
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
    assert.ok(outcome.warnings.length > 0);
    assert.ok(outcome.confidence > 0);
  }
});

await test("tenant mismatch is denied", async () => {
  const adapter = createMockAiDraftAdapter({
    config: {
      draftEnabled: true,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 1000,
    },
  });
  const outcome = await adapter.generateDraft({
    ...baseRequest,
    companyId: "tenant-a",
    conversationCompanyId: "tenant-b",
  });
  assert.equal(outcome.status, "denied");
  if (outcome.status === "denied") {
    assert.equal(outcome.reasonCode, "tenant_mismatch");
  }
});

await test("provider failure throws safely (no send side effect)", async () => {
  const adapter = createMockAiDraftAdapter({
    config: {
      draftEnabled: true,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 1000,
    },
    failWith: new Error("mock provider boom"),
  });
  await assert.rejects(
    () => adapter.generateDraft(baseRequest),
    /mock provider boom/
  );
});

await test("factory defaults to mock adapter (no live provider)", () => {
  const adapter = createInboxAiDraftAdapter({
    config: {
      draftEnabled: true,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 1000,
    },
  });
  assert.equal(adapter.adapterId, "mock-ai-draft");
});

await test("timeout maps to denied timeout", async () => {
  const adapter = createMockAiDraftAdapter({
    config: {
      draftEnabled: true,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 50,
    },
    delayMs: 200,
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const outcome = await adapter.generateDraft({
    ...baseRequest,
    abortSignal: controller.signal,
  });
  assert.equal(outcome.status, "denied");
  if (outcome.status === "denied") {
    assert.equal(outcome.reasonCode, "timeout");
  }
});

if (failed > 0) {
  console.error(`\n${failed} ai-draft adapter test(s) failed`);
  process.exit(1);
}
console.log("\nAll ai-draft adapter tests passed");
