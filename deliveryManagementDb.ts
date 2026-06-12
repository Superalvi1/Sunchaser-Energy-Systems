import {
  isSupabaseActive,
  getSupabase,
  type Database,
  verifyStaffPortalUser,
  verifyCustomerPortalUser,
  StaffPortalAuthError,
  CustomerPortalAuthError,
} from "./dbManager.js";
import { randomBytes } from "crypto";
import { getAdminInvoiceById } from "./invoiceDb.js";
import { stockOutAdminInventoryItem } from "./inventoryFoundationDb.js";
import { uploadFileToCustomerStorage } from "./customerProfileDb.js";
import { syncDeliveryCertificateDocumentVault } from "./customerDocumentSync.js";
import {
  ALLOCATING_STATUSES,
  computeInvoiceDeliverySummary,
  computePreviouslyDeliveredQty,
  generateOtpCode,
  isChallanLocked,
  isVerificationTokenExpired,
  tokenExpiresInDays,
  validateDeliverNowQty,
  type DeliveryChallan,
  type DeliveryChallanItem,
  type DeliveryChallanPhoto,
  type DeliveryDashboardSummary,
  type DeliveryStatus,
  type DisputeDetails,
  type PublicVerificationStatus,
  type VerificationChecklist,
  DELIVERY_STATUSES,
  PHOTO_TYPES,
} from "./src/lib/deliveryManagement.ts";
import { buildDeliveryVerificationUrl } from "./src/lib/deliveryQr.ts";
import { compileDeliveryCertificateHtml } from "./deliveryCertificatePdf.ts";
import { compileDeliveryChallanHtml } from "./deliveryChallanPdf.ts";
import { isSuperAdmin } from "./src/lib/roles.ts";

export class DeliveryManagementDbError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DeliveryManagementDbError";
    this.statusCode = statusCode;
  }
}

const CHALLANS_TABLE = "delivery_challans";
const ITEMS_TABLE = "delivery_challan_items";
const PHOTOS_TABLE = "delivery_challan_photos";

function isDeliveryTableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === "42P01" || msg.includes("delivery_challan");
}

const TABLES_NOT_READY =
  "Delivery tables are not ready. Run scripts/delivery-management-schema.sql on Supabase.";

async function assertDeliveryStaff(userId: string, username: string, localDb?: Database) {
  const { user, role } = await verifyStaffPortalUser(userId, username, localDb);
  return { user, role };
}

function parseChecklist(raw: unknown): VerificationChecklist {
  const o = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
  return {
    receivedMaterial: !!o?.receivedMaterial,
    quantityCorrect: !!o?.quantityCorrect,
    conditionAcceptable: !!o?.conditionAcceptable,
  };
}

function parseDisputeDetails(raw: unknown): DisputeDetails {
  const o = (typeof raw === "string" ? JSON.parse(raw) : raw) as DisputeDetails | null;
  if (!o || typeof o !== "object") return {};
  return {
    comments: o.comments ? String(o.comments) : undefined,
    items: Array.isArray(o.items)
      ? o.items.map((it) => ({
          itemId: String((it as any).itemId || ""),
          itemName: (it as any).itemName ? String((it as any).itemName) : undefined,
          issueType: (it as any).issueType === "damaged" ? "damaged" : "missing",
          notes: (it as any).notes ? String((it as any).notes) : undefined,
        }))
      : undefined,
  };
}

function generateVerificationToken(): string {
  return randomBytes(12).toString("base64url");
}

function verificationTokenFields(now = new Date().toISOString()) {
  return {
    verification_token: generateVerificationToken(),
    token_expires_at: tokenExpiresInDays(7),
    public_verification_status: "pending",
    updated_at: now,
  };
}

function mapChallanRow(row: any): DeliveryChallan {
  return {
    id: row.id,
    challanNumber: row.challan_number || row.challanNumber,
    invoiceId: row.invoice_id || row.invoiceId,
    projectId: row.project_id ?? row.projectId ?? null,
    customerId: row.customer_id ?? row.customerId ?? null,
    leadId: row.lead_id ?? row.leadId ?? null,
    quotationId: row.quotation_id ?? row.quotationId ?? null,
    status: (row.status || "draft") as DeliveryStatus,
    deliveryTitle: row.delivery_title || row.deliveryTitle || "",
    deliveryDate: row.delivery_date ?? row.deliveryDate ?? null,
    vehicleNumber: row.vehicle_number || row.vehicleNumber || "",
    driverName: row.driver_name || row.driverName || "",
    installerName: row.installer_name || row.installerName || "",
    receiverName: row.receiver_name || row.receiverName || "",
    receiverPhone: row.receiver_phone || row.receiverPhone || "",
    receiverCnic: row.receiver_cnic || row.receiverCnic || "",
    receiverRelation: row.receiver_relation || row.receiverRelation || "",
    otpCode: row.otp_code ?? row.otpCode ?? null,
    otpSentAt: row.otp_sent_at ?? row.otpSentAt ?? null,
    otpVerifiedAt: row.otp_verified_at ?? row.otpVerifiedAt ?? null,
    verifiedByPhone: row.verified_by_phone ?? row.verifiedByPhone ?? null,
    gpsLat: row.gps_lat != null ? Number(row.gps_lat) : row.gpsLat != null ? Number(row.gpsLat) : null,
    gpsLng: row.gps_lng != null ? Number(row.gps_lng) : row.gpsLng != null ? Number(row.gpsLng) : null,
    gpsAddress: row.gps_address || row.gpsAddress || "",
    signedAt: row.signed_at ?? row.signedAt ?? null,
    signatureImageUrl: row.signature_image_url ?? row.signatureImageUrl ?? null,
    verificationChecklist: parseChecklist(row.verification_checklist ?? row.verificationChecklist),
    disputeReason: row.dispute_reason ?? row.disputeReason ?? null,
    disputeDetails: parseDisputeDetails(row.dispute_details ?? row.disputeDetails),
    verificationToken: row.verification_token ?? row.verificationToken ?? null,
    tokenExpiresAt: row.token_expires_at ?? row.tokenExpiresAt ?? null,
    publicVerificationStatus: (row.public_verification_status ||
      row.publicVerificationStatus ||
      "pending") as PublicVerificationStatus,
    verifiedAt: row.verified_at ?? row.verifiedAt ?? null,
    verifiedIp: row.verified_ip ?? row.verifiedIp ?? null,
    verifiedUserAgent: row.verified_user_agent ?? row.verifiedUserAgent ?? null,
    signedByName: row.signed_by_name ?? row.signedByName ?? null,
    signedByPhone: row.signed_by_phone ?? row.signedByPhone ?? null,
    signedRelation: row.signed_relation ?? row.signedRelation ?? null,
    notes: row.notes || "",
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
}

function mapItemRow(row: any): DeliveryChallanItem {
  return {
    id: row.id,
    challanId: row.challan_id || row.challanId,
    invoiceItemId: row.invoice_item_id ?? row.invoiceItemId ?? null,
    inventoryItemId: row.inventory_item_id ?? row.inventoryItemId ?? null,
    itemName: row.item_name || row.itemName || "",
    category: row.category || "",
    invoiceQty: Number(row.invoice_qty ?? row.invoiceQty ?? 0),
    previouslyDeliveredQty: Number(row.previously_delivered_qty ?? row.previouslyDeliveredQty ?? 0),
    deliverNowQty: Number(row.deliver_now_qty ?? row.deliverNowQty ?? 0),
    remainingQtyAfter: Number(row.remaining_qty_after ?? row.remainingQtyAfter ?? 0),
    serialNumber: row.serial_number || row.serialNumber || "",
    conditionNotes: row.condition_notes || row.conditionNotes || "",
    createdAt: row.created_at || row.createdAt,
  };
}

function mapPhotoRow(row: any): DeliveryChallanPhoto {
  return {
    id: row.id,
    challanId: row.challan_id || row.challanId,
    photoUrl: row.photo_url || row.photoUrl,
    photoType: (row.photo_type || row.photoType || "material") as DeliveryChallanPhoto["photoType"],
    caption: row.caption || "",
    uploadedBy: row.uploaded_by ?? row.uploadedBy ?? null,
    uploadedAt: row.uploaded_at || row.uploadedAt,
  };
}

type LocalKey = "deliveryChallans" | "deliveryChallanItems" | "deliveryChallanPhotos";

async function loadTable(table: string, localKey: LocalKey, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(table).select("*");
    if (error) {
      if (isDeliveryTableMissing(error)) throw new DeliveryManagementDbError(TABLES_NOT_READY, 503);
      throw error;
    }
    return data || [];
  }
  if (!localDb) throw new DeliveryManagementDbError("Database unavailable.", 500);
  return ((localDb as any)[localKey] || []) as any[];
}

async function insertTable(table: string, localKey: LocalKey, row: any, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(table).insert(row).select("*").single();
    if (error) {
      if (isDeliveryTableMissing(error)) throw new DeliveryManagementDbError(TABLES_NOT_READY, 503);
      throw error;
    }
    return data;
  }
  const db = localDb as any;
  if (!db[localKey]) db[localKey] = [];
  db[localKey].push(row);
  return row;
}

async function updateTable(table: string, localKey: LocalKey, id: string, patch: any, localDb?: Database) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(table).update(patch).eq("id", id).select("*").single();
    if (error || !data) throw new DeliveryManagementDbError("Challan not found.", 404);
    return data;
  }
  const db = localDb as any;
  const list = db[localKey] || [];
  const idx = list.findIndex((r: any) => r.id === id);
  if (idx < 0) throw new DeliveryManagementDbError("Challan not found.", 404);
  list[idx] = { ...list[idx], ...patch };
  return list[idx];
}

async function loadChallanByToken(token: string, localDb?: Database) {
  const rows = await loadTable(CHALLANS_TABLE, "deliveryChallans", localDb);
  const row = rows.find((r: any) => (r.verification_token || r.verificationToken) === token);
  if (!row) throw new DeliveryManagementDbError("Verification link not found.", 404);
  return loadChallanBundle(row.id, localDb);
}

type PublicAccessState = "pending" | "expired" | "cancelled" | "verified_readonly" | "disputed_readonly";

function resolvePublicAccess(challan: DeliveryChallan): PublicAccessState {
  if (challan.status === "cancelled") return "cancelled";
  if (isVerificationTokenExpired(challan.tokenExpiresAt) && challan.publicVerificationStatus === "pending") {
    return "expired";
  }
  if (challan.status === "verified_received" || challan.publicVerificationStatus === "verified") {
    return "verified_readonly";
  }
  if (challan.status === "disputed" || challan.publicVerificationStatus === "disputed") {
    return "disputed_readonly";
  }
  return "pending";
}

function assertPublicVerificationWritable(challan: DeliveryChallan) {
  const access = resolvePublicAccess(challan);
  if (access === "cancelled") throw new DeliveryManagementDbError("This delivery was cancelled.", 403);
  if (access === "expired") throw new DeliveryManagementDbError("This verification link has expired.", 410);
  if (access === "verified_readonly") throw new DeliveryManagementDbError("This delivery is already verified.", 409);
  if (access === "disputed_readonly") throw new DeliveryManagementDbError("This delivery is already marked as disputed.", 409);
}

async function ensureChallanVerificationToken(challanId: string, localDb?: Database) {
  const challan = await loadChallanBundle(challanId, localDb);
  if (challan.verificationToken) return challan;
  const now = new Date().toISOString();
  await updateTable(CHALLANS_TABLE, "deliveryChallans", challanId, verificationTokenFields(now), localDb);
  return loadChallanBundle(challanId, localDb);
}

async function loadChallanBundle(challanId: string, localDb?: Database) {
  const [challans, items, photos] = await Promise.all([
    loadTable(CHALLANS_TABLE, "deliveryChallans", localDb),
    loadTable(ITEMS_TABLE, "deliveryChallanItems", localDb),
    loadTable(PHOTOS_TABLE, "deliveryChallanPhotos", localDb),
  ]);
  const row = challans.find((r: any) => r.id === challanId);
  if (!row) throw new DeliveryManagementDbError("Challan not found.", 404);
  const challan = mapChallanRow(row);
  challan.items = items.filter((r: any) => (r.challan_id || r.challanId) === challanId).map(mapItemRow);
  challan.photos = photos.filter((r: any) => (r.challan_id || r.challanId) === challanId).map(mapPhotoRow);
  return challan;
}

async function nextChallanNumber(localDb?: Database): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DC-${year}-`;
  const rows = await loadTable(CHALLANS_TABLE, "deliveryChallans", localDb);
  const nums = rows
    .map((r: any) => String(r.challan_number || r.challanNumber || ""))
    .filter((n: string) => n.startsWith(prefix))
    .map((n: string) => Number(n.slice(prefix.length)) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function itemsByChallanMap(allItems: any[]): Map<string, DeliveryChallanItem[]> {
  const map = new Map<string, DeliveryChallanItem[]>();
  for (const row of allItems) {
    const item = mapItemRow(row);
    const list = map.get(item.challanId) || [];
    list.push(item);
    map.set(item.challanId, list);
  }
  return map;
}

async function loadInvoiceChallans(invoiceId: string, localDb?: Database) {
  const rows = await loadTable(CHALLANS_TABLE, "deliveryChallans", localDb);
  return rows.filter((r: any) => (r.invoice_id || r.invoiceId) === invoiceId).map(mapChallanRow);
}

export async function getInvoiceDeliverySummaryAdmin(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const invoice = await getAdminInvoiceById(userId, username, role, invoiceId, localDb);
  const challans = await loadInvoiceChallans(invoiceId, localDb);
  const allItems = await loadTable(ITEMS_TABLE, "deliveryChallanItems", localDb);
  const map = itemsByChallanMap(allItems);
  const summary = computeInvoiceDeliverySummary(invoice.items || [], challans, map);
  summary.invoiceId = invoiceId;
  return { summary, challans, invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, customerName: invoice.customerName } };
}

export async function listAdminDeliveriesForInvoice(
  userId: string,
  username: string,
  role: string,
  invoiceId: string,
  localDb?: Database
) {
  const data = await getInvoiceDeliverySummaryAdmin(userId, username, role, invoiceId, localDb);
  const bundles = [];
  for (const ch of data.challans) {
    bundles.push(await loadChallanBundle(ch.id, localDb));
  }
  return { ...data, challans: bundles };
}

export async function getAdminDeliveryChallan(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  return { challan: await loadChallanBundle(challanId, localDb) };
}

export async function createAdminDeliveryChallan(
  userId: string,
  username: string,
  role: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const invoiceId = String(body.invoiceId ?? body.invoice_id ?? "");
  if (!invoiceId) throw new DeliveryManagementDbError("invoiceId is required.");
  const invoice = await getAdminInvoiceById(userId, username, role, invoiceId, localDb);

  const existingChallans = await loadInvoiceChallans(invoiceId, localDb);
  const allItems = await loadTable(ITEMS_TABLE, "deliveryChallanItems", localDb);
  const itemMap = itemsByChallanMap(allItems);

  const draftItems = Array.isArray(body.items) ? body.items : [];
  if (!draftItems.length) throw new DeliveryManagementDbError("At least one delivery line is required.");

  const id = String(body.id || `dch-${Date.now()}`);
  const now = new Date().toISOString();
  const challanNumber = String(body.challanNumber ?? body.challan_number ?? (await nextChallanNumber(localDb)));

  const itemRows: any[] = [];
  for (const raw of draftItems) {
    const invoiceItemId = String((raw as any).invoiceItemId ?? (raw as any).invoice_item_id ?? "");
    const invLine = (invoice.items || []).find((it) => it.id === invoiceItemId);
    const invoiceQty = Number((raw as any).invoiceQty ?? (raw as any).invoice_qty ?? invLine?.qty ?? 0);
    const prev = computePreviouslyDeliveredQty(invoiceItemId, existingChallans, itemMap);
    const check = validateDeliverNowQty((raw as any).deliverNowQty ?? (raw as any).deliver_now_qty, invoiceQty, prev);
    if (!check.ok) throw new DeliveryManagementDbError(check.ok === false ? check.error : "Invalid quantity.");
    const remainingAfter = Math.max(0, invoiceQty - prev - check.qty);
    itemRows.push({
      id: `dci-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      challan_id: id,
      invoice_item_id: invoiceItemId || null,
      inventory_item_id: (raw as any).inventoryItemId ?? (raw as any).inventory_item_id ?? null,
      item_name: String((raw as any).itemName ?? (raw as any).item_name ?? invLine?.itemName ?? invLine?.description ?? ""),
      category: String((raw as any).category ?? ""),
      invoice_qty: invoiceQty,
      previously_delivered_qty: prev,
      deliver_now_qty: check.qty,
      remaining_qty_after: remainingAfter,
      serial_number: String((raw as any).serialNumber ?? (raw as any).serial_number ?? ""),
      condition_notes: String((raw as any).conditionNotes ?? (raw as any).condition_notes ?? ""),
      created_at: now,
    });
  }

  const challanRow = {
    id,
    challan_number: challanNumber,
    invoice_id: invoiceId,
    project_id: body.projectId ?? body.project_id ?? invoice.projectId ?? null,
    customer_id: body.customerId ?? body.customer_id ?? invoice.customerId ?? null,
    lead_id: body.leadId ?? body.lead_id ?? invoice.leadId ?? null,
    quotation_id: body.quotationId ?? body.quotation_id ?? invoice.quotationId ?? null,
    status: "draft",
    delivery_title: String(body.deliveryTitle ?? body.delivery_title ?? `Delivery — ${invoice.invoiceNumber}`),
    delivery_date: body.deliveryDate ?? body.delivery_date ?? new Date().toISOString().slice(0, 10),
    vehicle_number: String(body.vehicleNumber ?? body.vehicle_number ?? ""),
    driver_name: String(body.driverName ?? body.driver_name ?? ""),
    installer_name: String(body.installerName ?? body.installer_name ?? ""),
    receiver_name: String(body.receiverName ?? body.receiver_name ?? ""),
    receiver_phone: String(body.receiverPhone ?? body.receiver_phone ?? ""),
    receiver_cnic: String(body.receiverCnic ?? body.receiver_cnic ?? ""),
    receiver_relation: String(body.receiverRelation ?? body.receiver_relation ?? ""),
    notes: String(body.notes ?? ""),
    created_by: username,
    created_at: now,
    updated_at: now,
    ...verificationTokenFields(now),
  };

  await insertTable(CHALLANS_TABLE, "deliveryChallans", challanRow, localDb);
  for (const row of itemRows) {
    await insertTable(ITEMS_TABLE, "deliveryChallanItems", row, localDb);
  }

  return { challan: await loadChallanBundle(id, localDb), auditAction: "challan_created" };
}

export async function updateAdminDeliveryChallan(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status)) {
    throw new DeliveryManagementDbError("Verified/disputed challans cannot be edited.", 409);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: [string, string][] = [
    ["delivery_title", "deliveryTitle"],
    ["delivery_date", "deliveryDate"],
    ["vehicle_number", "vehicleNumber"],
    ["driver_name", "driverName"],
    ["installer_name", "installerName"],
    ["receiver_name", "receiverName"],
    ["receiver_phone", "receiverPhone"],
    ["receiver_cnic", "receiverCnic"],
    ["receiver_relation", "receiverRelation"],
    ["gps_lat", "gpsLat"],
    ["gps_lng", "gpsLng"],
    ["gps_address", "gpsAddress"],
    ["notes", "notes"],
  ];
  for (const [dbKey, bodyKey] of fields) {
    if (body[bodyKey] !== undefined || body[dbKey] !== undefined) {
      patch[dbKey] = body[bodyKey] ?? body[dbKey];
    }
  }

  if (body.status && DELIVERY_STATUSES.includes(body.status as DeliveryStatus)) {
    patch.status = body.status;
  }

  await updateTable(CHALLANS_TABLE, "deliveryChallans", challanId, patch, localDb);

  if (Array.isArray(body.items)) {
    const invoice = await getAdminInvoiceById(userId, username, role, existing.invoiceId, localDb);
    const existingChallans = (await loadInvoiceChallans(existing.invoiceId, localDb)).filter((c) => c.id !== challanId);
    const allItems = (await loadTable(ITEMS_TABLE, "deliveryChallanItems", localDb)).filter(
      (r: any) => (r.challan_id || r.challanId) !== challanId
    );
    const itemMap = itemsByChallanMap(allItems);
    const db = localDb as any;
    db.deliveryChallanItems = (db.deliveryChallanItems || []).filter((r: any) => (r.challan_id || r.challanId) !== challanId);
    if (isSupabaseActive()) {
      await getSupabase()!.from(ITEMS_TABLE).delete().eq("challan_id", challanId);
    }
    const now = new Date().toISOString();
    for (const raw of body.items) {
      const invoiceItemId = String((raw as any).invoiceItemId ?? (raw as any).invoice_item_id ?? "");
      const invLine = (invoice.items || []).find((it) => it.id === invoiceItemId);
      const invoiceQty = Number((raw as any).invoiceQty ?? invLine?.qty ?? 0);
      const prev = computePreviouslyDeliveredQty(invoiceItemId, existingChallans, itemMap, challanId);
      const check = validateDeliverNowQty((raw as any).deliverNowQty, invoiceQty, prev);
      if (!check.ok) throw new DeliveryManagementDbError(check.ok === false ? check.error : "Invalid quantity.");
      await insertTable(
        ITEMS_TABLE,
        "deliveryChallanItems",
        {
          id: String((raw as any).id || `dci-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
          challan_id: challanId,
          invoice_item_id: invoiceItemId || null,
          inventory_item_id: (raw as any).inventoryItemId ?? null,
          item_name: String((raw as any).itemName ?? invLine?.itemName ?? ""),
          category: String((raw as any).category ?? ""),
          invoice_qty: invoiceQty,
          previously_delivered_qty: prev,
          deliver_now_qty: check.qty,
          remaining_qty_after: Math.max(0, invoiceQty - prev - check.qty),
          serial_number: String((raw as any).serialNumber ?? ""),
          condition_notes: String((raw as any).conditionNotes ?? ""),
          created_at: now,
        },
        localDb
      );
    }
  }

  return { challan: await loadChallanBundle(challanId, localDb), auditAction: "challan_updated" };
}

export async function updateAdminDeliveryChallanStatus(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  status: string,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status) && status !== "disputed") {
    throw new DeliveryManagementDbError("Challan is locked.", 409);
  }
  if (!DELIVERY_STATUSES.includes(status as DeliveryStatus)) {
    throw new DeliveryManagementDbError("Invalid status.");
  }
  await updateTable(CHALLANS_TABLE, "deliveryChallans", challanId, { status, updated_at: new Date().toISOString() }, localDb);
  return { challan: await loadChallanBundle(challanId, localDb), auditAction: "status_changed", status };
}

export async function sendAdminDeliveryOtp(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status)) throw new DeliveryManagementDbError("Challan is locked.", 409);
  const otp = generateOtpCode();
  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challanId,
    { otp_code: otp, otp_sent_at: now, updated_at: now },
    localDb
  );
  const challan = await loadChallanBundle(challanId, localDb);
  return { challan, otp, auditAction: "otp_sent" };
}

export async function verifyAdminDeliveryOtp(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  body: { code?: string; verifiedByPhone?: string },
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status)) throw new DeliveryManagementDbError("Challan is locked.", 409);
  const code = String(body.code || "").trim();
  if (!code || code !== String(existing.otpCode || "")) {
    throw new DeliveryManagementDbError("Invalid OTP code.");
  }
  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challanId,
    {
      otp_verified_at: now,
      verified_by_phone: body.verifiedByPhone || existing.receiverPhone || null,
      updated_at: now,
    },
    localDb
  );
  return { challan: await loadChallanBundle(challanId, localDb), auditAction: "otp_verified" };
}

export async function captureAdminDeliverySignature(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  body: { signatureDataUrl?: string; signatureImageUrl?: string },
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status)) throw new DeliveryManagementDbError("Challan is locked.", 409);

  let signatureUrl = body.signatureImageUrl || null;
  if (body.signatureDataUrl && existing.customerId) {
    const up = await uploadFileToCustomerStorage(
      existing.customerId,
      String(body.signatureDataUrl),
      `delivery-signature-${challanId}.png`,
      "image/png"
    );
    signatureUrl = up.url;
  } else if (body.signatureDataUrl) {
    signatureUrl = String(body.signatureDataUrl);
  }
  if (!signatureUrl) throw new DeliveryManagementDbError("Signature data is required.");

  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challanId,
    { signature_image_url: signatureUrl, signed_at: now, updated_at: now },
    localDb
  );
  return { challan: await loadChallanBundle(challanId, localDb), auditAction: "signature_captured" };
}

export async function uploadAdminDeliveryPhoto(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status)) throw new DeliveryManagementDbError("Challan is locked.", 409);

  let photoUrl = String(body.photoUrl ?? body.photo_url ?? "");
  if (body.base64Data && existing.customerId) {
    const up = await uploadFileToCustomerStorage(
      existing.customerId,
      String(body.base64Data),
      String(body.fileName || `delivery-${challanId}.jpg`),
      String(body.mimeType || "image/jpeg")
    );
    photoUrl = up.url;
  }
  if (!photoUrl) throw new DeliveryManagementDbError("Photo URL or base64Data is required.");

  const photoType = String(body.photoType ?? body.photo_type ?? "material");
  if (!(PHOTO_TYPES as readonly string[]).includes(photoType)) {
    throw new DeliveryManagementDbError("Invalid photo type.");
  }

  const id = `dcp-${Date.now()}`;
  const now = new Date().toISOString();
  await insertTable(
    PHOTOS_TABLE,
    "deliveryChallanPhotos",
    {
      id,
      challan_id: challanId,
      photo_url: photoUrl,
      photo_type: photoType,
      caption: String(body.caption ?? ""),
      uploaded_by: username,
      uploaded_at: now,
    },
    localDb
  );
  return { challan: await loadChallanBundle(challanId, localDb), auditAction: "photo_uploaded", photoType };
}

function resolveDeliveryAutomationActor(localDb?: Database) {
  const users = ((localDb as any)?.users || []) as any[];
  const hit =
    users.find((u) => String(u.username || "").toLowerCase() === "allauddin") ||
    users.find((u) => u.role === "Super Admin");
  if (hit) return { userId: hit.id, username: hit.username };
  return { userId: "u-system", username: "system" };
}

async function applyVerifiedInventoryMovements(
  userId: string,
  username: string,
  challan: DeliveryChallan,
  localDb?: Database
) {
  for (const item of challan.items || []) {
    if (!item.inventoryItemId || item.deliverNowQty <= 0) continue;
    await stockOutAdminInventoryItem(
      userId,
      username,
      item.inventoryItemId,
      {
        qty: item.deliverNowQty,
        referenceType: "material_delivered",
        referenceId: challan.id,
        notes: `Delivery challan ${challan.challanNumber}: ${item.itemName}`,
      },
      localDb
    );
  }
}

async function finalizeDeliveryVerification(
  challanId: string,
  body: Record<string, unknown>,
  meta: { ip?: string; userAgent?: string; source: "staff" | "customer" },
  localDb?: Database,
  actor?: { userId: string; username: string }
) {
  const existing = await loadChallanBundle(challanId, localDb);
  if (isChallanLocked(existing.status)) {
    throw new DeliveryManagementDbError("Challan is already verified/disputed.", 409);
  }

  const checklist = {
    receivedMaterial: !!(body.receivedMaterial ?? (body.checklist as any)?.receivedMaterial),
    quantityCorrect: !!(body.quantityCorrect ?? (body.checklist as any)?.quantityCorrect),
    conditionAcceptable: !!(body.conditionAcceptable ?? (body.checklist as any)?.conditionAcceptable),
  };
  if (!checklist.receivedMaterial || !checklist.quantityCorrect || !checklist.conditionAcceptable) {
    throw new DeliveryManagementDbError("All customer checklist items must be confirmed.");
  }
  if (!existing.otpVerifiedAt) throw new DeliveryManagementDbError("OTP must be verified first.");
  if (!existing.signatureImageUrl) throw new DeliveryManagementDbError("Signature is required.");

  const receiverName = String(body.receiverName ?? body.receiver_name ?? existing.receiverName ?? existing.signedByName ?? "").trim();
  const receiverPhone = String(body.receiverPhone ?? body.receiver_phone ?? existing.receiverPhone ?? existing.signedByPhone ?? "").trim();
  if (!receiverName) throw new DeliveryManagementDbError("Receiver name is required.");
  if (!receiverPhone) throw new DeliveryManagementDbError("Receiver phone is required.");

  const photos = existing.photos || [];
  if (!photos.some((p) => p.photoType === "material")) {
    throw new DeliveryManagementDbError("At least one material photo is recommended before verification.");
  }

  const now = new Date().toISOString();
  const signedRelation = String(
    body.receiverRelation ?? body.receiver_relation ?? body.signedRelation ?? existing.receiverRelation ?? existing.signedRelation ?? "owner"
  );

  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challanId,
    {
      status: "verified_received",
      public_verification_status: "verified",
      verified_at: now,
      verified_ip: meta.ip || null,
      verified_user_agent: meta.userAgent || null,
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      receiver_cnic: body.receiverCnic ?? body.receiver_cnic ?? existing.receiverCnic,
      receiver_relation: signedRelation,
      signed_by_name: receiverName,
      signed_by_phone: receiverPhone,
      signed_relation: signedRelation,
      verification_checklist: checklist,
      gps_lat: body.gpsLat ?? body.gps_lat ?? existing.gpsLat,
      gps_lng: body.gpsLng ?? body.gps_lng ?? existing.gpsLng,
      gps_address: body.gpsAddress ?? body.gps_address ?? existing.gpsAddress,
      notes: body.notes !== undefined ? String(body.notes) : existing.notes,
      updated_at: now,
    },
    localDb
  );

  const verified = await loadChallanBundle(challanId, localDb);
  const inventoryActor = actor || resolveDeliveryAutomationActor(localDb);
  await applyVerifiedInventoryMovements(inventoryActor.userId, inventoryActor.username, verified, localDb);
  await syncDeliveryCertificateDocument(verified, localDb);
  return { challan: verified, auditAction: meta.source === "customer" ? "delivery_verified_by_customer" : "delivery_verified" };
}

export async function verifyAdminDeliveryChallan(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  return finalizeDeliveryVerification(
    challanId,
    body,
    { source: "staff" },
    localDb,
    { userId, username }
  );
}

export async function disputeAdminDeliveryChallan(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  reason: string,
  localDb?: Database
) {
  const { role: staffRole } = await assertDeliveryStaff(userId, username, localDb);
  if (!isSuperAdmin(username, staffRole)) {
    throw new StaffPortalAuthError("Only Super Admin can mark a delivery as disputed.");
  }
  const reasonText = String(reason || "").trim();
  if (!reasonText) throw new DeliveryManagementDbError("Dispute reason is required.");
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challanId,
    { status: "disputed", public_verification_status: "disputed", dispute_reason: reasonText, updated_at: new Date().toISOString() },
    localDb
  );
  return { challan: await loadChallanBundle(challanId, localDb), auditAction: "disputed", reason: reasonText };
}

function certificateUrl(challanId: string, portal = false): string {
  const path = portal
    ? `/api/customer-portal/deliveries/${encodeURIComponent(challanId)}/certificate`
    : `/api/admin/deliveries/${encodeURIComponent(challanId)}/certificate`;
  const base = (process.env.APP_PUBLIC_URL || process.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export async function syncDeliveryCertificateDocument(challan: DeliveryChallan, localDb?: Database) {
  if (!challan.customerId) return null;
  const url = certificateUrl(challan.id, true);
  return syncDeliveryCertificateDocumentVault(
    {
      customerId: challan.customerId,
      challanId: challan.id,
      challanNumber: challan.challanNumber,
      fileUrl: url,
      notes: `Challan ${challan.challanNumber} verified ${challan.updatedAt}`,
    },
    localDb
  );
}

export async function buildDeliveryCertificatePayload(challanId: string, localDb?: Database) {
  const challan = await loadChallanBundle(challanId, localDb);
  let invoice: any = null;
  try {
    invoice = await getAdminInvoiceById("system", "system", "Super Admin", challan.invoiceId, localDb);
  } catch {
    const rows = ((localDb as any)?.invoices || []) as any[];
    const row = rows.find((r) => r.id === challan.invoiceId);
    if (row) invoice = { invoiceNumber: row.invoice_number || row.invoiceNumber, customerName: row.customer_name, customerAddress: row.customer_address };
  }
  return { challan, invoice };
}

export async function renderDeliveryCertificateHtml(challanId: string, localDb?: Database, branding?: any) {
  const { challan, invoice } = await buildDeliveryCertificatePayload(challanId, localDb);
  return compileDeliveryCertificateHtml({ challan, invoice, branding });
}

export async function fetchDeliveryDashboardSummary(
  userId: string,
  username: string,
  localDb?: Database
): Promise<{ summary: DeliveryDashboardSummary }> {
  if (!isSuperAdmin(username, (await assertDeliveryStaff(userId, username, localDb)).role)) {
    throw new StaffPortalAuthError("Delivery dashboard is restricted to Super Admin.");
  }
  const rows = await loadTable(CHALLANS_TABLE, "deliveryChallans", localDb);
  const challans = rows.map(mapChallanRow);
  const items = await loadTable(ITEMS_TABLE, "deliveryChallanItems", localDb);
  const today = new Date().toISOString().slice(0, 10);

  let materialsPendingValue = 0;
  for (const ch of challans) {
    if (!["draft", "out_for_delivery", "delivered_pending_verification"].includes(ch.status)) continue;
    const lines = items.filter((r: any) => (r.challan_id || r.challanId) === ch.id);
    for (const line of lines) {
      materialsPendingValue += Number(line.deliver_now_qty ?? 0) * 1000; // placeholder unit value
    }
  }

  return {
    summary: {
      deliveriesToday: challans.filter((c) => String(c.deliveryDate || "").slice(0, 10) === today && c.status !== "cancelled").length,
      pendingDeliveries: challans.filter((c) =>
        ["draft", "out_for_delivery", "delivered_pending_verification"].includes(c.status)
      ).length,
      verifiedDeliveries: challans.filter((c) => c.status === "verified_received").length,
      materialsPendingValue: Math.round(materialsPendingValue),
    },
  };
}

export async function fetchCustomerPortalDeliveriesMe(
  userId: string,
  username: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  if (!customerId) throw new CustomerPortalAuthError("Customer account is not linked.");

  const rows = await loadTable(CHALLANS_TABLE, "deliveryChallans", localDb);
  const challans = rows
    .filter((r: any) => (r.customer_id || r.customerId) === customerId)
    .map(mapChallanRow)
    .filter((c) => c.status !== "cancelled" && c.status !== "draft");

  const items = await loadTable(ITEMS_TABLE, "deliveryChallanItems", localDb);
  const map = itemsByChallanMap(items);

  const deliveries = challans.map((ch) => ({
    id: ch.id,
    challanNumber: ch.challanNumber,
    deliveryDate: ch.deliveryDate,
    status: ch.status,
    deliveryTitle: ch.deliveryTitle,
    items: (map.get(ch.id) || []).map((it) => ({
      itemName: it.itemName,
      deliverNowQty: it.deliverNowQty,
      serialNumber: it.serialNumber,
      remainingQtyAfter: it.remainingQtyAfter,
    })),
    certificateUrl: certificateUrl(ch.id, true),
  }));

  return { customerId, deliveries };
}

export async function getCustomerPortalDeliveryCertificate(
  userId: string,
  username: string,
  challanId: string,
  localDb?: Database
) {
  const { customerId } = await verifyCustomerPortalUser(userId, username, localDb);
  const challan = await loadChallanBundle(challanId, localDb);
  if (challan.customerId !== customerId) {
    throw new DeliveryManagementDbError("Delivery not found.", 404);
  }
  if (challan.status !== "verified_received") {
    throw new DeliveryManagementDbError("Certificate available after verification only.", 403);
  }
  return renderDeliveryCertificateHtml(challanId, localDb);
}

function sanitizePublicChallan(ch: DeliveryChallan) {
  const { otpCode: _otp, ...rest } = ch;
  return rest;
}

async function loadPublicVerificationContext(token: string, localDb?: Database) {
  const challan = await loadChallanByToken(token, localDb);
  const ensured = challan.verificationToken ? challan : await ensureChallanVerificationToken(challan.id, localDb);
  const access = resolvePublicAccess(ensured);
  const { invoice } = await buildDeliveryCertificatePayload(ensured.id, localDb);
  const verificationUrl = buildDeliveryVerificationUrl(ensured.verificationToken || token);
  return {
    access,
    challan: sanitizePublicChallan(ensured),
    invoice: {
      invoiceNumber: invoice?.invoiceNumber || "—",
      customerName: invoice?.customerName || "—",
      customerAddress: invoice?.customerAddress || "—",
      customerPhone: invoice?.customerPhone || "",
    },
    verificationUrl,
    certificateUrl:
      access === "verified_readonly"
        ? `/api/public/delivery/verify/${encodeURIComponent(token)}/certificate`
        : null,
  };
}

export async function getPublicDeliveryVerificationPage(token: string, localDb?: Database) {
  return loadPublicVerificationContext(token, localDb);
}

export async function sendPublicDeliveryOtp(token: string, localDb?: Database) {
  const challan = await loadChallanByToken(token, localDb);
  assertPublicVerificationWritable(challan);
  const otp = generateOtpCode();
  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challan.id,
    { otp_code: otp, otp_sent_at: now, updated_at: now },
    localDb
  );
  const updated = await loadChallanBundle(challan.id, localDb);
  const devOtp = process.env.NODE_ENV !== "production" ? otp : undefined;
  return { challan: sanitizePublicChallan(updated), sent: true, otp: devOtp, auditAction: "otp_sent" };
}

export async function verifyPublicDeliveryOtp(
  token: string,
  body: { code?: string; verifiedByPhone?: string },
  localDb?: Database
) {
  const challan = await loadChallanByToken(token, localDb);
  assertPublicVerificationWritable(challan);
  const code = String(body.code || "").trim();
  if (!code || code !== String(challan.otpCode || "")) {
    throw new DeliveryManagementDbError("Invalid OTP code.");
  }
  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challan.id,
    {
      otp_verified_at: now,
      verified_by_phone: body.verifiedByPhone || challan.receiverPhone || null,
      updated_at: now,
    },
    localDb
  );
  return { challan: sanitizePublicChallan(await loadChallanBundle(challan.id, localDb)), auditAction: "otp_verified" };
}

export async function capturePublicDeliverySignature(
  token: string,
  body: { signatureDataUrl?: string; signatureImageUrl?: string },
  localDb?: Database
) {
  const challan = await loadChallanByToken(token, localDb);
  assertPublicVerificationWritable(challan);

  let signatureUrl = body.signatureImageUrl || null;
  if (body.signatureDataUrl && challan.customerId) {
    const up = await uploadFileToCustomerStorage(
      challan.customerId,
      String(body.signatureDataUrl),
      `delivery-signature-${challan.id}.png`,
      "image/png"
    );
    signatureUrl = up.url;
  } else if (body.signatureDataUrl) {
    signatureUrl = String(body.signatureDataUrl);
  }
  if (!signatureUrl) throw new DeliveryManagementDbError("Signature data is required.");

  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challan.id,
    { signature_image_url: signatureUrl, signed_at: now, updated_at: now },
    localDb
  );
  return { challan: sanitizePublicChallan(await loadChallanBundle(challan.id, localDb)), auditAction: "signature_captured" };
}

export async function uploadPublicDeliveryPhoto(
  token: string,
  body: Record<string, unknown>,
  localDb?: Database
) {
  const challan = await loadChallanByToken(token, localDb);
  assertPublicVerificationWritable(challan);

  let photoUrl = String(body.photoUrl ?? body.photo_url ?? "");
  if (body.base64Data && challan.customerId) {
    const up = await uploadFileToCustomerStorage(
      challan.customerId,
      String(body.base64Data),
      String(body.fileName || `delivery-public-${challan.id}.jpg`),
      String(body.mimeType || "image/jpeg")
    );
    photoUrl = up.url;
  }
  if (!photoUrl) throw new DeliveryManagementDbError("Photo URL or base64Data is required.");

  const photoType = String(body.photoType ?? body.photo_type ?? "material");
  if (!(PHOTO_TYPES as readonly string[]).includes(photoType)) {
    throw new DeliveryManagementDbError("Invalid photo type.");
  }

  const id = `dcp-${Date.now()}`;
  const now = new Date().toISOString();
  await insertTable(
    PHOTOS_TABLE,
    "deliveryChallanPhotos",
    {
      id,
      challan_id: challan.id,
      photo_url: photoUrl,
      photo_type: photoType,
      caption: String(body.caption ?? ""),
      uploaded_by: "customer-public",
      uploaded_at: now,
    },
    localDb
  );
  return {
    challan: sanitizePublicChallan(await loadChallanBundle(challan.id, localDb)),
    auditAction: "photo_uploaded",
    photoType,
  };
}

export async function submitPublicDeliveryVerification(
  token: string,
  body: Record<string, unknown>,
  meta: { ip?: string; userAgent?: string },
  localDb?: Database
) {
  const challan = await loadChallanByToken(token, localDb);
  assertPublicVerificationWritable(challan);
  return finalizeDeliveryVerification(challan.id, body, { ...meta, source: "customer" }, localDb);
}

export async function disputePublicDeliveryChallan(
  token: string,
  body: Record<string, unknown>,
  meta: { ip?: string; userAgent?: string },
  localDb?: Database
) {
  const challan = await loadChallanByToken(token, localDb);
  assertPublicVerificationWritable(challan);

  const comments = String(body.comments ?? body.disputeReason ?? "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!comments && !items.length) {
    throw new DeliveryManagementDbError("Please describe missing or damaged items.");
  }

  const disputeDetails: DisputeDetails = {
    comments,
    items: items.map((raw: any) => ({
      itemId: String(raw.itemId || raw.id || ""),
      itemName: raw.itemName ? String(raw.itemName) : undefined,
      issueType: raw.issueType === "damaged" ? "damaged" : "missing",
      notes: raw.notes ? String(raw.notes) : undefined,
    })),
  };

  const now = new Date().toISOString();
  await updateTable(
    CHALLANS_TABLE,
    "deliveryChallans",
    challan.id,
    {
      status: "disputed",
      public_verification_status: "disputed",
      dispute_reason: comments || "Customer reported missing/damaged items.",
      dispute_details: disputeDetails,
      verified_at: now,
      verified_ip: meta.ip || null,
      verified_user_agent: meta.userAgent || null,
      updated_at: now,
    },
    localDb
  );

  return {
    challan: sanitizePublicChallan(await loadChallanBundle(challan.id, localDb)),
    auditAction: "disputed",
    reason: comments,
  };
}

export async function renderPublicDeliveryCertificate(token: string, localDb?: Database) {
  const challan = await loadChallanByToken(token, localDb);
  if (challan.status !== "verified_received") {
    throw new DeliveryManagementDbError("Certificate available after verification only.", 403);
  }
  return renderDeliveryCertificateHtml(challan.id, localDb);
}

export async function renderDeliveryChallanHtml(challanId: string, localDb?: Database, branding?: any) {
  const ensured = await ensureChallanVerificationToken(challanId, localDb);
  const { invoice } = await buildDeliveryCertificatePayload(challanId, localDb);
  const verificationUrl = buildDeliveryVerificationUrl(ensured.verificationToken || "");
  return compileDeliveryChallanHtml({ challan: ensured, invoice, branding, verificationUrl });
}

export async function getAdminDeliveryVerificationInfo(
  userId: string,
  username: string,
  role: string,
  challanId: string,
  localDb?: Database
) {
  await assertDeliveryStaff(userId, username, localDb);
  const challan = await ensureChallanVerificationToken(challanId, localDb);
  const { invoice } = await buildDeliveryCertificatePayload(challanId, localDb);
  const verificationUrl = buildDeliveryVerificationUrl(challan.verificationToken || "");
  return {
    challan,
    invoice,
    verificationUrl,
  };
}
