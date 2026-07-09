import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager";
import { filterActiveLeads } from "../../src/lib/leadSoftDelete.ts";
import type { RequestActor } from "../middleware/actor.ts";

export type SalesOwnedResourceType =
  | "lead"
  | "quotation"
  | "customer"
  | "project"
  | "manual_quote_export"
  | "quotation_pdf";

export class SalesOwnershipError extends Error {
  statusCode: 401 | 403 | 404;

  constructor(message: string, statusCode: 401 | 403 | 404 = 403) {
    super(message);
    this.name = "SalesOwnershipError";
    this.statusCode = statusCode;
  }
}

const SALES_STAFF_ROLES = new Set(["Sales Executive", "Sales Manager"]);
const OWNERSHIP_BYPASS_ROLES = new Set(["Admin", "Director", "Super Admin"]);

function normalizeToken(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function readField(row: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

/** Durable sales owner user id — never match on name alone when this is set. */
export function readAssignedSalesUserId(row: Record<string, unknown> | null | undefined): string {
  return readField(row, "assigned_sales_user_id", "assignedSalesUserId");
}

/** Legacy salesperson name — temporary fallback only when durable user id is absent. */
export function readLegacySalesOwnerName(row: Record<string, unknown> | null | undefined): string {
  return readField(row, "assigned_salesperson", "assignedSalesperson", "bdmName", "bdm_name");
}

/** @deprecated Use readLegacySalesOwnerName */
export function readAssignedSalespersonName(row: Record<string, unknown> | null | undefined): string {
  return readLegacySalesOwnerName(row);
}

export function normalizeSalesStaffRole(role: string): string {
  return role === "Sales Advisor" ? "Sales Executive" : role;
}

export function isSalesStaffRole(role: string): boolean {
  const normalized = normalizeSalesStaffRole(role);
  return SALES_STAFF_ROLES.has(normalized);
}

export function isSalesOwnershipBypassRole(role: string): boolean {
  return OWNERSHIP_BYPASS_ROLES.has(role);
}

/**
 * Temporary legacy fallback when assigned_sales_user_id is absent.
 * Exact match only: normalized display name or username.
 */
export function legacySalespersonNameMatches(actor: RequestActor, salespersonName: string): boolean {
  const assignee = normalizeToken(salespersonName);
  if (!assignee) return false;
  const displayName = normalizeToken(actor.name);
  const username = normalizeToken(actor.username);
  return assignee === displayName || assignee === username;
}

export function assertRowSalesOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): void {
  const salesUserId = readAssignedSalesUserId(row);
  if (salesUserId) {
    if (salesUserId !== actor.id) {
      throw new SalesOwnershipError("You cannot access another salesperson's assignment.", 403);
    }
    return;
  }
  const salespersonName = readLegacySalesOwnerName(row);
  if (!salespersonName) {
    throw new SalesOwnershipError("Lead is not assigned to you.", 403);
  }
  if (!legacySalespersonNameMatches(actor, salespersonName)) {
    throw new SalesOwnershipError("You cannot access another salesperson's assignment.", 403);
  }
}

export function isRowSalesOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): boolean {
  try {
    assertRowSalesOwnedByActor(actor, row);
    return true;
  } catch {
    return false;
  }
}

async function loadLeadRow(
  leadId: string,
  localDb?: Database,
  options: { includeDeleted?: boolean } = {}
): Promise<Record<string, unknown> | null> {
  const id = String(leadId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
    if (!data) return null;
    if (!options.includeDeleted && (data as Record<string, unknown>).deleted_at) return null;
    return data as Record<string, unknown>;
  }
  const source = options.includeDeleted ? localDb?.leads || [] : filterActiveLeads(localDb?.leads || []);
  const lead = source.find((l: any) => l.id === id);
  return (lead as Record<string, unknown>) || null;
}

async function loadQuotationRow(
  quotationId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  const id = String(quotationId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("quotations").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  for (const lead of localDb?.leads || []) {
    const quote = (lead.quotes || []).find((q: any) => q.id === id);
    if (quote) {
      return {
        ...(quote as Record<string, unknown>),
        lead_id: lead.id,
        leadId: lead.id,
        customer_id: lead.customerId || lead.customer_id,
        customerId: lead.customerId || lead.customer_id,
      };
    }
  }
  const row = (localDb?.quotations || []).find((q: any) => q.id === id);
  return (row as Record<string, unknown>) || null;
}

async function loadCustomerRow(
  customerId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  const id = String(customerId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const lead = (localDb?.leads || []).find(
    (l: any) => l.customerId === id || l.customer_id === id
  );
  if (lead) {
    return {
      id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
    };
  }
  return null;
}

async function findLeadsForCustomer(
  customerId: string,
  localDb?: Database
): Promise<Record<string, unknown>[]> {
  const id = String(customerId || "").trim();
  if (!id) return [];
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("leads").select("*").eq("customer_id", id);
    return (data as Record<string, unknown>[]) || [];
  }
  return (localDb?.leads || []).filter(
    (l: any) => l.customerId === id || l.customer_id === id
  ) as Record<string, unknown>[];
}

async function loadProjectRow(
  projectId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  const id = String(projectId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.projects || []).find((p: any) => p.id === id);
  return (row as Record<string, unknown>) || null;
}

async function assertLeadOwnedByActor(
  actor: RequestActor,
  leadId: string,
  localDb?: Database,
  options: { includeDeleted?: boolean } = {}
): Promise<void> {
  const lead = await loadLeadRow(leadId, localDb, options);
  if (!lead) {
    throw new SalesOwnershipError("Lead not found.", 404);
  }
  assertRowSalesOwnedByActor(actor, lead);
}

export const SalesOwnershipResolver = {
  isSalesStaffRole,
  isSalesOwnershipBypassRole,

  /**
   * Only Admin, Director, and Super Admin bypass sales ownership.
   * Every other actor — sales staff and any other authenticated role
   * (Accounts Manager, Technician, Survey Engineer, Customer, etc.) — is
   * enforced against. Missing actor is also enforced (never silently
   * allowed); callers without an actor fail closed via 401/403 downstream.
   */
  shouldEnforceForActor(actor: RequestActor | undefined): boolean {
    if (!actor) return true;
    return !isSalesOwnershipBypassRole(actor.role);
  },

  assertSalesActor(actor: RequestActor | undefined): string {
    if (!actor) {
      throw new SalesOwnershipError("Unauthorized", 401);
    }
    if (!isSalesStaffRole(actor.role)) {
      throw new SalesOwnershipError("Not authorized for sales ownership scope.");
    }
    return actor.id;
  },

  async assertResourceOwnedByActor(
    actor: RequestActor | undefined,
    resourceType: SalesOwnedResourceType,
    resourceId: string,
    localDb?: Database
  ): Promise<void> {
    if (!actor) {
      throw new SalesOwnershipError("Unauthorized", 401);
    }
    if (!this.shouldEnforceForActor(actor)) return;

    const id = String(resourceId || "").trim();
    if (!id) {
      throw new SalesOwnershipError("Resource not found.", 404);
    }

    switch (resourceType) {
      case "lead":
        await assertLeadOwnedByActor(actor, id, localDb);
        return;
      case "quotation": {
        const quote = await loadQuotationRow(id, localDb);
        if (!quote) {
          throw new SalesOwnershipError("Quotation not found.", 404);
        }
        const leadId = readField(quote, "lead_id", "leadId");
        if (!leadId) {
          throw new SalesOwnershipError("Quotation not found.", 404);
        }
        const lead = await loadLeadRow(leadId, localDb);
        if (!lead) {
          throw new SalesOwnershipError("Quotation not found.", 404);
        }
        assertRowSalesOwnedByActor(actor, { ...lead, ...quote });
        return;
      }
      case "customer": {
        const customer = await loadCustomerRow(id, localDb);
        if (!customer) {
          throw new SalesOwnershipError("Customer not found.", 404);
        }
        const leads = await findLeadsForCustomer(id, localDb);
        if (leads.length === 0) {
          throw new SalesOwnershipError("Customer not found.", 404);
        }
        if (!leads.some((lead) => isRowSalesOwnedByActor(actor, lead))) {
          throw new SalesOwnershipError("You cannot access another salesperson's customer.", 403);
        }
        return;
      }
      case "project": {
        const project = await loadProjectRow(id, localDb);
        if (!project) {
          throw new SalesOwnershipError("Project not found.", 404);
        }
        const leadId = readField(project, "lead_id", "leadId");
        if (!leadId) {
          throw new SalesOwnershipError("Project not found.", 404);
        }
        await assertLeadOwnedByActor(actor, leadId, localDb);
        return;
      }
      case "manual_quote_export":
      case "quotation_pdf":
        await assertLeadOwnedByActor(actor, id, localDb);
        return;
      default:
        throw new SalesOwnershipError("Resource not found.", 404);
    }
  },

  filterAppStateForActor<T extends Record<string, unknown>>(actor: RequestActor, state: T): T {
    const leads = Array.isArray(state.leads) ? (state.leads as Record<string, unknown>[]) : [];
    const ownedLeads = leads.filter((lead) => isRowSalesOwnedByActor(actor, lead));
    const ownedLeadIds = new Set(
      ownedLeads.map((lead) => String(lead.id || "").trim()).filter(Boolean)
    );

    const projects = Array.isArray(state.projects) ? (state.projects as Record<string, unknown>[]) : [];
    const ownedProjects = projects.filter((project) => {
      const leadId = readField(project, "leadId", "lead_id");
      return leadId && ownedLeadIds.has(leadId);
    });

    const quotations = Array.isArray(state.quotations)
      ? (state.quotations as Record<string, unknown>[])
      : [];
    const ownedQuotations = quotations.filter((quote) => {
      const leadId = readField(quote, "leadId", "lead_id");
      return leadId && ownedLeadIds.has(leadId);
    });

    // Collections keyed by leadId (e.g. paymentTracks, netMeteringTrackers) — keep owned keys only.
    const filterMapByLeadId = (map: unknown): Record<string, unknown> => {
      if (!map || typeof map !== "object" || Array.isArray(map)) return {};
      const source = map as Record<string, unknown>;
      const scoped: Record<string, unknown> = {};
      for (const key of Object.keys(source)) {
        if (ownedLeadIds.has(String(key).trim())) {
          scoped[key] = source[key];
        }
      }
      return scoped;
    };

    const result: Record<string, unknown> = {
      ...state,
      leads: ownedLeads,
      projects: ownedProjects,
      quotations: ownedQuotations,
    };
    if (state.paymentTracks !== undefined) {
      result.paymentTracks = filterMapByLeadId(state.paymentTracks);
    }
    if (state.netMeteringTrackers !== undefined) {
      result.netMeteringTrackers = filterMapByLeadId(state.netMeteringTrackers);
    }
    return result as T;
  },
};
