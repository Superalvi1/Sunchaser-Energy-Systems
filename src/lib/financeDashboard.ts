export type AgingBucketKey = "d0_30" | "d31_60" | "d61_90" | "d90p";

export type AgingBucket = {
  key: AgingBucketKey;
  label: string;
  invoiceCount: number;
  outstandingAmount: number;
  percentOfTotal: number;
};

export type FinanceTopCustomer = {
  partyKey: string;
  customerId: string | null;
  name: string;
  phone: string | null;
  outstanding: number;
  invoiceCount: number;
  lastPaymentDate: string | null;
};

export type FinanceOverdueInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string | null;
  partyKey: string;
  dueDate: string;
  daysOverdue: number;
  balanceDue: number;
  agingBucket: AgingBucketKey;
};

export type FinanceMonthPerformance = {
  invoicesIssued: number;
  amountInvoiced: number;
  amountCollected: number;
  collectionPercent: number;
};

export type FinanceDashboardData = {
  summary: {
    outstandingReceivables: number;
    collectedThisMonth: number;
    overdueAmount: number;
    activeCustomers: number;
    totalInvoices: number;
    collectionRate: number;
    totalSales: number;
    totalReceived: number;
  };
  ceoOps?: {
    projectsInProgress: number;
    pendingNetMetering: number;
  };
  aging: AgingBucket[];
  topCustomers: FinanceTopCustomer[];
  collectionPerformance: {
    currentMonth: FinanceMonthPerformance;
    previousMonth: FinanceMonthPerformance;
    growth: {
      invoiced: number;
      collected: number;
      collectionPercent: number;
    };
  };
  overdueInvoices: FinanceOverdueInvoice[];
  charts: {
    monthlyCollections: Array<{ month: string; label: string; amount: number }>;
    agingBreakdown: Array<{ name: string; value: number; fill: string }>;
    topCustomersByBalance: Array<{ name: string; balance: number }>;
  };
};

export const AGING_BUCKET_META: Record<
  AgingBucketKey,
  { label: string; color: string; bg: string; border: string }
> = {
  d0_30: { label: "0–30 Days", color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  d31_60: { label: "31–60 Days", color: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  d61_90: { label: "61–90 Days", color: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  d90p: { label: "90+ Days", color: "text-red-300", bg: "bg-red-500/10", border: "border-red-500/30" },
};

export function isFinanceCeoMode(username: string, role: string): boolean {
  const r = String(role || "");
  return r === "Director" || r === "Super Admin" || String(username || "").toLowerCase() === "allauddin";
}

export function canViewFinanceDashboard(username: string, role: string): boolean {
  if (isFinanceCeoMode(username, role)) return true;
  const r = String(role || "");
  return r === "Accounts Manager" || r === "Admin";
}
