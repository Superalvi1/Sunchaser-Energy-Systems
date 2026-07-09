import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildEnterpriseDashboardModel,
  sanitizeEnterpriseActivityLog,
  safeStats,
} from "./enterpriseDashboard.ts";
import { buildExecutiveBiViewModel } from "./executiveBiAdapter.ts";
import {
  anonymizeSalespersonLabel,
  buildAnonymizedRevenueChart,
  buildSafePipelineChart,
  safeLeadStatusLabel,
  safeProjectStageLabel,
  safeTaskLabel,
} from "./dashboardLabelSanitizers.ts";
import { assertInsightDisplaySafe } from "./insightLabels.ts";
import type { ActivityLog } from "../types";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0;
function check(name: string, condition: boolean) {
  assert.ok(condition, `FAILED: ${name}`);
  pass += 1;
  console.log(`PASS: ${name}`);
}

const SENSITIVE_LOG: ActivityLog = {
  id: "log-secret-99",
  timestamp: "2026-06-01T10:00:00.000Z",
  userId: "user-abc-123",
  userName: "Ali Khan",
  role: "Admin",
  action: "db.update leads",
  details: "IP 192.168.1.50 modified lead lead-4422 for customer Fatima Shah CNIC 35202-1234567-1",
};

check(
  "sanitizeEnterpriseActivityLog never exposes details, userName, userId, or raw action text",
  (() => {
    const sanitized = sanitizeEnterpriseActivityLog(SENSITIVE_LOG, 0);
    const blob = JSON.stringify(sanitized);
    return (
      sanitized !== null &&
      !blob.includes("192.168") &&
      !blob.includes("Ali Khan") &&
      !blob.includes("Fatima") &&
      !blob.includes("lead-4422") &&
      !blob.includes("user-abc") &&
      !blob.includes("CNIC") &&
      !blob.includes("db.update") &&
      sanitized.label === "Lead activity" &&
      typeof sanitized.eventType === "string" &&
      sanitized.eventType.length > 0
    );
  })()
);

check(
  "buildEnterpriseDashboardModel recentActivity excludes sensitive activity log fields",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: { totalRevenue: 0, pendingRevenue: 0, totalLeads: 0, installedCount: 0, contractedCount: 0, pipelineCount: 0, leadsByStatus: {} },
      leads: [],
      tickets: [],
      inventory: [],
      activityLogs: [SENSITIVE_LOG],
    });
    const blob = JSON.stringify(model.recentActivity);
    return (
      model.recentActivity.length > 0 &&
      !blob.includes("192.168") &&
      !blob.includes("Ali Khan") &&
      !blob.includes("Fatima") &&
      !blob.includes("lead-4422") &&
      !blob.includes("CNIC") &&
      model.recentActivity.every((item) => item.title === "Lead activity" || item.title === "Ticket activity" || item.title === "System activity" || item.title === "Finance activity" || item.title === "Inventory activity")
    );
  })()
);

check(
  "missing stats does not crash and yields zeroed safe defaults",
  (() => {
    const model = buildEnterpriseDashboardModel({
      leads: [],
      tickets: [],
      inventory: [],
    });
    return (
      model.healthScore >= 0 &&
      model.healthScore <= 100 &&
      model.kpis[0].value.includes("0") &&
      model.pipelineChart.length === 0
    );
  })()
);

check(
  "missing leadsByStatus does not crash",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: {
        totalRevenue: 100,
        pendingRevenue: 50,
        totalLeads: 5,
        installedCount: 1,
        contractedCount: 2,
        pipelineCount: 3,
        leadsByStatus: undefined as unknown as Record<string, number>,
      },
      leads: [],
      tickets: [],
      inventory: [],
    });
    return model.pipelineChart.length === 0 && model.healthScore >= 0;
  })()
);

check(
  "safeStats coerces missing leadsByStatus to empty object",
  Object.keys(safeStats({ totalRevenue: 1, pendingRevenue: 0, totalLeads: 0, installedCount: 0, contractedCount: 0, pipelineCount: 0, leadsByStatus: undefined as unknown as Record<string, number> }).leadsByStatus).length === 0
);

check(
  "invalid createdAt on leads does not crash",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: safeStats(null),
      leads: [
        {
          id: "lead-bad-date",
          name: "Secret Customer Name",
          email: "x@test.com",
          phone: "0300",
          address: "hidden",
          status: "New",
          monthlyBill: 0,
          roofSpace: 0,
          shading: "None",
          rating: 0,
          assignedSalesperson: "Rep",
          createdAt: "not-a-valid-date",
          notes: "",
          quotes: [],
        },
      ],
      tickets: [],
      inventory: [],
    });
    const blob = JSON.stringify(model.recentActivity);
    return (
      model.recentActivity.some((a) => a.title === "Lead activity") &&
      !blob.includes("Secret Customer Name") &&
      !blob.includes("lead-bad-date")
    );
  })()
);

check(
  "empty app state returns safe dashboard model without throwing",
  (() => {
    const model = buildEnterpriseDashboardModel({});
    return (
      Array.isArray(model.recentActivity) &&
      Array.isArray(model.alerts) &&
      Array.isArray(model.kpis) &&
      model.kpis.length === 4 &&
      model.revenueChart.length === 1 &&
      model.revenueChart[0].name === "No data"
    );
  })()
);

check(
  "null input arrays are treated as empty",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: null,
      leads: null,
      tickets: null,
      inventory: null,
      activityLogs: null,
    });
    return model.todayTasks.length === 0 && model.recentActivity.length === 0;
  })()
);

check(
  "ticket recent activity uses generic labels only",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: safeStats(null),
      leads: [],
      tickets: [
        {
          id: "ticket-99",
          customerName: "Private Name",
          email: "secret@test.com",
          subject: "Confidential inverter fault",
          description: "CNIC leak",
          status: "Open",
          priority: "High",
          createdAt: "2026-05-01T12:00:00.000Z",
          messages: [],
        },
      ],
      inventory: [],
    });
    const item = model.recentActivity.find((a) => a.kind === "ticket");
    const blob = JSON.stringify(item);
    return (
      item?.title === "Ticket activity" &&
      item?.subtitle === "Support update" &&
      !blob.includes("Private") &&
      !blob.includes("Confidential") &&
      !blob.includes("ticket-99")
    );
  })()
);

check(
  "empty app state includes deterministic BI view model without throwing",
  (() => {
    const model = buildEnterpriseDashboardModel({});
    return (
      model.bi.deterministic === true &&
      model.bi.healthScore >= 0 &&
      model.bi.healthScore <= 100 &&
      Array.isArray(model.bi.departments) &&
      model.bi.departments.length === 5
    );
  })()
);

check(
  "health score is bounded 0-100 for stressed CRM state",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: {
        totalRevenue: 1,
        pendingRevenue: 999999,
        totalLeads: 200,
        installedCount: 0,
        contractedCount: 1,
        pipelineCount: 199,
        leadsByStatus: { New: 180, Quoted: 20 },
      },
      leads: Array.from({ length: 50 }, (_, i) => ({
        id: `lead-${i}`,
        name: `Customer ${i}`,
        email: `c${i}@test.com`,
        phone: "03001234567",
        address: "Secret Address",
        status: "New",
        monthlyBill: 0,
        roofSpace: 0,
        shading: "None",
        rating: 0,
        assignedSalesperson: "Rep",
        createdAt: "2020-01-01T00:00:00.000Z",
        notes: "private notes",
        quotes: [{ id: `q-${i}`, date: "2020-01-01", amount: 100, status: "Draft" }],
      })),
      tickets: Array.from({ length: 30 }, (_, i) => ({
        id: `t-${i}`,
        customerName: "Hidden",
        email: "x@test.com",
        subject: "Fault",
        description: "CNIC 35202-1234567-1",
        status: "Open",
        priority: "High",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [],
      })),
      inventory: Array.from({ length: 10 }, (_, i) => ({
        id: `sku-${i}`,
        name: "Inverter",
        category: "Hardware",
        stock: 0,
        reorderLevel: 5,
        unitCost: 100,
        sellingPrice: 150,
      })),
    });
    return model.healthScore >= 0 && model.healthScore <= 100 && model.bi.healthScore === model.healthScore;
  })()
);

check(
  "BI warnings and opportunities render without PII from malicious CRM labels",
  (() => {
    const model = buildEnterpriseDashboardModel({
      stats: {
        totalRevenue: 50000,
        pendingRevenue: 80000,
        totalLeads: 10,
        installedCount: 1,
        contractedCount: 2,
        pipelineCount: 7,
        leadsByStatus: { "New customer email secret@test.com": 5 },
      },
      leads: [
        {
          id: "lead-evil",
          name: "Fatima Shah CNIC 35202-1234567-1",
          email: "fatima@bank.com",
          phone: "03001234567",
          address: "123 Private Street",
          status: "New customer email secret@test.com",
          monthlyBill: 0,
          roofSpace: 0,
          shading: "None",
          rating: 0,
          assignedSalesperson: "Ali Khan",
          createdAt: "2020-01-01T00:00:00.000Z",
          notes: "bank account 12345",
          quotes: [],
        },
      ],
      tickets: [],
      inventory: [],
    });
    const biBlob = JSON.stringify(model.bi);
    const forbidden = /fatima|35202|secret@test|private street|bank account|ali khan|cnic|0300/i;
    const allInsights = [
      ...model.bi.criticalWarnings,
      ...model.bi.opportunities,
      ...model.bi.todaysPriorities,
      ...model.bi.executiveSummary,
      ...model.bi.departments.flatMap((d) => d.insights),
    ];
    return (
      !forbidden.test(biBlob) &&
      assertInsightDisplaySafe(allInsights) &&
      model.bi.criticalWarnings.every((w) => typeof w.title === "string" && w.title.length > 0)
    );
  })()
);

check(
  "executive BI adapter is deterministic and makes no network/LLM calls",
  (() => {
    const adapterSource = readFileSync(join(__dirname, "executiveBiAdapter.ts"), "utf8");
    const forbidden = /\bfetch\s*\(|axios|openai|anthropic|gemini|generateText|chat\.completions/i;
    const bi = buildExecutiveBiViewModel({});
    return bi.deterministic === true && !forbidden.test(adapterSource);
  })()
);

check(
  "department sections cover sales finance operations support procurement",
  (() => {
    const model = buildEnterpriseDashboardModel({});
    const ids = model.bi.departments.map((d) => d.id).sort();
    return (
      ids.join(",") === "finance,operations,procurement,sales,support" &&
      model.bi.departments.every((d) => d.score >= 0 && d.score <= 100)
    );
  })()
);

const MALICIOUS_FIXTURE = {
  phone: "03001234567",
  cnic: "35202-1234567-1",
  address: "123 Private Street Gulberg Lahore",
  bank: "IBAN PK36SCBL0000001123456702",
  notes: "private notes wire to bank account 998877",
  email: "fatima.secret@evil-bank.com",
  customer: "Fatima Shah",
  rep: "Ali Khan 03001234567",
  statusKey: "New customer Fatima 35202-1234567-1",
  taskName: "Call Fatima at 123 Private Street IBAN PK36",
  leadId: "lead-evil-4422",
  taskId: "task-secret-99",
};

check(
  "label sanitizers whitelist known values and bucket unknowns",
  (() => {
    return (
      safeLeadStatusLabel("New") === "New" &&
      safeLeadStatusLabel("survey_scheduled") === "Survey Scheduled" &&
      safeLeadStatusLabel(MALICIOUS_FIXTURE.statusKey) === "Other" &&
      safeProjectStageLabel("In Progress") === "In Progress" &&
      safeProjectStageLabel("evil stage with address") === "Other" &&
      safeTaskLabel(0) === "Installation task" &&
      safeTaskLabel(1) === "Site task" &&
      safeTaskLabel(2) === "Follow-up task" &&
      anonymizeSalespersonLabel(1) === "Sales rep 1" &&
      anonymizeSalespersonLabel(0) === "Assigned sales"
    );
  })()
);

check(
  "pipeline chart uses safe labels only",
  (() => {
    const chart = buildSafePipelineChart({
      New: 3,
      Quoted: 2,
      [MALICIOUS_FIXTURE.statusKey]: 5,
    });
    const names = chart.map((p) => p.name);
    const blob = JSON.stringify(chart);
    return (
      names.includes("New") &&
      names.includes("Quoted") &&
      names.includes("Other") &&
      !blob.includes(MALICIOUS_FIXTURE.statusKey) &&
      !blob.includes("Fatima") &&
      chart.find((p) => p.name === "Other")?.value === 5
    );
  })()
);

check(
  "revenue chart anonymizes salesperson labels",
  (() => {
    const chart = buildAnonymizedRevenueChart([
      {
        id: "l1",
        name: MALICIOUS_FIXTURE.customer,
        email: MALICIOUS_FIXTURE.email,
        phone: MALICIOUS_FIXTURE.phone,
        address: MALICIOUS_FIXTURE.address,
        status: "Contracted",
        monthlyBill: 0,
        roofSpace: 0,
        shading: "None",
        rating: 0,
        assignedSalesperson: MALICIOUS_FIXTURE.rep,
        createdAt: "2026-01-01T00:00:00.000Z",
        notes: MALICIOUS_FIXTURE.notes,
        quotes: [{ id: "q1", date: "2026-01-01", amount: 100, totalCost: 50000, status: "Accepted" }],
      },
      {
        id: "l2",
        name: "Other Customer",
        email: "x@test.com",
        phone: "03009999999",
        address: "Elsewhere",
        status: "Installed",
        monthlyBill: 0,
        roofSpace: 0,
        shading: "None",
        rating: 0,
        assignedSalesperson: "Another Rep CNIC 35202-9999999-9",
        createdAt: "2026-01-02T00:00:00.000Z",
        notes: "",
        quotes: [{ id: "q2", date: "2026-01-02", amount: 100, totalCost: 30000, status: "Accepted" }],
      },
    ]);
    const blob = JSON.stringify(chart);
    return (
      chart.every((p) => /^Sales rep \d+$/.test(p.name)) &&
      !blob.includes(MALICIOUS_FIXTURE.rep) &&
      !blob.includes("Ali Khan") &&
      !blob.includes(MALICIOUS_FIXTURE.cnic) &&
      !blob.includes(MALICIOUS_FIXTURE.customer)
    );
  })()
);

check(
  "full dashboard model excludes malicious CRM strings from JSON output",
  (() => {
    const today = new Date().toISOString().slice(0, 10);
    const model = buildEnterpriseDashboardModel({
      stats: {
        totalRevenue: 50000,
        pendingRevenue: 80000,
        totalLeads: 4,
        installedCount: 1,
        contractedCount: 1,
        pipelineCount: 2,
        leadsByStatus: {
          New: 1,
          [MALICIOUS_FIXTURE.statusKey]: 2,
        },
      },
      leads: [
        {
          id: MALICIOUS_FIXTURE.leadId,
          name: MALICIOUS_FIXTURE.customer,
          email: MALICIOUS_FIXTURE.email,
          phone: MALICIOUS_FIXTURE.phone,
          address: MALICIOUS_FIXTURE.address,
          status: "Contracted",
          monthlyBill: 0,
          roofSpace: 0,
          shading: "None",
          rating: 0,
          assignedSalesperson: MALICIOUS_FIXTURE.rep,
          createdAt: "2026-01-01T00:00:00.000Z",
          notes: MALICIOUS_FIXTURE.notes,
          quotes: [{ id: "q-evil", date: "2026-01-01", amount: 100, totalCost: 50000, status: "Accepted" }],
          installation: {
            status: "Scheduled",
            scheduledDate: today,
            progress: 10,
            tasks: [
              { id: MALICIOUS_FIXTURE.taskId, name: MALICIOUS_FIXTURE.taskName, done: false },
              { id: "task-2", name: "Site visit at " + MALICIOUS_FIXTURE.address, done: false },
            ],
            completionPhotos: [],
            report: MALICIOUS_FIXTURE.bank,
          },
        },
      ],
      tickets: [
        {
          id: "ticket-evil",
          customerName: MALICIOUS_FIXTURE.customer,
          email: MALICIOUS_FIXTURE.email,
          subject: MALICIOUS_FIXTURE.taskName,
          description: MALICIOUS_FIXTURE.cnic + " " + MALICIOUS_FIXTURE.bank,
          status: "Open",
          priority: "High",
          createdAt: "2026-01-01T00:00:00.000Z",
          messages: [],
        },
      ],
      inventory: [],
      activityLogs: [SENSITIVE_LOG],
    });

    const blob = JSON.stringify(model);
    const forbidden = [
      MALICIOUS_FIXTURE.phone,
      MALICIOUS_FIXTURE.cnic,
      MALICIOUS_FIXTURE.address,
      MALICIOUS_FIXTURE.bank,
      MALICIOUS_FIXTURE.notes,
      MALICIOUS_FIXTURE.email,
      MALICIOUS_FIXTURE.customer,
      MALICIOUS_FIXTURE.rep,
      MALICIOUS_FIXTURE.statusKey,
      MALICIOUS_FIXTURE.taskName,
      MALICIOUS_FIXTURE.leadId,
      MALICIOUS_FIXTURE.taskId,
      "Ali Khan",
      "Fatima",
      "Private Street",
      "IBAN",
      "35202",
      "03001234567",
      "evil-bank",
      "lead-evil",
      "task-secret",
      "db.update",
      "192.168",
    ];

    const pipelineSafe = model.pipelineChart.every(
      (p) => p.name === "New" || p.name === "Other" || p.name === "Quoted" || p.name === "Contacted"
    );
    const revenueSafe = model.revenueChart.every(
      (p) => p.name === "No data" || p.name === "Sales rep 1" || p.name === "Assigned sales"
    );
    const tasksSafe =
      model.todayTasks.length > 0 &&
      model.todayTasks.every(
        (t) =>
          (t.title === "Installation scheduled" ||
            t.title === "Installation task" ||
            t.title === "Site task" ||
            t.title === "Follow-up task") &&
          t.context === "Assigned project"
      );

    return (
      forbidden.every((needle) => !blob.includes(needle)) &&
      pipelineSafe &&
      revenueSafe &&
      tasksSafe &&
      !model.pipelineChart.some((p) => p.name.includes("customer"))
    );
  })()
);

console.log(`\nenterpriseDashboard tests: ${pass} passed`);
