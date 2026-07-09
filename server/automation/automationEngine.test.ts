import assert from "node:assert/strict";
import type { RequestActor } from "../middleware/actor.ts";
import { AUTOMATION_TRIGGER_TYPES } from "./AutomationTrigger.ts";
import { createAutomationEngine } from "./AutomationEngine.ts";
import { AutomationPermissionError } from "./AutomationPermissions.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const admin: RequestActor = {
  id: "admin", username: "admin", name: "Admin", email: "a@test.com", role: "Sales Manager",
  accountStatus: "Active", emailVerified: true, onboardingCompleted: true, authMethod: "jwt",
};

const sales: RequestActor = { ...admin, id: "sales", role: "Sales Executive" };
const companyId = "co-1";

function setupEngine() {
  const engine = createAutomationEngine({ eventIdPrefix: "test" });
  engine.registerRule({
    id: "rule-lead", companyId, name: "Assign new leads", description: "",
    trigger: "lead_created", conditions: [{ op: "eq", field: "stage", value: "new" }],
    actions: [{ id: "act-assign", type: "assign_user", params: { userId: "sales-rep-1" } }],
    active: true, priority: 10, maxRetries: 3, createdBy: admin.id,
  }, admin);

  engine.registerRule({
    id: "rule-quote", companyId, name: "Quote accepted notify", description: "",
    trigger: "quote_accepted", conditions: [],
    actions: [
      { id: "act-email", type: "queue_email", params: { template: "quote_won" } },
      { id: "act-task", type: "create_task", params: { title: "Prepare contract", assigneeId: "ops-1" } },
    ],
    active: true, priority: 5, maxRetries: 2, createdBy: admin.id,
  }, admin);

  engine.registerRule({
    id: "rule-skip", companyId, name: "Skip rule", description: "",
    trigger: "lead_created", conditions: [{ op: "eq", field: "stage", value: "won" }],
    actions: [{ id: "act-x", type: "assign_user", params: { userId: "x" } }],
    active: true, priority: 1, maxRetries: 3, createdBy: admin.id,
  }, admin);

  engine.registerRule({
    id: "rule-inactive", companyId, name: "Inactive", description: "",
    trigger: "lead_created", conditions: [],
    actions: [{ id: "act-y", type: "assign_user", params: { userId: "y" } }],
    active: false, priority: 100, maxRetries: 3, createdBy: admin.id,
  }, admin);

  return engine;
}

const engine = setupEngine();
check("rules registered", engine.repository.listRules(companyId, admin).length === 4);

let salesDenied = false;
try {
  engine.processTrigger({
    id: "te-denied", trigger: "lead_created", companyId, entityType: "lead", entityId: "l0", actorId: sales.id, payload: {},
  }, sales);
} catch (e) {
  salesDenied = e instanceof AutomationPermissionError;
}
check("sales cannot execute", salesDenied);

const leadResult = engine.processTrigger({
  id: "te-lead-1", trigger: "lead_created", companyId, entityType: "lead", entityId: "lead-1", actorId: admin.id,
  payload: { stage: "new" },
}, admin);

check("lead processed", leadResult.runs.length >= 1);
check("lead matched run", leadResult.runs.some((r) => r.ruleId === "rule-lead" && r.status === "executed"));
check("lead skipped run", leadResult.runs.some((r) => r.ruleId === "rule-skip" && r.status === "skipped"));
check("inactive rule not run", !leadResult.runs.some((r) => r.ruleId === "rule-inactive"));

const quoteResult = engine.processTrigger({
  id: "te-quote-1", trigger: "quote_accepted", companyId, entityType: "quote", entityId: "quote-1", actorId: admin.id,
  payload: { amount: 50000 },
}, admin);

check("quote processed", quoteResult.runs.length === 1);
check("quote executed", quoteResult.runs[0].status === "executed");
check("quote queued email", quoteResult.queuedJobs.length === 1);
check("quote task created", quoteResult.runs[0].actionResults.some((a) => a.type === "create_task"));

const queueResult = engine.processQueue();
check("queue processed", queueResult.processed === 1);
check("queue completed", queueResult.completed === 1);

check("history records", engine.repository.getHistory().length >= 3);
check("events emitted", engine.repository.listEvents().length >= 5);
check("trigger event stored", engine.repository.getTriggerEvent("te-lead-1") !== null);

const deactivated = engine.deactivateRule("rule-lead", admin);
check("rule deactivated", deactivated?.active === false);

const triggerCompany = "co-triggers";
for (const trigger of AUTOMATION_TRIGGER_TYPES) {
  const entityType = trigger.includes("lead") ? "lead"
    : trigger.includes("quote") ? "quote"
    : trigger.includes("invoice") ? "invoice"
    : trigger.includes("project") ? "project"
    : trigger.includes("ticket") ? "ticket"
    : "delivery";
  engine.registerRule({
    id: `rule-${trigger}`, companyId: triggerCompany, name: `Rule ${trigger}`, description: "",
    trigger, conditions: [], actions: [{ id: `act-${trigger}`, type: "change_stage", params: { stage: "auto" } }],
    active: true, priority: 0, maxRetries: 1, createdBy: admin.id,
  }, admin);
  const result = engine.processTrigger({
    id: `te-${trigger}`, trigger, companyId: triggerCompany, entityType, entityId: `ent-${trigger}`, actorId: admin.id, payload: {},
  }, admin);
  check(`trigger ${trigger} runs`, result.runs.length === 1);
}

const failedAction = engine.processTrigger({
  id: "te-fail", trigger: "ticket_opened", companyId: triggerCompany, entityType: "ticket", entityId: "t1", actorId: admin.id, payload: {},
}, admin);
check("ticket opened processed", failedAction.runs.length >= 1);

engine.setNowMs(10_000);
engine.registerRule({
  id: "rule-webhook", companyId, name: "Webhook", description: "",
  trigger: "delivery_completed", conditions: [],
  actions: [{ id: "wh", type: "queue_webhook", params: { template: "delivery_done" } }],
  active: true, priority: 1, maxRetries: 3, createdBy: admin.id,
}, admin);

const delivery = engine.processTrigger({
  id: "te-delivery", trigger: "delivery_completed", companyId, entityType: "delivery", entityId: "d1", actorId: admin.id, payload: {},
}, admin);
check("delivery queued", delivery.queuedJobs.length === 1);
engine.processQueue();
check("webhook job completed", engine.repository.getQueue().get(delivery.queuedJobs[0].id)?.status === "completed");

for (let i = 0; i < 20; i += 1) {
  const r = engine.processTrigger({
    id: `te-loop-${i}`, trigger: "lead_updated", companyId, entityType: "lead", entityId: `lead-${i}`, actorId: admin.id,
    payload: { iteration: i },
  }, admin);
  check(`lead_updated loop ${i}`, r.event.id === `te-loop-${i}`);
}

console.log(`\nautomationEngine.test.ts: ${pass} passed`);
