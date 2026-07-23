import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager";
import type { RequestActor } from "../middleware/actor.ts";

export type CustomerOwnedResourceType =
  | "invoice"
  | "invoice_item"
  | "invoice_payment"
  | "quotation"
  | "customer_document"
  | "warranty"
  | "support_ticket"
  | "service_request";

export class OwnershipError extends Error {
  statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "OwnershipError";
    this.statusCode = statusCode;
  }
}

function readCustomerId(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  return String(row.customer_id || row.customerId || "").trim();
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

export const OwnershipResolver = {
  assertCustomerActor(actor: RequestActor | undefined): string {
    if (!actor) {
      throw new OwnershipError("Unauthorized", 401);
    }
    if (actor.role !== "Customer") {
      throw new OwnershipError("Not authorized for customer portal.");
    }
    const customerId = String(actor.customerId || "").trim();
    if (!customerId) {
      throw new OwnershipError("Customer account is not linked to a project yet.");
    }
    return customerId;
  },

  assertDirectOwnership(actorCustomerId: string, resource: Record<string, unknown>): void {
    const resourceCustomerId = readCustomerId(resource);
    if (!resourceCustomerId || resourceCustomerId !== actorCustomerId) {
      throw new OwnershipError("You cannot access another customer's data.");
    }
  },

  async resolveResourceCustomerId(
    resourceType: CustomerOwnedResourceType,
    resourceId: string,
    localDb?: Database
  ): Promise<string | null> {
    const id = String(resourceId || "").trim();
    if (!id) return null;

    if (isSupabaseActive()) {
      return resolveResourceCustomerIdSupabase(resourceType, id);
    }
    return resolveResourceCustomerIdLocal(resourceType, id, localDb);
  },

  async assertResourceOwnedByActor(
    actor: RequestActor | undefined,
    resourceType: CustomerOwnedResourceType,
    resourceId: string,
    localDb?: Database
  ): Promise<void> {
    const actorCustomerId = this.assertCustomerActor(actor);
    const resourceCustomerId = await this.resolveResourceCustomerId(resourceType, resourceId, localDb);
    if (!resourceCustomerId || resourceCustomerId !== actorCustomerId) {
      throw new OwnershipError("You cannot access another customer's data.");
    }
  },

  assertRouteCustomerId(actor: RequestActor | undefined, routeCustomerId: string): void {
    const actorCustomerId = this.assertCustomerActor(actor);
    const requested = String(routeCustomerId || "").trim();
    if (requested && requested !== actorCustomerId) {
      throw new OwnershipError("You cannot access another customer's data.");
    }
  },
};

async function resolveResourceCustomerIdSupabase(
  resourceType: CustomerOwnedResourceType,
  resourceId: string
): Promise<string | null> {
  const supabase = getSupabase()!;

  switch (resourceType) {
    case "invoice": {
      const { data } = await supabase.from("invoices").select("customer_id").eq("id", resourceId).maybeSingle();
      return readCustomerId(data as Record<string, unknown>);
    }
    case "invoice_item": {
      const { data: item } = await supabase
        .from("invoice_items")
        .select("invoice_id")
        .eq("id", resourceId)
        .maybeSingle();
      const invoiceId = readField(item as Record<string, unknown>, "invoice_id", "invoiceId");
      return invoiceId ? resolveResourceCustomerIdSupabase("invoice", invoiceId) : null;
    }
    case "invoice_payment": {
      const { data: payment } = await supabase
        .from("invoice_payments")
        .select("invoice_id")
        .eq("id", resourceId)
        .maybeSingle();
      const invoiceId = readField(payment as Record<string, unknown>, "invoice_id", "invoiceId");
      return invoiceId ? resolveResourceCustomerIdSupabase("invoice", invoiceId) : null;
    }
    case "quotation": {
      const { data } = await supabase.from("quotations").select("customer_id").eq("id", resourceId).maybeSingle();
      return readCustomerId(data as Record<string, unknown>);
    }
    case "customer_document": {
      const { data } = await supabase
        .from("customer_documents")
        .select("customer_id")
        .eq("id", resourceId)
        .maybeSingle();
      return readCustomerId(data as Record<string, unknown>);
    }
    case "warranty": {
      const { data } = await supabase
        .from("customer_warranties")
        .select("customer_id")
        .eq("id", resourceId)
        .maybeSingle();
      return readCustomerId(data as Record<string, unknown>);
    }
    case "support_ticket": {
      const { data } = await supabase
        .from("support_tickets")
        .select("customer_id")
        .eq("id", resourceId)
        .maybeSingle();
      return readCustomerId(data as Record<string, unknown>);
    }
    case "service_request": {
      const { data } = await supabase
        .from("service_requests")
        .select("customer_id")
        .eq("id", resourceId)
        .maybeSingle();
      return readCustomerId(data as Record<string, unknown>);
    }
    default:
      return null;
  }
}

function resolveResourceCustomerIdLocal(
  resourceType: CustomerOwnedResourceType,
  resourceId: string,
  localDb?: Database
): string | null {
  const db = localDb as unknown as Record<string, any[]> | undefined;
  if (!db) return null;

  switch (resourceType) {
    case "invoice": {
      const row = (db.invoices || []).find((r) => r.id === resourceId);
      return readCustomerId(row) || null;
    }
    case "invoice_item": {
      const item = (db.invoiceItems || []).find((r) => r.id === resourceId);
      const invoiceId = readField(item, "invoice_id", "invoiceId");
      return invoiceId ? resolveResourceCustomerIdLocal("invoice", invoiceId, localDb) : null;
    }
    case "invoice_payment": {
      const payment = (db.invoicePayments || []).find((r) => r.id === resourceId);
      const invoiceId = readField(payment, "invoice_id", "invoiceId");
      return invoiceId ? resolveResourceCustomerIdLocal("invoice", invoiceId, localDb) : null;
    }
    case "quotation": {
      const row = (db.quotations || []).find((r) => r.id === resourceId);
      return readCustomerId(row) || null;
    }
    case "customer_document": {
      const row = (db.customerDocuments || []).find((r) => r.id === resourceId);
      return readCustomerId(row) || null;
    }
    case "warranty": {
      const row = (db.customerWarranties || []).find((r) => r.id === resourceId);
      return readCustomerId(row) || null;
    }
    case "support_ticket": {
      const row = (db.tickets || []).find((r) => r.id === resourceId);
      return readCustomerId(row) || null;
    }
    case "service_request": {
      const row = (db.serviceRequests || []).find((r) => r.id === resourceId);
      return readCustomerId(row) || null;
    }
    default:
      return null;
  }
}

export function portalIdentityFromActor(actor: RequestActor): { userId: string; username: string } {
  return { userId: actor.id, username: actor.username };
}
