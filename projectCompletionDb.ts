import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  verifyTechnicalStaffUser,
  verifyCustomerPortalUser,
  StaffPortalAuthError,
  TechnicalStaffAuthError,
  CustomerPortalAuthError,
} from "./dbManager.js";
import {
  COMPLETION_STAGES,
  canAdvanceToStage,
  canMarkProjectCompleted,
  getMissingCompletionMedia,
  getMissingCompletionSerials,
  mediaLabel,
  requiredMediaTypes,
  type CompletionMediaType,
} from "./src/lib/projectCompletion.ts";
import { mapCustomerSystemRow, mapWarrantyRow } from "./src/lib/clientPortalPhase2.ts";
import { getCompanyBranding } from "./brandingDb.js";
import { compileWarrantyHandoverPDFHtml } from "./warrantyHandoverPdf.js";
import {
  provisionWarrantiesOnProjectCompletion,
  syncWarrantySerialFromCompletionMedia,
} from "./warrantyProvisionDb.js";

export class ProjectCompletionDbError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isCompletionTableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "42P01" || msg.includes("project_completion_media");
}

function mapMediaRow(row: any) {
  return {
    id: row.id,
    deliveryId: row.delivery_id || row.deliveryId,
    customerId: row.customer_id || row.customerId,
    mediaType: row.media_type || row.mediaType,
    fileUrl: row.file_url || row.fileUrl,
    storagePath: row.storage_path || row.storagePath,
    mimeType: row.mime_type || row.mimeType,
    serialNumber: row.serial_number || row.serialNumber || null,
    notes: row.notes || null,
    uploadedBy: row.uploaded_by || row.uploadedBy,
    createdAt: row.created_at || row.createdAt,
  };
}

async function loadDeliveryRow(deliveryId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("project_deliveries")
      .select("*")
      .eq("id", deliveryId)
      .single();
    if (error || !data) throw new ProjectCompletionDbError("Project delivery not found.", 404);
    return data;
  }
  const row = (localDb as any)?.projectDeliveries?.find((d: any) => d.id === deliveryId);
  if (!row) throw new ProjectCompletionDbError("Project delivery not found.", 404);
  return row;
}

async function listMediaForDelivery(deliveryId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    try {
      const { data, error } = await getSupabase()!
        .from("project_completion_media")
        .select("*")
        .eq("delivery_id", deliveryId)
        .order("created_at");
      if (error) throw error;
      return (data || []).map(mapMediaRow);
    } catch (err: any) {
      if (isCompletionTableMissing(err)) return [];
      throw err;
    }
  }
  return ((localDb as any)?.projectCompletionMedia || [])
    .filter((m: any) => (m.delivery_id || m.deliveryId) === deliveryId)
    .map(mapMediaRow);
}

export async function uploadCompletionMediaToStorage(
  deliveryId: string,
  customerId: string,
  base64Data: string,
  fileName: string,
  mimeType?: string
) {
  const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  let buffer: Buffer;
  let contentType = mimeType || "image/jpeg";
  if (matches) {
    contentType = matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else {
    buffer = Buffer.from(base64Data, "base64");
  }
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${customerId}/${deliveryId}/${Date.now()}_${safeName}`;

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const bucket = "project-completion-media";
    try {
      await supabase.storage.createBucket(bucket, { public: true });
    } catch {
      /* exists */
    }
    const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (error) throw new ProjectCompletionDbError(error.message);
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return { url: data.publicUrl, storagePath };
  }

  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(process.cwd(), "public", "uploads", "completion-media", customerId, deliveryId);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, safeName);
  fs.writeFileSync(full, buffer);
  return { url: `/uploads/completion-media/${customerId}/${deliveryId}/${safeName}`, storagePath: full };
}

export async function getCompletionStatusBundle(deliveryId: string, localDb?: Database) {
  const delivery = await loadDeliveryRow(deliveryId, localDb);
  const media = await listMediaForDelivery(deliveryId, localDb);
  const batteryApplicable = delivery.battery_applicable !== false && delivery.batteryApplicable !== false;
  const uploadedTypes = media.map((m) => m.mediaType);
  const missing = getMissingCompletionMedia(uploadedTypes, batteryApplicable);
  const missingSerials = getMissingCompletionSerials(media, batteryApplicable);
  const completionStage = delivery.completion_stage || delivery.completionStage || "Survey";
  return {
    deliveryId,
    customerId: delivery.customer_id || delivery.customerId,
    completionStage,
    batteryApplicable,
    installationDate: delivery.installation_completed_date || delivery.installationCompletedDate || null,
    warrantyStart: delivery.warranty_start_date || delivery.warrantyStartDate || null,
    warrantyEnd: delivery.warranty_end_date || delivery.warrantyEndDate || null,
    media,
    uploadedTypes,
    missing,
    missingSerials,
    missingSerialLabels: missingSerials.map(mediaLabel),
    missingLabels: missing.map(mediaLabel),
    canComplete: canMarkProjectCompleted(uploadedTypes, batteryApplicable, media),
    required: requiredMediaTypes(batteryApplicable).map((key) => ({
      key,
      label: mediaLabel(key),
      uploaded: uploadedTypes.includes(key),
    })),
  };
}

export async function postTechnicalCompletionMedia(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await verifyTechnicalStaffUser(userId, username, localDb);
  const delivery = await loadDeliveryRow(deliveryId, localDb);
  const customerId = String(delivery.customer_id || delivery.customerId);
  const mediaType = String(body.mediaType || body.media_type || "").trim();
  if (!requiredMediaTypes(true).includes(mediaType as CompletionMediaType) && mediaType) {
    const allKeys = [
      "panel_site_photo",
      "panel_serial_photo",
      "inverter_installed_photo",
      "inverter_serial_photo",
      "battery_installed_photo",
      "battery_serial_photo",
      "earth_bore_photo",
      "earthing_connection_photo",
      "complete_site_photo",
      "customer_handover_photo",
    ];
    if (!allKeys.includes(mediaType)) {
      throw new ProjectCompletionDbError("Invalid media type.");
    }
  }

  let fileUrl = String(body.fileUrl || body.file_url || "");
  let storagePath = String(body.storagePath || body.storage_path || "");
  if (body.base64Data) {
    const up = await uploadCompletionMediaToStorage(
      deliveryId,
      customerId,
      String(body.base64Data),
      String(body.fileName || `${mediaType}.jpg`),
      body.mimeType as string | undefined
    );
    fileUrl = up.url;
    storagePath = up.storagePath;
  }
  if (!fileUrl) throw new ProjectCompletionDbError("fileUrl or base64Data required.");

  const id = `pcm-${Date.now()}`;
  const row = {
    id,
    delivery_id: deliveryId,
    customer_id: customerId,
    media_type: mediaType,
    file_url: fileUrl,
    storage_path: storagePath || null,
    mime_type: body.mimeType || body.mime_type || null,
    serial_number: body.serialNumber || body.serial_number || null,
    notes: body.notes || null,
    uploaded_by: username,
    created_at: new Date().toISOString(),
  };

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("project_completion_media")
      .upsert(row, { onConflict: "delivery_id,media_type" })
      .select("*")
      .single();
    if (error) throw error;
    const mapped = mapMediaRow(data);
    const serial = String(body.serialNumber || body.serial_number || "").trim();
    if (serial && mediaType.includes("serial")) {
      await syncWarrantySerialFromCompletionMedia(deliveryId, mediaType, serial, localDb);
    }
    return mapped;
  }

  const db = localDb as any;
  db.projectCompletionMedia = db.projectCompletionMedia || [];
  const idx = db.projectCompletionMedia.findIndex(
    (m: any) => (m.delivery_id || m.deliveryId) === deliveryId && (m.media_type || m.mediaType) === mediaType
  );
  if (idx >= 0) db.projectCompletionMedia[idx] = row;
  else db.projectCompletionMedia.push(row);
  const mapped = mapMediaRow(row);
  const serial = String(body.serialNumber || body.serial_number || "").trim();
  if (serial && mediaType.includes("serial")) {
    await syncWarrantySerialFromCompletionMedia(deliveryId, mediaType, serial, localDb);
  }
  return mapped;
}

export async function patchTechnicalCompletionStage(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await verifyTechnicalStaffUser(userId, username, localDb);
  const target = String(body.completionStage || body.completion_stage || "").trim();
  if (!COMPLETION_STAGES.includes(target as any)) {
    throw new ProjectCompletionDbError("Invalid completion stage.");
  }

  const bundle = await getCompletionStatusBundle(deliveryId, localDb);
  const gate = canAdvanceToStage(target, bundle.uploadedTypes, bundle.batteryApplicable, bundle.media);
  if (!gate.ok) throw new ProjectCompletionDbError(gate.reason || "Missing installation proof.");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    completion_stage: target,
    updated_at: now,
  };

  if (target === "Completed") {
    const today = now.slice(0, 10);
    patch.installation_completed_date = body.installationDate || body.installation_completed_date || today;
    patch.warranty_start_date = body.warrantyStart || body.warranty_start_date || today;
    const start = String(patch.warranty_start_date);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 5);
    patch.warranty_end_date = body.warrantyEnd || body.warranty_end_date || end.toISOString().slice(0, 10);
    patch.delivery_status = "Handover Completed";
  } else if (target === "Customer Handover") {
    patch.delivery_status = "Installation Completed";
  } else if (target === "Installation Started" || target === "Panels Installed") {
    patch.delivery_status = "Installation In Progress";
  }

  if (body.batteryApplicable !== undefined || body.battery_applicable !== undefined) {
    patch.battery_applicable = !!(body.batteryApplicable ?? body.battery_applicable);
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("project_deliveries")
      .update(patch)
      .eq("id", deliveryId)
      .select("*")
      .single();
    if (error) throw error;
    if (target === "Completed") {
      await provisionWarrantiesOnProjectCompletion(deliveryId, localDb);
    }
    return { delivery: data, status: await getCompletionStatusBundle(deliveryId, localDb) };
  }

  const row = await loadDeliveryRow(deliveryId, localDb);
  Object.assign(row, patch);
  if (target === "Completed") {
    await provisionWarrantiesOnProjectCompletion(deliveryId, localDb);
  }
  return { delivery: row, status: await getCompletionStatusBundle(deliveryId, localDb) };
}

/** Block legacy status patch to completed/handover without proof */
export async function assertCompletionProofForHandover(
  deliveryId: string,
  targetStatus: string,
  localDb?: Database
) {
  const completing = ["Installation Completed", "Handover Completed"].includes(targetStatus);
  if (!completing) return;
  const bundle = await getCompletionStatusBundle(deliveryId, localDb);
  if (!bundle.canComplete) {
    throw new TechnicalStaffAuthError(
      `Cannot mark ${targetStatus} until required installation photos and serial numbers are complete. Missing photos: ${bundle.missingLabels.join(", ")}${
        bundle.missingSerialLabels?.length ? `. Missing serials: ${bundle.missingSerialLabels.join(", ")}` : ""
      }`
    );
  }
}

export async function listAdminCompletionGaps(
  staffUserId: string,
  staffUsername: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  let deliveries: any[] = [];
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("project_deliveries")
      .select("id, project_title, customer_id, completion_stage, battery_applicable, delivery_status, assigned_technician_user_id")
      .order("updated_at", { ascending: false });
    if (error) {
      if (isCompletionTableMissing(error)) return { deliveries: [] };
      throw error;
    }
    deliveries = data || [];
  } else {
    deliveries = (localDb as any)?.projectDeliveries || [];
  }

  const out = [];
  for (const d of deliveries) {
    const id = d.id;
    const status = await getCompletionStatusBundle(id, localDb);
    if (status.missing.length > 0 || status.completionStage !== "Completed") {
      out.push({
        deliveryId: id,
        projectTitle: d.project_title || d.projectTitle,
        customerId: d.customer_id || d.customerId,
        completionStage: status.completionStage,
        deliveryStatus: d.delivery_status || d.deliveryStatus,
        missingCount: status.missing.length,
        missing: status.missingLabels,
        canComplete: status.canComplete,
        assignedTechnicianUserId: d.assigned_technician_user_id || d.assignedTechnicianUserId,
      });
    }
  }
  return { deliveries: out };
}

async function buildWarrantyHandoverData(deliveryId: string, localDb?: Database) {
  const delivery = await loadDeliveryRow(deliveryId, localDb);
  const media = await listMediaForDelivery(deliveryId, localDb);
  const customerId = delivery.customer_id || delivery.customerId;

  let customer: any = { name: "Customer", phone: "", address: "" };
  let system: any = null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: cust } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
    if (cust) customer = { name: cust.name, phone: cust.phone, address: cust.address };
    const { data: sys } = await supabase
      .from("customer_systems")
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (sys) system = mapCustomerSystemRow(sys);
    const { data: items } = await supabase
      .from("project_delivery_items")
      .select("*")
      .eq("delivery_id", deliveryId);
    const { data: installed } = await supabase
      .from("project_installed_equipment")
      .select("*")
      .eq("delivery_id", deliveryId);
    return {
      delivery,
      customer,
      system,
      items: items || [],
      installed: installed || [],
      media,
    };
  }

  return {
    delivery,
    customer,
    system: null,
    items: [],
    installed: [],
    media,
  };
}

export async function compileWarrantyHandoverHtmlForDelivery(deliveryId: string, localDb?: Database) {
  const data = await buildWarrantyHandoverData(deliveryId, localDb);
  const branding = await getCompanyBranding(localDb);
  return compileWarrantyHandoverPDFHtml(data, branding);
}

export async function fetchCustomerWarrantyHandoverMe(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerPortalAuthError("Customer not linked.", 403);

  let deliveryId: string | null = null;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("project_deliveries")
      .select("id, completion_stage, warranty_start_date, warranty_end_date, installation_completed_date")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1);
    deliveryId = data?.[0]?.id || null;
  } else {
    const row = (localDb as any)?.projectDeliveries?.find(
      (d: any) => (d.customer_id || d.customerId) === customerId
    );
    deliveryId = row?.id || null;
  }

  if (!deliveryId) {
    return { customerId, handover: null, warranties: [], media: [] };
  }

  const status = await getCompletionStatusBundle(deliveryId, localDb);
  const delivery = await loadDeliveryRow(deliveryId, localDb);

  let warranties: any[] = [];
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customer_warranties")
      .select("*")
      .eq("customer_id", customerId);
    warranties = (data || []).map(mapWarrantyRow);
  } else {
    warranties = ((localDb as any)?.customerWarranties || [])
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

  return {
    customerId,
    deliveryId,
    handover: {
      completionStage: status.completionStage,
      installationDate: delivery.installation_completed_date || delivery.installationCompletedDate,
      warrantyStart: delivery.warranty_start_date || delivery.warrantyStartDate,
      warrantyEnd: delivery.warranty_end_date || delivery.warrantyEndDate,
      canDownloadPdf: status.canComplete || status.completionStage === "Completed",
      missing: status.missingLabels,
      required: status.required,
    },
    media: status.media,
    warranties,
  };
}
