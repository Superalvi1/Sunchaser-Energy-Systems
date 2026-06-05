import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  DollarSign,
  Loader2,
  Phone,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { User as StaffUser } from "../types";
import { fetchFinanceDashboard } from "../services/api";
import {
  AGING_BUCKET_META,
  canViewFinanceDashboard,
  isFinanceCeoMode,
  type FinanceDashboardData,
} from "../lib/financeDashboard";
import WhatsAppActionButton from "./WhatsAppActionButton";

const fmt = (n: number) => `PKR ${Math.round(n || 0).toLocaleString("en-PK")}`;
const pct = (n: number) => `${Number(n || 0).toFixed(1)}%`;

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${accent}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="mt-2 text-xl font-extrabold text-neutral-50">{value}</div>
      {sub && <div className="mt-1 text-[10px] text-neutral-500">{sub}</div>}
    </div>
  );
}

function GrowthBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-neutral-500 text-[10px]">—</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${up ? "text-emerald-400" : "text-red-400"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export default function FinanceDashboardStaff({
  staffUser,
  onOpenLedger,
  onEditInvoice,
}: {
  staffUser: StaffUser;
  onOpenLedger?: (partyKey: string) => void;
  onEditInvoice?: (invoiceId: string) => void;
}) {
  const allowed = canViewFinanceDashboard(staffUser.username, staffUser.role);
  const ceoMode = isFinanceCeoMode(staffUser.username, staffUser.role);
  const [data, setData] = useState<FinanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchFinanceDashboard(staffUser);
      setData(res as FinanceDashboardData);
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [staffUser]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  if (!allowed) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-400">
        Finance dashboard is available to Admin, Accounts Manager, and CEO users.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading finance dashboard…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-6 text-red-300 text-sm">
        {error || "No data"}
        <button type="button" onClick={load} className="ml-3 underline text-xs">
          Retry
        </button>
      </div>
    );
  }

  const { summary, aging, topCustomers, collectionPerformance, overdueInvoices, charts, ceoOps } = data;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-neutral-100 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-amber-400" />
            Finance Dashboard
          </h2>
          <p className="text-[11px] text-neutral-500 mt-1">
            Accounts receivable, aging, and collection performance
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
        >
          Refresh
        </button>
      </div>

      {ceoMode && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Outstanding" value={fmt(summary.outstandingReceivables)} accent="border-violet-500/30 bg-violet-500/5" />
          <KpiCard label="Collected (Month)" value={fmt(summary.collectedThisMonth)} accent="border-emerald-500/30 bg-emerald-500/5" />
          <KpiCard label="Projects In Progress" value={String(ceoOps?.projectsInProgress ?? 0)} accent="border-sky-500/30 bg-sky-500/5" />
          <KpiCard label="Pending Net Metering" value={String(ceoOps?.pendingNetMetering ?? 0)} accent="border-cyan-500/30 bg-cyan-500/5" />
          <KpiCard label="Overdue" value={fmt(summary.overdueAmount)} accent="border-red-500/30 bg-red-500/5" />
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Outstanding Receivables" value={fmt(summary.outstandingReceivables)} accent="border-amber-500/35 bg-gradient-to-br from-amber-500/10 to-neutral-900" />
        <KpiCard label="Collected This Month" value={fmt(summary.collectedThisMonth)} accent="border-emerald-500/35 bg-gradient-to-br from-emerald-500/10 to-neutral-900" />
        <KpiCard label="Overdue Amount" value={fmt(summary.overdueAmount)} accent="border-red-500/35 bg-gradient-to-br from-red-500/10 to-neutral-900" />
        <KpiCard label="Active Customers" value={String(summary.activeCustomers)} accent="border-sky-500/35 bg-gradient-to-br from-sky-500/10 to-neutral-900" />
        <KpiCard label="Total Invoices" value={String(summary.totalInvoices)} accent="border-violet-500/35 bg-gradient-to-br from-violet-500/10 to-neutral-900" />
        <KpiCard
          label="Collection Rate"
          value={pct(summary.collectionRate)}
          sub={`${fmt(summary.totalReceived)} / ${fmt(summary.totalSales)}`}
          accent="border-indigo-500/35 bg-gradient-to-br from-indigo-500/10 to-neutral-900"
        />
      </div>

      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Receivables Aging</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {aging.map((bucket) => {
            const meta = AGING_BUCKET_META[bucket.key];
            return (
              <div key={bucket.key} className={`rounded-2xl border p-4 ${meta.bg} ${meta.border}`}>
                <div className={`text-[10px] font-bold uppercase ${meta.color}`}>{bucket.label}</div>
                <div className="mt-2 text-lg font-extrabold text-neutral-100">{fmt(bucket.outstandingAmount)}</div>
                <div className="text-[10px] text-neutral-500 mt-1">
                  {bucket.invoiceCount} invoice{bucket.invoiceCount !== 1 ? "s" : ""} · {pct(bucket.percentOfTotal)} of AR
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-neutral-800 bg-neutral-900/80 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Monthly Collections (12 mo)</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.monthlyCollections}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 11 }} />
                <Bar dataKey="amount" fill="#7c6cf0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Aging Breakdown</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={charts.agingBreakdown.filter((d) => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {charts.agingBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Top 10 Customers by Balance</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts.topCustomersByBalance} layout="vertical" margin={{ left: 8, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" tick={{ fontSize: 9, fill: "#94a3b8" }} tickFormatter={(v) => `${Math.round(v / 1000000)}M`} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9, fill: "#94a3b8" }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="balance" fill="#c5a028" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Collection Performance — Current Month</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-neutral-500">Invoices Issued</span><span className="font-bold text-neutral-100">{collectionPerformance.currentMonth.invoicesIssued}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Amount Invoiced</span><span className="font-bold text-neutral-100">{fmt(collectionPerformance.currentMonth.amountInvoiced)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Amount Collected</span><span className="font-bold text-emerald-400">{fmt(collectionPerformance.currentMonth.amountCollected)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-500">Collection %</span><span className="font-bold text-amber-300">{pct(collectionPerformance.currentMonth.collectionPercent)}</span></div>
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-3">Previous Month vs Growth</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-neutral-500">Invoiced</span>
              <span className="font-bold text-neutral-100">{fmt(collectionPerformance.previousMonth.amountInvoiced)} <GrowthBadge value={collectionPerformance.growth.invoiced} /></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-500">Collected</span>
              <span className="font-bold text-neutral-100">{fmt(collectionPerformance.previousMonth.amountCollected)} <GrowthBadge value={collectionPerformance.growth.collected} /></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-500">Collection %</span>
              <span className="font-bold text-neutral-100">{pct(collectionPerformance.previousMonth.collectionPercent)} <GrowthBadge value={collectionPerformance.growth.collectionPercent} /></span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">Top Outstanding Customers</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-800">
                <th className="text-left py-2 px-3">Customer</th>
                <th className="text-left px-2">Phone</th>
                <th className="text-right px-2">Outstanding</th>
                <th className="text-center px-2">Invoices</th>
                <th className="text-center px-2">Last Payment</th>
                <th className="text-right px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.map((c) => (
                <tr key={c.partyKey} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  <td className="py-2 px-3 font-semibold text-neutral-100">{c.name}</td>
                  <td className="px-2 text-neutral-400">{c.phone || "—"}</td>
                  <td className="text-right px-2 font-bold text-amber-400">{fmt(c.outstanding)}</td>
                  <td className="text-center px-2">{c.invoiceCount}</td>
                  <td className="text-center px-2 text-neutral-400">{c.lastPaymentDate || "—"}</td>
                  <td className="text-right px-3 whitespace-nowrap">
                    {onOpenLedger && (
                      <button type="button" onClick={() => onOpenLedger(c.partyKey)} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-violet-900/40 text-violet-300 text-[9px] font-bold mr-1">
                        <BookOpen className="h-3 w-3" /> Ledger
                      </button>
                    )}
                    {c.phone && (
                      <WhatsAppActionButton
                        staffUser={staffUser}
                        phone={c.phone}
                        messageType="invoice_payment_reminder"
                        vars={{ customerName: c.name, balanceDue: String(c.outstanding) }}
                        label="WhatsApp"
                        customerId={c.customerId || undefined}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-900/40 text-emerald-300 text-[9px] font-bold mr-1"
                      />
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-900/40 text-sky-300 text-[9px] font-bold">
                        <Phone className="h-3 w-3" /> Call
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {topCustomers.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-neutral-500">No outstanding balances</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-red-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300">Overdue Invoices</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-800">
                <th className="text-left py-2 px-3">Invoice #</th>
                <th className="text-left px-2">Customer</th>
                <th className="text-center px-2">Due Date</th>
                <th className="text-center px-2">Days Overdue</th>
                <th className="text-right px-2">Balance</th>
                <th className="text-right px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {overdueInvoices.map((row) => {
                const meta = AGING_BUCKET_META[row.agingBucket];
                return (
                  <tr key={row.invoiceId} className={`border-b border-neutral-800/50 hover:bg-neutral-800/30 ${meta.bg}`}>
                    <td className="py-2 px-3 font-semibold text-neutral-100">{row.invoiceNumber}</td>
                    <td className="px-2 text-neutral-300">{row.customerName}</td>
                    <td className="text-center px-2 text-neutral-400">{row.dueDate}</td>
                    <td className={`text-center px-2 font-bold ${meta.color}`}>{row.daysOverdue}</td>
                    <td className="text-right px-2 font-bold text-amber-400">{fmt(row.balanceDue)}</td>
                    <td className="text-right px-3 whitespace-nowrap">
                      {onOpenLedger && (
                        <button type="button" onClick={() => onOpenLedger(row.partyKey)} className="px-2 py-1 rounded bg-violet-900/40 text-violet-300 text-[9px] font-bold mr-1">
                          Pay
                        </button>
                      )}
                      {onEditInvoice && (
                        <button type="button" onClick={() => onEditInvoice(row.invoiceId)} className="px-2 py-1 rounded bg-slate-700 text-[9px] font-bold mr-1">
                          Invoice
                        </button>
                      )}
                      {row.customerPhone && (
                        <WhatsAppActionButton
                          staffUser={staffUser}
                          phone={row.customerPhone}
                          messageType="invoice_payment_reminder"
                          vars={{ customerName: row.customerName, invoiceNumber: row.invoiceNumber, balanceDue: String(row.balanceDue) }}
                          label="Remind"
                          className="px-2 py-1 rounded bg-emerald-900/40 text-emerald-300 text-[9px] font-bold"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
              {overdueInvoices.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-neutral-500">No overdue invoices</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
