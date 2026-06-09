import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  StaffPortalAuthError,
} from "./dbManager.js";
import { listPartyLedgers } from "./partyLedgerDb.js";
import { listAdminInvoices } from "./invoiceDb.js";
import {
  canViewFinanceDashboard,
  type AgingBucket,
  type AgingBucketKey,
  type FinanceDashboardData,
  type FinanceMonthPerformance,
  type FinanceOverdueInvoice,
  type FinanceTopCustomer,
} from "./src/lib/financeDashboard.ts";
import { isExcludedFromLedgerTotals } from "./src/lib/invoices.ts";
import {
  resolveInvoiceBalanceDue,
  resolveInvoiceReceivedAmount,
} from "./src/lib/invoicePayments.ts";

function partyKeyFromInvoice(inv: {
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string | null;
}) {
  if (inv.customerId) return `cid:${inv.customerId}`;
  const name = String(inv.customerName || "").trim().toLowerCase();
  const phone = String(inv.customerPhone || "").trim();
  return `name:${name}|${phone}`;
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(String(fromDate).slice(0, 10));
  const b = new Date(String(toDate).slice(0, 10));
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function agingBucketForDueDate(dueDate: string | null | undefined, today: string): AgingBucketKey {
  const anchor = String(dueDate || today).slice(0, 10);
  const daysOverdue = Math.max(0, daysBetween(anchor, today));
  if (daysOverdue <= 30) return "d0_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90p";
}

function monthRange(year: number, monthIndex: number) {
  const start = `${year}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const endDate = new Date(year, monthIndex + 1, 0);
  const end = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
  const label = endDate.toLocaleDateString("en-PK", { month: "short", year: "2-digit" });
  return { start, end, label, year, monthIndex };
}

function computeMonthPerformance(
  invoices: Awaited<ReturnType<typeof listAdminInvoices>>,
  range: { start: string; end: string }
): FinanceMonthPerformance {
  let invoicesIssued = 0;
  let amountInvoiced = 0;
  let amountCollected = 0;

  for (const inv of invoices) {
    if (isExcludedFromLedgerTotals(inv.invoiceStatus, inv.archivedAt)) continue;
    const invDate = String(inv.invoiceDate || "").slice(0, 10);
    if (invDate >= range.start && invDate <= range.end) {
      invoicesIssued += 1;
      amountInvoiced += Number(inv.grandTotal || 0);
    }
    for (const p of inv.payments || []) {
      const payDate = String(p.paymentDate || p.createdAt || "").slice(0, 10);
      if (payDate >= range.start && payDate <= range.end) {
        amountCollected += Number(p.amount || 0);
      }
    }
  }

  amountInvoiced = Math.round(amountInvoiced * 100) / 100;
  amountCollected = Math.round(amountCollected * 100) / 100;
  const collectionPercent =
    amountInvoiced > 0 ? Math.round((amountCollected / amountInvoiced) * 10000) / 100 : 0;

  return { invoicesIssued, amountInvoiced, amountCollected, collectionPercent };
}

async function loadCeoOpsMetrics(): Promise<{ projectsInProgress: number; pendingNetMetering: number }> {
  if (!isSupabaseActive()) return { projectsInProgress: 0, pendingNetMetering: 0 };
  const supabase = getSupabase()!;
  let projectsInProgress = 0;
  let pendingNetMetering = 0;

  const { count: projectCount } = await supabase
    .from("project_deliveries")
    .select("id", { count: "exact", head: true })
    .neq("delivery_status", "Handover Completed");
  projectsInProgress = projectCount || 0;

  const { data: nmRows } = await supabase.from("net_metering_trackers").select("green_meter_active");
  pendingNetMetering = (nmRows || []).filter((r: any) => !r.green_meter_active).length;

  return { projectsInProgress, pendingNetMetering };
}

export async function fetchFinanceDashboard(
  userId: string,
  username: string,
  role: string,
  localDb?: Database
): Promise<FinanceDashboardData> {
  await verifyStaffPortalUser(userId, username, localDb);
  if (!canViewFinanceDashboard(username, role)) {
    throw new StaffPortalAuthError("You do not have permission to view the finance dashboard.", 403);
  }

  const parties = await listPartyLedgers(userId, username, role, localDb);
  const invoices = await listAdminInvoices(userId, username, role, localDb);
  const activeInvoices = invoices.filter(
    (inv) => !isExcludedFromLedgerTotals(inv.invoiceStatus, inv.archivedAt)
  );
  const today = new Date().toISOString().slice(0, 10);

  const outstandingReceivables = Math.round(
    parties.reduce((s, p) => s + Number(p.balanceDue || 0), 0) * 100
  ) / 100;
  const totalSales = Math.round(parties.reduce((s, p) => s + Number(p.totalSales || 0), 0) * 100) / 100;
  const totalReceived = Math.round(
    parties.reduce((s, p) => s + Number(p.receivedAmount || 0), 0) * 100
  ) / 100;
  const collectionRate =
    totalSales > 0 ? Math.round((totalReceived / totalSales) * 10000) / 100 : 0;

  const now = new Date();
  const currentRange = monthRange(now.getFullYear(), now.getMonth());
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const previousRange = monthRange(prevYear, prevMonth);

  let collectedThisMonth = 0;
  for (const inv of invoices) {
    for (const p of inv.payments || []) {
      const payDate = String(p.paymentDate || p.createdAt || "").slice(0, 10);
      if (payDate >= currentRange.start && payDate <= currentRange.end) {
        collectedThisMonth += Number(p.amount || 0);
      }
    }
  }
  collectedThisMonth = Math.round(collectedThisMonth * 100) / 100;

  let overdueAmount = 0;
  const agingMap: Record<AgingBucketKey, { invoiceCount: number; outstandingAmount: number }> = {
    d0_30: { invoiceCount: 0, outstandingAmount: 0 },
    d31_60: { invoiceCount: 0, outstandingAmount: 0 },
    d61_90: { invoiceCount: 0, outstandingAmount: 0 },
    d90p: { invoiceCount: 0, outstandingAmount: 0 },
  };

  const overdueInvoices: FinanceOverdueInvoice[] = [];

  for (const inv of activeInvoices) {
    const balance = resolveInvoiceBalanceDue(inv);
    if (balance <= 0) continue;

    const due = String(inv.dueDate || inv.invoiceDate || today).slice(0, 10);
    const bucket = agingBucketForDueDate(due, today);
    agingMap[bucket].invoiceCount += 1;
    agingMap[bucket].outstandingAmount += balance;

    if (inv.dueDate && String(inv.dueDate).slice(0, 10) < today) {
      overdueAmount += balance;
      const daysOverdue = daysBetween(due, today);
      overdueInvoices.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customerName,
        customerPhone: inv.customerPhone,
        partyKey: partyKeyFromInvoice(inv),
        dueDate: due,
        daysOverdue,
        balanceDue: balance,
        agingBucket: bucket,
      });
    }
  }

  overdueAmount = Math.round(overdueAmount * 100) / 100;
  const agingTotal = Object.values(agingMap).reduce((s, b) => s + b.outstandingAmount, 0);

  const aging: AgingBucket[] = (["d0_30", "d31_60", "d61_90", "d90p"] as AgingBucketKey[]).map((key) => {
    const row = agingMap[key];
    const amount = Math.round(row.outstandingAmount * 100) / 100;
    return {
      key,
      label:
        key === "d0_30"
          ? "0–30 Days"
          : key === "d31_60"
            ? "31–60 Days"
            : key === "d61_90"
              ? "61–90 Days"
              : "90+ Days",
      invoiceCount: row.invoiceCount,
      outstandingAmount: amount,
      percentOfTotal:
        agingTotal > 0 ? Math.round((amount / agingTotal) * 10000) / 100 : 0,
    };
  });

  const lastPaymentByParty = new Map<string, string>();
  for (const inv of invoices) {
    const key = partyKeyFromInvoice(inv);
    for (const p of inv.payments || []) {
      const d = String(p.paymentDate || p.createdAt || "").slice(0, 10);
      const prev = lastPaymentByParty.get(key);
      if (!prev || d > prev) lastPaymentByParty.set(key, d);
    }
  }

  const topCustomers: FinanceTopCustomer[] = parties
    .filter((p) => Number(p.balanceDue || 0) > 0)
    .sort((a, b) => Number(b.balanceDue) - Number(a.balanceDue))
    .slice(0, 20)
    .map((p) => ({
      partyKey: p.partyKey,
      customerId: p.customerId,
      name: p.name,
      phone: p.phone,
      outstanding: Number(p.balanceDue || 0),
      invoiceCount: p.invoiceCount,
      lastPaymentDate: lastPaymentByParty.get(p.partyKey) || null,
    }));

  const currentMonth = computeMonthPerformance(invoices, currentRange);
  const previousMonth = computeMonthPerformance(invoices, previousRange);

  const growth = {
    invoiced:
      previousMonth.amountInvoiced > 0
        ? Math.round(
            ((currentMonth.amountInvoiced - previousMonth.amountInvoiced) /
              previousMonth.amountInvoiced) *
              10000
          ) / 100
        : currentMonth.amountInvoiced > 0
          ? 100
          : 0,
    collected:
      previousMonth.amountCollected > 0
        ? Math.round(
            ((currentMonth.amountCollected - previousMonth.amountCollected) /
              previousMonth.amountCollected) *
              10000
          ) / 100
        : currentMonth.amountCollected > 0
          ? 100
          : 0,
    collectionPercent: Math.round((currentMonth.collectionPercent - previousMonth.collectionPercent) * 100) / 100,
  };

  const monthlyCollections: Array<{ month: string; label: string; amount: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const range = monthRange(d.getFullYear(), d.getMonth());
    let amount = 0;
    for (const inv of invoices) {
      for (const p of inv.payments || []) {
        const payDate = String(p.paymentDate || p.createdAt || "").slice(0, 10);
        if (payDate >= range.start && payDate <= range.end) {
          amount += Number(p.amount || 0);
        }
      }
    }
    monthlyCollections.push({
      month: range.start.slice(0, 7),
      label: range.label,
      amount: Math.round(amount * 100) / 100,
    });
  }

  const agingBreakdown = [
    { name: "0–30 Days", value: agingMap.d0_30.outstandingAmount, fill: "#34d399" },
    { name: "31–60 Days", value: agingMap.d31_60.outstandingAmount, fill: "#fbbf24" },
    { name: "61–90 Days", value: agingMap.d61_90.outstandingAmount, fill: "#fb923c" },
    { name: "90+ Days", value: agingMap.d90p.outstandingAmount, fill: "#f87171" },
  ].map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 }));

  const topCustomersByBalance = topCustomers.slice(0, 10).map((c) => ({
    name: c.name.length > 18 ? `${c.name.slice(0, 16)}…` : c.name,
    balance: c.outstanding,
  }));

  overdueInvoices.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceDue - a.balanceDue);

  const ceoOps = await loadCeoOpsMetrics();

  return {
    summary: {
      outstandingReceivables,
      collectedThisMonth,
      overdueAmount,
      activeCustomers: parties.filter((p) => p.invoiceCount > 0).length,
      totalInvoices: activeInvoices.length,
      collectionRate,
      totalSales,
      totalReceived,
    },
    ceoOps,
    aging,
    topCustomers,
    collectionPerformance: { currentMonth, previousMonth, growth },
    overdueInvoices,
    charts: { monthlyCollections, agingBreakdown, topCustomersByBalance },
  };
}
