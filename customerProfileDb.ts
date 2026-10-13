import {
  getSupabase,
  isSupabaseActive,
  verifyStaffPortalUser,
  verifyCustomerPortalUser,
  type Database,
} from "./dbManager";
import { DOCUMENT_WALLET_TYPES, mapCustomerSystemRow, mapDocumentRow, type CustomerSystemProfile } from "./src/lib/clientPortalPhase2";
import { canManageCustomers, isSuperAdmin } from "./src/lib/roles";
import { randomUUID } from "node:crypto";
import { generateCustomerCode } from "./customerCode";
import {
  buildRailwayObjectProxyUrl,
  isRailwayObjectStorageConfigured,
  isStoragePathForCustomer,
  putRailwayObject,
  rewriteLegacyStorageUrl,
} from "./server/storage/railwayObjectStorage.ts";

export class CustomerProfileError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mapCustomerDocumentForResponse(row: any) {
  return mapDocumentRow({
    ...row,
    file_url: rewriteLegacyStorageUrl(
      row?.file_url ?? row?.fileUrl,
      row?.storage_path ?? row?.storagePath,
    ),
  });
}

export async function assertCustomerAdmin(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(actorId, actorUsername, localDb);
  if (!canManageCustomers(actorUsername, actorRole) && !isSuperAdmin(actorUsername, actorRole)) {
    throw new CustomerProfileError("Admin access required for customer profiles.", 403);
  }
}

export async function listCustomerPortalAccounts(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  localDb?: Database
) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: users, error } = await supabase
      .from("users")
      .select("id, username, name, email, role, customer_id, account_status")
      .eq("role", "Customer")
      .order("name");
    if (error) throw error;
    const customerIds = (users || []).map((u: any) => u.customer_id).filter(Boolean);
    let customers: any[] = [];
    if (customerIds.length) {
      const { data: custRows } = await supabase.from("customers").select("*").in("id", customerIds);
      customers = custRows || [];
    }
    return (users || []).map((u: any) => {
      const c = customers.find((x: any) => x.id === u.customer_id);
      return {
        userId: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        customerId: u.customer_id,
        customerCode: c?.customer_code || null,
        accountStatus: u.account_status,
        phone: c?.phone || null,
      };
    });
  }
  return (localDb?.users || [])
    .filter((u: any) => u.role === "Customer")
    .map((u: any) => ({
      userId: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      customerId: u.customer_id || u.customerId,
      accountStatus: u.account_status || "Approved",
      phone: null,
    }));
}

export async function getCustomerSystemProfile(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  customerId: string,
  localDb?: Database
): Promise<CustomerSystemProfile | null> {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const id = String(customerId || "").trim();
  if (!id) throw new CustomerProfileError("customerId required.");

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customer_systems")
      .select("*")
      .eq("customer_id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCustomerSystemRow(data) : { customerId: id };
  }
  const row = (localDb as any)?.customerSystems?.find((s: any) => s.customer_id === id || s.customerId === id);
  return row ? mapCustomerSystemRow(row) : { customerId: id };
}

export async function upsertCustomerSystemProfile(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const customerId = String(body.customerId || body.customer_id || "").trim();
  if (!customerId) throw new CustomerProfileError("customerId required.");

  const row = {
    customer_id: customerId,
    system_size_kw: body.systemSizeKw ?? body.system_size_kw ?? null,
    system_type: body.systemType || body.system_type || null,
    panel_brand: body.panelBrand || body.panel_brand || null,
    panel_wattage: body.panelWattage ?? body.panel_wattage ?? null,
    panel_quantity: body.panelQuantity ?? body.panel_quantity ?? null,
    inverter_brand: body.inverterBrand || body.inverter_brand || null,
    inverter_size_kw: body.inverterSizeKw ?? body.inverter_size_kw ?? null,
    battery_brand: body.batteryBrand || body.battery_brand || null,
    battery_capacity_kwh: body.batteryCapacityKwh ?? body.battery_capacity_kwh ?? null,
    structure_type: body.structureType || body.structure_type || null,
    installation_date: body.installationDate || body.installation_date || null,
    warranty_start: body.warrantyStart || body.warranty_start || null,
    warranty_end: body.warrantyEnd || body.warranty_end || null,
    net_metering_status: body.netMeteringStatus || body.net_metering_status || null,
    meter_number: body.meterNumber || body.meter_number || null,
    consumer_number: body.consumerNumber || body.consumer_number || null,
    sanctioned_load_kw: body.sanctionedLoadKw ?? body.sanctioned_load_kw ?? null,
    site_address: body.siteAddress || body.site_address || null,
    notes: body.notes || null,
    updated_at: new Date().toISOString(),
    updated_by: actorUsername,
  };

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customer_systems")
      .upsert(row, { onConflict: "customer_id" })
      .select("*")
      .single();
    if (error) throw error;
    return mapCustomerSystemRow(data);
  }
  const db = localDb as any;
  db.customerSystems = db.customerSystems || [];
  const idx = db.customerSystems.findIndex((s: any) => s.customer_id === customerId);
  if (idx >= 0) db.customerSystems[idx] = row;
  else db.customerSystems.push(row);
  return mapCustomerSystemRow(row);
}

export async function listAdminCustomerDocuments(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  customerId: string,
  localDb?: Database
) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customer_documents")
      .select("*")
      .eq("customer_id", customerId)
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapCustomerDocumentForResponse);
  }
  return (localDb?.customerDocuments || [])
    .filter((d: any) => (d.customerId || d.customer_id) === customerId)
    .map((d: any) => mapDocumentRow(d));
}

/** Prepare a document wallet for an existing CRM lead without creating a login. */
export async function prepareLeadCustomerProfile(actorId: string, actorUsername: string, actorRole: string, leadId: string, localDb?: Database) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const client = isSupabaseActive() ? getSupabase()! : null;
  let lead: any;
  if (client) {
    const { data, error } = await client.from("leads").select("id,customer_id,name,email,phone,address,deleted_at").eq("id", leadId).maybeSingle();
    if (error) throw error;
    lead = data;
  } else lead = localDb?.leads.find(l => l.id === leadId);
  if (!lead || lead.deleted_at || lead.deletedAt) throw new CustomerProfileError("Lead not found.", 404);
  const existing = lead.customer_id || lead.customerId;
  if (existing) return { customerId: existing };
  const customerId = `cust-${leadId.replace(/^lead-/, "")}`;
  const row = { id: customerId, name: lead.name, email: lead.email || "", phone: lead.phone || "", address: lead.address || "", customer_code: await generateCustomerCode(localDb) };
  if (client) {
    const { error } = await client.from("customers").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    const { error: linkError } = await client.from("leads").update({ customer_id: customerId }).eq("id", leadId).is("customer_id", null).is("deleted_at", null);
    if (linkError) throw linkError;
    const { data, error: readError } = await client.from("leads").select("customer_id").eq("id", leadId).single();
    if (readError || !data?.customer_id) throw readError || new Error("Could not link client profile.");
    return { customerId: data.customer_id };
  }
  const local = localDb as any;
  local.customers ||= [];
  if (!local.customers.some((c: any) => c.id === customerId)) local.customers.push(row);
  lead.customerId = customerId;
  return { customerId };
}

async function findCustomerDocument(id: string, localDb?: Database): Promise<any | null> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from("customer_documents").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }
  return (localDb?.customerDocuments || []).find((d: any) => d.id === id) || null;
}

export async function assignCustomerDocument(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  body: {
    customerId: string;
    documentType: string;
    title: string;
    fileUrl: string;
    fileName?: string;
    mimeType?: string;
    storagePath?: string;
    visibleToCustomer?: boolean;
    internalOnly?: boolean;
    notes?: string;
    projectId?: string;
    uploadedBy?: string;
    documentId?: string;
  },
  localDb?: Database
) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const customerId = String(body.customerId || "").trim();
  if (!customerId || !body.fileUrl) {
    throw new CustomerProfileError("customerId and fileUrl required.");
  }
  // With bucket storage the path is an object key: it must be this client's own folder or a Smart Quote archive.
  if (body.storagePath && isRailwayObjectStorageConfigured() && !isStoragePathForCustomer(customerId, String(body.storagePath))) {
    throw new CustomerProfileError("storagePath does not belong to this client.", 422);
  }
  const documentId = body.documentId || `doc-${randomUUID()}`;
  const existing = await findCustomerDocument(documentId, localDb);
  if (existing) {
    // A retried upload: return the saved row, never a copy or another customer's document.
    if ((existing.customer_id ?? existing.customerId) !== customerId) throw new CustomerProfileError("Upload id belongs to another client.", 409);
    return mapCustomerDocumentForResponse(existing);
  }

  const internalOnly = !!body.internalOnly;
  const visibleToCustomer = body.visibleToCustomer !== false && !internalOnly;

  const doc = {
    id: documentId,
    customer_id: customerId,
    project_id: body.projectId || null,
    document_type: body.documentType,
    title: body.title || body.documentType,
    file_url: body.fileUrl,
    file_name: body.fileName || null,
    mime_type: body.mimeType || null,
    storage_path: body.storagePath || null,
    visible_to_customer: visibleToCustomer,
    internal_only: internalOnly,
    notes: body.notes || null,
    uploaded_by: body.uploadedBy || actorUsername,
    uploaded_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customer_documents")
      .insert(doc)
      .select("*")
      .single();
    if (error) {
      // Two requests with one clientUploadId raced past the lookup above: the loser returns the saved row.
      if ((error as { code?: string }).code === "23505") {
        const saved = await findCustomerDocument(documentId, localDb);
        if (saved) {
          if ((saved.customer_id ?? saved.customerId) !== customerId) throw new CustomerProfileError("Upload id belongs to another client.", 409);
          return mapCustomerDocumentForResponse(saved);
        }
      }
      throw error;
    }
    return mapCustomerDocumentForResponse(data);
  }

  localDb!.customerDocuments = localDb!.customerDocuments || [];
  localDb!.customerDocuments.unshift({
    ...doc,
    customerId: doc.customer_id,
    documentType: doc.document_type,
    fileUrl: doc.file_url,
    visibleToCustomer: doc.visible_to_customer,
    internalOnly: doc.internal_only,
  });
  return mapCustomerDocumentForResponse(doc);
}

const CUSTOMER_DOC_MAX_BYTES = 25 * 1024 * 1024;
const CUSTOMER_DOC_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function assertCustomerDocumentUpload(fileName: string, buffer: Buffer, contentType: string) {
  if (buffer.length > CUSTOMER_DOC_MAX_BYTES) {
    throw new CustomerProfileError("File exceeds the 25 MB limit.", 422);
  }
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const extOk = ["pdf", "jpg", "jpeg", "png", "docx"].includes(ext);
  const mimeOk = CUSTOMER_DOC_ALLOWED_MIME.has(contentType);
  if (!extOk || !mimeOk) {
    throw new CustomerProfileError("Only PDF, JPG, PNG, and DOCX files are allowed.", 422);
  }
  // The name and declared type come from the browser; the bytes must match them too.
  const signatures: Record<string, number[]> = {
    "application/pdf": [0x25, 0x50, 0x44, 0x46],
    "image/png": [0x89, 0x50, 0x4e, 0x47],
    "image/jpeg": [0xff, 0xd8, 0xff],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4b, 0x03, 0x04],
  };
  if (!signatures[contentType].every((byte, index) => buffer[index] === byte)) {
    throw new CustomerProfileError("The file content does not match its type. Upload the original PDF, JPG, PNG or DOCX file.", 422);
  }
}

/**
 * Checked BEFORE any bytes are written to storage, so an unknown client or document type cannot leave an
 * object in the bucket that no database row will ever reference.
 */
export async function assertCustomerUploadTarget(customerId: string, documentType: unknown, localDb?: Database) {
  const id = String(customerId || "").trim();
  if (!id) throw new CustomerProfileError("customerId required.", 400);
  if (!DOCUMENT_WALLET_TYPES.some((entry) => entry.type === documentType)) {
    throw new CustomerProfileError("Unknown document type.", 422);
  }
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from("customers").select("id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw new CustomerProfileError("Client not found.", 404);
  }
  void localDb; // the local JSON fallback has no foreign keys, so it cannot produce orphans
}

export async function uploadFileToCustomerStorage(
  customerId: string,
  base64Data: string,
  fileName: string,
  mimeType?: string,
  options: { objectId?: string } = {}
): Promise<{ url: string; storagePath: string }> {
  if (!/^(?!.*\.\.)[A-Za-z0-9._-]{1,120}$/.test(customerId)) {
    throw new CustomerProfileError("Invalid customer id.", 400);
  }
  const matches = base64Data.match(/^data:([^;]*);base64,(.+)$/);
  let buffer: Buffer;
  let contentType = mimeType || "application/octet-stream";
  if (matches) {
    contentType = mimeType || matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else {
    buffer = Buffer.from(base64Data, "base64");
  }

  assertCustomerDocumentUpload(fileName, buffer, contentType);

  // Keep the tail so the extension survives; the whole bucket key must stay under 1024 characters.
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const storagePath = `${customerId}/${options.objectId || Date.now()}_${safeName}`;

  if (isRailwayObjectStorageConfigured()) {
    await putRailwayObject("customer-documents", storagePath, buffer, contentType);
    return {
      url: buildRailwayObjectProxyUrl("customer-documents", storagePath),
      storagePath,
    };
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const bucket = "customer-documents";
    try {
      await supabase.storage.createBucket(bucket, { public: true });
    } catch {
      /* exists */
    }
    const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw new CustomerProfileError(error.message);
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return { url: data.publicUrl, storagePath };
  }

  const fs = await import("fs");
  const path = await import("path");
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "customer-docs", customerId);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fullPath = path.join(uploadsDir, safeName);
  fs.writeFileSync(fullPath, buffer);
  return { url: `/uploads/customer-docs/${customerId}/${safeName}`, storagePath: fullPath };
}

export async function fetchCustomerPortalSystemMe(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerProfileError("Customer not linked.", 403);

  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customer_systems")
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();
    return { system: data ? mapCustomerSystemRow(data) : { customerId } };
  }
  const row = (localDb as any)?.customerSystems?.find((s: any) => s.customer_id === customerId);
  return { system: row ? mapCustomerSystemRow(row) : { customerId } };
}
