import { getCompanyBranding } from "./brandingDb.js";
import {
  CustomerPortalAuthError,
  StaffPortalAuthError,
  getSupabase,
  isSupabaseActive,
  verifyCustomerPortalUser,
  verifyStaffPortalUser,
  type Database,
} from "./dbManager.js";
import { syncWarrantyCertificateDocumentVault } from "./customerDocumentSync.js";
import { mapWarrantyRow } from "./src/lib/clientPortalPhase2.ts";
import {
  buildCertificateComponentRows,
  compileWarrantyCertificatePDFHtml,
  type WarrantyCertificatePayload,
} from "./warrantyCertificatePdf.js";

export class WarrantyCertificateDbError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function buildWarrantyCertificateDocumentId(customerId: string): string {
  const slug = String(customerId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-10)
    .toUpperCase();
  return `WC-${slug || "UNKNOWN"}`;
}

async function loadCustomerWarranties(customerId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customer_warranties")
      .select("*")
      .eq("customer_id", customerId);
    if (error) throw error;
    return (data || []).map(mapWarrantyRow);
  }
  return ((localDb as any)?.customerWarranties || [])
    .filter((w: any) => (w.customer_id || w.customerId) === customerId)
    .map((w: any) =>
      mapWarrantyRow({
        id: w.id,
        customer_id: w.customer_id || w.customerId,
        project_id: w.project_id || w.projectId,
        component_type: w.component_type || w.componentType,
        brand: w.brand,
        model: w.model,
        serial_number: w.serial_number || w.serialNumber,
        start_date: w.start_date || w.startDate,
        end_date: w.end_date || w.endDate,
      })
    );
}

async function loadLatestDelivery(customerId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_deliveries")
      .select(
        "id, project_id, installation_address, installation_completed_date, warranty_start_date, project_title"
      )
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1);
    return data?.[0] || null;
  }
  const rows = ((localDb as any)?.projectDeliveries || []).filter(
    (d: any) => (d.customer_id || d.customerId) === customerId
  );
  return rows.sort((a: any, b: any) => String(b.updated_at || b.updatedAt || "").localeCompare(String(a.updated_at || a.updatedAt || "")))[0] || null;
}

async function loadCustomerBasics(customerId: string, localDb?: Database) {
  const empty = { name: "Customer", phone: "", address: "" };
  if (!customerId) return empty;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customers")
      .select("name, phone, address")
      .eq("id", customerId)
      .maybeSingle();
    if (data) {
      return {
        name: data.name || "Customer",
        phone: data.phone || "",
        address: data.address || "",
      };
    }
  }
  const lead = ((localDb as any)?.leads || []).find(
    (l: any) => l.customerId === customerId || l.customer_id === customerId
  );
  if (lead) {
    return {
      name: lead.name || "Customer",
      phone: lead.phone || "",
      address: lead.address || lead.siteAddress || "",
    };
  }
  return empty;
}

export async function buildWarrantyCertificatePayload(
  customerId: string,
  localDb?: Database
): Promise<WarrantyCertificatePayload> {
  const id = String(customerId || "").trim();
  if (!id) throw new WarrantyCertificateDbError("customerId is required.", 400);

  const warranties = await loadCustomerWarranties(id, localDb);
  if (!warranties.length) {
    throw new WarrantyCertificateDbError("No warranty records for this customer.", 404);
  }

  const delivery = await loadLatestDelivery(id, localDb);
  const customer = await loadCustomerBasics(id, localDb);
  const byType = Object.fromEntries(warranties.map((w) => [w.componentType, w]));
  const issueDate = new Date().toISOString().slice(0, 10);

  const installationDate =
    delivery?.installation_completed_date ||
    delivery?.warranty_start_date ||
    warranties.map((w) => w.startDate).filter(Boolean).sort()[0] ||
    "—";

  const siteAddress =
    delivery?.installation_address ||
    customer.address ||
    "—";

  return {
    documentId: buildWarrantyCertificateDocumentId(id),
    issueDate,
    customerName: customer.name,
    siteAddress,
    projectId: delivery?.project_id || warranties.find((w) => w.projectId)?.projectId || null,
    deliveryId: delivery?.id || null,
    installationDate: String(installationDate).slice(0, 10),
    components: buildCertificateComponentRows(byType),
  };
}

export async function compileWarrantyCertificateHtmlForCustomer(
  customerId: string,
  localDb?: Database
): Promise<string> {
  const payload = await buildWarrantyCertificatePayload(customerId, localDb);
  const branding = await getCompanyBranding(localDb);
  return compileWarrantyCertificatePDFHtml(payload, branding);
}

export async function maybeSyncWarrantyCertificateDocument(customerId: string, localDb?: Database) {
  const id = String(customerId || "").trim();
  if (!id) return null;
  try {
    const warranties = await loadCustomerWarranties(id, localDb);
    if (!warranties.length) return null;
    const documentId = buildWarrantyCertificateDocumentId(id);
    return await syncWarrantyCertificateDocumentVault({ customerId: id, documentId }, localDb);
  } catch (err: any) {
    console.error("[WarrantyCertificate] document sync failed", id, err?.message || err);
    return null;
  }
}

export async function fetchAdminWarrantyCertificateHtml(
  staffUserId: string,
  staffUsername: string,
  customerId: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const id = String(customerId || "").trim();
  if (!id) throw new StaffPortalAuthError("customerId is required.");
  await maybeSyncWarrantyCertificateDocument(id, localDb);
  return compileWarrantyCertificateHtmlForCustomer(id, localDb);
}

export async function fetchPortalWarrantyCertificateHtml(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerPortalAuthError("Customer not linked.", 403);
  await maybeSyncWarrantyCertificateDocument(customerId, localDb);
  return compileWarrantyCertificateHtmlForCustomer(customerId, localDb);
}
