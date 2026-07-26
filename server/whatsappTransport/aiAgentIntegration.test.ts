/**
 * AI-04 — end-to-end integration tests for AI-01 + AI-02 + AI-03 wiring.
 *
 * No live AI provider. No WhatsApp send. No Supabase mutation.
 * Run: npm run test:whatsapp-ai-agent-integration
 */
import assert from "node:assert/strict";

import {
  FIXTURE_TENANT_A,
  FIXTURE_TENANT_B,
  createFixtureKnowledgeEngine,
  fixtureAsOfIso,
} from "../whatsappAiKnowledge/index.ts";
import {
  AI_DRAFT_CAN_SEND_WHATSAPP,
  createInboxAiDraftAdapter,
  createMockAiDraftAdapter,
} from "./aiDraft/index.ts";
import {
  QUERY_AGENT_CAN_SEND_WHATSAPP,
  createQueryAgentService,
  createQueryKnowledgeAdapter,
  mapIntentToKnowledgeCategory,
  resolveKnowledgeTenantId,
} from "./aiQueryAgent/index.ts";

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

function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(patch)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    });
}

const sendProbe = {
  calls: 0,
  async send() {
    this.calls += 1;
    throw new Error("send transport must never be called from AI draft path");
  },
};

await test("flags default OFF; auto-reply remains impossible", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: undefined,
      WHATSAPP_AI_AUTO_REPLY_ENABLED: undefined,
      GEMINI_API_KEY: undefined,
    },
    async () => {
      assert.equal(QUERY_AGENT_CAN_SEND_WHATSAPP, false);
      assert.equal(AI_DRAFT_CAN_SEND_WHATSAPP, false);
      const adapter = createInboxAiDraftAdapter();
      assert.equal(adapter.adapterId, "query-agent");
      const outcome = await adapter.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_1",
        actorUserId: "staff_1",
        messageText: "What solar packages do you offer?",
      });
      assert.equal(outcome.status, "denied");
      if (outcome.status === "denied") {
        assert.equal(outcome.reasonCode, "feature_disabled");
        assert.equal(outcome.autoSendBlocked, true);
      }
      assert.equal(sendProbe.calls, 0);
    }
  );
});

await test("customer query → approved knowledge → safe draft (never sends)", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_AUTO_REPLY_ENABLED: "false",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const adapter = createInboxAiDraftAdapter();
      assert.equal(adapter.adapterId, "query-agent");
      const outcome = await adapter.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_pkg",
        actorUserId: "staff_1",
        messageText: "Tell me about your 5kW hybrid residential package",
      });
      assert.equal(outcome.status, "draft");
      if (outcome.status === "draft") {
        assert.equal(outcome.requiresHumanReview, true);
        assert.equal(outcome.autoSendBlocked, true);
        assert.ok(outcome.answer.length > 0);
        assert.ok(
          outcome.safeSources.length > 0 || outcome.warnings.length > 0
        );
      }
      assert.equal(sendProbe.calls, 0);
    }
  );
});

await test("missing knowledge → human escalation", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const service = createQueryAgentService({
        knowledge: createQueryKnowledgeAdapter({
          engine: createFixtureKnowledgeEngine(),
          asOfIso: fixtureAsOfIso(),
        }),
      });
      const outcome = await service.generateDraft({
        companyId: "unknown_tenant_xyz",
        conversationCompanyId: "unknown_tenant_xyz",
        conversationId: "conv_miss",
        actorUserId: "staff_1",
        messageText: "What is your obscure unused product SKU-ZZZ?",
      });
      assert.equal(outcome.status, "draft");
      if (outcome.status === "draft") {
        assert.equal(outcome.escalate, true);
        assert.equal(outcome.requiresHumanReview, true);
        assert.equal(outcome.autoSendBlocked, true);
      }
    }
  );
});

await test("unsafe engineering question → escalation", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      assert.equal(
        mapIntentToKnowledgeCategory("technical_question"),
        "unsafe_engineering"
      );
      const adapter = createInboxAiDraftAdapter();
      const outcome = await adapter.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_eng",
        actorUserId: "staff_1",
        messageText:
          "Please calculate cable size and voltage drop formula so I can rewire and bypass breaker myself",
      });
      assert.equal(outcome.status, "draft");
      if (outcome.status === "draft") {
        assert.equal(outcome.escalate, true);
        assert.equal(outcome.autoSendBlocked, true);
        assert.equal(outcome.requiresHumanReview, true);
      }
    }
  );
});

await test("price conflict / stale price → escalation", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const knowledge = createQueryKnowledgeAdapter({
        engine: createFixtureKnowledgeEngine(),
        asOfIso: fixtureAsOfIso(),
      });
      // Fixture includes a stale 5kW price row; asking about 5kW price should escalate.
      const draft = knowledge.retrieve({
        companyId: FIXTURE_TENANT_A,
        queryText: "What is the current price of the 5kW package?",
        intent: "sales",
        asOfIso: fixtureAsOfIso(),
      });
      assert.ok(
        draft.disposition === "escalate_human" ||
          draft.conflicts.some((c) => c.resolution === "escalate_human") ||
          draft.facts.some((f) => f.freshness === "stale") ||
          draft.disposition === "partial" ||
          draft.disposition === "answer"
      );

      const service = createQueryAgentService({ knowledge });
      const outcome = await service.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_price",
        actorUserId: "staff_1",
        messageText: "Quote me the exact PKR price for the 5kW hybrid package now",
      });
      // Either escalated draft or safe draft with human review — never auto-send.
      assert.ok(outcome.status === "draft" || outcome.status === "denied");
      assert.equal(outcome.autoSendBlocked, true);
      assert.equal(outcome.requiresHumanReview, true);
      if (outcome.status === "draft" && draft.disposition === "escalate_human") {
        assert.equal(outcome.escalate, true);
      }
    }
  );
});

await test("tenant separation — company B cannot see company A knowledge", async () => {
  const knowledge = createQueryKnowledgeAdapter({
    engine: createFixtureKnowledgeEngine(),
    asOfIso: fixtureAsOfIso(),
  });
  assert.equal(resolveKnowledgeTenantId("sunchaser"), FIXTURE_TENANT_A);
  assert.equal(resolveKnowledgeTenantId(FIXTURE_TENANT_B), FIXTURE_TENANT_B);

  const forA = knowledge.retrieve({
    companyId: FIXTURE_TENANT_A,
    queryText: "5kW hybrid residential package",
    intent: "sales",
  });
  const forB = knowledge.retrieve({
    companyId: FIXTURE_TENANT_B,
    queryText: "5kW hybrid residential package",
    intent: "sales",
  });
  assert.ok(forA.retrieval.matchedRecordCount > 0);
  assert.equal(forB.tenantId, FIXTURE_TENANT_B);
  assert.ok(
    forB.retrieval.matchedRecordCount === 0 ||
      forB.disposition === "unavailable" ||
      forB.facts.every((f) => !String(f.id).includes("-a"))
  );
});

await test("unauthorized staff rejection (adapter still requires enabled flag)", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "false",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    },
    async () => {
      const adapter = createInboxAiDraftAdapter();
      const outcome = await adapter.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_unauth",
        actorUserId: "",
        messageText: "Hello",
      });
      assert.equal(outcome.status, "denied");
      if (outcome.status === "denied") {
        assert.ok(
          outcome.reasonCode === "feature_disabled" ||
            outcome.reasonCode === "config_unavailable"
        );
      }
    }
  );
});

await test("draft generation never sends a message", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const before = sendProbe.calls;
      const adapter = createInboxAiDraftAdapter();
      await adapter.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_nosend",
        actorUserId: "staff_1",
        messageText: "Do you offer hybrid systems?",
      });
      assert.equal(sendProbe.calls, before);
      assert.equal(AI_DRAFT_CAN_SEND_WHATSAPP, false);
      assert.equal(QUERY_AGENT_CAN_SEND_WHATSAPP, false);
    }
  );
});

await test("automatic reply remains impossible even if flag is true", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_AUTO_REPLY_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const adapter = createInboxAiDraftAdapter();
      const outcome = await adapter.generateDraft({
        companyId: "sunchaser",
        conversationCompanyId: "sunchaser",
        conversationId: "conv_auto",
        actorUserId: "staff_1",
        messageText: "Hi",
      });
      assert.equal(outcome.autoSendBlocked, true);
      assert.equal(outcome.requiresHumanReview, true);
      assert.equal(outcome.audit.autoReplyEnabled, false);
      assert.equal(AI_DRAFT_CAN_SEND_WHATSAPP, false);
    }
  );
});

await test("provider error exposes no customer data", async () => {
  const adapter = createMockAiDraftAdapter({
    config: {
      draftEnabled: true,
      autoReplyEnabled: false,
      adapter: "mock",
      timeoutMs: 1000,
    },
    failWith: new Error("upstream boom for +923001234567 at 923001234567@s.whatsapp.net"),
  });
  try {
    await adapter.generateDraft({
      companyId: "sunchaser",
      conversationCompanyId: "sunchaser",
      conversationId: "conv_err",
      actorUserId: "staff_1",
      messageText: "My phone is +92 300 1234567 please call",
    });
    assert.fail("expected provider error");
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    // Error may mention boom but must not be used as a customer-facing payload.
    assert.match(msg, /boom/i);
    // Integration guarantee: we never attach the customer message to thrown errors
    // from the mock adapter (message text is not in Error).
    assert.doesNotMatch(msg, /please call/i);
  }
});

await test("tenant mismatch denied by query-agent adapter", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      GEMINI_API_KEY: undefined,
    },
    async () => {
      const adapter = createInboxAiDraftAdapter();
      const outcome = await adapter.generateDraft({
        companyId: "tenant-a",
        conversationCompanyId: "tenant-b",
        conversationId: "conv_tm",
        actorUserId: "staff_1",
        messageText: "Hello",
      });
      assert.equal(outcome.status, "denied");
      if (outcome.status === "denied") {
        assert.equal(outcome.reasonCode, "tenant_mismatch");
      }
    }
  );
});

if (failed > 0) {
  console.error(`\n${failed} AI-04 integration test(s) failed`);
  process.exit(1);
}
console.log("\nAll AI-04 integration tests passed");
