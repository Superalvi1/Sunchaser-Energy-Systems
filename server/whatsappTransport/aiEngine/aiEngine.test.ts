/**
 * Unit Tests for Sunchaser Connect Phase 1B: AI Conversation Engine Infrastructure.
 * Verifies state machine, context builder, memory model, prompt builder, provider abstraction,
 * decision schema, and shadow mode engine.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AiContextBuilder,
  AiMemoryStore,
  AiPromptBuilder,
  AiShadowEngine,
  AiStateMachine,
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
