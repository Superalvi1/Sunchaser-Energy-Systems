/**
 * AI-05 — production launch knowledge pack + fail-closed source selector tests.
 *
 * Proves production never loads fixtures, prices escalate without amounts,
 * and approved Sunchaser launch facts work.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createQueryAgentService,
  createQueryKnowledgeAdapter,
  createUnavailableKnowledgePort,
  knowledgeRequiresHumanEscalation,
  prepareKnowledgeDraftForPhrasing,
  queryRequestsPrice,
  readKnowledgeSource,
  readQueryAgentConfig,
  resolveKnowledgeTenantId,
  type QueryAgentGateway,
} from "../whatsappTransport/aiQueryAgent/index.ts";
import {
  FIXTURE_TENANT_A,
  FORBIDDEN_FIXTURE_PRICE_AMOUNTS,
  FORBIDDEN_FIXTURE_SOURCE_IDS,
  KNOWLEDGE_FIXTURE_RECORDS,
  KNOWLEDGE_PRODUCTION_RECORDS,
  PRODUCTION_TENANT_SUNCHASER,
  createFixtureKnowledgeEngine,
  createProductionKnowledgeEngine,
  fixtureAsOfIso,
  productionAsOfIso,
} from "./index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function assertNoFixtureLeak(text: string, label: string): void {
  const sample = String(text || "");
  for (const amount of FORBIDDEN_FIXTURE_PRICE_AMOUNTS) {
    assert.doesNotMatch(
      sample,
      new RegExp(String(amount)),
      `${label} must not expose fixture amount ${amount}`
    );
  }
  for (const sourceId of FORBIDDEN_FIXTURE_SOURCE_IDS) {
    assert.doesNotMatch(
      sample,
      new RegExp(sourceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${label} must not expose fixture sourceId ${sourceId}`
    );
  }
  assert.doesNotMatch(sample, /tenant_sunchaser_demo|knowledge-fixtures/);
  assert.doesNotMatch(sample, /875000|1450000|650000|899000|999999/);
}

function mockGateway(): QueryAgentGateway {
  return {
    providerId: "mock-ai05",
    isConfigured: () => true,
    async phraseDraft() {
      return {
        phrasedAnswer:
          "Sunchaser draft for staff review. A human must edit before send.",
        confidence: 0.8,
        providerId: "mock-ai05",
        model: "mock",
      };
    },
  };
}

await test("production pack contains zero priced records and no fixture IDs", () => {
  assert.ok(KNOWLEDGE_PRODUCTION_RECORDS.length >= 5);
  for (const record of KNOWLEDGE_PRODUCTION_RECORDS) {
    assert.equal(record.tenantId, PRODUCTION_TENANT_SUNCHASER);
    assert.equal(record.containsPrice, false);
    assert.equal(record.price, null);
    assert.ok(!FORBIDDEN_FIXTURE_SOURCE_IDS.includes(record.id));
    assert.ok(record.id.startsWith("sc-launch-"));
    assertNoFixtureLeak(JSON.stringify(record), `record ${record.id}`);
  }
  // Fixture pack still exists for tests — but is disjoint.
  assert.ok(KNOWLEDGE_FIXTURE_RECORDS.some((r) => r.containsPrice));
});

await test("production engine never loads fixture records", () => {
  const engine = createProductionKnowledgeEngine();
  const prodSnap = engine.storeSnapshot(PRODUCTION_TENANT_SUNCHASER);
  const fixtureSnap = engine.storeSnapshot(FIXTURE_TENANT_A);
  assert.ok(prodSnap.recordCount > 0);
  assert.equal(fixtureSnap.recordCount, 0);

  // Prove loaded IDs are launch-only via retrieval across fixture source titles.
  const probe = engine.retrieveAnswerDraft({
    tenantId: PRODUCTION_TENANT_SUNCHASER,
    queryText: "5kW hybrid residential package price PKR",
    categoryHint: "solar_packages",
    asOfIso: productionAsOfIso(),
  });
  const ids = probe.facts.map((f) => f.sourceId);
  for (const forbidden of FORBIDDEN_FIXTURE_SOURCE_IDS) {
    assert.ok(!ids.includes(forbidden), `must not load ${forbidden}`);
  }
  assert.ok(probe.facts.every((f) => !f.containsPrice && f.price == null));
  assertNoFixtureLeak(JSON.stringify(probe), "production retrieve probe");
  assertNoFixtureLeak(JSON.stringify(KNOWLEDGE_PRODUCTION_RECORDS), "pack");
});

await test("knowledge source selector: production runtime requires production", () => {
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "production",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    }),
    "production"
  );
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "production",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "fixtures",
    }),
    "unavailable"
  );
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "production",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "",
    }),
    "unavailable"
  );
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "production",
    }),
    "unavailable"
  );
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "production",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "demo",
    }),
    "unavailable"
  );
});

await test("knowledge source selector: non-production may select fixtures explicitly only", () => {
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "test",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "fixtures",
    }),
    "fixtures"
  );
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "development",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    }),
    "production"
  );
  assert.equal(
    readKnowledgeSource({ NODE_ENV: "test" }),
    "unavailable"
  );
  assert.equal(
    readKnowledgeSource({
      NODE_ENV: "test",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "unknown",
    }),
    "unavailable"
  );
  assert.equal(
    readQueryAgentConfig({
      NODE_ENV: "test",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    }).knowledgeSource,
    "production"
  );
});

await test("adapter: production runtime never selects fixture port", () => {
  const blocked = createQueryKnowledgeAdapter({
    env: {
      NODE_ENV: "production",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "fixtures",
    },
  });
  assert.equal(blocked.portId, "knowledge-unavailable");

  const prod = createQueryKnowledgeAdapter({
    env: {
      NODE_ENV: "production",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    },
  });
  assert.equal(prod.portId, "knowledge-production");

  const draft = prod.retrieve({
    companyId: "sunchaser",
    queryText: "Tell me about Sunchaser solar solutions in Lahore",
    intent: "sales",
  });
  assert.equal(draft.tenantId, PRODUCTION_TENANT_SUNCHASER);
  assert.ok(draft.retrieval.matchedRecordCount > 0);
  assertNoFixtureLeak(JSON.stringify(draft), "production retrieve draft");
});

await test("adapter: missing/invalid knowledge source fails closed", () => {
  for (const env of [
    { NODE_ENV: "test" },
    { NODE_ENV: "test", WHATSAPP_AI_KNOWLEDGE_SOURCE: "" },
    { NODE_ENV: "test", WHATSAPP_AI_KNOWLEDGE_SOURCE: "bogus" },
    { NODE_ENV: "production", WHATSAPP_AI_KNOWLEDGE_SOURCE: "fixtures" },
  ] as NodeJS.ProcessEnv[]) {
    const port = createQueryKnowledgeAdapter({ env });
    assert.equal(port.portId, "knowledge-unavailable");
    const draft = port.retrieve({
      companyId: "sunchaser",
      queryText: "What is the 5kW hybrid package price?",
      intent: "sales",
    });
    assert.equal(draft.disposition, "unavailable");
    assert.equal(knowledgeRequiresHumanEscalation(draft, {
      queryText: "What is the 5kW hybrid package price?",
    }), true);
    assertNoFixtureLeak(JSON.stringify(draft), "unavailable draft");
  }
});

await test("adapter: explicit fixtures mode loads fixtures only outside production runtime", () => {
  const port = createQueryKnowledgeAdapter({
    env: {
      NODE_ENV: "test",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "fixtures",
    },
  });
  assert.equal(port.portId, "knowledge-fixtures");
  assert.equal(resolveKnowledgeTenantId("sunchaser", "fixtures"), FIXTURE_TENANT_A);
  const draft = port.retrieve({
    companyId: "sunchaser",
    queryText: "5kW hybrid residential package",
    intent: "sales",
    asOfIso: fixtureAsOfIso(),
  });
  assert.ok(draft.facts.some((f) => f.sourceId === "pkg-5kw-hybrid-a"));
});

await test("approved Sunchaser launch facts retrieve for company questions", () => {
  const port = createQueryKnowledgeAdapter({
    knowledgeSource: "production",
    asOfIso: productionAsOfIso(),
  });
  const draft = port.retrieve({
    companyId: "sunchaser",
    queryText: "What solar solutions does Sunchaser Energy Systems provide in Lahore?",
    intent: "sales",
  });
  assert.ok(["answer", "partial"].includes(draft.disposition));
  const blob = JSON.stringify(draft);
  assert.match(blob, /Sunchaser Energy Systems/);
  assert.match(blob, /residential and commercial/i);
  assert.match(blob, /Lahore/i);
  assert.match(blob, /on-grid|hybrid/i);
  assertNoFixtureLeak(blob, "launch facts");
});

await test("quotation enquiry asks for approved information checklist", () => {
  const port = createQueryKnowledgeAdapter({
    knowledgeSource: "production",
    asOfIso: productionAsOfIso(),
  });
  const draft = port.retrieve({
    companyId: "sunchaser",
    queryText: "I need a quotation — what do you need for a quote?",
    intent: "quotation_request",
  });
  const blob = `${draft.safeReplyHints.join(" ")} ${draft.facts.map((f) => f.text).join(" ")}`;
  assert.match(blob, /customer name/i);
  assert.match(blob, /city\/area|city/i);
  assert.match(blob, /residential or commercial/i);
  assert.match(blob, /electricity bill/i);
  assert.match(blob, /on-grid|hybrid|not sure/i);
  assert.match(blob, /battery backup/i);
  assert.match(blob, /phone number/i);
  assertNoFixtureLeak(blob, "quotation checklist");
});

await test("every price request escalates without an amount", async () => {
  const priceQueries = [
    "What is the price of a 5kW hybrid package?",
    "10kW solar package kitne ka hai?",
    "Exact PKR cost please",
    "5kW ka rate bata dein",
  ];
  const port = createQueryKnowledgeAdapter({
    knowledgeSource: "production",
    asOfIso: productionAsOfIso(),
  });
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
      NODE_ENV: "test",
    }),
    gateway: mockGateway(),
    knowledge: port,
  });

  for (const messageText of priceQueries) {
    assert.equal(queryRequestsPrice(messageText), true, messageText);
    const outcome = await service.generateDraft({
      companyId: "sunchaser",
      conversationCompanyId: "sunchaser",
      conversationId: `conv_price_${messageText.length}`,
      actorUserId: "staff_1",
      messageText,
    });
    assert.equal(outcome.status, "draft", messageText);
    if (outcome.status === "draft") {
      assert.equal(outcome.escalate, true, messageText);
      assert.equal(outcome.requiresHumanReview, true);
      assert.equal(outcome.autoSendBlocked, true);
      assertNoFixtureLeak(outcome.answer, `price answer: ${messageText}`);
      assertNoFixtureLeak(
        outcome.warnings.join(" "),
        `price warnings: ${messageText}`
      );
      assert.doesNotMatch(outcome.answer, /\b\d{4,}\b/);
    }
  }
});

await test("warranty duration questions escalate", async () => {
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    }),
    gateway: mockGateway(),
    knowledge: createQueryKnowledgeAdapter({ knowledgeSource: "production" }),
  });
  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_warranty",
    actorUserId: "staff_1",
    messageText: "How many years is the panel warranty duration?",
  });
  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.requiresHumanReview, true);
    assert.doesNotMatch(outcome.answer, /\b\d+\s*years?\b/i);
    assertNoFixtureLeak(outcome.answer, "warranty answer");
  }
});

await test("site-specific engineering questions escalate", async () => {
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    }),
    gateway: mockGateway(),
    knowledge: createQueryKnowledgeAdapter({ knowledgeSource: "production" }),
  });
  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_eng",
    actorUserId: "staff_1",
    messageText:
      "Please calculate cable size and voltage drop formula for earthing and string sizing on my site",
  });
  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.requiresHumanReview, true);
    assert.ok(
      outcome.escalationReasons.includes("dangerous") ||
        outcome.escalationReasons.includes("uncertain")
    );
  }
});

await test("unknown questions escalate", async () => {
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
    }),
    gateway: mockGateway(),
    knowledge: createQueryKnowledgeAdapter({ knowledgeSource: "production" }),
  });
  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_unknown",
    actorUserId: "staff_1",
    messageText: "What is your obscure unused product SKU-ZZZ-ORBIT?",
  });
  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
  }
});

await test("tenant isolation remains enforced on production pack", () => {
  const port = createQueryKnowledgeAdapter({
    knowledgeSource: "production",
    asOfIso: productionAsOfIso(),
  });
  assert.equal(
    resolveKnowledgeTenantId("sunchaser", "production"),
    PRODUCTION_TENANT_SUNCHASER
  );
  const forSunchaser = port.retrieve({
    companyId: "sunchaser",
    queryText: "Sunchaser solar solutions Lahore",
    intent: "sales",
  });
  const forOther = port.retrieve({
    companyId: "other_org_xyz",
    queryText: "Sunchaser solar solutions Lahore",
    intent: "sales",
  });
  assert.ok(forSunchaser.retrieval.matchedRecordCount > 0);
  assert.equal(forOther.tenantId, "other_org_xyz");
  assert.ok(
    forOther.disposition === "unavailable" ||
      forOther.retrieval.matchedRecordCount === 0
  );
});

await test("production phrasing path never emits fixture prices or source IDs", () => {
  const port = createQueryKnowledgeAdapter({ knowledgeSource: "production" });
  const draft = port.retrieve({
    companyId: "sunchaser",
    queryText: "What is the current price of the 5kW hybrid package?",
    intent: "sales",
  });
  assert.equal(
    knowledgeRequiresHumanEscalation(draft, {
      queryText: "What is the current price of the 5kW hybrid package?",
    }),
    true
  );
  const prepared = prepareKnowledgeDraftForPhrasing(
    draft,
    "What is the current price of the 5kW hybrid package?"
  );
  assertNoFixtureLeak(JSON.stringify(prepared), "prepared production draft");
});

await test("unavailable port and fixture factory remain distinct", () => {
  const unavailable = createUnavailableKnowledgePort();
  assert.equal(unavailable.portId, "knowledge-unavailable");
  const fixtures = createQueryKnowledgeAdapter({
    engine: createFixtureKnowledgeEngine(),
    knowledgeSource: "fixtures",
    asOfIso: fixtureAsOfIso(),
  });
  assert.equal(fixtures.portId, "knowledge-fixtures");
  assert.notEqual(unavailable.portId, fixtures.portId);
});

await test("no WhatsApp transport/send import in production knowledge modules", () => {
  const files = [
    "knowledgeProduction.ts",
    "knowledgeEngine.ts",
    join("..", "whatsappTransport", "aiQueryAgent", "queryKnowledgeAdapter.ts"),
  ];
  for (const rel of files) {
    const src = readFileSync(join(HERE, rel), "utf8");
    assert.doesNotMatch(
      src,
      /whatsappOutbound|sendOutbound|sendTextMessage|graph\.facebook|messages\.send/i,
      `${rel} must not import/call WhatsApp send`
    );
  }
});
