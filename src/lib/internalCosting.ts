import { isSuperAdmin } from "./roles";

/** Phase 22 — Internal Costing Sheet + Investor Inventory Ledger (Super Admin only). */

export const PURCHASE_PAYMENT_STATUSES = ["Unpaid", "Partial", "Paid"] as const;
export type PurchasePaymentStatus = (typeof PURCHASE_PAYMENT_STATUSES)[number];

export const PURCHASE_PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Cheque",
  "Online",
  "Other",
] as const;

export type InternalCostingItem = {
  id: string;
  itemName: string;
  supplierName: string;
  purchaseRate: number;
  purchaseQty: number;
  saleRate: number;
  saleQty: number;
  totalPurchaseCost: number;
  totalSaleValue: number;
  profit: number;
  profitPercent: number;
  paidToSupplier: boolean;
  supplierPaymentDate: string | null;
  /** Optional link to a hardware inventory foundation item. */
  inventoryItemId: string | null;
  /** Set true by the server once stock has been consumed for this item. */
  stockConsumed: boolean;
  /** Client sets true to request a stock-out when the sheet is saved. */
  consumeStock?: boolean;
  notes: string;
};

export type InternalCostingTotals = {
  quotationValue: number;
  totalPurchaseCost: number;
  totalSaleValue: number;
  grossProfit: number;
  profitPercent: number;
  amountReceived: number;
  amountPaidToSuppliers: number;
  netCashRemaining: number;
};

export type InternalCostingSheet = {
  id: string;
  title: string;
  clientName: string;
  leadId: string | null;
  customerId: string | null;
  projectId: string | null;
  quotationId: string | null;
  invoiceId: string | null;
  quotationValue: number;
  amountReceived: number;
  items: InternalCostingItem[];
  totals: InternalCostingTotals;
  notes: string;
  autoCreated: boolean;
  /** When enabled: reserve stock on save (contracted), consume when installation starts. */
  consumeInventory: boolean;
  stockReserved: boolean;
  reservedStockValue: number;
  consumedStockValue: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvestorRecord = {
  id: string;
  name: string;
  amountReceived: number;
  dateReceived: string | null;
  purpose: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type InvestorWithBalance = InvestorRecord & {
  amountSpent: number;
  remainingBalance: number;
  purchaseCount: number;
};

export type InventoryPurchaseRecord = {
  id: string;
  supplierName: string;
  productName: string;
  inventoryItemId: string | null;
  quantity: number;
  purchaseRate: number;
  totalCost: number;
  investorId: string | null;
  paymentMethod: string;
  paymentStatus: PurchasePaymentStatus;
  billUrl: string | null;
  notes: string;
  createdBy: string | null;
  createdAt: string;
};

export function canViewInternalCosting(username: string, role: string): boolean {
  return isSuperAdmin(username, role);
}

export function moneyRound(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Recompute the derived fields of a costing line item. */
export function computeCostingItem(raw: Partial<InternalCostingItem>): InternalCostingItem {
  const purchaseRate = Math.max(0, num(raw.purchaseRate));
  const purchaseQty = Math.max(0, num(raw.purchaseQty));
  const saleRate = Math.max(0, num(raw.saleRate));
  const saleQty = Math.max(0, num(raw.saleQty, purchaseQty));
  const totalPurchaseCost = moneyRound(purchaseRate * purchaseQty);
  const totalSaleValue = moneyRound(saleRate * saleQty);
  const profit = moneyRound(totalSaleValue - totalPurchaseCost);
  const profitPercent =
    totalPurchaseCost > 0 ? moneyRound((profit / totalPurchaseCost) * 100) : 0;
  return {
    id: String(raw.id || `ci-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    itemName: String(raw.itemName || "").trim(),
    supplierName: String(raw.supplierName || "").trim(),
    purchaseRate,
    purchaseQty,
    saleRate,
    saleQty,
    totalPurchaseCost,
    totalSaleValue,
    profit,
    profitPercent,
    paidToSupplier: !!raw.paidToSupplier,
    supplierPaymentDate: raw.supplierPaymentDate ? String(raw.supplierPaymentDate) : null,
    inventoryItemId: raw.inventoryItemId ? String(raw.inventoryItemId) : null,
    stockConsumed: !!raw.stockConsumed,
    consumeStock: !!raw.consumeStock,
    notes: String(raw.notes || ""),
  };
}

/** Recompute the totals block of a costing sheet from its items. */
export function computeCostingTotals(input: {
  quotationValue?: unknown;
  amountReceived?: unknown;
  items: InternalCostingItem[];
}): InternalCostingTotals {
  const items = input.items || [];
  const totalSaleValue = moneyRound(items.reduce((s, it) => s + num(it.totalSaleValue), 0));
  const quotationValue = moneyRound(Math.max(0, num(input.quotationValue, totalSaleValue)));
  const amountReceived = moneyRound(Math.max(0, num(input.amountReceived)));
  const totalPurchaseCost = moneyRound(
    items.reduce((s, it) => s + num(it.totalPurchaseCost), 0)
  );
  const saleBasis = quotationValue > 0 ? quotationValue : totalSaleValue;
  const grossProfit = moneyRound(saleBasis - totalPurchaseCost);
  const profitPercent = saleBasis > 0 ? moneyRound((grossProfit / saleBasis) * 100) : 0;
  const amountPaidToSuppliers = moneyRound(
    items.filter((it) => it.paidToSupplier).reduce((s, it) => s + num(it.totalPurchaseCost), 0)
  );
  const netCashRemaining = moneyRound(amountReceived - amountPaidToSuppliers);
  return {
    quotationValue,
    totalPurchaseCost,
    totalSaleValue,
    grossProfit,
    profitPercent,
    amountReceived,
    amountPaidToSuppliers,
    netCashRemaining,
  };
}

export function computePurchaseTotal(quantity: unknown, purchaseRate: unknown): number {
  return moneyRound(Math.max(0, num(quantity)) * Math.max(0, num(purchaseRate)));
}

/** Investor remaining balance = received − total cost of purchases linked to them. */
export function computeInvestorBalance(
  investor: InvestorRecord,
  purchases: InventoryPurchaseRecord[]
): InvestorWithBalance {
  const linked = purchases.filter((p) => p.investorId === investor.id);
  const amountSpent = moneyRound(linked.reduce((s, p) => s + num(p.totalCost), 0));
  return {
    ...investor,
    amountSpent,
    remainingBalance: moneyRound(num(investor.amountReceived) - amountSpent),
    purchaseCount: linked.length,
  };
}

export type BoqImportRow = {
  id?: string;
  type?: string;
  name?: string;
  description?: string;
  qty?: number;
  rate?: number;
  total?: number;
};

/** Phase 23 — Map accepted quotation BOQ rows into blank-purchase costing items. */
export function boqRowsToCostingItems(rows: BoqImportRow[] | null | undefined): InternalCostingItem[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => {
      const t = String(row.type || "item").toLowerCase();
      return t === "item";
    })
    .map((row) => {
      const qty = Math.max(0, num(row.qty));
      const rate = Math.max(0, num(row.rate));
      const total = num(row.total);
      const saleRate = rate > 0 ? rate : qty > 0 && total > 0 ? total / qty : 0;
      const label = String(row.name || row.description || "").trim() || "BOQ Item";
      return computeCostingItem({
        itemName: label,
        supplierName: "",
        purchaseRate: 0,
        purchaseQty: 0,
        saleRate,
        saleQty: qty,
        paidToSupplier: false,
        supplierPaymentDate: null,
        inventoryItemId: null,
        stockConsumed: false,
        notes: "",
      });
    })
    .filter((it) => it.itemName && (it.saleQty > 0 || it.saleRate > 0));
}

export function quotationBoqRows(quote: Record<string, unknown> | null | undefined): BoqImportRow[] {
  if (!quote) return [];
  const rows = (quote as any).boqRows ?? (quote as any).boqItems;
  return Array.isArray(rows) ? rows : [];
}

export function buildAutoCostingTitle(clientName: string): string {
  const name = String(clientName || "").trim() || "Client";
  return `Internal Costing — ${name}`;
}

export type ProjectProfitabilitySummary = {
  monthLabel: string;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  marginPercent: number;
  sheetCount: number;
};

/** Aggregate profitability for sheets created in the current calendar month. */
export function computeProjectProfitabilitySummary(
  sheets: InternalCostingSheet[],
  refDate = new Date()
): ProjectProfitabilitySummary {
  const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const monthEnd = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthLabel = monthStart.toLocaleString("en-US", { month: "long", year: "numeric" });
  const inMonth = sheets.filter((s) => {
    const created = new Date(s.createdAt || 0);
    return created >= monthStart && created <= monthEnd;
  });
  const totalRevenue = moneyRound(inMonth.reduce((s, x) => s + x.totals.quotationValue, 0));
  const totalCost = moneyRound(inMonth.reduce((s, x) => s + x.totals.totalPurchaseCost, 0));
  const grossProfit = moneyRound(totalRevenue - totalCost);
  const marginPercent = totalRevenue > 0 ? moneyRound((grossProfit / totalRevenue) * 100) : 0;
  return {
    monthLabel,
    totalRevenue,
    totalCost,
    grossProfit,
    marginPercent,
    sheetCount: inMonth.length,
  };
}

export const INSTALLATION_START_STAGES = new Set([
  "Structure Installation",
  "Panel Installation",
  "Inverter Installation",
  "Testing & Commissioning",
  "Material Procurement",
]);
