/**
 * Global Search V1 — client-side index over existing AppState only.
 * No backend calls. No mutations. Safe labels only — no raw PII in results or previews.
 */

import { isKnowledgeMockUiEnabled } from "./knowledgeFeatureFlag.ts";
import {
  assertSearchOutputSafe,
  createSalesRepAnonymizer,
  safeCatalogLabel,
  safeCustomerResultTitle,
  safeEngagementLabel,
  safeInvoiceResultTitle,
  safeLeadResultTitle,
  safeLeadSourceLabel,
  safeLeadStatusLabel,
  safePortalAccessLabel,
  safePortalAccountMeta,
  safePortalAccountTitle,
  safePriorityLabel,
  safeProjectResultTitle,
  safeProjectStageLabel,
  safeQuotationResultTitle,
  safeQuoteStatusLabel,
  safeRoofTypeLabel,
  safeTicketResultTitle,
  safeTicketStatusLabel,
} from "./globalSearchLabels.ts";
import type { AppState, Lead, Project, Ticket, User } from "../types";

export type GlobalSearchCategory =
  | "customers"
  | "leads"
  | "quotations"
  | "projects"
  | "invoices"
  | "tickets"
  | "inventory"
  | "documents";

export const GLOBAL_SEARCH_CATEGORY_LABELS: Record<GlobalSearchCategory, string> = {
  customers: "Customers",
  leads: "Leads",
  quotations: "Quotations",
  projects: "Projects",
  invoices: "Invoices",
  tickets: "Tickets",
  inventory: "Inventory",
  documents: "Documents",
};

export interface GlobalSearchPreviewLine {
  label: string;
  value: string;
}

export interface GlobalSearchResult {
  id: string;
  category: GlobalSearchCategory;
  title: string;
  subtitle: string;
  meta?: string;
  /** Tab id from App.tsx navigation — only set when the user is allowed to open it. */
  routeTab?: string;
  preview: {
    heading: string;
    lines: GlobalSearchPreviewLine[];
  };
}

export interface GlobalSearchGroup {
  category: GlobalSearchCategory;
  label: string;
  results: GlobalSearchResult[];
}

export interface GlobalSearchInput {
  appState: AppState | null;
  query: string;
  allowedTabIds: readonly string[];
  /** When false, document mock results are omitted. Defaults to knowledge mock flag. */
  documentsEnabled?: boolean;
}

const RECENT_STORAGE_KEY = "sunchaser-global-search-recent-v1";

/** Fixed intro copy — never includes currentUser.name or role. */
export const GLOBAL_SEARCH_INTRO_HEADING = "Sunchaser Spotlight";
export const GLOBAL_SEARCH_INTRO_BODY =
  "Search your workspace. Local app state only — safe labels, no server search.";

/** Fixed empty-results copy — never echoes the user's query. */
export const GLOBAL_SEARCH_NO_RESULTS_MESSAGE = "No matching results found";

export interface GlobalSearchShellModel {
  introHeading: string;
  introBody: string;
  noResultsMessage: string;
  recentSearchesEnabled: false;
}

export function buildGlobalSearchShellModel(): GlobalSearchShellModel {
  return {
    introHeading: GLOBAL_SEARCH_INTRO_HEADING,
    introBody: GLOBAL_SEARCH_INTRO_BODY,
    noResultsMessage: GLOBAL_SEARCH_NO_RESULTS_MESSAGE,
    recentSearchesEnabled: false,
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Remove legacy recent-search localStorage from pre-audit builds. V1 does not persist queries. */
export function clearLegacyRecentSearchStorage(storage?: StorageLike | null): void {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!target) return;
  try {
    target.removeItem(RECENT_STORAGE_KEY);
  } catch {
    /* ignore private mode / quota */
  }
}

export const GLOBAL_SEARCH_RECENT_STORAGE_KEY = RECENT_STORAGE_KEY;

/** Fields never used as preview line labels. */
const SENSITIVE_FIELD_PATTERN =
  /^(cnic|notes|internalnotes|customnotes|bankaccount|iban|routing|accountnumber|password|token|voicenote|resolutionproof|monthlybill|cost|totalvalue|advance|pendingamount|amount|totalcost|netcost|grandtotal|nettotal|taxamount|societycharges|discountvalue|email|phone|address|customername|clientname|description|subject|name|username|login|portalidentifier|customerid|portalid)$/i;

/** Mock knowledge-style documents — frontend only, gated by feature flag. */
const MOCK_DOCUMENTS: Array<{
  id: string;
  title: string;
  collection: string;
  tags: string[];
  summary: string;
}> = [
  {
    id: "gs-doc-1",
    title: "Solar Installation SOP — Rooftop",
    collection: "SOPs",
    tags: ["sop", "installation", "safety"],
    summary: "Step-by-step rooftop installation checklist.",
  },
  {
    id: "gs-doc-2",
    title: "Net Metering Application Guide",
    collection: "SOPs",
    tags: ["net-metering", "discom"],
    summary: "State-wise net metering process for sales teams.",
  },
  {
    id: "gs-doc-3",
    title: "Warranty Claim Process",
    collection: "Support",
    tags: ["warranty", "support"],
    summary: "Customer warranty intake and escalation flow.",
  },
  {
    id: "gs-doc-4",
    title: "Panel Datasheet — SunMax 550W",
    collection: "Products",
    tags: ["datasheet", "panels"],
    summary: "Manufacturer specs for SunMax mono PERC panels.",
  },
];

const ALLOWED_PREVIEW_LABELS = new Set([
  "Status",
  "Source",
  "Engagement",
  "Roof type",
  "Owner",
  "System",
  "Panels",
  "Inverter",
  "Stage",
  "System size",
  "Updated",
  "Milestones",
  "Reminder sent",
  "Priority",
  "Category",
  "Stock",
  "Description",
  "Collection",
  "Summary",
  "Tags",
  "Source type",
  "Reference",
  "Role",
  "Account type",
]);

export function isSensitiveFieldKey(key: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(key.replace(/[^a-zA-Z]/g, ""));
}

/** Safe single-line text for internal use — strips control chars, caps length. */
export function safeDisplayText(value: unknown, maxLen = 120): string {
  if (value === null || value === undefined) return "";
  const text = String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function tokenMatch(query: string, ...parts: Array<string | number | undefined | null>): boolean {
  if (!query) return false;
  const haystack = parts
    .filter((p) => p !== undefined && p !== null && String(p).trim() !== "")
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function tabIfAllowed(tabId: string, allowed: readonly string[]): string | undefined {
  return allowed.includes(tabId) ? tabId : undefined;
}

/** Internal-only match tokens for portal users — never rendered in results. */
function portalUserMatchTokens(user: User): Array<string | number | undefined | null> {
  const extended = user as User & {
    phone?: string;
    cnic?: string;
    address?: string;
    iban?: string;
    login?: string;
    portalId?: string;
  };
  return [
    extended.name,
    extended.username,
    extended.email,
    extended.customerId,
    extended.login,
    extended.portalId,
    extended.phone,
    extended.cnic,
    extended.address,
    extended.iban,
  ];
}

function previewLine(label: string, value: string): GlobalSearchPreviewLine | null {
  if (!value.trim()) return null;
  if (!ALLOWED_PREVIEW_LABELS.has(label)) return null;
  if (isSensitiveFieldKey(label.replace(/\s+/g, ""))) return null;
  return { label, value: safeDisplayText(value, 120) };
}

function buildCustomerResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[],
  repLabel: (raw: string) => string
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];
  const customerStatuses = new Set<Lead["status"]>(["Contracted", "Installed", "Won"]);

  for (const lead of appState.leads ?? []) {
    if (lead.deletedAt) continue;
    if (!customerStatuses.has(lead.status)) continue;
    if (!tokenMatch(query, lead.name, lead.email, lead.phone, lead.address, lead.status, lead.assignedSalesperson)) {
      continue;
    }

    const status = safeLeadStatusLabel(lead.status);
    results.push({
      id: `customer-lead-${lead.id}`,
      category: "customers",
      title: safeCustomerResultTitle(lead.status),
      subtitle: `Deployment record · ${status}`,
      meta: repLabel(lead.assignedSalesperson),
      routeTab: tabIfAllowed("CRM Database", allowedTabIds),
      preview: {
        heading: safeCustomerResultTitle(lead.status),
        lines: [
          previewLine("Status", status),
          previewLine("Owner", repLabel(lead.assignedSalesperson)),
        ].filter((line): line is GlobalSearchPreviewLine => line !== null),
      },
    });
  }

  for (const user of appState.users ?? []) {
    if (user.role !== "Customer") continue;
    if (!tokenMatch(query, ...portalUserMatchTokens(user))) continue;
    if (results.some((r) => r.id === `customer-user-${user.id}`)) continue;

    const portalAccess = safePortalAccessLabel(user);
    results.push({
      id: `customer-user-${user.id}`,
      category: "customers",
      title: safePortalAccountTitle(),
      subtitle: portalAccess,
      meta: safePortalAccountMeta(),
      routeTab: tabIfAllowed("CRM Database", allowedTabIds),
      preview: {
        heading: safePortalAccountTitle(),
        lines: [
          previewLine("Account type", safePortalAccountMeta()),
          previewLine("Status", portalAccess),
        ].filter((line): line is GlobalSearchPreviewLine => line !== null),
      },
    });
  }

  return results.slice(0, 12);
}

function buildLeadResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[],
  repLabel: (raw: string) => string
): GlobalSearchResult[] {
  return (appState.leads ?? [])
    .filter((lead) => !lead.deletedAt)
    .filter((lead) =>
      tokenMatch(
        query,
        lead.name,
        lead.email,
        lead.phone,
        lead.status,
        lead.assignedSalesperson,
        lead.location,
        lead.leadSource
      )
    )
    .slice(0, 15)
    .map((lead) => {
      const status = safeLeadStatusLabel(lead.status);
      const source = safeLeadSourceLabel(lead.leadSource);
      const engagement = safeEngagementLabel(lead.engagementLevel);
      const roof = safeRoofTypeLabel(lead.roofType);
      return {
        id: `lead-${lead.id}`,
        category: "leads" as const,
        title: safeLeadResultTitle(lead.status),
        subtitle: [status, source || "Pipeline record"].filter(Boolean).join(" · "),
        meta: repLabel(lead.assignedSalesperson),
        routeTab: tabIfAllowed("CRM Database", allowedTabIds),
        preview: {
          heading: safeLeadResultTitle(lead.status),
          lines: [
            previewLine("Status", status),
            previewLine("Source", source),
            previewLine("Engagement", engagement),
            previewLine("Roof type", roof),
            previewLine("Owner", repLabel(lead.assignedSalesperson)),
          ].filter((line): line is GlobalSearchPreviewLine => line !== null),
        },
      };
    });
}

function buildQuotationResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[]
): GlobalSearchResult[] {
  const results: GlobalSearchResult[] = [];

  for (const lead of appState.leads ?? []) {
    if (lead.deletedAt) continue;
    for (const quote of lead.quotes ?? []) {
      if (
        !tokenMatch(
          query,
          quote.id,
          quote.clientName,
          lead.name,
          quote.status,
          quote.panelType,
          quote.inverterType,
          String(quote.systemSizekW)
        )
      ) {
        continue;
      }

      const kw = safeDisplayText(String(quote.systemSizekW), 10);
      const status = safeQuoteStatusLabel(String(quote.status ?? ""));
      results.push({
        id: `quote-${lead.id}-${quote.id}`,
        category: "quotations",
        title: safeQuotationResultTitle(kw),
        subtitle: `${kw} kW · ${status}`,
        meta: safeCatalogLabel(quote.panelType, "Solar system"),
        routeTab:
          tabIfAllowed("Sales Advisor", allowedTabIds) ?? tabIfAllowed("CRM Database", allowedTabIds),
        preview: {
          heading: safeQuotationResultTitle(kw),
          lines: [
            previewLine("System", `${kw} kW`),
            previewLine("Panels", safeCatalogLabel(quote.panelType, "Panels")),
            previewLine("Inverter", safeCatalogLabel(quote.inverterType, "Inverter")),
            previewLine("Status", status),
          ].filter((line): line is GlobalSearchPreviewLine => line !== null),
        },
      });
    }
  }

  for (const q of appState.quotations ?? []) {
    const id = safeDisplayText(q?.id, 40);
    const client = safeDisplayText(q?.clientName ?? q?.customerName, 80);
    if (!id && !client) continue;
    if (!tokenMatch(query, id, client, q?.status, q?.reference)) continue;
    if (results.some((r) => r.id === `quote-global-${id}`)) continue;

    const status = safeQuoteStatusLabel(String(q?.status ?? ""));
    results.push({
      id: `quote-global-${id}`,
      category: "quotations",
      title: "Quotation · Record",
      subtitle: status,
      routeTab:
        tabIfAllowed("Sales Advisor", allowedTabIds) ?? tabIfAllowed("CRM Database", allowedTabIds),
      preview: {
        heading: "Quotation · Record",
        lines: [
          previewLine("Reference", id || "Quotation"),
          previewLine("Status", status),
        ].filter((line): line is GlobalSearchPreviewLine => line !== null),
      },
    });
  }

  return results.slice(0, 15);
}

function buildProjectResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[]
): GlobalSearchResult[] {
  return (appState.projects ?? [])
    .filter((project: Project) =>
      tokenMatch(
        query,
        project.customerName,
        project.address,
        project.stage,
        project.id,
        String(project.systemSizekW)
      )
    )
    .slice(0, 12)
    .map((project) => {
      const kw = safeDisplayText(String(project.systemSizekW), 10);
      return {
        id: `project-${project.id}`,
        category: "projects",
        title: safeProjectResultTitle(project.stage, kw),
        subtitle: `${kw} kW · Active project`,
        meta: "Project record",
        routeTab: tabIfAllowed("Admin Dashboard", allowedTabIds),
        preview: {
          heading: safeProjectResultTitle(project.stage, kw),
          lines: [
            previewLine("Stage", safeProjectStageLabel(project.stage)),
            previewLine("System size", `${kw} kW`),
            previewLine("Updated", safeDisplayText(project.updatedAt?.slice(0, 10), 20)),
          ].filter((line): line is GlobalSearchPreviewLine => line !== null),
        },
      };
    });
}

function buildInvoiceResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[]
): GlobalSearchResult[] {
  const tracks = appState.paymentTracks ?? {};
  const leadById = new Map((appState.leads ?? []).map((l) => [l.id, l]));
  const results: GlobalSearchResult[] = [];

  for (const [leadId, track] of Object.entries(tracks)) {
    const lead = leadById.get(leadId);
    if (!tokenMatch(query, lead?.name, lead?.email, track.invoiceStatus, leadId)) continue;

    const status = safeQuoteStatusLabel(String(track.invoiceStatus ?? ""));
    results.push({
      id: `invoice-${leadId}`,
      category: "invoices",
      title: safeInvoiceResultTitle(status),
      subtitle: "Payment track",
      meta: "Finance record",
      routeTab: tabIfAllowed("Admin Dashboard", allowedTabIds),
      preview: {
        heading: safeInvoiceResultTitle(status),
        lines: [
          previewLine("Status", status),
          previewLine("Milestones", String(track.milestones?.length ?? 0)),
          previewLine("Reminder sent", track.reminderSent ? "Yes" : "No"),
        ].filter((line): line is GlobalSearchPreviewLine => line !== null),
      },
    });
  }

  return results.slice(0, 10);
}

function buildTicketResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[]
): GlobalSearchResult[] {
  return (appState.tickets ?? [])
    .filter((ticket: Ticket) =>
      tokenMatch(
        query,
        ticket.customerName,
        ticket.subject,
        ticket.description,
        ticket.status,
        ticket.priority,
        ticket.assignedTechnician
      )
    )
    .slice(0, 12)
    .map((ticket) => {
      const status = safeTicketStatusLabel(String(ticket.status ?? ""));
      const priority = safePriorityLabel(String(ticket.priority ?? ""));
      return {
        id: `ticket-${ticket.id}`,
        category: "tickets",
        title: safeTicketResultTitle(status),
        subtitle: `${priority} priority · ${status}`,
        meta: "Support record",
        routeTab:
          tabIfAllowed("Admin Dashboard", allowedTabIds) ??
          tabIfAllowed("Activity Telemetry", allowedTabIds),
        preview: {
          heading: safeTicketResultTitle(status),
          lines: [
            previewLine("Status", status),
            previewLine("Priority", priority),
          ].filter((line): line is GlobalSearchPreviewLine => line !== null),
        },
      };
    });
}

function buildInventoryResults(
  query: string,
  appState: AppState,
  allowedTabIds: readonly string[]
): GlobalSearchResult[] {
  return (appState.inventory ?? [])
    .filter((item) =>
      tokenMatch(query, item.name, item.category, item.desc, item.id, String(item.stock))
    )
    .slice(0, 12)
    .map((item) => ({
      id: `inventory-${item.id}`,
      category: "inventory",
      title: safeCatalogLabel(item.name, "Inventory item"),
      subtitle: `${safeCatalogLabel(item.category, "Category")} · Stock ${safeDisplayText(String(item.stock), 10)}`,
      meta: safeCatalogLabel(item.desc, "SKU"),
      routeTab: tabIfAllowed("Admin Dashboard", allowedTabIds),
      preview: {
        heading: safeCatalogLabel(item.name, "Inventory item"),
        lines: [
          previewLine("Category", safeCatalogLabel(item.category, "Category")),
          previewLine("Stock", safeDisplayText(String(item.stock), 10)),
          previewLine("Description", safeCatalogLabel(item.desc, "Catalog SKU")),
        ].filter((line): line is GlobalSearchPreviewLine => line !== null),
      },
    }));
}

function buildDocumentResults(
  query: string,
  allowedTabIds: readonly string[]
): GlobalSearchResult[] {
  return MOCK_DOCUMENTS.filter((doc) =>
    tokenMatch(query, doc.title, doc.collection, doc.summary, ...doc.tags)
  )
    .slice(0, 8)
    .map((doc) => ({
      id: doc.id,
      category: "documents" as const,
      title: doc.title,
      subtitle: `${doc.collection} · Knowledge mock`,
      meta: doc.tags.map((t) => `#${t}`).join(" "),
      routeTab: tabIfAllowed("Admin Dashboard", allowedTabIds),
      preview: {
        heading: doc.title,
        lines: [
          previewLine("Collection", doc.collection),
          previewLine("Summary", doc.summary),
          previewLine("Tags", doc.tags.join(", ")),
          previewLine("Source type", "Frontend mock (no API)"),
        ].filter((line): line is GlobalSearchPreviewLine => line !== null),
      },
    }));
}

const CATEGORY_ORDER: GlobalSearchCategory[] = [
  "customers",
  "leads",
  "quotations",
  "projects",
  "invoices",
  "tickets",
  "inventory",
  "documents",
];

/** Run client-side global search over AppState. Safe with null/partial state. */
export function runGlobalSearch(input: GlobalSearchInput): GlobalSearchGroup[] {
  const query = normalizeQuery(input.query);
  if (!query) return [];

  const appState = input.appState;
  const allowed = input.allowedTabIds;
  const documentsEnabled = input.documentsEnabled ?? isKnowledgeMockUiEnabled();
  const repLabel = createSalesRepAnonymizer();

  const byCategory: Record<GlobalSearchCategory, GlobalSearchResult[]> = {
    customers: appState ? buildCustomerResults(query, appState, allowed, repLabel) : [],
    leads: appState ? buildLeadResults(query, appState, allowed, repLabel) : [],
    quotations: appState ? buildQuotationResults(query, appState, allowed) : [],
    projects: appState ? buildProjectResults(query, appState, allowed) : [],
    invoices: appState ? buildInvoiceResults(query, appState, allowed) : [],
    tickets: appState ? buildTicketResults(query, appState, allowed) : [],
    inventory: appState ? buildInventoryResults(query, appState, allowed) : [],
    documents: documentsEnabled ? buildDocumentResults(query, allowed) : [],
  };

  return CATEGORY_ORDER.map((category) => ({
    category,
    label: GLOBAL_SEARCH_CATEGORY_LABELS[category],
    results: byCategory[category],
  })).filter((group) => group.results.length > 0);
}

export function flattenSearchGroups(groups: GlobalSearchGroup[]): GlobalSearchResult[] {
  return groups.flatMap((g) => g.results);
}

/** Whether global search should mount for this user (Customer shell excluded). */
export function isGlobalSearchAllowedForUser(user: User | null): boolean {
  return Boolean(user && user.role !== "Customer");
}

/** Assert preview lines contain no sensitive field labels from blocklist. */
export function assertPreviewSafe(lines: GlobalSearchPreviewLine[]): boolean {
  return lines.every(
    (line) =>
      ALLOWED_PREVIEW_LABELS.has(line.label) && !isSensitiveFieldKey(line.label.replace(/\s+/g, ""))
  );
}

export { assertSearchOutputSafe };
