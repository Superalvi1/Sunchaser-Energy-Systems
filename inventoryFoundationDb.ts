import {
  getSupabase,
  isSupabaseActive,
  verifyStaffPortalUser,
  type Database,
} from "./dbManager.js";
import {
  computeAvailableQty,
  isLowStock,
  type InventoryFoundationItem,
  type InventoryMovementRecord,
  type InventoryMovementType,
  type ProjectInventoryReservation,
} from "./src/lib/inventoryFoundation.ts";

export class InventoryFoundationDbError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ITEMS_TABLE = "inventory_items";
const MOVEMENTS_TABLE = "inventory_movements";
const RESERVATIONS_TABLE = "project_inventory_reservations";

function isInventoryTableMissing(err: any) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "42P01" ||
    msg.includes("inventory_items") ||
    msg.includes("inventory_movements") ||
    msg.includes("project_inventory_reservations")
  );
}

function inventoryTableMissingError() {
  return new InventoryFoundationDbError(
    "Inventory tables are not configured. Run scripts/inventory-foundation-schema.sql in Supabase.",
    503
  );
}

function mapItemRow(row: any): InventoryFoundationItem {
  const stockQty = Number(row.stock_qty ?? row.stockQty ?? 0);
  const reservedQty = Number(row.reserved_qty ?? row.reservedQty ?? 0);
  return {
    id: row.id,
    productId: row.product_id ?? row.productId ?? null,
    category: row.category || "",
    brand: row.brand || "",
    model: row.model || "",
    sku: row.sku || "",
    stockQty,
    reservedQty,
    availableQty: Number(row.available_qty ?? row.availableQty ?? computeAvailableQty(stockQty, reservedQty)),
    costPrice: Number(row.cost_price ?? row.costPrice ?? 0),
    salePrice: Number(row.sale_price ?? row.salePrice ?? 0),
    supplier: row.supplier || "",
    warehouseLocation: row.warehouse_location ?? row.warehouseLocation ?? "",
    serialRequired: !!(row.serial_required ?? row.serialRequired),
    lowStockThreshold: Number(row.low_stock_threshold ?? row.lowStockThreshold ?? 5),
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
  };
}

function mapMovementRow(row: any): InventoryMovementRecord {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id || row.inventoryItemId,
    movementType: row.movement_type || row.movementType,
    qty: Number(row.qty || 0),
    referenceType: row.reference_type ?? row.referenceType ?? null,
    referenceId: row.reference_id ?? row.referenceId ?? null,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at || row.createdAt,
  };
}

function mapReservationRow(row: any): ProjectInventoryReservation {
  return {
    id: row.id,
    projectId: row.project_id || row.projectId,
    deliveryId: row.delivery_id ?? row.deliveryId ?? null,
    inventoryItemId: row.inventory_item_id || row.inventoryItemId,
    qtyReserved: Number(row.qty_reserved ?? row.qtyReserved ?? 0),
    status: row.status,
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: row.created_at || row.createdAt,
  };
}

function itemDbRow(item: InventoryFoundationItem) {
  return {
    id: item.id,
    product_id: item.productId,
    category: item.category,
    brand: item.brand,
    model: item.model,
    sku: item.sku,
    stock_qty: item.stockQty,
    reserved_qty: item.reservedQty,
    cost_price: item.costPrice,
    sale_price: item.salePrice,
    supplier: item.supplier,
    warehouse_location: item.warehouseLocation,
    serial_required: item.serialRequired,
    low_stock_threshold: item.lowStockThreshold,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

async function loadAllItems(localDb?: Database): Promise<InventoryFoundationItem[]> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(ITEMS_TABLE).select("*").order("updated_at", { ascending: false });
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return (data || []).map(mapItemRow);
  }
  return ((localDb as any)?.inventoryFoundationItems || []).map((r: any) => mapItemRow(r));
}

async function loadItemById(id: string, localDb?: Database): Promise<InventoryFoundationItem | null> {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(ITEMS_TABLE).select("*").eq("id", id).maybeSingle();
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return data ? mapItemRow(data) : null;
  }
  const row = ((localDb as any)?.inventoryFoundationItems || []).find((r: any) => r.id === id);
  return row ? mapItemRow(row) : null;
}

async function persistItem(item: InventoryFoundationItem, localDb?: Database) {
  const row = itemDbRow(item);
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(ITEMS_TABLE).upsert(row).select("*").single();
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return mapItemRow(data);
  }
  const db = localDb as any;
  db.inventoryFoundationItems = db.inventoryFoundationItems || [];
  const idx = db.inventoryFoundationItems.findIndex((r: any) => r.id === item.id);
  const stored = { ...row, available_qty: computeAvailableQty(item.stockQty, item.reservedQty) };
  if (idx >= 0) db.inventoryFoundationItems[idx] = stored;
  else db.inventoryFoundationItems.unshift(stored);
  return mapItemRow(stored);
}

async function insertMovement(
  body: {
    inventoryItemId: string;
    movementType: InventoryMovementType;
    qty: number;
    referenceType?: string | null;
    referenceId?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  },
  localDb?: Database
) {
  const row = {
    id: `im-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    inventory_item_id: body.inventoryItemId,
    movement_type: body.movementType,
    qty: body.qty,
    reference_type: body.referenceType || null,
    reference_id: body.referenceId || null,
    notes: body.notes || null,
    created_by: body.createdBy || null,
    created_at: new Date().toISOString(),
  };
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(MOVEMENTS_TABLE).insert(row).select("*").single();
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return mapMovementRow(data);
  }
  const db = localDb as any;
  db.inventoryFoundationMovements = db.inventoryFoundationMovements || [];
  db.inventoryFoundationMovements.unshift(row);
  return mapMovementRow(row);
}

async function insertReservation(
  body: {
    projectId: string;
    deliveryId?: string | null;
    inventoryItemId: string;
    qtyReserved: number;
    createdBy?: string | null;
  },
  localDb?: Database
) {
  const row = {
    id: `pir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    project_id: body.projectId,
    delivery_id: body.deliveryId || null,
    inventory_item_id: body.inventoryItemId,
    qty_reserved: body.qtyReserved,
    status: "reserved",
    created_by: body.createdBy || null,
    created_at: new Date().toISOString(),
  };
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!.from(RESERVATIONS_TABLE).insert(row).select("*").single();
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return mapReservationRow(data);
  }
  const db = localDb as any;
  db.projectInventoryReservations = db.projectInventoryReservations || [];
  db.projectInventoryReservations.unshift(row);
  return mapReservationRow(row);
}

async function updateReservationStatus(
  id: string,
  status: ProjectInventoryReservation["status"],
  localDb?: Database
) {
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from(RESERVATIONS_TABLE)
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return mapReservationRow(data);
  }
  const db = localDb as any;
  const row = (db.projectInventoryReservations || []).find((r: any) => r.id === id);
  if (!row) throw new InventoryFoundationDbError("Reservation not found.", 404);
  row.status = status;
  return mapReservationRow(row);
}

export async function listAdminInventoryFoundationItems(
  staffUserId: string,
  staffUsername: string,
  _role: string,
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const items = await loadAllItems(localDb);
  return { items };
}

export async function listAdminLowStockItems(
  staffUserId: string,
  staffUsername: string,
  role: string,
  localDb?: Database
) {
  const { items } = await listAdminInventoryFoundationItems(staffUserId, staffUsername, role, localDb);
  return { items: items.filter(isLowStock) };
}

export async function createAdminInventoryFoundationItem(
  staffUserId: string,
  staffUsername: string,
  body: {
    productId?: string | null;
    category?: string;
    brand?: string;
    model?: string;
    sku?: string;
    costPrice?: number;
    salePrice?: number;
    supplier?: string;
    warehouseLocation?: string;
    serialRequired?: boolean;
    lowStockThreshold?: number;
    initialStock?: number;
  },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const now = new Date().toISOString();
  const initialStock = Math.max(0, Number(body.initialStock || 0));
  const item: InventoryFoundationItem = {
    id: `inv-${Date.now()}`,
    productId: body.productId || null,
    category: String(body.category || "").trim(),
    brand: String(body.brand || "").trim(),
    model: String(body.model || "").trim(),
    sku: String(body.sku || "").trim() || `SKU-${Date.now()}`,
    stockQty: initialStock,
    reservedQty: 0,
    availableQty: initialStock,
    costPrice: Number(body.costPrice || 0),
    salePrice: Number(body.salePrice || 0),
    supplier: String(body.supplier || "").trim(),
    warehouseLocation: String(body.warehouseLocation || "").trim(),
    serialRequired: !!body.serialRequired,
    lowStockThreshold: Number(body.lowStockThreshold ?? 5),
    createdAt: now,
    updatedAt: now,
  };
  const saved = await persistItem(item, localDb);
  if (initialStock > 0) {
    await insertMovement(
      {
        inventoryItemId: saved.id,
        movementType: "stock_in",
        qty: initialStock,
        referenceType: "initial",
        notes: "Initial stock on item creation",
        createdBy: staffUserId,
      },
      localDb
    );
  }
  return saved;
}

export async function stockInAdminInventoryItem(
  staffUserId: string,
  staffUsername: string,
  itemId: string,
  body: { qty: number; notes?: string; referenceType?: string; referenceId?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const qty = Number(body.qty);
  if (!qty || qty <= 0) throw new InventoryFoundationDbError("qty must be greater than 0.");

  const item = await loadItemById(itemId, localDb);
  if (!item) throw new InventoryFoundationDbError("Inventory item not found.", 404);

  item.stockQty += qty;
  item.updatedAt = new Date().toISOString();
  const saved = await persistItem(item, localDb);
  const movement = await insertMovement(
    {
      inventoryItemId: itemId,
      movementType: "stock_in",
      qty,
      referenceType: body.referenceType || "manual",
      referenceId: body.referenceId || null,
      notes: body.notes || null,
      createdBy: staffUserId,
    },
    localDb
  );
  return { item: saved, movement };
}

export async function stockOutAdminInventoryItem(
  staffUserId: string,
  staffUsername: string,
  itemId: string,
  body: { qty: number; notes?: string; referenceType?: string; referenceId?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const qty = Number(body.qty);
  if (!qty || qty <= 0) throw new InventoryFoundationDbError("qty must be greater than 0.");

  const item = await loadItemById(itemId, localDb);
  if (!item) throw new InventoryFoundationDbError("Inventory item not found.", 404);
  if (item.availableQty < qty) {
    throw new InventoryFoundationDbError(
      `Cannot stock out ${qty} units. Only ${item.availableQty} available (${item.reservedQty} reserved).`
    );
  }

  item.stockQty -= qty;
  item.updatedAt = new Date().toISOString();
  const saved = await persistItem(item, localDb);
  const movement = await insertMovement(
    {
      inventoryItemId: itemId,
      movementType: "stock_out",
      qty,
      referenceType: body.referenceType || "manual",
      referenceId: body.referenceId || null,
      notes: body.notes || null,
      createdBy: staffUserId,
    },
    localDb
  );
  return { item: saved, movement };
}

export async function adjustAdminInventoryItem(
  staffUserId: string,
  staffUsername: string,
  itemId: string,
  body: { qtyDelta: number; notes?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const qtyDelta = Number(body.qtyDelta);
  if (!qtyDelta || qtyDelta === 0) throw new InventoryFoundationDbError("qtyDelta cannot be 0.");

  const item = await loadItemById(itemId, localDb);
  if (!item) throw new InventoryFoundationDbError("Inventory item not found.", 404);

  const nextStock = item.stockQty + qtyDelta;
  if (nextStock < item.reservedQty) {
    throw new InventoryFoundationDbError(
      `Adjustment would leave stock below reserved quantity (${item.reservedQty} reserved).`
    );
  }
  if (nextStock < 0) throw new InventoryFoundationDbError("Adjustment would make stock negative.");

  item.stockQty = nextStock;
  item.updatedAt = new Date().toISOString();
  const saved = await persistItem(item, localDb);
  const movement = await insertMovement(
    {
      inventoryItemId: itemId,
      movementType: "adjustment",
      qty: Math.abs(qtyDelta),
      referenceType: "adjustment",
      notes: body.notes || (qtyDelta > 0 ? `+${qtyDelta}` : `${qtyDelta}`),
      createdBy: staffUserId,
    },
    localDb
  );
  return { item: saved, movement };
}

export async function reserveAdminInventoryForProject(
  staffUserId: string,
  staffUsername: string,
  body: {
    inventoryItemId: string;
    projectId: string;
    deliveryId?: string | null;
    qty: number;
    notes?: string;
  },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const qty = Number(body.qty);
  if (!qty || qty <= 0) throw new InventoryFoundationDbError("qty must be greater than 0.");
  if (!body.projectId?.trim()) throw new InventoryFoundationDbError("projectId is required.");

  const item = await loadItemById(body.inventoryItemId, localDb);
  if (!item) throw new InventoryFoundationDbError("Inventory item not found.", 404);
  if (item.availableQty < qty) {
    throw new InventoryFoundationDbError(
      `Cannot reserve ${qty} units. Only ${item.availableQty} available.`
    );
  }

  item.reservedQty += qty;
  item.updatedAt = new Date().toISOString();
  const saved = await persistItem(item, localDb);
  const movement = await insertMovement(
    {
      inventoryItemId: body.inventoryItemId,
      movementType: "reserve",
      qty,
      referenceType: "project",
      referenceId: body.projectId,
      notes: body.notes || null,
      createdBy: staffUserId,
    },
    localDb
  );
  const reservation = await insertReservation(
    {
      projectId: body.projectId.trim(),
      deliveryId: body.deliveryId || null,
      inventoryItemId: body.inventoryItemId,
      qtyReserved: qty,
      createdBy: staffUserId,
    },
    localDb
  );
  return { item: saved, movement, reservation };
}

export async function releaseAdminInventoryReservation(
  staffUserId: string,
  staffUsername: string,
  reservationId: string,
  body: { notes?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);

  let reservation: ProjectInventoryReservation | null = null;
  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from(RESERVATIONS_TABLE)
      .select("*")
      .eq("id", reservationId)
      .maybeSingle();
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    reservation = data ? mapReservationRow(data) : null;
  } else {
    const row = ((localDb as any)?.projectInventoryReservations || []).find((r: any) => r.id === reservationId);
    reservation = row ? mapReservationRow(row) : null;
  }

  if (!reservation) throw new InventoryFoundationDbError("Reservation not found.", 404);
  if (reservation.status !== "reserved") {
    throw new InventoryFoundationDbError(`Reservation is already ${reservation.status}.`);
  }

  const item = await loadItemById(reservation.inventoryItemId, localDb);
  if (!item) throw new InventoryFoundationDbError("Inventory item not found.", 404);

  item.reservedQty = Math.max(0, item.reservedQty - reservation.qtyReserved);
  item.updatedAt = new Date().toISOString();
  const saved = await persistItem(item, localDb);
  const movement = await insertMovement(
    {
      inventoryItemId: reservation.inventoryItemId,
      movementType: "release",
      qty: reservation.qtyReserved,
      referenceType: "project",
      referenceId: reservation.projectId,
      notes: body.notes || `Release reservation ${reservationId}`,
      createdBy: staffUserId,
    },
    localDb
  );
  const updatedReservation = await updateReservationStatus(reservationId, "released", localDb);
  return { item: saved, movement, reservation: updatedReservation };
}

export async function listAdminInventoryMovements(
  staffUserId: string,
  staffUsername: string,
  opts: { inventoryItemId?: string; limit?: number },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);
  const limit = Math.min(Math.max(Number(opts.limit || 100), 1), 500);

  if (isSupabaseActive()) {
    let query = getSupabase()!.from(MOVEMENTS_TABLE).select("*").order("created_at", { ascending: false }).limit(limit);
    if (opts.inventoryItemId) query = query.eq("inventory_item_id", opts.inventoryItemId);
    const { data, error } = await query;
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return { movements: (data || []).map(mapMovementRow) };
  }

  let rows = ((localDb as any)?.inventoryFoundationMovements || []).map(mapMovementRow);
  if (opts.inventoryItemId) {
    rows = rows.filter((m) => m.inventoryItemId === opts.inventoryItemId);
  }
  return { movements: rows.slice(0, limit) };
}

export async function listAdminInventoryReservations(
  staffUserId: string,
  staffUsername: string,
  opts: { status?: string; inventoryItemId?: string },
  localDb?: Database
) {
  await verifyStaffPortalUser(staffUserId, staffUsername, localDb);

  if (isSupabaseActive()) {
    let query = getSupabase()!.from(RESERVATIONS_TABLE).select("*").order("created_at", { ascending: false });
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.inventoryItemId) query = query.eq("inventory_item_id", opts.inventoryItemId);
    const { data, error } = await query;
    if (error) {
      if (isInventoryTableMissing(error)) throw inventoryTableMissingError();
      throw error;
    }
    return { reservations: (data || []).map(mapReservationRow) };
  }

  let rows = ((localDb as any)?.projectInventoryReservations || []).map(mapReservationRow);
  if (opts.status) rows = rows.filter((r) => r.status === opts.status);
  if (opts.inventoryItemId) rows = rows.filter((r) => r.inventoryItemId === opts.inventoryItemId);
  return { reservations: rows };
}
