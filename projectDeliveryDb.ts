import {
  isSupabaseActive,
  getSupabase,
  type Database,
  verifyStaffPortalUser,
  verifyTechnicalStaffUser,
  verifyCustomerPortalUser,
  StaffPortalAuthError,
  TechnicalStaffAuthError,
  CustomerPortalAuthError,
} from "./dbManager.js";
import { mapWarrantyRow, type WarrantyComponentType } from "./src/lib/clientPortalPhase2.ts";
import {
  DELIVERY_STATUSES,
  buildCustomerDeliveryProgress,
  defaultWarrantyEndDate,
  warrantyComponentForEquipmentType,
  type ProjectDeliveryRecord,
} from "./src/lib/projectDelivery.ts";
import { assertCompletionProofForHandover } from "./projectCompletionDb.js";
import { provisionWarrantiesOnProjectCompletion } from "./warrantyProvisionDb.js";

export class ProjectDeliveryDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDeliveryDbError";
  }
}

function isPhase10TableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "42P01" ||
    msg.includes("project_deliveries") ||
    msg.includes("project_delivery_items") ||
    msg.includes("project_installed_equipment")
  );
}

function mapDeliveryRow(row: any): ProjectDeliveryRecord {
  return {
    id: row.id,
    customerId: row.customer_id || row.customerId,
    leadId: row.lead_id || row.leadId || null,
    quotationId: row.quotation_id || row.quotationId || null,
    projectTitle: row.project_title || row.projectTitle,
    systemType: row.system_type || row.systemType,
    projectType: row.project_type || row.projectType,
    systemSizeKw: row.system_size_kw != null ? Number(row.system_size_kw) : row.systemSizeKw,
    assignedTechnicianUserId: row.assigned_technician_user_id || row.assignedTechnicianUserId,
    installationAddress: row.installation_address || row.installationAddress,
    expectedInstallationDate: row.expected_installation_date || row.expectedInstallationDate,
    deliveryStatus: row.delivery_status || row.deliveryStatus,
    completionStage: row.completion_stage || row.completionStage || "Survey",
    batteryApplicable: row.battery_applicable !== false && row.batteryApplicable !== false,
    safetyChecklist: row.safety_checklist || row.safetyChecklist || {},
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapItemRow(row: any) {
  return {
    id: row.id,
    deliveryId: row.delivery_id || row.deliveryId,
    itemCategory: row.item_category || row.itemCategory,
    brand: row.brand,
    model: row.model,
    quantity: Number(row.quantity ?? 1),
    wattage: row.wattage,
    capacity: row.capacity,
    notes: row.notes,
    createdAt: row.created_at || row.createdAt,
  };
}

function mapInstalledRow(row: any) {
  return {
    id: row.id,
    deliveryId: row.delivery_id || row.deliveryId,
    customerId: row.customer_id || row.customerId,
    equipmentType: row.equipment_type || row.equipmentType,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number || row.serialNumber,
    capacity: row.capacity,
    quantity: Number(row.quantity ?? 1),
    warrantyStartDate: row.warranty_start_date || row.warrantyStartDate,
    warrantyEndDate: row.warranty_end_date || row.warrantyEndDate,
    photoUrl: row.photo_url || row.photoUrl,
    notes: row.notes,
    syncedEquipmentId: row.synced_equipment_id || row.syncedEquipmentId,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapPhotoRow(row: any) {
  return {
    id: row.id,
    deliveryId: row.delivery_id || row.deliveryId,
    customerId: row.customer_id || row.customerId,
    photoCategory: row.photo_category || row.photoCategory,
    photoUrl: row.photo_url || row.photoUrl,
    caption: row.caption,
    uploadedBy: row.uploaded_by || row.uploadedBy,
    syncedPhotoId: row.synced_photo_id || row.syncedPhotoId,
    createdAt: row.created_at || row.createdAt,
  };
}

async function loadDeliveryBundle(deliveryId: string, localDb?: Database) {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: delivery, error } = await supabase
      .from("project_deliveries")
      .select("*")
      .eq("id", deliveryId)
      .single();
    if (error || !delivery) throw new ProjectDeliveryDbError("Project delivery not found.");
    const [{ data: items }, { data: installed }, { data: photos }] = await Promise.all([
      supabase.from("project_delivery_items").select("*").eq("delivery_id", deliveryId),
      supabase.from("project_installed_equipment").select("*").eq("delivery_id", deliveryId),
      supabase.from("project_installation_photos").select("*").eq("delivery_id", deliveryId),
    ]);
    return {
      delivery: mapDeliveryRow(delivery),
      items: (items || []).map(mapItemRow),
      installedEquipment: (installed || []).map(mapInstalledRow),
      photos: (photos || []).map(mapPhotoRow),
    };
  }
  const d = (localDb?.projectDeliveries || []).find((x: any) => x.id === deliveryId);
  if (!d) throw new ProjectDeliveryDbError("Project delivery not found.");
  return {
    delivery: mapDeliveryRow(d),
    items: (localDb?.projectDeliveryItems || []).filter((i: any) => i.deliveryId === deliveryId).map(mapItemRow),
    installedEquipment: (localDb?.projectInstalledEquipment || [])
      .filter((i: any) => i.deliveryId === deliveryId)
      .map(mapInstalledRow),
    photos: (localDb?.projectInstallationPhotos || [])
      .filter((p: any) => p.deliveryId === deliveryId)
      .map(mapPhotoRow),
  };
}

export async function listAdminProjectDeliveries(
  staffUserId: string,
  staffUsername: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_deliveries")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      if (isPhase10TableMissing(error)) throw new StaffPortalAuthError("Project delivery tables not ready.");
      throw error;
    }
    return (data || []).map(mapDeliveryRow);
  }
  return (localDb?.projectDeliveries || []).map(mapDeliveryRow);
}

export async function createAdminProjectDelivery(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const customerId = String(body.customerId || body.customer_id || "").trim();
  const projectTitle = String(body.projectTitle || body.project_title || "").trim();
  if (!customerId || !projectTitle) {
    throw new StaffPortalAuthError("customerId and projectTitle are required.");
  }
  const id = `pd-${Date.now()}`;
  const now = new Date().toISOString();
  const row = {
    id,
    customer_id: customerId,
    lead_id: body.leadId || body.lead_id || null,
    quotation_id: body.quotationId || body.quotation_id || null,
    project_title: projectTitle,
    system_type: body.systemType || body.system_type || "On-grid",
    project_type: body.projectType || body.project_type || "Residential",
    system_size_kw: body.systemSizeKw != null ? Number(body.systemSizeKw) : body.system_size_kw != null ? Number(body.system_size_kw) : null,
    assigned_technician_user_id: body.assignedTechnicianUserId || body.assigned_technician_user_id || null,
    installation_address: body.installationAddress || body.installation_address || null,
    expected_installation_date: body.expectedInstallationDate || body.expected_installation_date || null,
    delivery_status: body.deliveryStatus || body.delivery_status || "Order Confirmed",
    safety_checklist: body.safetyChecklist || body.safety_checklist || {},
    created_at: now,
    updated_at: now,
  };
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("project_deliveries").insert(row).select("*").single();
    if (error) {
      if (isPhase10TableMissing(error)) throw new StaffPortalAuthError("Project delivery tables not ready.");
      throw error;
    }
    return mapDeliveryRow(data);
  }
  localDb!.projectDeliveries = localDb!.projectDeliveries || [];
  localDb!.projectDeliveries.unshift(row);
  return mapDeliveryRow(row);
}

export async function patchAdminProjectDelivery(
  staffUserId: string,
  staffUsername: string,
  deliveryId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  const fields: [string, string][] = [
    ["projectTitle", "project_title"],
    ["project_title", "project_title"],
    ["systemType", "system_type"],
    ["system_type", "system_type"],
    ["projectType", "project_type"],
    ["project_type", "project_type"],
    ["systemSizeKw", "system_size_kw"],
    ["system_size_kw", "system_size_kw"],
    ["assignedTechnicianUserId", "assigned_technician_user_id"],
    ["assigned_technician_user_id", "assigned_technician_user_id"],
    ["installationAddress", "installation_address"],
    ["installation_address", "installation_address"],
    ["expectedInstallationDate", "expected_installation_date"],
    ["expected_installation_date", "expected_installation_date"],
    ["deliveryStatus", "delivery_status"],
    ["delivery_status", "delivery_status"],
    ["leadId", "lead_id"],
    ["quotationId", "quotation_id"],
  ];
  for (const [a, b] of fields) {
    if (body[a] !== undefined) patch[b] = body[a];
  }
  if (patch.delivery_status && !DELIVERY_STATUSES.includes(patch.delivery_status as any)) {
    throw new StaffPortalAuthError("Invalid delivery status.");
  }

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_deliveries")
      .update(patch)
      .eq("id", deliveryId)
      .select("*")
      .single();
    if (error || !data) throw new StaffPortalAuthError("Project delivery not found.");
    return mapDeliveryRow(data);
  }
  const row = (localDb!.projectDeliveries || []).find((d: any) => d.id === deliveryId);
  if (!row) throw new StaffPortalAuthError("Project delivery not found.");
  Object.assign(row, patch);
  return mapDeliveryRow(row);
}

export async function addAdminProjectDeliveryItems(
  staffUserId: string,
  staffUsername: string,
  deliveryId: string,
  body: { items?: unknown[] },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) throw new StaffPortalAuthError("items array is required.");
  const now = new Date().toISOString();
  const rows = items.map((raw: any, idx: number) => ({
    id: `pdi-${Date.now()}-${idx}`,
    delivery_id: deliveryId,
    item_category: raw.itemCategory || raw.item_category || raw.category || "Other accessories",
    brand: raw.brand || null,
    model: raw.model || null,
    quantity: Number(raw.quantity ?? 1),
    wattage: raw.wattage || null,
    capacity: raw.capacity || null,
    notes: raw.notes || null,
    created_at: now,
  }));

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("project_delivery_items").insert(rows).select("*");
    if (error) {
      if (isPhase10TableMissing(error)) throw new StaffPortalAuthError("Project delivery items table not ready.");
      throw error;
    }
    return (data || []).map(mapItemRow);
  }
  localDb!.projectDeliveryItems = localDb!.projectDeliveryItems || [];
  localDb!.projectDeliveryItems.push(...rows);
  return rows.map(mapItemRow);
}

export async function listTechnicalProjectDeliveriesForUser(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { user } = await verifyTechnicalStaffUser(userId, username, localDb);
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_deliveries")
      .select("*")
      .eq("assigned_technician_user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) {
      if (isPhase10TableMissing(error)) throw new TechnicalStaffAuthError("Project delivery tables not ready.");
      throw error;
    }
    return (data || []).map(mapDeliveryRow);
  }
  return (localDb?.projectDeliveries || [])
    .filter((d: any) => (d.assigned_technician_user_id || d.assignedTechnicianUserId) === user.id)
    .map(mapDeliveryRow);
}

export async function getTechnicalProjectDeliveryById(
  userId: string,
  username: string,
  deliveryId: string,
  localDb?: Database
) {
  const { user } = await verifyTechnicalStaffUser(userId, username, localDb);
  const bundle = await loadDeliveryBundle(deliveryId, localDb);
  if (
    bundle.delivery.assignedTechnicianUserId &&
    bundle.delivery.assignedTechnicianUserId !== user.id
  ) {
    throw new TechnicalStaffAuthError("Delivery not assigned to you.");
  }
  return bundle;
}

async function syncInstalledToCustomerEquipment(
  customerId: string,
  installed: ReturnType<typeof mapInstalledRow>,
  localDb?: Database
) {
  const eqId = `eq-pd-${installed.id}`;
  const now = new Date().toISOString();
  const row = {
    id: eqId,
    customer_id: customerId,
    project_id: null,
    equipment_type: installed.equipmentType,
    brand: installed.brand,
    model: installed.model,
    serial_number: installed.serialNumber,
    quantity: installed.quantity,
    installation_date: installed.warrantyStartDate || now.slice(0, 10),
    warranty_start: installed.warrantyStartDate,
    warranty_end: installed.warrantyEndDate,
    photo_url: installed.photoUrl,
    notes: installed.notes,
    created_at: now,
    updated_at: now,
  };
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    await supabase.from("customer_equipment").upsert(row, { onConflict: "id" });
  } else {
    localDb!.customerEquipment = localDb!.customerEquipment || [];
    const idx = localDb!.customerEquipment.findIndex((e: any) => e.id === eqId);
    if (idx >= 0) localDb!.customerEquipment[idx] = row;
    else localDb!.customerEquipment.push(row);
  }
  return eqId;
}

async function syncPhotoToInstallationPhotos(
  customerId: string,
  photo: { photoCategory: string; photoUrl: string; caption?: string; uploadedBy: string },
  localDb?: Database
) {
  const photoId = `inst-pd-${Date.now()}`;
  const now = new Date().toISOString();
  const row = {
    id: photoId,
    customer_id: customerId,
    project_id: null,
    photo_category: photo.photoCategory.toLowerCase().replace(/\s+/g, "_"),
    photo_url: photo.photoUrl,
    caption: photo.caption || photo.photoCategory,
    uploaded_by: photo.uploadedBy,
    created_at: now,
  };
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    await supabase.from("installation_photos").insert(row);
  } else {
    localDb!.installationPhotos = localDb!.installationPhotos || [];
    localDb!.installationPhotos.unshift(row);
  }
  return photoId;
}

async function autoWarrantyFromInstalled(
  customerId: string,
  installed: ReturnType<typeof mapInstalledRow>,
  localDb?: Database
) {
  const component = warrantyComponentForEquipmentType(installed.equipmentType);
  if (!component) return null;
  const start = installed.warrantyStartDate || new Date().toISOString().slice(0, 10);
  const end =
    installed.warrantyEndDate || defaultWarrantyEndDate(component as WarrantyComponentType, start);
  const row = {
    id: `cw-${component}-${customerId}`,
    customer_id: customerId,
    project_id: null,
    component_type: component,
    brand: installed.brand || null,
    model: installed.model || null,
    serial_number: installed.serialNumber || null,
    start_date: start,
    end_date: end,
    updated_at: new Date().toISOString(),
  };
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("customer_warranties")
      .upsert(row, { onConflict: "customer_id,component_type" })
      .select("*")
      .single();
    if (error) {
      const { data: data2, error: error2 } = await supabase
        .from("customer_warranties")
        .upsert({ ...row, id: `cw-pd-${Date.now()}` })
        .select("*")
        .single();
      if (error2) return null;
      return mapWarrantyRow(data2);
    }
    return mapWarrantyRow(data);
  }
  localDb!.customerWarranties = localDb!.customerWarranties || [];
  const idx = localDb!.customerWarranties.findIndex(
    (w: any) =>
      (w.customerId || w.customer_id) === customerId &&
      (w.componentType || w.component_type) === component
  );
  const mapped = {
    id: row.id,
    customerId,
    componentType: component,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serial_number,
    startDate: row.start_date,
    endDate: row.end_date,
  };
  if (idx >= 0) localDb!.customerWarranties[idx] = mapped;
  else localDb!.customerWarranties.push(mapped);
  return mapWarrantyRow({
    id: mapped.id,
    customer_id: customerId,
    component_type: component,
    brand: mapped.brand,
    model: mapped.model,
    serial_number: mapped.serialNumber,
    start_date: mapped.startDate,
    end_date: mapped.endDate,
  });
}

export async function postTechnicalInstalledEquipment(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  const { user } = await verifyTechnicalStaffUser(userId, username, localDb);
  const bundle = await getTechnicalProjectDeliveryById(userId, username, deliveryId, localDb);
  const customerId = bundle.delivery.customerId;
  const id = `pie-${Date.now()}`;
  const now = new Date().toISOString();
  const equipmentType = String(body.equipmentType || body.equipment_type || "").trim();
  if (!equipmentType) throw new TechnicalStaffAuthError("equipmentType is required.");

  const row = {
    id,
    delivery_id: deliveryId,
    customer_id: customerId,
    equipment_type: equipmentType,
    brand: body.brand || null,
    model: body.model || null,
    serial_number: body.serialNumber || body.serial_number || null,
    capacity: body.capacity || null,
    quantity: Number(body.quantity ?? 1),
    warranty_start_date: body.warrantyStartDate || body.warranty_start_date || now.slice(0, 10),
    warranty_end_date: body.warrantyEndDate || body.warranty_end_date || null,
    photo_url: body.photoUrl || body.photo_url || null,
    notes: body.notes || null,
    synced_equipment_id: null as string | null,
    created_at: now,
    updated_at: now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("project_installed_equipment").insert(row).select("*").single();
    if (error) {
      if (isPhase10TableMissing(error)) throw new TechnicalStaffAuthError("Installed equipment table not ready.");
      throw error;
    }
    const mapped = mapInstalledRow(data);
    const eqId = await syncInstalledToCustomerEquipment(customerId, mapped, localDb);
    await supabase.from("project_installed_equipment").update({ synced_equipment_id: eqId }).eq("id", id);
    const warranty = await autoWarrantyFromInstalled(customerId, mapped, localDb);
    return { equipment: { ...mapped, syncedEquipmentId: eqId }, warranty };
  }

  localDb!.projectInstalledEquipment = localDb!.projectInstalledEquipment || [];
  localDb!.projectInstalledEquipment.push(row);
  const mapped = mapInstalledRow(row);
  const eqId = await syncInstalledToCustomerEquipment(customerId, mapped, localDb);
  row.synced_equipment_id = eqId;
  const warranty = await autoWarrantyFromInstalled(customerId, mapped, localDb);
  return { equipment: mapped, warranty };
}

export async function postTechnicalProjectDeliveryPhotos(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  const { user } = await verifyTechnicalStaffUser(userId, username, localDb);
  const bundle = await getTechnicalProjectDeliveryById(userId, username, deliveryId, localDb);
  const customerId = bundle.delivery.customerId;
  const photoCategory = String(body.photoCategory || body.photo_category || "").trim();
  const photoUrl = String(body.photoUrl || body.photo_url || "").trim();
  if (!photoCategory || !photoUrl) {
    throw new TechnicalStaffAuthError("photoCategory and photoUrl are required.");
  }
  const id = `pip-${Date.now()}`;
  const now = new Date().toISOString();
  const syncedPhotoId = await syncPhotoToInstallationPhotos(
    customerId,
    {
      photoCategory,
      photoUrl,
      caption: String(body.caption || ""),
      uploadedBy: user.name || username,
    },
    localDb
  );
  const row = {
    id,
    delivery_id: deliveryId,
    customer_id: customerId,
    photo_category: photoCategory,
    photo_url: photoUrl,
    caption: body.caption || null,
    uploaded_by: user.name || username,
    synced_photo_id: syncedPhotoId,
    created_at: now,
  };

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase.from("project_installation_photos").insert(row).select("*").single();
    if (error) {
      if (isPhase10TableMissing(error)) throw new TechnicalStaffAuthError("Installation photos table not ready.");
      throw error;
    }
    return mapPhotoRow(data);
  }
  localDb!.projectInstallationPhotos = localDb!.projectInstallationPhotos || [];
  localDb!.projectInstallationPhotos.push(row);
  return mapPhotoRow(row);
}

export async function patchTechnicalProjectDeliveryStatus(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  const { user } = await verifyTechnicalStaffUser(userId, username, localDb);
  const status = String(body.status || body.deliveryStatus || body.delivery_status || "").trim();
  if (!DELIVERY_STATUSES.includes(status as any)) {
    throw new TechnicalStaffAuthError("Invalid delivery status.");
  }
  const bundle = await getTechnicalProjectDeliveryById(userId, username, deliveryId, localDb);
  const previous = bundle.delivery.deliveryStatus;
  const now = new Date().toISOString();
  const safety = body.safetyChecklist || body.safety_checklist;

  await assertCompletionProofForHandover(deliveryId, status, localDb);

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const patch: Record<string, unknown> = { delivery_status: status, updated_at: now };
    if (safety) patch.safety_checklist = safety;
    const { data, error } = await supabase
      .from("project_deliveries")
      .update(patch)
      .eq("id", deliveryId)
      .select("*")
      .single();
    if (error || !data) throw new TechnicalStaffAuthError("Project delivery not found.");
    await supabase.from("project_delivery_updates").insert({
      id: `pdu-${Date.now()}`,
      delivery_id: deliveryId,
      previous_status: previous,
      new_status: status,
      updated_by_user_id: user.id,
      notes: body.notes || null,
      created_at: now,
    });
    if (status === "Handover Completed") {
      await provisionWarrantiesOnProjectCompletion(deliveryId, localDb);
    }
    return mapDeliveryRow(data);
  }

  const row = (localDb!.projectDeliveries || []).find((d: any) => d.id === deliveryId);
  if (!row) throw new TechnicalStaffAuthError("Project delivery not found.");
  row.delivery_status = status;
  row.updated_at = now;
  if (safety) row.safety_checklist = safety;
  localDb!.projectDeliveryUpdates = localDb!.projectDeliveryUpdates || [];
  localDb!.projectDeliveryUpdates.unshift({
    id: `pdu-${Date.now()}`,
    delivery_id: deliveryId,
    previous_status: previous,
    new_status: status,
    updated_by_user_id: user.id,
    created_at: now,
  });
  if (status === "Handover Completed") {
    await provisionWarrantiesOnProjectCompletion(deliveryId, localDb);
  }
  return mapDeliveryRow(row);
}

export async function fetchCustomerProjectDeliveryMe(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerPortalAuthError("Customer not linked.");

  let delivery: ProjectDeliveryRecord | null = null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("project_deliveries")
      .select("*")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      if (isPhase10TableMissing(error)) {
        return { customerId, delivery: null, progress: null, items: [], installedEquipment: [], photos: [] };
      }
      throw error;
    }
    if (data?.[0]) delivery = mapDeliveryRow(data[0]);
  } else {
    const rows = (localDb?.projectDeliveries || []).filter(
      (d: any) => (d.customer_id || d.customerId) === customerId
    );
    if (rows[0]) delivery = mapDeliveryRow(rows[0]);
  }

  if (!delivery) {
    return {
      customerId,
      delivery: null,
      progress: null,
      items: [],
      installedEquipment: [],
      photos: [],
      handoverComplete: false,
    };
  }

  const bundle = await loadDeliveryBundle(delivery.id, localDb);
  const progress = buildCustomerDeliveryProgress(delivery.projectType, delivery.deliveryStatus);
  return {
    customerId,
    delivery: bundle.delivery,
    progress,
    items: bundle.items,
    installedEquipment: bundle.installedEquipment,
    photos: bundle.photos,
    handoverComplete: delivery.deliveryStatus === "Handover Completed",
  };
}
