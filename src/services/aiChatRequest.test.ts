/**
 * AI chat request payload tests — run: npm run test:phase-1b1
 */
import assert from "node:assert/strict";
import { buildAiChatRequestPayload } from "./aiChatRequest.ts";

let passCount = 0;

function pass(name: string): void {
  passCount += 1;
  console.log(`PASS: ${name}`);
}

function runTests(): void {
  const off = buildAiChatRequestPayload({ message: "Hello" });
  assert.equal(off.message, "Hello");
  assert.equal("includeBusinessContext" in off, false);
  pass("default payload omits includeBusinessContext");

  const offExplicit = buildAiChatRequestPayload({
    message: "Hi",
    includeBusinessContext: false,
  });
  assert.equal("includeBusinessContext" in offExplicit, false);
  pass("includeBusinessContext false is omitted");

  const on = buildAiChatRequestPayload({
    message: "Status?",
    conversationId: "conv-1",
    agent: "sales",
    includeBusinessContext: true,
  });
  assert.equal(on.includeBusinessContext, true);
  assert.equal(on.conversationId, "conv-1");
  assert.equal(on.agent, "sales");
  const json = JSON.stringify(on);
  assert.doesNotMatch(json, /appState/);
  assert.doesNotMatch(json, /customers/);
  assert.doesNotMatch(json, /leads/);
  assert.doesNotMatch(json, /invoices/);
  pass("includeBusinessContext true when enabled; no CRM bulk fields");

  console.log(`aiChatRequest.test.ts: ${passCount} checks passed`);
}

runTests();
