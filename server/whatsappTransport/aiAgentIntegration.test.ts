/**
 * AI-04 / AI-04-R1 — end-to-end integration tests for AI-01 + AI-02 + AI-03.
 *
 * No live AI provider network calls. No WhatsApp send. No Supabase mutation.
 * Run: npm run test:whatsapp-ai-agent-integration
 */
import assert from "node:assert/strict";

import {
  DEFAULT_PRICE_MAX_AGE_HOURS,
  FIXTURE_TENANT_A,
  FIXTURE_TENANT_B,
  InMemoryKnowledgeStore,
  KnowledgeAnswerEngine,
  createFixtureKnowledgeEngine,
  fixtureAsOfIso,
  type KnowledgeRecord,
} from "../whatsappAiKnowledge/index.ts";
import {
  AI_DRAFT_CAN_SEND_WHATSAPP,
  createInboxAiDraftAdapter,
  createMockAiDraftAdapter,
} from "./aiDraft/index.ts";
import {
  QUERY_AGENT_CAN_SEND_WHATSAPP,
  createQueryAgentGateway,
  createQueryAgentService,
  createQueryKnowledgeAdapter,
  isLiveQueryProviderOptedIn,
  isTechnicalRateContext,
  mapIntentToKnowledgeCategory,
  normalizePriceIntentText,
  prepareKnowledgeDraftForPhrasing,
  queryRequestsPrice,
  readQueryAgentConfig,
  resolveKnowledgeTenantId,
  stripTechnicalRateSpans,
  type QueryAgentGateway,
  type QueryProviderPhraseRequest,
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

function assertNoMonetaryLeak(
  text: string,
  forbiddenAmounts: number[],
  label: string
): void {
  const sample = String(text || "");
  for (const amount of forbiddenAmounts) {
    assert.doesNotMatch(
      sample,
      new RegExp(String(amount)),
      `${label} must not expose amount ${amount}`
    );
  }
}

function recordingGateway(): {
  gateway: QueryAgentGateway;
  calls: QueryProviderPhraseRequest[];
} {
  const calls: QueryProviderPhraseRequest[] = [];
  return {
    calls,
    gateway: {
      providerId: "mock-recording",
      isConfigured: () => true,
      async phraseDraft(request) {
        calls.push(request);
        return {
          phrasedAnswer:
            "Recorded mock draft for staff review. A human must edit before send.",
          confidence: 0.8,
          providerId: "mock-recording",
          model: "mock",
        };
      },
    },
  };
}

function hoursAgoIso(hours: number, asOf = fixtureAsOfIso()): string {
  return new Date(Date.parse(asOf) - hours * 60 * 60 * 1000).toISOString();
}

function engineFromRecords(records: KnowledgeRecord[]): KnowledgeAnswerEngine {
  return new KnowledgeAnswerEngine(new InMemoryKnowledgeStore(records));
}

await test("flags default OFF; auto-reply remains impossible", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: undefined,
      WHATSAPP_AI_AUTO_REPLY_ENABLED: undefined,
      WHATSAPP_AI_QUERY_PROVIDER: undefined,
      WHATSAPP_AI_LIVE_PROVIDER_ENABLED: undefined,
      GEMINI_API_KEY: undefined,
    },
    async () => {
      assert.equal(QUERY_AGENT_CAN_SEND_WHATSAPP, false);
      assert.equal(AI_DRAFT_CAN_SEND_WHATSAPP, false);
      const cfg = readQueryAgentConfig();
      assert.equal(cfg.draftEnabled, false);
      assert.equal(cfg.autoReplyEnabled, false);
      assert.equal(cfg.provider, "mock");
      assert.equal(cfg.liveProviderEnabled, false);
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

await test("provider opt-in: no provider setting + Gemini key => mock", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: undefined,
      WHATSAPP_AI_LIVE_PROVIDER_ENABLED: undefined,
      GEMINI_API_KEY: "AIza-test-key-must-not-network",
    },
    async () => {
      const cfg = readQueryAgentConfig();
      assert.equal(cfg.provider, "mock");
      assert.equal(isLiveQueryProviderOptedIn(process.env, cfg), false);
      const gateway = createQueryAgentGateway({ config: cfg, env: process.env });
      assert.equal(gateway.providerId, "mock");
    }
  );
});

await test("provider opt-in: provider=env + key but live flag absent/false => mock", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "env",
      WHATSAPP_AI_LIVE_PROVIDER_ENABLED: "false",
      GEMINI_API_KEY: "AIza-test-key-must-not-network",
    },
    async () => {
      const cfg = readQueryAgentConfig();
      assert.equal(cfg.provider, "env");
      assert.equal(cfg.liveProviderEnabled, false);
      assert.equal(isLiveQueryProviderOptedIn(process.env, cfg), false);
      const gateway = createQueryAgentGateway({ config: cfg, env: process.env });
      assert.equal(gateway.providerId, "mock");
    }
  );
});

await test("provider opt-in: unknown provider value + Gemini key => mock", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "gemini-live",
      WHATSAPP_AI_LIVE_PROVIDER_ENABLED: "true",
      GEMINI_API_KEY: "AIza-test-key-must-not-network",
    },
    async () => {
      const cfg = readQueryAgentConfig();
      assert.equal(cfg.provider, "mock");
      assert.equal(isLiveQueryProviderOptedIn(process.env, cfg), false);
      const gateway = createQueryAgentGateway({ config: cfg, env: process.env });
      assert.equal(gateway.providerId, "mock");
    }
  );
});

await test("provider opt-in: full opt-in selects injected fake live gateway only", async () => {
  let networkishCalls = 0;
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "env",
      WHATSAPP_AI_LIVE_PROVIDER_ENABLED: "true",
      GEMINI_API_KEY: "AIza-test-key-must-not-network",
    },
    async () => {
      const cfg = readQueryAgentConfig();
      assert.equal(isLiveQueryProviderOptedIn(process.env, cfg), true);
      const gateway = createQueryAgentGateway({
        config: cfg,
        env: process.env,
        liveComplete: async () => {
          networkishCalls += 1;
          return {
            text: "Fake live gateway draft — human must review before send.",
            model: "fake-live",
            providerId: "fake-live",
          };
        },
      });
      assert.equal(gateway.providerId, "live");
      const phrased = await gateway.phraseDraft({
        companyId: "sunchaser",
        intent: "sales",
        policyAnswerOutline: "Describe packages safely.",
        sanitizedUserText: "Tell me about solar packages",
        warnings: [],
        allowedToolNames: [],
      });
      assert.equal(networkishCalls, 1);
      assert.match(phrased.phrasedAnswer, /Fake live gateway draft/i);
      assert.equal(phrased.providerId, "fake-live");
    }
  );
});

await test("AI-04-R2: informal Pakistani price intents are recognized", () => {
  const positives = [
    "5kW ka rate bata dein",
    "8kW system kitne ka hai?",
    "10kW ke charges kya hain?",
    "solar package kia rate hai",
    "5kw kitnay ka hai",
    "system kitni ki hai",
    "kitnay mein milega 5kw",
    "price batao please",
    "rate batao",
    // punctuation / case / spacing variations
    "  5KW   KA   RATE???   BATA   DEIN!!!  ",
    "10kw-ke-charges-kya-hain",
    "Solar Package  KYA   Rate  Hai",
    // Urdu-script
    "5kW کی قیمت کیا ہے؟",
    "پیکج کا ریٹ بتائیں",
    "کتنے کا ہے 8kW؟",
    "کتنی کی ہے؟",
  ];
  for (const sample of positives) {
    assert.equal(
      queryRequestsPrice(sample),
      true,
      `expected price intent: ${JSON.stringify(sample)} (norm=${normalizePriceIntentText(sample)})`
    );
  }
});

await test("AI-04-R2: technical rate phrases are not price requests", () => {
  const technical = [
    "What is the battery charge rate for this lithium pack?",
    "Explain the charging rate for overnight top-up",
    "Safe discharge rate for the battery bank?",
    "What data rate does the logger use?",
    "Display refresh rate settings",
    "Inverter failure rate statistics",
    "Expected generation rate in summer",
    "Panel degradation rate per year",
  ];
  for (const sample of technical) {
    assert.equal(isTechnicalRateContext(sample), true, sample);
    assert.equal(
      queryRequestsPrice(sample),
      false,
      `technical rate must not be price intent: ${sample}`
    );
  }
});

await test("AI-04-R3: span-safe technical-only rate intents => false", () => {
  const technicalOnly = [
    "What is the charge rate for this battery?",
    "What is the rate of discharge?",
    "Explain the rate of panel degradation.",
    "Battery charge/discharge rate kya hai?",
    "بیٹری کا چارجنگ ریٹ کیا ہے؟",
  ];
  for (const sample of technicalOnly) {
    const stripped = stripTechnicalRateSpans(sample);
    assert.equal(
      stripped.removedTechnicalSpan,
      true,
      `expected technical span removed: ${sample}`
    );
    assert.equal(
      queryRequestsPrice(sample),
      false,
      `technical-only must be false: ${sample} (remainder=${JSON.stringify(stripped.normalizedRemainder)})`
    );
  }
});

await test("AI-04-R3: mixed technical + package price intent => true", () => {
  const mixed = [
    "What is the battery charging rate and the 10kW system rate?",
    "Tell me the discharge rate and 8kW package rate.",
    "Battery charging rate kya hai aur 10kW kitne ka hai?",
    "بیٹری کا چارجنگ ریٹ کیا ہے اور 10kW کی قیمت؟",
    "Battery charging ریٹ kya hai aur solar package rate batao",
  ];
  for (const sample of mixed) {
    assert.equal(
      queryRequestsPrice(sample),
      true,
      `mixed intent must be price-positive: ${sample}`
    );
    // Explicit commercial wording must win even alongside technical rate.
    assert.equal(
      queryRequestsPrice(
        `What is the battery charging rate and the package cost for 10kW?`
      ),
      true
    );
  }
});

await test("AI-04-R4: price-first mixed must not be swallowed by technical spans", () => {
  const priceFirst = [
    "battery package ریٹ aur charging ریٹ?",
    "10kW system ریٹ aur battery charging ریٹ?",
    "solar package rate aur battery charging ریٹ?",
  ];
  for (const sample of priceFirst) {
    const stripped = stripTechnicalRateSpans(sample);
    assert.equal(
      queryRequestsPrice(sample),
      true,
      `price-first mixed must be true: ${sample} (remainder=${JSON.stringify(stripped.rawRemainder)})`
    );
    assert.match(
      stripped.rawRemainder,
      /package|system|rate|ریٹ/i,
      `commercial wording must remain after tech strip: ${sample}`
    );
  }
});

await test("AI-04-R4: price-first Urdu must not be swallowed by technical spans", () => {
  const priceFirstUrdu = [
    "بیٹری پیکیج کا ریٹ اور چارجنگ ریٹ کیا ہے؟",
    "بیٹری پیکیج کا ریٹ اور بیٹری کا چارجنگ ریٹ کیا ہے؟",
    "بیٹری پیکیج کی قیمت اور discharge rate کیا ہے؟",
    "سولر پیکیج کا ریٹ اور بیٹری کا discharge ریٹ؟",
  ];
  for (const sample of priceFirstUrdu) {
    const stripped = stripTechnicalRateSpans(sample);
    assert.equal(
      queryRequestsPrice(sample),
      true,
      `price-first Urdu must be true: ${sample} (remainder=${JSON.stringify(stripped.rawRemainder)})`
    );
    assert.match(
      stripped.rawRemainder,
      /پیکیج|قیمت|ریٹ/,
      `Urdu commercial wording must remain: ${sample}`
    );
  }
});

await test("AI-04-R4: technical Urdu with safe descriptive words stays non-price", () => {
  const technicalUrdu = [
    "بیٹری بینک کا چارجنگ ریٹ بتائیں",
    "lithium battery pack charging rate kya hai",
    "بیٹری پیک کا discharge ریٹ کیا ہے؟",
  ];
  for (const sample of technicalUrdu) {
    assert.equal(
      queryRequestsPrice(sample),
      false,
      `descriptive technical-only must be false: ${sample}`
    );
    assert.equal(isTechnicalRateContext(sample), true, sample);
  }
});

await test("AI-04-R2: informal conflicting/stale/missing price requests escalate", async () => {
  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: createFixtureKnowledgeEngine(),
      asOfIso: fixtureAsOfIso(),
    }),
  });

  // Conflicting current 5kW prices via informal wording.
  const conflict = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_r2_conflict",
    actorUserId: "staff_1",
    messageText: "5kW ka rate bata dein",
  });
  assert.equal(conflict.status, "draft");
  if (conflict.status === "draft") {
    assert.equal(conflict.escalate, true);
    assert.equal(conflict.requiresHumanReview, true);
    assert.equal(conflict.autoSendBlocked, true);
    assertNoMonetaryLeak(
      conflict.answer,
      [650000, 875000, 899000],
      "informal conflict answer"
    );
  }

  // Missing approved price for 8kW (no fixture amount for that size).
  assert.equal(queryRequestsPrice("8kW solar package kitne ka hai?"), true);
  const missing = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_r2_missing",
    actorUserId: "staff_1",
    messageText: "8kW solar package kitne ka hai?",
  });
  assert.equal(missing.status, "draft");
  if (missing.status === "draft") {
    assert.equal(missing.escalate, true);
    assert.equal(missing.requiresHumanReview, true);
    assert.equal(missing.autoSendBlocked, true);
    assert.ok(
      missing.escalationReasons.includes("uncertain") ||
        missing.warnings.some((w) => /price|knowledge|human/i.test(w))
    );
  }

  // Stale-only informal request (knowledge price path).
  const staleAmount = 588000;
  const staleRecorder = recordingGateway();
  const staleService = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway: staleRecorder.gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: engineFromRecords([
        {
          id: "pkg-6kw-stale-informal",
          tenantId: FIXTURE_TENANT_A,
          sourceType: "pricing_approved",
          title: "6kW Package Price (stale)",
          body: "Legacy approved row retained for freshness testing only.",
          categories: ["solar_packages"],
          keywords: ["6kw", "package", "price", "rate"],
          publishedAt: hoursAgoIso(96),
          maxAgeHours: DEFAULT_PRICE_MAX_AGE_HOURS,
          containsPrice: true,
          price: {
            amountPkr: staleAmount,
            currency: "PKR",
            unitLabel: "starting package",
            publishedAt: hoursAgoIso(96),
            freshness: "stale",
            sourceId: "pkg-6kw-stale-informal",
            sourceTitle: "6kW Package Price (stale)",
          },
          priority: 80,
          active: true,
        },
      ]),
      asOfIso: fixtureAsOfIso(),
    }),
  });
  assert.equal(queryRequestsPrice("6kW package kitnay ka rate hai?"), true);
  const stale = await staleService.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_r2_stale",
    actorUserId: "staff_1",
    messageText: "6kW package kitnay ka rate hai?",
  });
  assert.equal(stale.status, "draft");
  if (stale.status === "draft") {
    assert.equal(stale.escalate, true);
    assert.equal(stale.requiresHumanReview, true);
    assert.equal(stale.autoSendBlocked, true);
    assertNoMonetaryLeak(stale.answer, [staleAmount], "informal stale answer");
  }

  assert.equal(
    calls.length,
    0,
    "informal uncertain prices must not reach provider phrasing"
  );
  assert.equal(
    staleRecorder.calls.length,
    0,
    "stale informal price must not reach provider phrasing"
  );
});

await test("AI-04-R2: one approved informal price request remains normal", async () => {
  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: createFixtureKnowledgeEngine(),
      asOfIso: fixtureAsOfIso(),
    }),
  });

  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_r2_one_price",
    actorUserId: "staff_1",
    messageText: "10kW ke charges kya hain?",
  });
  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
    assert.ok(outcome.answer.length > 0);
  }
  assert.ok(calls.length >= 1);
  const outline = calls.map((c) => c.policyAnswerOutline).join("\n");
  assert.match(outline, /1450000|1,450,000/);
  assertNoMonetaryLeak(outline, [650000, 875000, 899000], "informal one-price outline");
});

await test("customer query → approved knowledge → safe draft (never sends)", async () => {
  await withEnv(
    {
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_AUTO_REPLY_ENABLED: "false",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
      WHATSAPP_AI_LIVE_PROVIDER_ENABLED: "false",
      // Explicit fixtures mode for demo-pack assertion (never silent fallback).
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "fixtures",
      NODE_ENV: "test",
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
        assert.equal(outcome.escalate, false);
        assert.ok(outcome.answer.length > 0);
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
      WHATSAPP_AI_KNOWLEDGE_SOURCE: "production",
      NODE_ENV: "test",
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

await test("explicitly requested stale price => escalation", async () => {
  const staleAmount = 612000;
  const engine = engineFromRecords([
    {
      id: "pkg-7kw-stale-only",
      tenantId: FIXTURE_TENANT_A,
      sourceType: "pricing_approved",
      title: "7kW Package Price (stale)",
      body: "Legacy approved row retained for freshness testing only.",
      categories: ["solar_packages"],
      keywords: ["7kw", "package", "price"],
      publishedAt: hoursAgoIso(96),
      maxAgeHours: DEFAULT_PRICE_MAX_AGE_HOURS,
      containsPrice: true,
      price: {
        amountPkr: staleAmount,
        currency: "PKR",
        unitLabel: "starting package",
        publishedAt: hoursAgoIso(96),
        freshness: "stale",
        sourceId: "pkg-7kw-stale-only",
        sourceTitle: "7kW Package Price (stale)",
      },
      priority: 80,
      active: true,
    },
  ]);

  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine,
      asOfIso: fixtureAsOfIso(),
    }),
  });

  const messageText = "What is the current price of the 7kW package?";
  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_stale_price",
    actorUserId: "staff_1",
    messageText,
  });

  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
    assertNoMonetaryLeak(outcome.answer, [staleAmount], "stale draft answer");
    for (const w of outcome.warnings) {
      assertNoMonetaryLeak(w, [staleAmount], "stale warning");
    }
  }
  assert.equal(calls.length, 0, "stale price must not reach provider phrasing");
});

await test("conflicting current prices => escalation", async () => {
  const forbidden = [650000, 875000, 899000];
  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: createFixtureKnowledgeEngine(),
      asOfIso: fixtureAsOfIso(),
    }),
  });

  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_conflict_price",
    actorUserId: "staff_1",
    messageText: "Quote me the exact PKR price for the 5kW hybrid package now",
  });

  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
    assertNoMonetaryLeak(outcome.answer, forbidden, "conflict draft answer");
    for (const w of outcome.warnings) {
      assertNoMonetaryLeak(w, forbidden, "conflict warning");
    }
  }
  assert.equal(calls.length, 0, "conflicting prices must not reach provider");
});

await test("missing approved current price => escalation", async () => {
  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: createFixtureKnowledgeEngine(),
      asOfIso: fixtureAsOfIso(),
    }),
  });

  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_missing_price",
    actorUserId: "staff_1",
    messageText: "What is the price of mono perc solar panels?",
  });

  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, true);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
    assertNoMonetaryLeak(
      outcome.answer,
      [650000, 875000, 899000, 1450000],
      "missing-price answer"
    );
  }
  assert.equal(calls.length, 0);
});

await test("one current approved price => safe editable draft", async () => {
  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: createFixtureKnowledgeEngine(),
      asOfIso: fixtureAsOfIso(),
    }),
  });

  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_one_price",
    actorUserId: "staff_1",
    messageText: "What is the current price of the 10kW on-grid package?",
  });

  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
    assert.ok(outcome.answer.length > 0);
  }
  assert.ok(calls.length >= 1, "unambiguous price may use provider phrasing");
  const outline = calls.map((c) => c.policyAnswerOutline).join("\n");
  assert.match(outline, /1450000|1,450,000/);
  assertNoMonetaryLeak(outline, [650000, 875000, 899000], "safe price outline");
});

await test("non-price package question => normal safe behavior", async () => {
  const { gateway, calls } = recordingGateway();
  const service = createQueryAgentService({
    config: readQueryAgentConfig({
      WHATSAPP_AI_QUERY_DRAFT_ENABLED: "true",
      WHATSAPP_AI_QUERY_PROVIDER: "mock",
    }),
    gateway,
    knowledge: createQueryKnowledgeAdapter({
      engine: createFixtureKnowledgeEngine(),
      asOfIso: fixtureAsOfIso(),
    }),
  });

  const outcome = await service.generateDraft({
    companyId: "sunchaser",
    conversationCompanyId: "sunchaser",
    conversationId: "conv_non_price",
    actorUserId: "staff_1",
    messageText: "Tell me about your 5kW hybrid residential package",
  });

  assert.equal(outcome.status, "draft");
  if (outcome.status === "draft") {
    assert.equal(outcome.escalate, false);
    assert.equal(outcome.requiresHumanReview, true);
    assert.equal(outcome.autoSendBlocked, true);
  }
  assert.ok(calls.length >= 1);
  const outline = calls.map((c) => c.policyAnswerOutline).join("\n");
  // Must not volunteer uncertain/conflicting amounts when price was not asked.
  assertNoMonetaryLeak(
    outline,
    [650000, 875000, 899000],
    "non-price provider outline"
  );
});

await test("stale/conflicting monetary amounts absent from provider input and output", async () => {
  const knowledge = createQueryKnowledgeAdapter({
    engine: createFixtureKnowledgeEngine(),
    asOfIso: fixtureAsOfIso(),
  });
  const draft = knowledge.retrieve({
    companyId: FIXTURE_TENANT_A,
    queryText: "Quote me the exact PKR price for the 5kW hybrid package now",
    intent: "sales",
  });
  const prepared = prepareKnowledgeDraftForPhrasing(
    draft,
    "Quote me the exact PKR price for the 5kW hybrid package now"
  );
  const serialized = JSON.stringify(prepared);
  assertNoMonetaryLeak(
    serialized,
    [650000, 875000, 899000],
    "prepared phrasing draft"
  );
});

await test("tenant separation — company B cannot see company A knowledge", async () => {
  const knowledge = createQueryKnowledgeAdapter({
    engine: createFixtureKnowledgeEngine(),
    asOfIso: fixtureAsOfIso(),
  });
  assert.equal(resolveKnowledgeTenantId("sunchaser", "fixtures"), FIXTURE_TENANT_A);
  assert.equal(resolveKnowledgeTenantId(FIXTURE_TENANT_B, "fixtures"), FIXTURE_TENANT_B);

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
    failWith: new Error(
      "upstream boom for +923001234567 at 923001234567@s.whatsapp.net"
    ),
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
    assert.match(msg, /boom/i);
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
