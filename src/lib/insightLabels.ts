/**
 * Safe human-readable labels for structured BI insight codes.
 * Never echoes raw CRM fields — codes and metrics only.
 */

import type { InsightItem, InsightSeverity, PriorityLevel } from "../../server/ai/intelligence/InsightModels.ts";

const CODE_LABELS: Record<string, string> = {
  SALES_LEAD_BACKLOG: "Lead backlog monitored",
  SALES_LEAD_BACKLOG_HIGH: "Lead backlog is elevated",
  SALES_QUOTE_BACKLOG: "Open quotations tracked",
  SALES_QUOTE_BACKLOG_HIGH: "Quotation backlog needs action",
  SALES_LEAD_AGING_RISK: "Stale new leads detected",
  SALES_MISSING_FOLLOWUP_RISK: "Follow-up gap on contacted leads",
  SALES_STALLED_PROJECTS: "Projects stalled in pipeline",
  SALES_PIPELINE_BALANCE: "Pipeline balance reviewed",
  SALES_PIPELINE_HEALTHY: "Sales pipeline is healthy",
  FINANCE_INVOICE_TOTALS: "Invoice totals summarized",
  FINANCE_PAYMENT_RISK: "Payment risk assessed",
  FINANCE_REVENUE_WARNING: "Revenue concentration warning",
  FINANCE_OVERDUE_CRITICAL: "Critical overdue invoice pressure",
  FINANCE_OVERDUE_WARNING: "Overdue invoices elevated",
  FINANCE_INVOICE_CONCENTRATION_RISK: "Invoice concentration risk",
  FINANCE_HEALTHY_CASHFLOW: "Cash collection healthy",
  OPS_PENDING_INSTALLS: "Pending installations tracked",
  OPS_INSTALLATION_PRESSURE_HIGH: "Installation workload is high",
  OPS_DELIVERY_BACKLOG_HIGH: "Delivery backlog elevated",
  OPS_TODAY_WORKLOAD: "Today's workload tracked",
  OPS_TODAY_WORKLOAD_HIGH: "Today's workload is high",
  OPS_TOMORROW_WORKLOAD: "Tomorrow's workload tracked",
  OPS_TOMORROW_WORKLOAD_HIGH: "Tomorrow's workload is high",
  OPS_ON_TRACK: "Operations on track",
  SUPPORT_OPEN_TICKET_LOAD: "Open ticket load tracked",
  SUPPORT_TICKET_LOAD_HIGH: "Support ticket load is high",
  SUPPORT_SERVICE_REQUEST_LOAD: "Service request load tracked",
  SUPPORT_SERVICE_REQUEST_PRESSURE_HIGH: "Service request pressure elevated",
  SUPPORT_REPEATED_PRESSURE_RISK: "Repeated support pressure risk",
  SUPPORT_LOAD_MANAGEABLE: "Support load is manageable",
  PROCUREMENT_LOW_STOCK_WARNING: "Low-stock items detected",
  PROCUREMENT_LOW_STOCK_CRITICAL: "Critical low-stock situation",
  PROCUREMENT_REORDER_RECOMMENDED: "Reorder recommended",
  PROCUREMENT_INVENTORY_HEALTHY: "Inventory levels healthy",
};

const METRIC_LABELS: Record<string, string> = {
  lead_backlog_ratio: "Lead backlog ratio",
  quote_backlog_count: "Open quotations",
  lead_aging_risk_ratio: "Aging lead ratio",
  follow_up_risk_ratio: "Follow-up gap ratio",
  pipeline_balance: "Pipeline win ratio",
  stalled_projects_count: "Stalled projects",
  overdue_percent: "Overdue share",
  invoice_total_amount: "Invoice total",
  installation_pressure: "Installation pressure",
  delivery_backlog_ratio: "Delivery backlog",
  today_workload: "Tasks today",
  tomorrow_workload: "Tasks tomorrow",
  ticket_load_ratio: "Open ticket ratio",
  service_request_ratio: "Service request ratio",
  low_stock_count: "Low-stock SKUs",
};

const SENSITIVE_PATTERN =
  /phone|cnic|address|email|bank|account|iban|password|customer|notes|@[a-z]/i;

export interface InsightDisplayItem {
  code: string;
  title: string;
  detail: string;
  severity: InsightSeverity;
  kind: InsightItem["kind"];
  category: InsightItem["category"];
}

function safeMetricLabel(metric: string): string {
  const key = metric.trim().toLowerCase();
  if (SENSITIVE_PATTERN.test(key)) return "Metric";
  return METRIC_LABELS[key] ?? "Metric";
}

export function formatInsightItem(item: InsightItem): InsightDisplayItem {
  const title = CODE_LABELS[item.code] ?? `${item.category} insight`;
  const metricLabel = safeMetricLabel(item.metric);
  const threshold =
    item.threshold !== null && item.threshold !== undefined ? ` · threshold ${item.threshold}` : "";
  const detail = `${metricLabel}: ${item.value}${threshold}`;

  return {
    code: item.code,
    title,
    detail,
    severity: item.severity,
    kind: item.kind,
    category: item.category,
  };
}

export function formatInsights(items: InsightItem[]): InsightDisplayItem[] {
  return items.map(formatInsightItem);
}

export function priorityLabel(priority: PriorityLevel): string {
  return priority;
}

export function assertInsightDisplaySafe(items: InsightDisplayItem[]): boolean {
  const blob = JSON.stringify(items);
  return !SENSITIVE_PATTERN.test(blob);
}
