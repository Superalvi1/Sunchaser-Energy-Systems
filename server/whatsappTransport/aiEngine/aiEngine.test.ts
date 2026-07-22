/**
 * Unit Tests for Sunchaser Connect Phase 1B: AI Conversation Engine Infrastructure.
 * Verifies state machine, context builder, memory model, prompt builder, provider abstraction,
 * decision schema, and shadow mode engine.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AiContextBuilder,
  AiIntentClassifier,
  AiLanguageDetector,
  AiMemoryStore,
  AiMissingFieldEngine,
  AiNextQuestionEngine,
  AiPromptBuilder,
  AiQualificationEngine,
  AiQualificationScorer,
  AiShadowEngine,
  AiStateMachine,
  createInitialLeadQualification,
  InMemoryAiShadowRepository,
  MockAiProvider,
  type AiDecision,
} from "./index.ts";

await test("1. State Machine: validates valid transitions and escalation safety", () => {
  const sm = new AiStateMachine();

  assert.equal(sm.canTransition("GREETING", "QUALIFYING"), true);
  assert.equal(sm.canTransition("GREETING", "INFO_PROVIDED"), false);
  assert.equal(sm.canTransition("QUALIFYING", "INFO_PROVIDED"), true);
  assert.equal(sm.canTransition("QUALIFYING", "ESCALATED"), true);

  const escalationDecision: AiDecision = {
    action: "ESCALATE_HUMAN",
    proposedReply: "Connecting to agent",
    confidence: 0.99,
    suggestedStateTransition: "QUALIFYING",
    extractedMemory: {},
    reasoning: "Customer requested human",
  };
  assert.equal(sm.computeNextState("GREETING", escalationDecision), "ESCALATED");

  const normalDecision: AiDecision = {
    action: "REPLY",
    proposedReply: "Details here",
    confidence: 0.9,
    suggestedStateTransition: "INFO_PROVIDED",
    extractedMemory: {},
    reasoning: "Information provided",
  };
  assert.equal(sm.computeNextState("QUALIFYING", normalDecision), "INFO_PROVIDED");
});

await test("2. Context Builder: aggregates context, CRM lead, memory slots, and transcript", () => {
  const builder = new AiContextBuilder();
  const context = builder.buildContext({
    conversationId: "conv_100",
    currentState: "QUALIFYING",
    contactName: "Ali Khan",
    contactPhone: "+923001234567",
    crmLead: { leadId: "lead_55", name: "Ali Khan", city: "Lahore" },
    memorySlots: { systemSizeKw: "10kW" },
    recentMessages: [
      {
        id: "msg_1",
        direction: "inbound",
        messageType: "text",
        textBody: "Need 10kW system",
        occurredAt: "2026-07-23T03:00:00Z",
      },
    ],
  });

  assert.equal(context.conversationId, "conv_100");
  assert.equal(context.currentState, "QUALIFYING");
  assert.equal(context.crmLead?.leadId, "lead_55");
  assert.equal(context.memory.systemSizeKw, "10kW");
  assert.equal(context.recentMessages.length, 1);
});

await test("3. Memory Store: stores, updates, and clears structured slot data", () => {
  const store = new AiMemoryStore();
  const initial = store.getMemory("c_test");
  assert.deepEqual(initial.slots, {});

  store.updateMemory("c_test", { systemSizeKw: 5, city: "Karachi" });
  const updated = store.getMemory("c_test");
  assert.equal(updated.slots.systemSizeKw, 5);
  assert.equal(updated.slots.city, "Karachi");

  store.updateMemory("c_test", { city: "Islamabad", budgetPkr: 1500000 });
  const merged = store.getMemory("c_test");
  assert.equal(merged.slots.systemSizeKw, 5);
  assert.equal(merged.slots.city, "Islamabad");
  assert.equal(merged.slots.budgetPkr, 1500000);

  store.clearMemory("c_test");
  assert.deepEqual(store.getMemory("c_test").slots, {});
});

await test("4. Prompt Builder: formats system prompt and context into provider request", () => {
  const contextBuilder = new AiContextBuilder();
  const promptBuilder = new AiPromptBuilder();

  const context = contextBuilder.buildContext({
    conversationId: "conv_prompt_1",
    currentState: "GREETING",
    contactName: "Tariq",
    contactPhone: "+923215556677",
    recentMessages: [
      {
        id: "m_1",
        direction: "inbound",
        messageType: "text",
        textBody: "Hello",
        occurredAt: "2026-07-23T03:01:00Z",
      },
    ],
  });

  const request = promptBuilder.buildPromptRequest(context);
  assert.ok(request.systemPrompt.includes("Sunchaser AI"));
  assert.ok(request.userPrompt.includes("conv_prompt_1"));
  assert.ok(request.userPrompt.includes("INBOUND: Hello"));
});

await test("5. Provider Abstraction & Mock Provider: evaluates keywords without external API keys", async () => {
  const provider = new MockAiProvider();
  const contextBuilder = new AiContextBuilder();
  const promptBuilder = new AiPromptBuilder();

  // Test keyword: hi -> greeting reply
  const ctxGreeting = contextBuilder.buildContext({
    conversationId: "c1",
    recentMessages: [
      { id: "m1", direction: "inbound", messageType: "text", textBody: "hi there", occurredAt: "2026-07-23T03:00:00Z" },
    ],
  });
  const req1 = promptBuilder.buildPromptRequest(ctxGreeting);
  const dec1 = await provider.generateDecision(req1);
  assert.equal(dec1.action, "REPLY");
  assert.equal(dec1.suggestedStateTransition, "GREETING");
  assert.ok(dec1.confidence >= 0.9);

  // Test keyword: human -> escalation
  const ctxHuman = contextBuilder.buildContext({
    conversationId: "c2",
    recentMessages: [
      { id: "m2", direction: "inbound", messageType: "text", textBody: "i want to speak to an agent", occurredAt: "2026-07-23T03:00:00Z" },
    ],
  });
  const req2 = promptBuilder.buildPromptRequest(ctxHuman);
  const dec2 = await provider.generateDecision(req2);
  assert.equal(dec2.action, "ESCALATE_HUMAN");
  assert.equal(dec2.suggestedStateTransition, "ESCALATED");

  // Test custom override
  provider.setDecisionOverride({
    action: "NO_ACTION",
    proposedReply: null,
    confidence: 1.0,
    suggestedStateTransition: null,
    extractedMemory: {},
    reasoning: "Custom override for unit test",
  });
  const decOverride = await provider.generateDecision(req1);
  assert.equal(decOverride.action, "NO_ACTION");
});

await test("6. Shadow Mode Engine: when disabled, returns null without executing", async () => {
  const engine = new AiShadowEngine({ enabled: false });
  assert.equal(engine.isEnabled(), false);

  const result = await engine.evaluateShadow({
    conversationId: "c_disabled",
    messageText: "hello",
  });
  assert.equal(result, null);
});

await test("7. Shadow Mode Engine: when enabled, evaluates shadow decision, updates memory, logs entry", async () => {
  const provider = new MockAiProvider();
  const repo = new InMemoryAiShadowRepository();
  const engine = new AiShadowEngine({
    enabled: true,
    provider,
    shadowRepo: repo,
  });

  assert.equal(engine.isEnabled(), true);

  const result = await engine.evaluateShadow({
    conversationId: "c_shadow_1",
    currentState: "GREETING",
    contactName: "Usman",
    recentMessages: [
      { id: "m1", direction: "inbound", messageType: "text", textBody: "I need 10kW solar for my house", occurredAt: "2026-07-23T03:00:00Z" },
    ],
  });

  assert.ok(result !== null);
  assert.equal(result.stateBefore, "GREETING");
  assert.equal(result.stateAfter, "QUALIFYING");
  assert.equal(result.decision.action, "REPLY");
  assert.equal(result.decision.extractedMemory.systemSizeInterest, "10kW");

  // Memory verification
  const memory = engine.getMemoryStore().getMemory("c_shadow_1");
  assert.equal(memory.slots.systemSizeInterest, "10kW");

  // Repository logging verification
  const logs = await repo.getShadowLogs("c_shadow_1");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].conversationId, "c_shadow_1");
  assert.equal(logs[0].stateBefore, "GREETING");
  assert.equal(logs[0].stateAfter, "QUALIFYING");
  assert.ok(logs[0].executionTimeMs >= 0);
});

// ---------------------------------------------------------------------------
// Sprint 2: Lead Qualification Engine Unit Tests
// ---------------------------------------------------------------------------

await test("8. Intent Classifier: classifies Residential, Commercial, Industrial, Support, Complaint, Existing Customer, and Unknown", () => {
  const classifier = new AiIntentClassifier();

  assert.equal(classifier.classify("I want a 10kW residential solar system for my house").intent, "ResidentialSolar");
  assert.equal(classifier.classify("We need 100kW commercial solar for our plaza office").intent, "CommercialSolar");
  assert.equal(classifier.classify("Factory requires 1MW industrial solar plant").intent, "IndustrialSolar");
  assert.equal(classifier.classify("Need maintenance service and panel cleaning support").intent, "Support");
  assert.equal(classifier.classify("Inverter is not working, kharab hai, filing a complaint").intent, "Complaint");
  assert.equal(classifier.classify("Warranty claim for my existing inverter").intent, "Warranty");
  assert.equal(classifier.classify("Hello, checking on my invoice and installation", true).intent, "ExistingCustomer");
  assert.equal(classifier.classify("xyz abc 123").intent, "Unknown");
});

await test("9. Language Detector: identifies English, Roman Urdu, Mixed, and Unknown languages", () => {
  const detector = new AiLanguageDetector();

  assert.equal(detector.detect("Need 10kW solar system quotation for residential roof"), "English");
  assert.equal(detector.detect("Mera monthly bijli bill kitna hoga agar 5kw lagwana hai ghar mai"), "Roman Urdu");
  assert.equal(detector.detect("Solar system lagwana hai for my home roof in Lahore"), "Mixed");
  assert.equal(detector.detect("12345 !!!"), "Unknown");
});

await test("10. Qualification Scorer & Missing Fields: computes deterministic score and missing fields list", () => {
  const engine = new AiQualificationEngine();
  const scorer = new AiQualificationScorer();
  const missingEngine = new AiMissingFieldEngine();

  const qual = createInitialLeadQualification("c_qual_1", "+923001234567", "Hassan");
  assert.equal(scorer.calculateScore(qual), 0);
  assert.ok(missingEngine.getMissingFields(qual).includes("Monthly Bill"));
  assert.ok(missingEngine.getMissingFields(qual).includes("City"));

  // Update partial fields
  qual.monthlyBillPkr = { value: 75000, confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };
  qual.city = { value: "Lahore", confidence: 0.9, source: "AI", lastUpdated: new Date().toISOString() };
  qual.customerIntent = { value: "ResidentialSolar", confidence: 0.9, source: "AI", lastUpdated: new Date().toISOString() };
  qual.preferredLanguage = { value: "English", confidence: 0.9, source: "AI", lastUpdated: new Date().toISOString() };

  const partialScore = scorer.calculateScore(qual);
  assert.equal(partialScore, 50); // 20 (bill) + 10 (city) + 10 (intent) + 10 (lang) = 50

  // Complete remaining fields
  qual.propertyType = { value: "House", confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };
  qual.electricPhase = { value: "3-Phase", confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };
  qual.roofType = { value: "Concrete Slab", confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };
  qual.backupRequired = { value: true, confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };
  qual.installationTimeline = { value: "Immediate", confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };
  qual.budgetPkr = { value: 2000000, confidence: 1.0, source: "HUMAN", lastUpdated: new Date().toISOString() };

  assert.equal(scorer.calculateScore(qual), 100);
  assert.equal(missingEngine.getMissingFields(qual).length, 0);
});

await test("11. Next Question Engine: recommends question based on missing fields without sending", () => {
  const nextQ = new AiNextQuestionEngine();
  assert.equal(nextQ.recommendNextQuestion(["Monthly Bill", "City"]), "Ask monthly electricity bill in PKR");
  assert.equal(nextQ.recommendNextQuestion(["City"]), "Ask city or location in Pakistan");
  assert.equal(nextQ.recommendNextQuestion([]), null);
});

await test("12. Human Override Protection: AI can NEVER overwrite HUMAN or non-null SYSTEM fields", () => {
  const engine = new AiQualificationEngine();

  const humanField = { value: "Karachi", confidence: 1.0, source: "HUMAN" as const, lastUpdated: "2026-07-23T00:00:00Z" };
  const aiAttempt = { value: "Lahore", confidence: 0.9, source: "AI" as const };

  const resultHuman = engine.mergeField(humanField, aiAttempt);
  assert.equal(resultHuman.value, "Karachi");
  assert.equal(resultHuman.source, "HUMAN");

  const systemField = { value: "+923009998877", confidence: 1.0, source: "SYSTEM" as const, lastUpdated: "2026-07-23T00:00:00Z" };
  const resultSystem = engine.mergeField(systemField, aiAttempt);
  assert.equal(resultSystem.value, "+923009998877");
  assert.equal(resultSystem.source, "SYSTEM");

  // AI can update an empty/null SYSTEM field or an AI-owned field
  const emptySystemField = { value: null, confidence: 0.0, source: "SYSTEM" as const, lastUpdated: "2026-07-23T00:00:00Z" };
  const resultAllowed = engine.mergeField(emptySystemField, aiAttempt);
  assert.equal(resultAllowed.value, "Lahore");
  assert.equal(resultAllowed.source, "AI");
});

await test("13. Shadow Qualification Report: generates comprehensive report and flags human review when needed", () => {
  const engine = new AiQualificationEngine();
  const qual = createInitialLeadQualification("c_rep_1", "+923214445566", "Zubair");

  // Normal residential inquiry report
  const reportRes = engine.generateReport(qual, "Hi, I need 10kW residential solar system in Lahore");
  assert.equal(reportRes.intent, "ResidentialSolar");
  assert.equal(reportRes.language, "English");
  assert.ok(reportRes.missingFields.length > 0);
  assert.ok(reportRes.recommendedNextQuestion !== null);
  assert.equal(reportRes.humanReviewRequired, false);

  // Complaint message triggers human review
  const reportComplaint = engine.generateReport(qual, "Inverter kharab hai, filing a complaint immediately!");
  assert.equal(reportComplaint.intent, "Complaint");
  assert.equal(reportComplaint.humanReviewRequired, true);

  // Low confidence / unknown message triggers human review
  const reportUnknown = engine.generateReport(qual, "xyz 9999");
  assert.equal(reportUnknown.intent, "Unknown");
  assert.equal(reportUnknown.humanReviewRequired, true);
});
