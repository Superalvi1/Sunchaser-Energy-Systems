import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  History,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Unlock,
} from "lucide-react";
import { Product, User } from "../types";
import {
  adjustAdminInventoryItem,
  createAdminInventoryFoundationItem,
  fetchAdminInventoryFoundationItems,
  fetchAdminInventoryMovements,
  fetchAdminInventoryReservations,
  fetchAdminLowStockItems,
  fetchAdminProjectDeliveries,
  releaseAdminInventoryReservation,
  reserveAdminInventoryForProject,
  stockInAdminInventoryItem,
  stockOutAdminInventoryItem,
} from "../services/api";
import {
  MOVEMENT_TYPE_LABELS,
  type InventoryFoundationItem,
  type InventoryMovementRecord,
  type ProjectInventoryReservation,
} from "../lib/inventoryFoundation";
import AppModal from "./ui/AppModal";

type Screen = "list" | "movements" | "low-stock";

interface InventoryStaffProps {
  staffUser: User;
  products?: Product[];
  onRefreshState?: () => void;
}

const CATEGORIES = ["Solar Panels", "Inverters", "Batteries", "Structure", "Cables", "Protection", "Accessories"];

export default function InventoryStaff({ staffUser, products = [], onRefreshState }: InventoryStaffProps) {
  const [screen, setScreen] = useState<Screen>("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InventoryFoundationItem[]>([]);
  const [lowStock, setLowStock] = useState<InventoryFoundationItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);
  const [reservations, setReservations] = useState<ProjectInventoryReservation[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [showStockIn, setShowStockIn] = useState(false);
  const [showStockOut, setShowStockOut] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showReserve, setShowReserve] = useState(false);
  const [showRelease, setShowRelease] = useState(false);

  const [addForm, setAddForm] = useState({
    productId: "",
    category: CATEGORIES[0],
    brand: "",
    model: "",
    sku: "",
    costPrice: 0,
    salePrice: 0,
    supplier: "",
    warehouseLocation: "",
    serialRequired: false,
    lowStockThreshold: 5,
    initialStock: 0,
  });
  const [qty, setQty] = useState(1);
  const [qtyDelta, setQtyDelta] = useState(1);
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [releaseReservationId, setReleaseReservationId] = useState("");

  const staff = staffUser;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, lowRes, movRes, resRes, delRes] = await Promise.all([
        fetchAdminInventoryFoundationItems(staff.id, staff.username, staff.role),
        fetchAdminLowStockItems(staff.id, staff.username, staff.role),
        fetchAdminInventoryMovements(staff.id, staff.username, { limit: 200 }, staff.role),
        fetchAdminInventoryReservations(staff.id, staff.username, { status: "reserved" }, staff.role),
        fetchAdminProjectDeliveries(staff.id, staff.username).catch(() => ({ deliveries: [] })),
      ]);
      setItems(itemsRes.items || []);
      setLowStock(lowRes.items || []);
      setMovements(movRes.movements || []);
      setReservations(resRes.reservations || []);
      setDeliveries(delRes.deliveries || []);
      if (!selectedItemId && itemsRes.items?.[0]?.id) setSelectedItemId(itemsRes.items[0].id);
    } catch (err: any) {
      setError(err.message || "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  }, [staff.id, staff.username, staff.role, selectedItemId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.sku.toLowerCase().includes(q) ||
        i.brand.toLowerCase().includes(q) ||
        i.model.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }, [items, search]);

  const selectedItem = items.find((i) => i.id === selectedItemId) || null;
  const itemLabel = (id: string) => {
    const i = items.find((x) => x.id === id);
    return i ? `${i.brand} ${i.model} (${i.sku})` : id;
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onRefreshState?.();
    } catch (err: any) {
      setError(err.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const fillFromProduct = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setAddForm((f) => ({
      ...f,
      productId: p.id,
      category: p.category || f.category,
      brand: p.brand || "",
      model: p.model || "",
      sku: p.sku || f.sku,
      costPrice: Number(p.specifications?.costPrice || 0),
      salePrice: Number(p.price || 0),
    }));
  };

  if (loading && items.length === 0) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-in-entry text-left font-sans">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
            <Package className="h-5 w-5 text-amber-500" />
            Solar Inventory
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Warehouse stock, reservations, and movement history. Product Library catalog is read-only reference.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Item
          </button>
          <button
            type="button"
            onClick={() => load()}
            className="bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs px-3 py-2 rounded-xl flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs p-3 rounded-xl">{notice}</div>
      )}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs p-3 rounded-xl">{error}</div>
      )}

      {lowStock.length > 0 && screen !== "low-stock" && (
        <div className="bg-rose-950/30 border border-rose-900/50 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-bold text-rose-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Low stock alert — {lowStock.length} item(s)
          </p>
          <div className="flex flex-wrap gap-2 text-[10px] font-mono">
            {lowStock.slice(0, 6).map((i) => (
              <span key={i.id} className="bg-rose-950 border border-rose-900 px-2 py-1 rounded-lg text-rose-300">
                {i.brand} {i.model}: {i.availableQty} avail (threshold {i.lowStockThreshold})
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 bg-neutral-950 p-1.5 rounded-2xl border border-neutral-850">
        {(
          [
            { id: "list" as const, label: "Inventory List", icon: Package },
            { id: "movements" as const, label: "Movement History", icon: History },
            { id: "low-stock" as const, label: "Low Stock", icon: AlertTriangle },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScreen(tab.id)}
              className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
                screen === tab.id ? "bg-amber-500 text-neutral-950" : "text-neutral-400 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {screen === "list" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, brand, model…"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-xs text-neutral-100"
              />
            </div>
            {selectedItem && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowStockIn(true)} className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-[10px] font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 hover:border-amber-700">
                  <ArrowDownCircle className="h-3.5 w-3.5" /> Stock In
                </button>
                <button type="button" onClick={() => setShowStockOut(true)} className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-[10px] font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 hover:border-amber-700">
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Stock Out
                </button>
                <button type="button" onClick={() => setShowAdjust(true)} className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-[10px] font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 hover:border-amber-700">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
                </button>
                <button type="button" onClick={() => setShowReserve(true)} className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-[10px] font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 hover:border-amber-700">
                  <Package className="h-3.5 w-3.5" /> Reserve
                </button>
                <button type="button" onClick={() => setShowRelease(true)} className="bg-neutral-900 border border-neutral-800 text-neutral-200 text-[10px] font-bold px-2.5 py-1.5 rounded-xl flex items-center gap-1 hover:border-amber-700">
                  <Unlock className="h-3.5 w-3.5" /> Release
                </button>
              </div>
            )}
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase font-mono">
                  <th className="py-3 px-4">SKU</th>
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Stock</th>
                  <th className="py-3 px-4 text-right">Reserved</th>
                  <th className="py-3 px-4 text-right">Available</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-850 text-neutral-300">
                {filteredItems.map((item) => {
                  const low = item.availableQty <= item.lowStockThreshold;
                  const selected = item.id === selectedItemId;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      className={`cursor-pointer hover:bg-neutral-950 ${selected ? "bg-amber-500/5" : ""}`}
                    >
                      <td className="py-2.5 px-4 font-mono text-neutral-400">{item.sku}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-semibold text-neutral-100">{item.brand} {item.model}</span>
                        {item.productId && (
                          <span className="block text-[9px] text-neutral-500">Catalog ref: {item.productId}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">{item.category}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{item.stockQty}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-amber-400/90">{item.reservedQty}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-400">{item.availableQty}</td>
                      <td className="py-2.5 px-4 text-neutral-500">{item.warehouseLocation || "—"}</td>
                      <td className="py-2.5 px-4">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${low ? "border-rose-800 text-rose-400 bg-rose-950/40" : "border-emerald-900 text-emerald-400 bg-emerald-950/30"}`}>
                          {low ? "Low" : "OK"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-neutral-500">
                      No inventory items yet. Add your first warehouse SKU.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {reservations.length > 0 && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-bold uppercase text-neutral-400 font-mono">Active reservations</h3>
              <ul className="space-y-1 text-[11px] font-mono">
                {reservations.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 text-neutral-300">
                    <span>{itemLabel(r.inventoryItemId)} · project {r.projectId} · qty {r.qtyReserved}</span>
                    <button
                      type="button"
                      className="text-amber-400 hover:underline"
                      onClick={() => {
                        setReleaseReservationId(r.id);
                        setShowRelease(true);
                      }}
                    >
                      Release
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {screen === "movements" && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-3xl overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-neutral-900">
              <tr className="border-b border-neutral-800 text-neutral-400 text-[10px] uppercase font-mono">
                <th className="py-3 px-4">When</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Item</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-850 text-neutral-300">
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 px-4 font-mono text-[10px] text-neutral-500">
                    {new Date(m.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 px-4">{MOVEMENT_TYPE_LABELS[m.movementType] || m.movementType}</td>
                  <td className="py-2 px-4">{itemLabel(m.inventoryItemId)}</td>
                  <td className="py-2 px-4 text-right font-mono">{m.qty}</td>
                  <td className="py-2 px-4 text-[10px]">
                    {m.referenceType ? `${m.referenceType}${m.referenceId ? `: ${m.referenceId}` : ""}` : "—"}
                  </td>
                  <td className="py-2 px-4 text-neutral-500">{m.notes || "—"}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-neutral-500">No movements recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {screen === "low-stock" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lowStock.length === 0 ? (
            <p className="text-sm text-neutral-500 col-span-2 py-8 text-center">All items above their low-stock thresholds.</p>
          ) : (
            lowStock.map((i) => (
              <div key={i.id} className="bg-neutral-900 border border-rose-900/40 rounded-2xl p-4 space-y-1">
                <p className="text-sm font-bold text-white">{i.brand} {i.model}</p>
                <p className="text-[10px] font-mono text-neutral-500">{i.sku} · {i.category}</p>
                <p className="text-xs text-rose-400">
                  Available {i.availableQty} / threshold {i.lowStockThreshold} (stock {i.stockQty}, reserved {i.reservedQty})
                </p>
              </div>
            ))
          )}
        </div>
      )}

      <AppModal open={showAdd} onClose={() => setShowAdd(false)} panelClassName="max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-white mb-4">Add inventory item</h3>
        <form
          className="space-y-3 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            runAction(async () => {
              await createAdminInventoryFoundationItem(staff.id, staff.username, {
                ...addForm,
                productId: addForm.productId || null,
              }, staff.role);
              setShowAdd(false);
              flash("Inventory item created.");
            });
          }}
        >
          {products.length > 0 && (
            <label className="block space-y-1">
              <span className="text-neutral-400">Link to Product Library (optional)</span>
              <select
                value={addForm.productId}
                onChange={(e) => {
                  setAddForm((f) => ({ ...f, productId: e.target.value }));
                  if (e.target.value) fillFromProduct(e.target.value);
                }}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100"
              >
                <option value="">— None —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.brand} {p.model} ({p.sku})</option>
                ))}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Brand" required value={addForm.brand} onChange={(e) => setAddForm((f) => ({ ...f, brand: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input placeholder="Model" required value={addForm.model} onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input placeholder="SKU" value={addForm.sku} onChange={(e) => setAddForm((f) => ({ ...f, sku: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <select value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="number" placeholder="Cost" value={addForm.costPrice} onChange={(e) => setAddForm((f) => ({ ...f, costPrice: Number(e.target.value) }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input type="number" placeholder="Sale price" value={addForm.salePrice} onChange={(e) => setAddForm((f) => ({ ...f, salePrice: Number(e.target.value) }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input placeholder="Supplier" value={addForm.supplier} onChange={(e) => setAddForm((f) => ({ ...f, supplier: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input placeholder="Warehouse location" value={addForm.warehouseLocation} onChange={(e) => setAddForm((f) => ({ ...f, warehouseLocation: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input type="number" placeholder="Low stock threshold" value={addForm.lowStockThreshold} onChange={(e) => setAddForm((f) => ({ ...f, lowStockThreshold: Number(e.target.value) }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
            <input type="number" placeholder="Initial stock" value={addForm.initialStock} onChange={(e) => setAddForm((f) => ({ ...f, initialStock: Number(e.target.value) }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100" />
          </div>
          <label className="flex items-center gap-2 text-neutral-400">
            <input type="checkbox" checked={addForm.serialRequired} onChange={(e) => setAddForm((f) => ({ ...f, serialRequired: e.target.checked }))} />
            Serial number required
          </label>
          <button type="submit" disabled={busy} className="w-full bg-amber-500 text-neutral-950 font-bold py-2 rounded-xl">Create item</button>
        </form>
      </AppModal>

      <ActionModal open={showStockIn} onClose={() => setShowStockIn(false)} title="Stock In" busy={busy} onSubmit={() =>
        runAction(async () => {
          if (!selectedItemId) throw new Error("Select an item first.");
          await stockInAdminInventoryItem(staff.id, staff.username, selectedItemId, { qty, notes }, staff.role);
          setShowStockIn(false);
          flash(`Stocked in ${qty} units.`);
        })
      }>
        <p className="text-neutral-400 mb-2">{selectedItem ? `${selectedItem.brand} ${selectedItem.model}` : "Select item from list"}</p>
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2" />
        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full" />
      </ActionModal>

      <ActionModal open={showStockOut} onClose={() => setShowStockOut(false)} title="Stock Out" busy={busy} onSubmit={() =>
        runAction(async () => {
          if (!selectedItemId) throw new Error("Select an item first.");
          await stockOutAdminInventoryItem(staff.id, staff.username, selectedItemId, { qty, notes }, staff.role);
          setShowStockOut(false);
          flash(`Stocked out ${qty} units.`);
        })
      }>
        <p className="text-neutral-400 mb-2">Available: {selectedItem?.availableQty ?? 0}</p>
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2" />
        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full" />
      </ActionModal>

      <ActionModal open={showAdjust} onClose={() => setShowAdjust(false)} title="Adjust Stock" busy={busy} onSubmit={() =>
        runAction(async () => {
          if (!selectedItemId) throw new Error("Select an item first.");
          await adjustAdminInventoryItem(staff.id, staff.username, selectedItemId, { qtyDelta, notes }, staff.role);
          setShowAdjust(false);
          flash(`Adjusted stock by ${qtyDelta > 0 ? "+" : ""}${qtyDelta}.`);
        })
      }>
        <p className="text-neutral-400 mb-2">Use negative values to reduce stock.</p>
        <input type="number" value={qtyDelta} onChange={(e) => setQtyDelta(Number(e.target.value))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2" />
        <input placeholder="Reason" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full" />
      </ActionModal>

      <ActionModal open={showReserve} onClose={() => setShowReserve(false)} title="Reserve for Project" busy={busy} onSubmit={() =>
        runAction(async () => {
          if (!selectedItemId) throw new Error("Select an item first.");
          await reserveAdminInventoryForProject(staff.id, staff.username, {
            inventoryItemId: selectedItemId,
            projectId,
            deliveryId: deliveryId || null,
            qty,
            notes,
          }, staff.role);
          setShowReserve(false);
          flash(`Reserved ${qty} units for project ${projectId}.`);
        })
      }>
        <p className="text-neutral-400 mb-2">Available: {selectedItem?.availableQty ?? 0}</p>
        <select value={deliveryId} onChange={(e) => { setDeliveryId(e.target.value); const d = deliveries.find((x) => x.id === e.target.value); if (d) setProjectId(d.id || d.projectId || projectId); }} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2">
          <option value="">Project / delivery (optional)</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>{d.projectTitle || d.project_title || d.id}</option>
          ))}
        </select>
        <input placeholder="Project ID" required value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2" />
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2" />
        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full" />
      </ActionModal>

      <ActionModal open={showRelease} onClose={() => setShowRelease(false)} title="Release Reservation" busy={busy} onSubmit={() =>
        runAction(async () => {
          if (!releaseReservationId) throw new Error("Select a reservation.");
          await releaseAdminInventoryReservation(staff.id, staff.username, releaseReservationId, { notes }, staff.role);
          setShowRelease(false);
          flash("Reservation released.");
        })
      }>
        <select value={releaseReservationId} onChange={(e) => setReleaseReservationId(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full mb-2">
          <option value="">Select reservation</option>
          {reservations.map((r) => (
            <option key={r.id} value={r.id}>{itemLabel(r.inventoryItemId)} · {r.qtyReserved} for {r.projectId}</option>
          ))}
        </select>
        <input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-neutral-100 w-full" />
      </ActionModal>
    </div>
  );
}

function ActionModal({
  open,
  onClose,
  title,
  busy,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  busy: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <AppModal open={open} onClose={onClose} panelClassName="max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
      <h3 className="text-sm font-bold text-white mb-4">{title}</h3>
      <form
        className="space-y-3 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        <button type="submit" disabled={busy} className="w-full bg-amber-500 text-neutral-950 font-bold py-2 rounded-xl">
          {busy ? "Saving…" : "Confirm"}
        </button>
      </form>
    </AppModal>
  );
}
