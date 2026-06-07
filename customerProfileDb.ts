import {
  getSupabase,
  isSupabaseActive,
  verifyStaffPortalUser,
  verifyCustomerPortalUser,
  type Database,
} from "./dbManager";
import { mapCustomerSystemRow, mapDocumentRow, type CustomerSystemProfile } from "./src/lib/clientPortalPhase2";
import { canManageCustomers, isSuperAdmin } from "./src/lib/roles";

export class CustomerProfileError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function assertCustomerAdmin(
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
    return (data || []).map(mapDocumentRow);
  }
  return (localDb?.customerDocuments || [])
    .filter((d: any) => (d.customerId || d.customer_id) === customerId)
    .map((d: any) => mapDocumentRow(d));
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
  },
  localDb?: Database
) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const customerId = String(body.customerId || "").trim();
  if (!customerId || !body.fileUrl) {
    throw new CustomerProfileError("customerId and fileUrl required.");
  }

  const internalOnly = !!body.internalOnly;
  const visibleToCustomer = body.visibleToCustomer !== false && !internalOnly;

  const doc = {
    id: `doc-${Date.now()}`,
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
    if (error) throw error;
    return mapDocumentRow(data);
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
  return mapDocumentRow(doc);
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
}

export async function uploadFileToCustomerStorage(
  customerId: string,
  base64Data: string,
  fileName: string,
  mimeType?: string
): Promise<{ url: string; storagePath: string }> {
  const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  let buffer: Buffer;
  let contentType = mimeType || "application/octet-stream";
  if (matches) {
    contentType = matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else {
    buffer = Buffer.from(base64Data, "base64");
  }

  assertCustomerDocumentUpload(fileName, buffer, contentType);

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${customerId}/${Date.now()}_${safeName}`;

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
