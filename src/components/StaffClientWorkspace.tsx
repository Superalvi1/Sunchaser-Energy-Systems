import React, { useMemo, useState } from "react";
import {
  CreditCard,
  FileText,
  Headphones,
  Link2,
  NotebookPen,
  Shield,
  Sun,
  Wallet,
  Wrench,
} from "lucide-react";
import type { Lead, Quote, User } from "../types";
import { staffLeadCustomerId } from "../lib/clientPortalRouting";
import CustomerInvitationPanel from "./CustomerInvitationPanel";
import ClientPortalStaffTools from "./ClientPortalStaffTools";
import CustomerProfileStaff from "./CustomerProfileStaff";
import AfterSalesAdminTabs from "./AfterSalesAdminTabs";
import InvoiceStaff from "./InvoiceStaff";
import InteractiveProposalShareModal from "./InteractiveProposalShareModal";

type WorkspaceTab =
  | "overview"
  | "profile"
  | "quotes"
  | "finance"
  | "system"
  | "support"
  | "documents";

const TABS: { id: WorkspaceTab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Sun },
  { id: "profile", label: "Details", icon: NotebookPen },
  { id: "quotes", label: "Proposals", icon: FileText },
  { id: "finance", label: "Payments", icon: Wallet },
  { id: "system", label: "System", icon: Wrench },
  { id: "support", label: "Support", icon: Headphones },
  { id: "documents", label: "Documents", icon: Shield },
];

export function leadCustomerId(lead: Lead | null | undefined): string {
  return staffLeadCustomerId(lead as any);
}

export default function StaffClientWorkspace({
  staffUser,
  lead,
  customerCode,
}: {
  staffUser: User;
  lead: Lead;
  customerCode?: string;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [proposalQuote, setProposalQuote] = useState<Quote | null>(null);
  const customerId = leadCustomerId(lead);
  const quotes = lead.quotes || [];
  const accepted = quotes.find((q) => q.status === "Accepted") || quotes[quotes.length - 1];
  const clearance = useMemo(() => {
    const paid = Number((lead as any).amountPaid || 0);
    const total = Number(accepted?.totalCost || accepted?.netCost || 0);
    if (total <= 0) return "No billed balance";
    if (paid >= total) return "Cleared";
    return `Outstanding ${Math.max(0, total - paid).toLocaleString()}`;
  }, [accepted, lead]);

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-950/80 overflow-hidden">
      <header className="px-4 py-4 border-b border-slate-800">
        <p className="text-[10px] uppercase tracking-wide font-mono text-slate-500">Manage client</p>
        <h3 className="text-lg font-bold text-white">{lead.name}</h3>
        <p className="text-xs text-slate-400 font-mono">
          Lead {lead.id}
          {customerId ? ` · Customer ${customerId}` : " · CRM profile pending"}
        </p>
      </header>
      <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-slate-800">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-[40px] shrink-0 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
              tab === item.id ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>
      <div className="p-4 space-y-4">
        {tab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Fact label="Email" value={lead.email || "—"} />
            <Fact label="Phone" value={lead.phone || "—"} />
            <Fact label="Address" value={lead.address || "—"} />
            <Fact label="Project status" value={lead.status} />
            <Fact label="Latest proposal" value={accepted ? `${accepted.systemSizekW} kW · ${accepted.status}` : "None yet"} />
            <Fact label="Clearance" value={clearance} />
            <Fact label="Notes" value={lead.notes || "No notes"} />
            {customerCode ? (
              <div className="md:col-span-2">
                <CustomerInvitationPanel customerName={lead.name} customerCode={customerCode} phone={lead.phone} compact />
              </div>
            ) : null}
          </div>
        )}
        {tab === "profile" && <CustomerProfileStaff staffUser={staffUser} initialUserId={customerId} />}
        {tab === "quotes" && (
          <div className="space-y-2">
            {quotes.length === 0 && <p className="text-sm text-slate-500">No saved quotations yet.</p>}
            {quotes.map((quote) => (
              <div key={quote.id} className="rounded-2xl border border-slate-800 px-3 py-2 text-sm text-slate-200 flex flex-wrap items-center justify-between gap-3">
                <span>{quote.id} · {quote.systemSizekW} kW · {quote.status}</span>
                <button
                  type="button"
                  onClick={() => setProposalQuote(quote)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-200"
                >
                  <Link2 className="h-3.5 w-3.5" /> Interactive link
                </button>
              </div>
            ))}
            <p className="text-xs text-slate-500">The original quotation stays unchanged. Accepted configurations are stored as a separate snapshot.</p>
          </div>
        )}
        {tab === "finance" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-800 p-4 text-sm text-slate-300 space-y-2">
              <p className="inline-flex items-center gap-2 font-semibold text-white">
                <CreditCard className="h-4 w-4 text-amber-400" /> Payments, invoices, outstanding balance
              </p>
              <Fact label="Clearance" value={clearance} />
            </div>
            {customerId ? (
              <InvoiceStaff staffUser={staffUser} leads={[lead]} initialCustomerId={customerId} />
            ) : (
              <p className="text-sm text-slate-500">Link this lead to a customer profile before managing invoices.</p>
            )}
          </div>
        )}
        {tab === "system" && <ClientPortalStaffTools staffUser={staffUser} section="warranty" initialCustomerId={customerId} />}
        {tab === "support" && <AfterSalesAdminTabs staffUser={staffUser} leads={[lead]} />}
        {tab === "documents" && <ClientPortalStaffTools staffUser={staffUser} section="documents" initialCustomerId={customerId} />}
      </div>
      {proposalQuote ? (
        <InteractiveProposalShareModal
          open
          lead={lead}
          quote={proposalQuote}
          onClose={() => setProposalQuote(null)}
        />
      ) : null}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide font-mono text-slate-500">{label}</p>
      <p className="text-sm text-slate-100 break-words">{value}</p>
    </div>
  );
}
