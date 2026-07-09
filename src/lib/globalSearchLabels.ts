/**
 * Safe display labels for Global Search — never echo raw CRM PII in results or previews.
 */

import type { User } from "../types.ts";
import { safeLeadStatusLabel, safeProjectStageLabel } from "./dashboardLabelSanitizers.ts";

export { safeLeadStatusLabel, safeProjectStageLabel };

const TICKET_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  "in progress": "In Progress",
  resolved: "Resolved",
  new: "New",
  "under review": "Under Review",
  "technician assigned": "Technician Assigned",
  "visit scheduled": "Visit Scheduled",
  closed: "Closed",
  rejected: "Rejected",
};

const KNOWN_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

const KNOWN_QUOTE_STATUS = new Set([
  "pending",
  "accepted",
  "rejected",
  "draft",
  "sent",
  "expired",
]);

export function safeTicketStatusLabel(raw: string): string {
  const token = raw.trim().toLowerCase();
  return TICKET_STATUS_LABELS[token] ?? "Open";
}

export function safePriorityLabel(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (KNOWN_PRIORITIES.has(token)) return token.charAt(0).toUpperCase() + token.slice(1);
  return "Medium";
}

export function safeQuoteStatusLabel(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (KNOWN_QUOTE_STATUS.has(token)) return token.charAt(0).toUpperCase() + token.slice(1);
  return "Pending";
}

export function safeEngagementLabel(raw: string | undefined): string {
  const token = String(raw ?? "").trim().toLowerCase();
  if (token === "high" || token === "medium" || token === "low") {
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return "";
}

export function safeLeadSourceLabel(raw: string | undefined): string {
  const token = String(raw ?? "").trim();
  if (!token) return "";
  if (/phone|cnic|@|street|road|iban|bank|account|\d{5,}/i.test(token)) return "Referral";
  if (token.length > 40) return "Campaign";
  return token;
}

export function safeRoofTypeLabel(raw: string | undefined): string {
  const token = String(raw ?? "").trim();
  if (!token || /phone|cnic|@|street|address|iban/i.test(token)) return "";
  return token.length > 40 ? "Standard" : token;
}

export function safeCatalogLabel(raw: string | undefined, fallback = "Catalog item"): string {
  const token = String(raw ?? "").trim();
  if (!token || /phone|cnic|@|street|address|iban|bank/i.test(token)) return fallback;
  return token.length > 80 ? `${token.slice(0, 79)}…` : token;
}

export function safeLeadResultTitle(status: string): string {
  return `Lead · ${safeLeadStatusLabel(status)}`;
}

export function safeCustomerResultTitle(status: string): string {
  return `Customer · ${safeLeadStatusLabel(status)}`;
}

/** Fixed label for customer portal user search hits — never echoes username/email/login. */
export function safePortalAccountTitle(): string {
  return "Portal Account";
}

/** Fixed meta label for portal customer hits. */
export function safePortalAccountMeta(): string {
  return "Customer Account";
}

/** Portal access state — derived from account status only, no identifiers. */
export function safePortalAccessLabel(user: Pick<User, "accountStatus">): string {
  const status = String(user.accountStatus ?? "").trim();
  if (status === "Approved") return "Portal Enabled";
  return "Portal Disabled";
}

export function safeQuotationResultTitle(systemSizeKw: string | number): string {
  const kw = String(systemSizeKw ?? "").trim() || "—";
  return `Quotation · ${kw} kW`;
}

export function safeProjectResultTitle(stage: string, systemSizeKw: string | number): string {
  const kw = String(systemSizeKw ?? "").trim() || "—";
  return `Project · ${safeProjectStageLabel(stage)} · ${kw} kW`;
}

export function safeTicketResultTitle(status: string): string {
  return `Support ticket · ${safeTicketStatusLabel(status)}`;
}

export function safeInvoiceResultTitle(status: string): string {
  return `Invoice · ${safeQuoteStatusLabel(status)}`;
}

export function createSalesRepAnonymizer(): (raw: string) => string {
  const map = new Map<string, number>();
  let next = 1;
  return (raw: string): string => {
    const key = raw.trim();
    if (!key) return "Assigned sales";
    if (!map.has(key)) {
      map.set(key, next);
      next += 1;
    }
    return `Sales rep ${map.get(key)}`;
  };
}

/** Patterns that must never appear in serialized search output. */
export const FORBIDDEN_OUTPUT_PATTERNS = [
  /cnic/i,
  /\biban\b/i,
  /bank\s*account/i,
  /private\s*notes/i,
  /\b\d{5}-\d{7}-\d\b/,
  /\b03\d{9}\b/,
] as const;

export function assertSearchOutputSafe(blob: string, needles: string[] = []): boolean {
  if (FORBIDDEN_OUTPUT_PATTERNS.some((re) => re.test(blob))) return false;
  return needles.every((needle) => !blob.includes(needle));
}
