import {
  getSupabase,
  isSupabaseActive,
  verifyStaffPortalUser,
  verifyCustomerPortalUser,
  type Database,
} from "./dbManager";
import { mapCustomerSystemRow, mapDocumentRow, type CustomerSystemProfile } from "./src/lib/clientPortalPhase2";
import { canManageCustomers, isSuperAdmin } from "./src/lib/roles";
import {
  assertSafeSupabaseCustomerObjectPath,
  assertValidCustomerId,
  isServerGeneratedCustomerStoragePath,
  resolveSafeCustomerDocsDirectory,
  resolveSafeLocalCustomerDocumentPath,
} from "./src/lib/customerDocumentPath";
import crypto from "crypto";
import fs from "fs";
import path from "path";

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

/** Require a real customer row before any document write I/O. */
export async function assertCustomerRecordExists(
  customerId: string,
  localDb?: Database
): Promise<void> {
  const id = assertValidCustomerId(customerId);
  if (!id) {
    throw new CustomerProfileError("Invalid customerId.", 400);
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customers")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) {
      throw new CustomerProfileError("Customer not found.", 404);
    }
    return;
  }

  const customers = (localDb as any)?.customers || [];
  const found = customers.some((c: any) => String(c.id || c.customerId || "") === id);
  if (!found) {
    throw new CustomerProfileError("Customer not found.", 404);
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
    const out = [];
    for (const row of data || []) {
      const mapped = secureDocumentRecord(mapDocumentRow(row));
      const storagePath = row.storage_path || row.storagePath;
      if (storagePath) {
        const signed = await createCustomerDocumentSignedUrl(String(storagePath), customerId, 300);
        if (signed) {
          out.push({ ...mapped, fileUrl: signed });
          continue;
        }
      }
      out.push(mapped);
    }
    return out;
  }
  return (localDb?.customerDocuments || [])
    .filter((d: any) => (d.customerId || d.customer_id) === customerId)
    .map((d: any) => secureDocumentRecord(mapDocumentRow(d)));
}

/** True if URL looks like a permanent public/static document location. */
export function isPublicDocumentUrl(url: string): boolean {
  const u = String(url || "").trim().toLowerCase();
  if (!u) return false;
  if (u.includes("/storage/v1/object/public/customer-documents/")) return true;
  if (u.startsWith("/uploads/customer-docs/")) return true;
  if (u.includes("/uploads/customer-docs/")) return true;
  return false;
}

/** Rewrite document records to authenticated download paths (no permanent public URLs). */
export function secureDocumentRecord<T extends { id: string; fileUrl?: string | null }>(
  doc: T
): T {
  return {
    ...doc,
    fileUrl: `/api/customer-documents/${doc.id}/download`,
  };
}

export async function getCustomerDocumentById(
  documentId: string,
  localDb?: Database
): Promise<{
  id: string;
  customerId: string;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  storagePath: string | null;
  visibleToCustomer: boolean;
  internalOnly: boolean;
} | null> {
  const id = String(documentId || "").trim();
  if (!id) return null;

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("customer_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const mapped = mapDocumentRow(data);
    return {
      id: mapped.id,
      customerId: String(mapped.customerId || data.customer_id || ""),
      fileUrl: mapped.fileUrl || null,
      fileName: mapped.fileName || null,
      mimeType: mapped.mimeType || null,
      storagePath: data.storage_path || data.storagePath || null,
      visibleToCustomer: !!mapped.visibleToCustomer,
      internalOnly: !!mapped.internalOnly,
    };
  }

  const row = (localDb?.customerDocuments || []).find(
    (d: any) => String(d.id) === id
  );
  if (!row) return null;
  const mapped = mapDocumentRow(row);
  return {
    id: mapped.id,
    customerId: String(mapped.customerId || row.customer_id || row.customerId || ""),
    fileUrl: mapped.fileUrl || null,
    fileName: mapped.fileName || null,
    mimeType: mapped.mimeType || null,
    storagePath: row.storage_path || row.storagePath || null,
    visibleToCustomer: !!mapped.visibleToCustomer,
    internalOnly: !!mapped.internalOnly,
  };
}

/**
 * Create a short-lived signed URL for a private Supabase object key.
 * Validates the object path for the given customer; returns null on any failure.
 * Never falls through to local filesystem reads.
 */
export async function createCustomerDocumentSignedUrl(
  storagePath: string,
  customerId: string,
  expiresInSeconds = 300
): Promise<string | null> {
  if (!isSupabaseActive()) return null;
  const safe = assertSafeSupabaseCustomerObjectPath(storagePath, customerId);
  if (!safe) return null;
  const { data, error } = await getSupabase()!
    .storage.from("customer-documents")
    .createSignedUrl(safe, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
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
    /** Ignored from client/admin assignment — only server upload may pass via options. */
    storagePath?: string;
    visibleToCustomer?: boolean;
    internalOnly?: boolean;
    notes?: string;
    projectId?: string;
    uploadedBy?: string;
  },
  localDb?: Database,
  options?: {
    /** Only the server-side upload flow may supply a generated path. */
    serverGeneratedStoragePath?: string | null;
  }
) {
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const customerId = assertValidCustomerId(body.customerId);
  if (!customerId) {
    throw new CustomerProfileError("Invalid customerId.", 400);
  }
  await assertCustomerRecordExists(customerId, localDb);

  const internalOnly = !!body.internalOnly;
  const visibleToCustomer = body.visibleToCustomer !== false && !internalOnly;
  const docId = `doc-${Date.now()}`;
  const downloadPath = `/api/customer-documents/${docId}/download`;

  // Public/admin assignment must never persist an arbitrary client storagePath.
  let storagePath: string | null = null;
  const serverPath = options?.serverGeneratedStoragePath;
  if (serverPath) {
    if (!isServerGeneratedCustomerStoragePath(serverPath, customerId)) {
      throw new CustomerProfileError("Invalid document storage path.", 400);
    }
    storagePath = serverPath;
  }

  const doc = {
    id: docId,
    customer_id: customerId,
    project_id: body.projectId || null,
    document_type: body.documentType,
    title: body.title || body.documentType,
    // Persist authenticated download path — never a permanent public URL.
    file_url: body.fileUrl && !isPublicDocumentUrl(body.fileUrl) ? body.fileUrl : downloadPath,
    file_name: body.fileName || null,
    mime_type: body.mimeType || null,
    storage_path: storagePath,
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

/** Build a unique filename shared by local disk and Supabase object keys. */
export function buildUniqueCustomerDocumentFileName(originalFileName: string): string {
  const safeName = String(originalFileName || "document").replace(/[^a-zA-Z0-9._-]/g, "_");
  const extMatch = safeName.match(/(\.[a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  const truncatedBase = (base || "document").slice(0, 80);
  return `${Date.now()}_${crypto.randomBytes(8).toString("hex")}_${truncatedBase}${ext}`;
}

/**
 * Remove a just-uploaded local file or Supabase object. Fail soft (best effort).
 * Used when DB assignment fails after storage write.
 */
export async function removeUploadedCustomerDocument(
  storagePath: string,
  customerId: string,
  options?: { cwd?: string; bucket?: string | null }
): Promise<void> {
  const cust = assertValidCustomerId(customerId);
  if (!cust) return;
  const key = assertSafeSupabaseCustomerObjectPath(storagePath, cust);
  const abs = resolveSafeLocalCustomerDocumentPath(
    storagePath,
    cust,
    options?.cwd || process.cwd()
  );

  if (isSupabaseActive() && key) {
    try {
      await getSupabase()!
        .storage.from(options?.bucket || "customer-documents")
        .remove([key]);
    } catch {
      /* best-effort cleanup */
    }
    return;
  }

  if (abs && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Low-level storage write. Caller MUST authorize and validate customer existence first
 * for admin document management. Still validates customerId and path containment.
 */
export async function uploadFileToCustomerStorage(
  customerId: string,
  base64Data: string,
  fileName: string,
  mimeType?: string,
  options?: { cwd?: string }
): Promise<{ url: string; storagePath: string; bucket?: string | null }> {
  const cust = assertValidCustomerId(customerId);
  if (!cust) {
    throw new CustomerProfileError("Invalid customerId.", 400);
  }

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

  const uniqueName = buildUniqueCustomerDocumentFileName(fileName);
  const storagePath = `${cust}/${uniqueName}`;
  if (!assertSafeSupabaseCustomerObjectPath(storagePath, cust)) {
    throw new CustomerProfileError("Invalid document storage path.", 400);
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const bucket = "customer-documents";
    try {
      await supabase.storage.createBucket(bucket, { public: false });
    } catch {
      /* exists — try to ensure private */
      try {
        await supabase.storage.updateBucket(bucket, { public: false });
      } catch {
        /* best-effort hardening */
      }
    }
    // Never overwrite an existing object with the same key.
    const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });
    if (error) throw new CustomerProfileError(error.message);
    // Never return permanent public URLs. Callers store an authenticated download path.
    return {
      url: "",
      storagePath,
      bucket,
    };
  }

  const cwd = options?.cwd || process.cwd();
  const uploadsDir = resolveSafeCustomerDocsDirectory(cust, cwd);
  if (!uploadsDir) {
    throw new CustomerProfileError("Invalid customer document directory.", 400);
  }
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fullPath = path.resolve(uploadsDir, uniqueName);
  if (!fullPath.startsWith(uploadsDir + path.sep)) {
    throw new CustomerProfileError("Invalid customer document path.", 400);
  }
  // Do not overwrite an existing file (including same original user filename).
  if (fs.existsSync(fullPath)) {
    throw new CustomerProfileError("Document file already exists.", 409);
  }
  fs.writeFileSync(fullPath, buffer);
  // Persist the same relative object key as Supabase for consistent download resolution.
  return { url: "", storagePath, bucket: null };
}

/**
 * Authorized admin customer-document upload:
 * authorize → validate customerId → confirm customer exists → storage write → DB assign.
 * On assign failure, removes the newly uploaded local file / Supabase object.
 */
export async function uploadAndAssignAdminCustomerDocument(
  actorId: string,
  actorUsername: string,
  actorRole: string,
  body: {
    customerId: string;
    base64Data: string;
    fileName?: string;
    mimeType?: string;
    documentType?: string;
    title?: string;
    visibleToCustomer?: boolean;
    internalOnly?: boolean;
    notes?: string;
  },
  localDb?: Database,
  options?: { cwd?: string }
) {
  // Authorization and customer existence MUST run before any storage I/O.
  await assertCustomerAdmin(actorId, actorUsername, actorRole, localDb);
  const customerId = assertValidCustomerId(body.customerId);
  if (!customerId) {
    throw new CustomerProfileError("Invalid customerId.", 400);
  }
  await assertCustomerRecordExists(customerId, localDb);

  let uploaded: { storagePath: string; bucket?: string | null } | null = null;
  try {
    uploaded = await uploadFileToCustomerStorage(
      customerId,
      String(body.base64Data || ""),
      String(body.fileName || "document"),
      body.mimeType,
      { cwd: options?.cwd }
    );

    const doc = await assignCustomerDocument(
      actorId,
      actorUsername,
      actorRole,
      {
        customerId,
        documentType: body.documentType || "other",
        title: body.title || body.fileName || "document",
        fileUrl: `/api/customer-documents/pending/download`,
        fileName: body.fileName,
        mimeType: body.mimeType,
        visibleToCustomer: body.visibleToCustomer !== false,
        internalOnly: !!body.internalOnly,
        notes: body.notes,
        uploadedBy: actorUsername,
      },
      localDb,
      { serverGeneratedStoragePath: uploaded.storagePath }
    );

    return {
      ...doc,
      fileUrl: `/api/customer-documents/${(doc as any).id}/download`,
      storagePath: uploaded.storagePath,
    };
  } catch (err) {
    if (uploaded?.storagePath) {
      await removeUploadedCustomerDocument(uploaded.storagePath, customerId, {
        cwd: options?.cwd,
        bucket: uploaded.bucket,
      });
    }
    throw err;
  }
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
