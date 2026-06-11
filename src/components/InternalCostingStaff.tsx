import React, { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  FileSpreadsheet,
  Loader2,
  Lock,
  PieChart,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Lead, User } from "../types";
import { useToast } from "../lib/toast";
import {
  canViewInternalCosting,
  computeCostingItem,
  computeCostingTotals,
  computePurchaseTotal,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_PAYMENT_STATUSES,
  type InternalCostingItem,
  type InternalCostingSheet,
  type InventoryPurchaseRecord,
  type InvestorWithBalance,
} from "../lib/internalCosting";
import {
  createAdminCostingSheet,
  createAdminInvestor,
  createAdminInventoryPurchase,
  deleteAdminCostingSheet,
  deleteAdminInvestor,
  deleteAdminInventoryPurchase,
  fetchAdminCostingReports,
  fetchAdminCostingSheets,
  fetchAdminInventoryFoundationItems,
  fetchAdminInventoryPurchases,
  fetchAdminInvestors,
  updateAdminCostingSheet,
  updateAdminInvestor,
} from "../services/api";

type Props = {
  staffUser: User;
  leads: Lead[];
};

type PanelTab = "sheets" | "investors" | "purchases" | "reports";

const fmt = (n: number) =>
  `Rs. ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const inputCls =
  "w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-100 focus:outline-none focus:border-amber-500";
const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1";
const btnPrimary =
  "inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost =
  "inline-flex items-center gap-2 border border-neutral-700 hover:border-neutral-500 text-neutral-300 text-xs font-bold px-3 py-2 rounded-lg";
const cardCls = "bg-neutral-900 border border-neutral-800 rounded-2xl p-5";

function emptyItem(): InternalCostingItem {
  return computeCostingItem({});
}

export default function InternalCostingStaff({ staffUser, leads }: Props) {
  const toast = useToast();
  const staff = { id: staffUser.id, username: staffUser.username, role: staffUser.role };
  const allowed = canViewInternalCosting(staffUser.username, staffUser.role);

  const [tab, setTab] = useState<PanelTab>("sheets");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [sheets, setSheets] = useState<InternalCostingSheet[]>([]);
  const [investors, setInvestors] = useState<InvestorWithBalance[]>([]);
  const [purchases, setPurchases] = useState<InventoryPurchaseRecord[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [reports, setReports] = useState<any>(null);

  // Costing sheet editor state
  const [editingSheet, setEditingSheet] = useState<InternalCostingSheet | null>(null);
  const [sheetDraft, setSheetDraft] = useState({
    leadId: "",
    clientName: "",
    quotationId: "",
    quotationValue: "",
    amountReceived: "",
    notes: "",
    consumeInventory: false,
  });
  const [itemsDraft, setItemsDraft] = useState<InternalCostingItem[]>([]);
  const [showSheetEditor, setShowSheetEditor] = useState(false);

  // Investor form state
  const [investorDraft, setInvestorDraft] = useState({
    id: "",
    name: "",
    amountReceived: "",
    dateReceived: "",
    purpose: "",
    notes: "",
  });
  const [showInvestorForm, setShowInvestorForm] = useState(false);

  // Purchase form state
  const [purchaseDraft, setPurchaseDraft] = useState({
    supplierName: "",
    productName: "",
    quantity: "",
    purchaseRate: "",
    investorId: "",
    inventoryItemId: "",
    paymentMethod: "Bank Transfer",
    paymentStatus: "Unpaid",
    billUrl: "",
    notes: "",
  });
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);

  const loadAll = async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [sheetData, investorData, purchaseData, invItems] = await Promise.all([
        fetchAdminCostingSheets(staff),
        fetchAdminInvestors(staff),
        fetchAdminInventoryPurchases(staff),
        fetchAdminInventoryFoundationItems(staff.id, staff.username, staff.role).catch(() => ({
          items: [],
        })),
      ]);
      setSheets(sheetData.sheets || []);
      setInvestors(investorData.investors || []);
      setPurchases(purchaseData.purchases || []);
      setInventoryItems((invItems as any).items || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load internal costing data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "reports" && allowed) {
      fetchAdminCostingReports(staff)
        .then(setReports)
        .catch((err) => toast.error(err.message || "Failed to load reports."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sheets.length, purchases.length, investors.length]);

  const liveTotals = useMemo(
    () =>
      computeCostingTotals({
        quotationValue: sheetDraft.quotationValue,
        amountReceived: sheetDraft.amountReceived,
        items: itemsDraft,
      }),
    [sheetDraft.quotationValue, sheetDraft.amountReceived, itemsDraft]
  );

  if (!allowed) {
    return (
      <div className={`${cardCls} flex items-center gap-3 text-neutral-400 text-sm`}>
        <Lock className="h-5 w-5 text-amber-500" />
        Internal costing is restricted to Super Admin.
      </div>
    );
  }

  // ----------------------------- Sheet editor helpers -----------------------------

  const openNewSheet = () => {
    setEditingSheet(null);
    setSheetDraft({
      leadId: "",
      clientName: "",
      quotationId: "",
      quotationValue: "",
      amountReceived: "",
      notes: "",
      consumeInventory: false,
    });
    setItemsDraft([emptyItem()]);
    setShowSheetEditor(true);
  };

  const openExistingSheet = (sheet: InternalCostingSheet) => {
    setEditingSheet(sheet);
    setSheetDraft({
      leadId: sheet.leadId || "",
      clientName: sheet.clientName,
      quotationId: sheet.quotationId || "",
      quotationValue: String(sheet.quotationValue || ""),
      amountReceived: String(sheet.amountReceived || ""),
      notes: sheet.notes || "",
      consumeInventory: !!sheet.consumeInventory,
    });
    setItemsDraft(sheet.items.map((it) => computeCostingItem(it)));
    setShowSheetEditor(true);
  };

  const onPickLead = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    const quote = lead?.quotes?.[0];
    setSheetDraft((d) => ({
      ...d,
      leadId,
      clientName: lead ? lead.name : d.clientName,
      quotationId: quote?.id || "",
      quotationValue: quote ? String(quote.totalCost || "") : d.quotationValue,
    }));
  };

  const patchItem = (idx: number, patch: Partial<InternalCostingItem>) => {
    setItemsDraft((rows) =>
      rows.map((row, i) => (i === idx ? computeCostingItem({ ...row, ...patch }) : row))
    );
  };

  const saveSheet = async () => {
    if (!sheetDraft.clientName.trim()) {
      toast.error("Client name is required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        clientName: sheetDraft.clientName.trim(),
        leadId: sheetDraft.leadId || null,
        quotationId: sheetDraft.quotationId || null,
        quotationValue: Number(sheetDraft.quotationValue || 0),
        amountReceived: Number(sheetDraft.amountReceived || 0),
        notes: sheetDraft.notes,
        consumeInventory: sheetDraft.consumeInventory,
        items: itemsDraft.filter((it) => it.itemName.trim() || it.totalPurchaseCost > 0),
      };
      if (editingSheet) {
        await updateAdminCostingSheet(staff, editingSheet.id, body);
        toast.success("Costing sheet updated.");
      } else {
        await createAdminCostingSheet(staff, body);
        toast.success("Costing sheet created.");
      }
      setShowSheetEditor(false);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to save costing sheet.");
    } finally {
      setSaving(false);
    }
  };

  const removeSheet = async (sheet: InternalCostingSheet) => {
    if (!window.confirm(`Delete internal costing sheet for "${sheet.clientName}"?`)) return;
    try {
      await deleteAdminCostingSheet(staff, sheet.id);
      toast.success("Costing sheet deleted.");
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Delete failed.");
    }
  };

  // ----------------------------- Investor helpers -----------------------------

  const saveInvestor = async () => {
    if (!investorDraft.name.trim()) {
      toast.error("Investor name is required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: investorDraft.name.trim(),
        amountReceived: Number(investorDraft.amountReceived || 0),
        dateReceived: investorDraft.dateReceived || null,
        purpose: investorDraft.purpose,
        notes: investorDraft.notes,
      };
      if (investorDraft.id) {
        await updateAdminInvestor(staff, investorDraft.id, body);
        toast.success("Investor updated.");
      } else {
        await createAdminInvestor(staff, body);
        toast.success("Investor added.");
      }
      setShowInvestorForm(false);
      setInvestorDraft({ id: "", name: "", amountReceived: "", dateReceived: "", purpose: "", notes: "" });
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to save investor.");
    } finally {
      setSaving(false);
    }
  };

  const removeInvestor = async (inv: InvestorWithBalance) => {
    if (!window.confirm(`Delete investor "${inv.name}"?`)) return;
    try {
      await deleteAdminInvestor(staff, inv.id);
      toast.success("Investor deleted.");
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Delete failed.");
    }
  };

  // ----------------------------- Purchase helpers -----------------------------

  const purchaseTotal = computePurchaseTotal(purchaseDraft.quantity, purchaseDraft.purchaseRate);
  const selectedInvestor = investors.find((i) => i.id === purchaseDraft.investorId);

  const savePurchase = async () => {
    setSaving(true);
    try {
      await createAdminInventoryPurchase(staff, {
        supplierName: purchaseDraft.supplierName,
        productName: purchaseDraft.productName,
        quantity: Number(purchaseDraft.quantity || 0),
        purchaseRate: Number(purchaseDraft.purchaseRate || 0),
        investorId: purchaseDraft.investorId || null,
        inventoryItemId: purchaseDraft.inventoryItemId || null,
        paymentMethod: purchaseDraft.paymentMethod,
        paymentStatus: purchaseDraft.paymentStatus,
        billUrl: purchaseDraft.billUrl || null,
        notes: purchaseDraft.notes,
      });
      toast.success(
        purchaseDraft.inventoryItemId
          ? "Purchase recorded and inventory stock increased."
          : "Purchase recorded."
      );
      setShowPurchaseForm(false);
      setPurchaseDraft({
        supplierName: "",
        productName: "",
        quantity: "",
        purchaseRate: "",
        investorId: "",
        inventoryItemId: "",
        paymentMethod: "Bank Transfer",
        paymentStatus: "Unpaid",
        billUrl: "",
        notes: "",
      });
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Failed to record purchase.");
    } finally {
      setSaving(false);
    }
  };

  const removePurchase = async (p: InventoryPurchaseRecord) => {
    if (
      !window.confirm(
        `Delete purchase of "${p.productName}"?${p.inventoryItemId ? " Linked stock will be reversed." : ""}`
      )
    )
      return;
    try {
      await deleteAdminInventoryPurchase(staff, p.id);
      toast.success("Purchase deleted.");
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || "Delete failed.");
    }
  };

  const invItemLabel = (id: string | null) => {
    if (!id) return "—";
    const it = inventoryItems.find((x: any) => x.id === id);
    if (!it) return id;
    return [it.brand, it.model].filter(Boolean).join(" ") || it.sku || id;
  };

  const investorName = (id: string | null) =>
    id ? investors.find((i) => i.id === id)?.name || id : "—";

  const lastPurchaseForItem = (inventoryItemId: string | null) => {
    if (!inventoryItemId) return null;
    return purchases.find((p) => p.inventoryItemId === inventoryItemId) || null;
  };

  // ----------------------------- Render -----------------------------

  const tabs: { id: PanelTab; label: string; icon: any }[] = [
    { id: "sheets", label: "Costing Sheets", icon: FileSpreadsheet },
    { id: "investors", label: "Investors", icon: Users },
    { id: "purchases", label: "Purchases", icon: ShoppingCart },
    { id: "reports", label: "Reports", icon: PieChart },
  ];

  return (
    <div className="space-y-5 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-neutral-100">Internal Costing & Investor Ledger</h2>
          <p className="text-[11px] text-neutral-500">
            Super Admin only. Hidden from sales users and the customer portal.
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={loadAll} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border transition ${
                tab === t.id
                  ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
                  : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-600"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ------------------------------ SHEETS TAB ------------------------------ */}
      {tab === "sheets" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} onClick={openNewSheet}>
              <Plus className="h-4 w-4" /> New Costing Sheet
            </button>
          </div>

          {sheets.length === 0 && !loading && (
            <div className={`${cardCls} text-xs text-neutral-500`}>
              No internal costing sheets yet. Create one for a client quotation to track purchase
              costs and profit.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sheets.map((sheet) => (
              <div key={sheet.id} className={`${cardCls} space-y-3`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-neutral-100">
                      {sheet.title || sheet.clientName}
                    </div>
                    {sheet.autoCreated && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-500/80">
                        Auto from contract
                      </span>
                    )}
                    <div className="text-[10px] text-neutral-500 font-mono">
                      {sheet.id}
                      {sheet.quotationId ? ` · quote ${sheet.quotationId}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-bold text-amber-400 hover:text-amber-300"
                      onClick={() => openExistingSheet(sheet)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="text-neutral-600 hover:text-red-400"
                      onClick={() => removeSheet(sheet)}
                      title="Delete sheet"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div>
                    <div className="text-neutral-500">Quotation</div>
                    <div className="font-bold text-neutral-200">{fmt(sheet.totals.quotationValue)}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Purchase Cost</div>
                    <div className="font-bold text-neutral-200">
                      {fmt(sheet.totals.totalPurchaseCost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Gross Profit</div>
                    <div
                      className={`font-bold ${sheet.totals.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {fmt(sheet.totals.grossProfit)}
                    </div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Profit %</div>
                    <div className="font-bold text-neutral-200">{sheet.totals.profitPercent}%</div>
                  </div>
                </div>
                <div className="text-[10px] text-neutral-500">
                  {sheet.items.length} item(s) · Received {fmt(sheet.totals.amountReceived)} · Paid to
                  suppliers {fmt(sheet.totals.amountPaidToSuppliers)} · Net cash{" "}
                  {fmt(sheet.totals.netCashRemaining)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------ SHEET EDITOR MODAL ------------------------------ */}
      {showSheetEditor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-5xl my-8 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-neutral-100">
                {editingSheet ? `Internal Costing — ${editingSheet.clientName}` : "New Internal Costing Sheet"}
              </h3>
              <button
                type="button"
                className="text-neutral-500 hover:text-neutral-200"
                onClick={() => setShowSheetEditor(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Client / Lead</label>
                <select
                  className={inputCls}
                  value={sheetDraft.leadId}
                  onChange={(e) => onPickLead(e.target.value)}
                >
                  <option value="">— Manual client —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Client Name</label>
                <input
                  className={inputCls}
                  value={sheetDraft.clientName}
                  onChange={(e) => setSheetDraft((d) => ({ ...d, clientName: e.target.value }))}
                  placeholder="e.g. Arsalan"
                />
              </div>
              <div>
                <label className={labelCls}>Quotation Value (Rs.)</label>
                <input
                  type="number"
                  className={inputCls}
                  value={sheetDraft.quotationValue}
                  onChange={(e) => setSheetDraft((d) => ({ ...d, quotationValue: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Amount Received From Client (Rs.)</label>
                <input
                  type="number"
                  className={inputCls}
                  value={sheetDraft.amountReceived}
                  onChange={(e) => setSheetDraft((d) => ({ ...d, amountReceived: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  value={sheetDraft.notes}
                  onChange={(e) => setSheetDraft((d) => ({ ...d, notes: e.target.value }))}
                  placeholder="Internal notes (never shown to customer)"
                />
              </div>
              <div className="sm:col-span-3 flex flex-wrap items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-[11px] text-neutral-300">
                  <input
                    type="checkbox"
                    checked={sheetDraft.consumeInventory}
                    onChange={(e) =>
                      setSheetDraft((d) => ({ ...d, consumeInventory: e.target.checked }))
                    }
                  />
                  Consume Inventory (reserve on save, consume when installation starts)
                </label>
                {editingSheet?.stockReserved && (
                  <span className="text-[10px] text-neutral-500">
                    Reserved stock value: {fmt(editingSheet.reservedStockValue)}
                  </span>
                )}
                {editingSheet && editingSheet.consumedStockValue > 0 && (
                  <span className="text-[10px] text-emerald-400">
                    Consumed stock value: {fmt(editingSheet.consumedStockValue)}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Costing Items
                </div>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => setItemsDraft((rows) => [...rows, emptyItem()])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </button>
              </div>

              <div className="overflow-x-auto border border-neutral-800 rounded-xl">
                <table className="w-full text-[11px] min-w-[1100px]">
                  <thead>
                    <tr className="text-neutral-500 text-[10px] uppercase tracking-wider bg-neutral-950/60">
                      <th className="text-left p-2">Item</th>
                      <th className="text-left p-2">Supplier</th>
                      <th className="text-right p-2">Buy Rate</th>
                      <th className="text-right p-2">Buy Qty</th>
                      <th className="text-right p-2">Sale Rate</th>
                      <th className="text-right p-2">Sale Qty</th>
                      <th className="text-right p-2">Cost</th>
                      <th className="text-right p-2">Sale</th>
                      <th className="text-right p-2">Profit</th>
                      <th className="text-center p-2">Paid?</th>
                      <th className="text-left p-2">Paid Date</th>
                      <th className="text-left p-2">Stock Link</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {itemsDraft.map((item, idx) => {
                      const lastPurchase = lastPurchaseForItem(item.inventoryItemId);
                      return (
                        <tr key={item.id} className="border-t border-neutral-800 align-top">
                          <td className="p-2 min-w-[140px]">
                            <input
                              className={inputCls}
                              value={item.itemName}
                              onChange={(e) => patchItem(idx, { itemName: e.target.value })}
                              placeholder="Longi X10 panels"
                            />
                            <input
                              className={`${inputCls} mt-1`}
                              value={item.notes}
                              onChange={(e) => patchItem(idx, { notes: e.target.value })}
                              placeholder="Notes"
                            />
                          </td>
                          <td className="p-2 min-w-[120px]">
                            <input
                              className={inputCls}
                              value={item.supplierName}
                              onChange={(e) => patchItem(idx, { supplierName: e.target.value })}
                              placeholder="Solar Market Lahore"
                            />
                          </td>
                          <td className="p-2 w-24">
                            <input
                              type="number"
                              className={`${inputCls} text-right`}
                              value={item.purchaseRate || ""}
                              onChange={(e) => patchItem(idx, { purchaseRate: Number(e.target.value) })}
                            />
                          </td>
                          <td className="p-2 w-20">
                            <input
                              type="number"
                              className={`${inputCls} text-right`}
                              value={item.purchaseQty || ""}
                              onChange={(e) =>
                                patchItem(idx, {
                                  purchaseQty: Number(e.target.value),
                                  saleQty:
                                    item.saleQty === item.purchaseQty
                                      ? Number(e.target.value)
                                      : item.saleQty,
                                })
                              }
                            />
                          </td>
                          <td className="p-2 w-24">
                            <input
                              type="number"
                              className={`${inputCls} text-right`}
                              value={item.saleRate || ""}
                              onChange={(e) => patchItem(idx, { saleRate: Number(e.target.value) })}
                            />
                          </td>
                          <td className="p-2 w-20">
                            <input
                              type="number"
                              className={`${inputCls} text-right`}
                              value={item.saleQty || ""}
                              onChange={(e) => patchItem(idx, { saleQty: Number(e.target.value) })}
                            />
                          </td>
                          <td className="p-2 text-right font-mono text-neutral-300">
                            {fmt(item.totalPurchaseCost)}
                          </td>
                          <td className="p-2 text-right font-mono text-neutral-300">
                            {fmt(item.totalSaleValue)}
                          </td>
                          <td
                            className={`p-2 text-right font-mono font-bold ${
                              item.profit >= 0 ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {fmt(item.profit)}
                            <div className="text-[9px] text-neutral-500">{item.profitPercent}%</div>
                          </td>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={item.paidToSupplier}
                              onChange={(e) => patchItem(idx, { paidToSupplier: e.target.checked })}
                            />
                          </td>
                          <td className="p-2 w-32">
                            <input
                              type="date"
                              className={inputCls}
                              value={item.supplierPaymentDate || ""}
                              onChange={(e) =>
                                patchItem(idx, { supplierPaymentDate: e.target.value || null })
                              }
                            />
                          </td>
                          <td className="p-2 min-w-[150px]">
                            <select
                              className={inputCls}
                              value={item.inventoryItemId || ""}
                              disabled={item.stockConsumed}
                              onChange={(e) =>
                                patchItem(idx, { inventoryItemId: e.target.value || null })
                              }
                            >
                              <option value="">No stock link</option>
                              {inventoryItems.map((it: any) => (
                                <option key={it.id} value={it.id}>
                                  {invItemLabel(it.id)} (avail {it.availableQty})
                                </option>
                              ))}
                            </select>
                            {item.inventoryItemId && lastPurchase && (
                              <div className="text-[9px] text-neutral-500 mt-1">
                                Source: {lastPurchase.supplierName} @ {fmt(lastPurchase.purchaseRate)}
                              </div>
                            )}
                            {item.inventoryItemId && (
                              <label className="flex items-center gap-1 text-[9px] text-neutral-400 mt-1">
                                <input
                                  type="checkbox"
                                  checked={item.stockConsumed || !!item.consumeStock}
                                  disabled={item.stockConsumed}
                                  onChange={(e) => patchItem(idx, { consumeStock: e.target.checked })}
                                />
                                {item.stockConsumed ? "Stock consumed ✓" : "Consume stock on save"}
                              </label>
                            )}
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              className="text-neutral-600 hover:text-red-400"
                              onClick={() => setItemsDraft((rows) => rows.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-neutral-950/60 border border-neutral-800 rounded-xl p-4 text-[11px]">
              <div>
                <div className="text-neutral-500">Quotation Value</div>
                <div className="font-bold text-neutral-100">{fmt(liveTotals.quotationValue)}</div>
              </div>
              <div>
                <div className="text-neutral-500">Total Purchase Cost</div>
                <div className="font-bold text-neutral-100">{fmt(liveTotals.totalPurchaseCost)}</div>
              </div>
              <div>
                <div className="text-neutral-500">Gross Profit</div>
                <div
                  className={`font-bold ${liveTotals.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {fmt(liveTotals.grossProfit)} ({liveTotals.profitPercent}%)
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Amount Received</div>
                <div className="font-bold text-neutral-100">{fmt(liveTotals.amountReceived)}</div>
              </div>
              <div>
                <div className="text-neutral-500">Paid To Suppliers</div>
                <div className="font-bold text-neutral-100">{fmt(liveTotals.amountPaidToSuppliers)}</div>
              </div>
              <div>
                <div className="text-neutral-500">Net Cash Remaining</div>
                <div
                  className={`font-bold ${liveTotals.netCashRemaining >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {fmt(liveTotals.netCashRemaining)}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setShowSheetEditor(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={saveSheet} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingSheet ? "Save Costing Sheet" : "Create Costing Sheet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ INVESTORS TAB ------------------------------ */}
      {tab === "investors" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setInvestorDraft({ id: "", name: "", amountReceived: "", dateReceived: "", purpose: "", notes: "" });
                setShowInvestorForm(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Investor
            </button>
          </div>

          {investors.length === 0 && !loading && (
            <div className={`${cardCls} text-xs text-neutral-500`}>
              No investors recorded. Add an investment to start tracking funding against inventory
              purchases.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {investors.map((inv) => (
              <div key={inv.id} className={`${cardCls} space-y-3`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-bold text-neutral-100 flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-amber-400" /> {inv.name}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {inv.dateReceived ? `Received ${inv.dateReceived}` : "No date"} ·{" "}
                      {inv.purpose || "No purpose specified"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-bold text-amber-400 hover:text-amber-300"
                      onClick={() => {
                        setInvestorDraft({
                          id: inv.id,
                          name: inv.name,
                          amountReceived: String(inv.amountReceived || ""),
                          dateReceived: inv.dateReceived || "",
                          purpose: inv.purpose || "",
                          notes: inv.notes || "",
                        });
                        setShowInvestorForm(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-neutral-600 hover:text-red-400"
                      onClick={() => removeInvestor(inv)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <div className="text-neutral-500">Invested</div>
                    <div className="font-bold text-neutral-100">{fmt(inv.amountReceived)}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Spent ({inv.purchaseCount})</div>
                    <div className="font-bold text-neutral-100">{fmt(inv.amountSpent)}</div>
                  </div>
                  <div>
                    <div className="text-neutral-500">Remaining</div>
                    <div
                      className={`font-bold ${inv.remainingBalance >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {fmt(inv.remainingBalance)}
                    </div>
                  </div>
                </div>
                {inv.notes && <div className="text-[10px] text-neutral-500">{inv.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showInvestorForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-neutral-100">
                {investorDraft.id ? "Edit Investor" : "Add Investor"}
              </h3>
              <button
                type="button"
                className="text-neutral-500 hover:text-neutral-200"
                onClick={() => setShowInvestorForm(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Investor Name</label>
                <input
                  className={inputCls}
                  value={investorDraft.name}
                  onChange={(e) => setInvestorDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Barrister Raza Khan Niazi"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Amount Received (Rs.)</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={investorDraft.amountReceived}
                    onChange={(e) => setInvestorDraft((d) => ({ ...d, amountReceived: e.target.value }))}
                    placeholder="930000"
                  />
                </div>
                <div>
                  <label className={labelCls}>Date Received</label>
                  <input
                    type="date"
                    className={inputCls}
                    value={investorDraft.dateReceived}
                    onChange={(e) => setInvestorDraft((d) => ({ ...d, dateReceived: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Purpose / Project</label>
                <input
                  className={inputCls}
                  value={investorDraft.purpose}
                  onChange={(e) => setInvestorDraft((d) => ({ ...d, purpose: e.target.value }))}
                  placeholder="Inverter stock funding"
                />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  value={investorDraft.notes}
                  onChange={(e) => setInvestorDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setShowInvestorForm(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={saveInvestor} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Investor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ PURCHASES TAB ------------------------------ */}
      {tab === "purchases" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} onClick={() => setShowPurchaseForm(true)}>
              <Plus className="h-4 w-4" /> Record Purchase
            </button>
          </div>

          {purchases.length === 0 && !loading && (
            <div className={`${cardCls} text-xs text-neutral-500`}>
              No inventory purchases recorded yet.
            </div>
          )}

          {purchases.length > 0 && (
            <div className={`${cardCls} overflow-x-auto`}>
              <table className="w-full text-[11px] min-w-[900px]">
                <thead>
                  <tr className="text-neutral-500 text-[10px] uppercase tracking-wider">
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Supplier</th>
                    <th className="text-left p-2">Product</th>
                    <th className="text-right p-2">Qty</th>
                    <th className="text-right p-2">Rate</th>
                    <th className="text-right p-2">Total</th>
                    <th className="text-left p-2">Investor</th>
                    <th className="text-left p-2">Stock Item</th>
                    <th className="text-left p-2">Payment</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-800">
                      <td className="p-2 text-neutral-400 whitespace-nowrap">
                        {String(p.createdAt || "").slice(0, 10)}
                      </td>
                      <td className="p-2 text-neutral-200 font-bold">{p.supplierName}</td>
                      <td className="p-2 text-neutral-300">{p.productName}</td>
                      <td className="p-2 text-right font-mono">{p.quantity}</td>
                      <td className="p-2 text-right font-mono">{fmt(p.purchaseRate)}</td>
                      <td className="p-2 text-right font-mono font-bold text-neutral-100">
                        {fmt(p.totalCost)}
                      </td>
                      <td className="p-2 text-neutral-300">{investorName(p.investorId)}</td>
                      <td className="p-2 text-neutral-400">{invItemLabel(p.inventoryItemId)}</td>
                      <td className="p-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                            p.paymentStatus === "Paid"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : p.paymentStatus === "Partial"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          {p.paymentStatus}
                        </span>
                        {p.paymentMethod && (
                          <span className="ml-1 text-[9px] text-neutral-500">{p.paymentMethod}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="text-neutral-600 hover:text-red-400"
                          onClick={() => removePurchase(p)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showPurchaseForm && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full max-w-lg my-8 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-neutral-100">Record Inventory Purchase</h3>
              <button
                type="button"
                className="text-neutral-500 hover:text-neutral-200"
                onClick={() => setShowPurchaseForm(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Supplier</label>
                <input
                  className={inputCls}
                  value={purchaseDraft.supplierName}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, supplierName: e.target.value }))}
                  placeholder="Knox supplier"
                />
              </div>
              <div>
                <label className={labelCls}>Product</label>
                <input
                  className={inputCls}
                  value={purchaseDraft.productName}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, productName: e.target.value }))}
                  placeholder="Knox 6kW inverter"
                />
              </div>
              <div>
                <label className={labelCls}>Quantity</label>
                <input
                  type="number"
                  className={inputCls}
                  value={purchaseDraft.quantity}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, quantity: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Buying Rate (Rs.)</label>
                <input
                  type="number"
                  className={inputCls}
                  value={purchaseDraft.purchaseRate}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, purchaseRate: e.target.value }))}
                />
              </div>
              <div className="col-span-2 text-[11px] text-neutral-400">
                Total cost: <span className="font-bold text-neutral-100">{fmt(purchaseTotal)}</span>
              </div>
              <div>
                <label className={labelCls}>Investor / Funding Source</label>
                <select
                  className={inputCls}
                  value={purchaseDraft.investorId}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, investorId: e.target.value }))}
                >
                  <option value="">— Company funds —</option>
                  {investors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (remaining {fmt(i.remainingBalance)})
                    </option>
                  ))}
                </select>
                {selectedInvestor && purchaseTotal > selectedInvestor.remainingBalance && (
                  <div className="text-[10px] text-red-400 mt-1">
                    Exceeds remaining balance of {fmt(selectedInvestor.remainingBalance)}.
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Stock Item (increases stock)</label>
                <select
                  className={inputCls}
                  value={purchaseDraft.inventoryItemId}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, inventoryItemId: e.target.value }))}
                >
                  <option value="">— Record only, no stock link —</option>
                  {inventoryItems.map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {invItemLabel(it.id)} (stock {it.stockQty})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Payment Method</label>
                <select
                  className={inputCls}
                  value={purchaseDraft.paymentMethod}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, paymentMethod: e.target.value }))}
                >
                  {PURCHASE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Payment Status</label>
                <select
                  className={inputCls}
                  value={purchaseDraft.paymentStatus}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, paymentStatus: e.target.value }))}
                >
                  {PURCHASE_PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Invoice / Bill URL (optional)</label>
                <input
                  className={inputCls}
                  value={purchaseDraft.billUrl}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, billUrl: e.target.value }))}
                  placeholder="https://... (uploaded bill link)"
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Notes</label>
                <input
                  className={inputCls}
                  value={purchaseDraft.notes}
                  onChange={(e) => setPurchaseDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setShowPurchaseForm(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={savePurchase} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Purchase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ REPORTS TAB ------------------------------ */}
      {tab === "reports" && (
        <div className="space-y-4">
          {!reports && (
            <div className={`${cardCls} text-xs text-neutral-500 flex items-center gap-2`}>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
            </div>
          )}
          {reports && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className={cardCls}>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Total Sale</div>
                  <div className="text-lg font-black text-neutral-100">
                    {fmt(reports.grossMargin?.totalSale || 0)}
                  </div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Total Cost</div>
                  <div className="text-lg font-black text-neutral-100">
                    {fmt(reports.grossMargin?.totalCost || 0)}
                  </div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
                    Gross Profit
                  </div>
                  <div
                    className={`text-lg font-black ${
                      (reports.grossMargin?.totalProfit || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {fmt(reports.grossMargin?.totalProfit || 0)}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    Margin {reports.grossMargin?.marginPercent || 0}%
                  </div>
                </div>
                <div className={cardCls}>
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
                    Stock Value
                  </div>
                  <div className="text-lg font-black text-neutral-100">
                    {fmt(reports.stockValue?.total || 0)}
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {reports.stockValue?.items?.length || 0} stock item(s)
                  </div>
                </div>
              </div>

              <div className={cardCls}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
                  Profit by Client / Project
                </h4>
                {(reports.profitByClient || []).length === 0 ? (
                  <div className="text-xs text-neutral-500">No costing sheets yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] min-w-[700px]">
                      <thead>
                        <tr className="text-neutral-500 text-[10px] uppercase tracking-wider">
                          <th className="text-left p-2">Client</th>
                          <th className="text-right p-2">Quotation</th>
                          <th className="text-right p-2">Purchase Cost</th>
                          <th className="text-right p-2">Gross Profit</th>
                          <th className="text-right p-2">Profit %</th>
                          <th className="text-right p-2">Net Cash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.profitByClient.map((r: any) => (
                          <tr key={r.sheetId} className="border-t border-neutral-800">
                            <td className="p-2 font-bold text-neutral-200">{r.clientName}</td>
                            <td className="p-2 text-right font-mono">{fmt(r.quotationValue)}</td>
                            <td className="p-2 text-right font-mono">{fmt(r.totalPurchaseCost)}</td>
                            <td
                              className={`p-2 text-right font-mono font-bold ${
                                r.grossProfit >= 0 ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {fmt(r.grossProfit)}
                            </td>
                            <td className="p-2 text-right font-mono">{r.profitPercent}%</td>
                            <td className="p-2 text-right font-mono">{fmt(r.netCashRemaining)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className={cardCls}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
                    Investor Balances
                  </h4>
                  {(reports.investorBalances || []).length === 0 ? (
                    <div className="text-xs text-neutral-500">No investors.</div>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-neutral-500 text-[10px] uppercase tracking-wider">
                          <th className="text-left p-2">Investor</th>
                          <th className="text-right p-2">Received</th>
                          <th className="text-right p-2">Spent</th>
                          <th className="text-right p-2">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.investorBalances.map((r: any) => (
                          <tr key={r.id} className="border-t border-neutral-800">
                            <td className="p-2 font-bold text-neutral-200">{r.name}</td>
                            <td className="p-2 text-right font-mono">{fmt(r.amountReceived)}</td>
                            <td className="p-2 text-right font-mono">{fmt(r.amountSpent)}</td>
                            <td
                              className={`p-2 text-right font-mono font-bold ${
                                r.remainingBalance >= 0 ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {fmt(r.remainingBalance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className={cardCls}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
                    Supplier Payable
                  </h4>
                  {(reports.supplierPayable || []).length === 0 ? (
                    <div className="text-xs text-neutral-500">Nothing payable to suppliers.</div>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-neutral-500 text-[10px] uppercase tracking-wider">
                          <th className="text-left p-2">Supplier</th>
                          <th className="text-right p-2">Entries</th>
                          <th className="text-right p-2">Payable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.supplierPayable.map((r: any) => (
                          <tr key={r.supplier} className="border-t border-neutral-800">
                            <td className="p-2 font-bold text-neutral-200">{r.supplier}</td>
                            <td className="p-2 text-right font-mono">{r.entries}</td>
                            <td className="p-2 text-right font-mono font-bold text-red-400">
                              {fmt(r.payable)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className={cardCls}>
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">
                  Inventory Purchase History ({(reports.purchaseHistory || []).length})
                </h4>
                {(reports.purchaseHistory || []).length === 0 ? (
                  <div className="text-xs text-neutral-500">No purchases recorded.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] min-w-[600px]">
                      <thead>
                        <tr className="text-neutral-500 text-[10px] uppercase tracking-wider">
                          <th className="text-left p-2">Date</th>
                          <th className="text-left p-2">Supplier</th>
                          <th className="text-left p-2">Product</th>
                          <th className="text-right p-2">Qty</th>
                          <th className="text-right p-2">Total</th>
                          <th className="text-left p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.purchaseHistory.map((p: any) => (
                          <tr key={p.id} className="border-t border-neutral-800">
                            <td className="p-2 text-neutral-400">
                              {String(p.createdAt || "").slice(0, 10)}
                            </td>
                            <td className="p-2 text-neutral-200">{p.supplierName}</td>
                            <td className="p-2 text-neutral-300">{p.productName}</td>
                            <td className="p-2 text-right font-mono">{p.quantity}</td>
                            <td className="p-2 text-right font-mono">{fmt(p.totalCost)}</td>
                            <td className="p-2 text-neutral-400">{p.paymentStatus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
