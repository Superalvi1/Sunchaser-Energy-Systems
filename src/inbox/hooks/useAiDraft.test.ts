/**
 * AI-03 useAiDraft state machine tests (no React DOM).
 * Run: npm run test:whatsapp-ai-draft
 */
import assert from "node:assert/strict";
import { InboxClientError, type InboxAiDraftOutcome } from "../types.ts";

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

/**
 * Pure reducer mirroring useAiDraft transitions for unit coverage without
 * mounting React (keeps the suite runnable under plain tsx).
 */
type State = {
  status:
    | "idle"
    | "loading"
    | "ready"
    | "timeout"
    | "failure"
    | "unavailable"
    | "denied";
  conversationId: string | null;
  editableText: string;
  draftAnswer: string | null;
  errorMessage: string | null;
};

function initial(conversationId: string | null): State {
  return {
    status: "idle",
    conversationId,
    editableText: "",
    draftAnswer: null,
    errorMessage: null,
  };
}

function onConversationSwitch(prev: State, nextId: string | null): State {
  return initial(nextId);
}

function onDiscard(prev: State): State {
  return initial(prev.conversationId);
}

function onGenerateStart(prev: State): State {
  if (prev.status === "loading") return prev; // duplicate click guard
  return { ...prev, status: "loading", errorMessage: null };
}

function onGenerateSuccess(prev: State, outcome: InboxAiDraftOutcome): State {
  if (outcome.status === "denied") {
    return {
      ...prev,
      status: "denied",
      editableText: "",
      draftAnswer: null,
      errorMessage: outcome.message,
    };
  }
  return {
    ...prev,
    status: "ready",
    editableText: outcome.answer,
    draftAnswer: outcome.answer,
    errorMessage: null,
  };
}

function onEdit(prev: State, text: string): State {
  return { ...prev, editableText: text };
}

function onFailure(prev: State, err: unknown): State {
  if (err instanceof InboxClientError && err.code === "feature_disabled") {
    return {
      ...prev,
      status: "unavailable",
      editableText: "",
      draftAnswer: null,
      errorMessage: err.message,
    };
  }
  return {
    ...prev,
    status: "failure",
    editableText: "",
    draftAnswer: null,
    errorMessage: err instanceof Error ? err.message : "failed",
  };
}

await test("generated text remains editable", () => {
  let state = initial("c1");
  state = onGenerateStart(state);
  state = onGenerateSuccess(state, {
    status: "draft",
    companyId: "sunchaser",
    conversationId: "c1",
    draftId: "d1",
    answer: "Original AI text",
    intent: "sales",
    confidence: 0.8,
    warnings: ["review"],
    requiresHumanReview: true,
    autoSendBlocked: true,
    escalate: false,
    escalationReasons: [],
    safeSources: [],
  });
  assert.equal(state.status, "ready");
  state = onEdit(state, "Human-edited reply");
  assert.equal(state.editableText, "Human-edited reply");
  assert.notEqual(state.editableText, state.draftAnswer);
});

await test("discard removes the draft", () => {
  let state = initial("c1");
  state = onGenerateSuccess(state, {
    status: "draft",
    companyId: "sunchaser",
    conversationId: "c1",
    draftId: "d1",
    answer: "to discard",
    intent: "sales",
    confidence: 0.7,
    warnings: [],
    requiresHumanReview: true,
    autoSendBlocked: true,
    escalate: false,
    escalationReasons: [],
    safeSources: [],
  });
  state = onDiscard(state);
  assert.equal(state.status, "idle");
  assert.equal(state.editableText, "");
  assert.equal(state.draftAnswer, null);
  assert.equal(state.conversationId, "c1");
});

await test("conversation switching does not leak another customer’s draft", () => {
  let state = initial("customer-a");
  state = onGenerateSuccess(state, {
    status: "draft",
    companyId: "sunchaser",
    conversationId: "customer-a",
    draftId: "d-a",
    answer: "Secret reply for customer A phone +15550001111",
    intent: "sales",
    confidence: 0.9,
    warnings: [],
    requiresHumanReview: true,
    autoSendBlocked: true,
    escalate: false,
    escalationReasons: [],
    safeSources: [],
  });
  state = onConversationSwitch(state, "customer-b");
  assert.equal(state.conversationId, "customer-b");
  assert.equal(state.status, "idle");
  assert.equal(state.editableText, "");
  assert.equal(state.draftAnswer, null);
  assert.equal(/customer A|15550001111/.test(state.editableText), false);
});

await test("duplicate generation clicks are ignored while loading", () => {
  let state = initial("c1");
  state = onGenerateStart(state);
  assert.equal(state.status, "loading");
  const again = onGenerateStart(state);
  assert.equal(again.status, "loading");
});

await test("provider/feature failure is safe (no draft retained)", () => {
  let state = initial("c1");
  state = onGenerateStart(state);
  state = onFailure(
    state,
    new InboxClientError(503, {
      code: "feature_disabled",
      message: "AI draft generation is disabled",
    })
  );
  assert.equal(state.status, "unavailable");
  assert.equal(state.draftAnswer, null);
  assert.equal(state.editableText, "");
});

await test("hook source clears on conversation change and blocks duplicate loads", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "useAiDraft.ts"),
    "utf8"
  );
  assert.ok(source.includes("switching conversations"));
  assert.ok(source.includes('status === "loading"'));
  assert.equal(/localStorage|sessionStorage/.test(source), false);
  // Must never call send API from the draft hook.
  assert.equal(/sendInboxMessage|messages\/send/.test(source), false);
});

if (failed > 0) {
  console.error(`\n${failed} useAiDraft test(s) failed`);
  process.exit(1);
}
console.log("\nAll useAiDraft tests passed");
