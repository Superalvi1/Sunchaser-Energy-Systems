import assert from "node:assert/strict";
import {
  createAutomationHistory,
  createAutomationRunRecord,
  deriveRunStatus,
  isAutomationRunStatus,
} from "./AutomationHistory.ts";

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

check("derive executed", deriveRunStatus([{ actionId: "a", type: "assign_user", status: "completed", message: "", output: {} }]) === "executed");
check("derive queued ok", deriveRunStatus([{ actionId: "a", type: "queue_email", status: "queued", message: "", output: {} }]) === "executed");
check("derive failed", deriveRunStatus([{ actionId: "a", type: "assign_user", status: "failed", message: "", output: {} }]) === "failed");
check("derive partial", deriveRunStatus([
  { actionId: "a", type: "assign_user", status: "completed", message: "", output: {} },
  { actionId: "b", type: "assign_user", status: "failed", message: "", output: {} },
]) === "partial");
check("derive skipped", deriveRunStatus([]) === "skipped");

const record = createAutomationRunRecord({
  id: "run-1", companyId: "c1", ruleId: "r1", ruleName: "Test", triggerEventId: "te-1",
  trigger: "lead_created", status: "executed", conditionResults: [], actionResults: [], actorId: "a1",
});
check("record created", record.id === "run-1");
check("default timestamps", record.startedAt === "1970-01-01T00:00:00.000Z");

const history = createAutomationHistory();
history.append(record);
check("history length", history.length === 1);
check("list by rule", history.listByRule("r1").length === 1);
check("list by event", history.listByTriggerEvent("te-1").length === 1);

history.freeze();
let frozen = false;
try { history.append(record); } catch { frozen = true; }
check("history frozen", frozen && history.isFrozen());

for (const status of ["matched", "skipped", "executed", "partial", "failed"]) {
  check(`status ${status}`, isAutomationRunStatus(status));
}

const richRecord = createAutomationRunRecord({
  id: "run-rich",
  companyId: "c1",
  ruleId: "r-rich",
  ruleName: "Rich",
  triggerEventId: "te-rich",
  trigger: "lead_created",
  status: "executed",
  actorId: "a1",
  conditionResults: [
    {
      expression: { op: "eq", field: "stage", value: "qualified" },
      passed: true,
    },
  ],
  actionResults: [
    {
      actionId: "act-1",
      type: "assign_user",
      status: "completed",
      message: "ok",
      output: { userId: "u1", score: 1 },
    },
  ],
});

const immutHistory = createAutomationHistory();
immutHistory.append(richRecord);
const listed = immutHistory.list();
const fromList = listed[0]!;

listed.push(fromList);
check("list array mutation does not affect stored history length", immutHistory.length === 1);

let conditionArrayMutated = false;
try {
  fromList.conditionResults.push({
    expression: { op: "eq", field: "hacked", value: true },
    passed: false,
  });
} catch {
  conditionArrayMutated = true;
}
check(
  "conditionResults array mutation does not affect stored history",
  conditionArrayMutated && immutHistory.get("run-rich")!.conditionResults.length === 1
);

let actionArrayMutated = false;
try {
  fromList.actionResults.push({
    actionId: "hacked",
    type: "assign_user",
    status: "failed",
    message: "",
    output: {},
  });
} catch {
  actionArrayMutated = true;
}
check(
  "actionResults array mutation does not affect stored history",
  actionArrayMutated && immutHistory.get("run-rich")!.actionResults.length === 1
);

let nestedCondMutated = false;
try {
  (fromList.conditionResults[0]!.expression as { value: string }).value = "lost";
} catch {
  nestedCondMutated = true;
}
check("nested condition expression is immutable", nestedCondMutated);

let nestedActionMutated = false;
try {
  (fromList.actionResults[0]!.output as { userId: string }).userId = "hacked";
} catch {
  nestedActionMutated = true;
}
check("nested action output fields are immutable", nestedActionMutated);

const beforeAppendOnlyLen = immutHistory.length;
immutHistory.append(createAutomationRunRecord({
  id: "run-append-2",
  companyId: "c1",
  ruleId: "r-rich",
  ruleName: "Rich 2",
  triggerEventId: "te-rich-2",
  trigger: "lead_created",
  status: "skipped",
  conditionResults: [],
  actionResults: [],
  actorId: "a1",
}));
check("history remains append-only", immutHistory.length === beforeAppendOnlyLen + 1);
check("get returns defensive copy", immutHistory.get("run-rich") !== immutHistory.get("run-rich"));

console.log(`\nautomationHistory.test.ts: ${pass} passed`);
