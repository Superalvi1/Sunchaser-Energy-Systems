/**
 * Business insight prompt tests — run: npm run test:phase-1b1
 */
import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { ChatBusinessContextProvider } from "./ChatBusinessContextProvider.ts";
import {
  BUSINESS_INSIGHT_PROMPT_MARKERS,
  assertPromptUsesOnlySafeBucketLabels,
  buildBusinessInsightPrompt,
  buildFinanceAvailabilityNote,
} from "./BusinessInsightPromptBuilder.ts";
import type { SafeBusinessSummary } from "./SafeBusinessContext.ts";
import { SAFE_BUCKET_LABELS, containsSensitiveBusinessFields } from "./SafeBusinessContext.ts";
import { isChatV1ToolsDisabled, createChatV1Engine } from "../chatV1.ts";

let passCount = 0;

function pass(name: string): void {
  passCount += 1;
  console.log(`PASS: ${name}`);
}

const salesSummary: SafeBusinessSummary = {
  scope: "sales",
  generatedAt: new Date().toISOString(),
  leads: { total: 3, byStatus: { new: 2, quoted: 1 } },
  quotations: { total: 4 },
  projects: { total: 1, byStage: { installation: 1 } },
  tickets: { total: 2, open: 1 },
};

const technicianSummary: SafeBusinessSummary = {
  scope: "technician",
  generatedAt: new Date().toISOString(),
  assignedJobs: { serviceRequests: 2, supportTickets: 1, deliveries: 1 },
  serviceRequests: { total: 2, open: 1 },
  tickets: { total: 1, open: 1 },
  deliveries: { total: 1, pending: 1 },
};

const ceoSummary: SafeBusinessSummary = {
  scope: "admin",
  generatedAt: new Date().toISOString(),
  leads: { total: 12, byStatus: { new: 4, contracted: 3, other: 5 } },
  projects: { total: 8, byStage: { installation: 2, completed: 3, other: 3 } },
  quotations: { total: 10 },
  invoices: { totalCount: 6, totalAmount: 45000, overdueCount: 2 },
  tickets: { total: 5, open: 2 },
  serviceRequests: { total: 3, open: 1 },
  deliveries: { total: 4, pending: 1 },
  inventory: { lowStockCount: 2 },
  tasks: { today: 3, tomorrow: 2 },
};

const MALICIOUS_NEEDLES = [
  "0300-1111111",
  "Secret Address",
  "12345-1234567-1",
  "PK36SCBL0000001123456702",
  "private note",
];

function assertPromptExcludesNeedles(prompt: string): void {
  for (const needle of MALICIOUS_NEEDLES) {
    assert.equal(prompt.includes(needle), false, `prompt must not contain: ${needle}`);
  }
}

async function runTests(): Promise<void> {
  const salesPrompt = buildBusinessInsightPrompt({
    actorRole: "Sales Executive",
    agentId: "sales",
    summary: salesSummary,
  });

  assert.match(salesPrompt, /Leads total: 3/);
  assert.match(salesPrompt, /Quotations total: 4/);
  assert.match(salesPrompt, /new=2/);
  assert.doesNotMatch(salesPrompt, /Leads total: 12/);
  assert.match(salesPrompt, /Sales focus:/);
  pass("sales prompt includes owned lead/project/quote counts only");

  const financeBlocked = buildBusinessInsightPrompt({
    actorRole: "Technician",
    agentId: "finance",
    summary: technicianSummary,
  });
  assert.ok(buildFinanceAvailabilityNote("finance", technicianSummary));
  assert.match(financeBlocked, /finance data is not available for your role/i);
  assert.match(financeBlocked, /Invoices: not included/);
  pass("finance prompt says unavailable when no finance summary exists");

  const ceoPrompt = buildBusinessInsightPrompt({
    actorRole: "Director",
    agentId: "ceo",
    summary: ceoSummary,
  });
  assert.match(ceoPrompt, /Leads total: 12/);
  assert.match(ceoPrompt, /overdueCount=2/);
  assert.match(ceoPrompt, /Executive focus:/);
  assert.match(ceoPrompt, /Inventory low-stock count: 2/);
  pass("CEO prompt can summarize allowed business health");

  assert.match(salesPrompt, new RegExp(BUSINESS_INSIGHT_PROMPT_MARKERS.useOnlySummary, "i"));
  assert.match(salesPrompt, new RegExp(BUSINESS_INSIGHT_PROMPT_MARKERS.noMutations, "i"));
  assert.match(salesPrompt, new RegExp(BUSINESS_INSIGHT_PROMPT_MARKERS.recommendationsOnly, "i"));
  assert.match(salesPrompt, new RegExp(BUSINESS_INSIGHT_PROMPT_MARKERS.insufficientData, "i"));
  assert.match(salesPrompt, new RegExp(BUSINESS_INSIGHT_PROMPT_MARKERS.dailyBriefing, "i"));
  pass("prompt includes summary-only, no-mutation, and briefing rules");

  assertPromptUsesOnlySafeBucketLabels(salesPrompt);
  assertPromptUsesOnlySafeBucketLabels(ceoPrompt);
  for (const label of SAFE_BUCKET_LABELS) {
    assert.ok(typeof label === "string");
  }
  pass("unknown raw bucket labels cannot appear in prompt");

  assert.equal(containsSensitiveBusinessFields(salesPrompt), false);
  assertPromptExcludesNeedles(salesPrompt);
  assertPromptExcludesNeedles(ceoPrompt);
  pass("prompt never contains sensitive strings");

  const providerOff = new ChatBusinessContextProvider({
    requestActor: {
      id: "u-1",
      username: "u",
      name: "U",
      email: "u@test.com",
      role: "Sales Executive",
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    } as RequestActor,
    db: { leads: [], projects: [] } as never,
    includeBusinessContext: false,
  });
  const ctxOff = await providerOff.load({
    actor: { userId: "u-1", role: "Sales Executive", permissions: [] },
    agentId: "sales",
    conversationId: "conv-1",
  });
  assert.equal(ctxOff.blocks.length, 1);
  assert.equal(ctxOff.blocks.some((b) => b.key === "business-insights"), false);
  pass("context disabled has no business summary block");

  process.env.GEMINI_API_KEY = "gemini-test";
  assert.ok(isChatV1ToolsDisabled(createChatV1Engine()));
  delete process.env.GEMINI_API_KEY;
  pass("tools remain disabled");

  console.log(`businessInsightPrompt.test.ts: ${passCount} checks passed`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
