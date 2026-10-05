import React, { useEffect, useMemo, useState } from "react";
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
import SmartQuotePreview from "./SmartQuotePreview";
import CustomerDocumentList from "./CustomerDocumentList";
import { prepareLeadCustomerProfile } from "../services/api";
import { parseSmartQuoteLeadNotes, parseSmartQuotePdfArchive, formatLeadReceivedAt, visibleLeadNotes, normalizePakistanMobile } from "../lib/smartQuoteLead";
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
  initialTab = "overview",
  relatedLeads = [],
}: {
  staffUser: User;
  lead: Lead;
  customerCode?: string;
  initialTab?: WorkspaceTab;
  relatedLeads?: Lead[];
}) {
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [proposalQuote, setProposalQuote] = useState<Quote | null>(null);
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);
  const [preparedCustomerId, setPreparedCustomerId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  useEffect(() => { setPreparedCustomerId(""); setPrepareError(""); }, [lead.id]);
  const smartQuote = parseSmartQuoteLeadNotes(lead.notes);
  const pdfArchive = parseSmartQuotePdfArchive(lead.notes);
  const customerId = leadCustomerId(lead) || preparedCustomerId;
  const phone = normalizePakistanMobile(lead.phone);
  const submissions = [lead, ...relatedLeads.filter(l => l.id !== lead.id && phone && normalizePakistanMobile(l.phone) === phone)]
    .filter(l => parseSmartQuoteLeadNotes(l.notes)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const prepareDocuments = async () => {
    setPreparing(true); setPrepareError("");
    try { setPreparedCustomerId((await prepareLeadCustomerProfile(lead.id)).customerId); }
    catch (error) { setPrepareError(error instanceof Error ? error.message : "Could not prepare documents."); }
    finally { setPreparing(false); }
  };
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
      {previewLead && <SmartQuotePreview lead={previewLead} onClose={() => setPreviewLead(null)} />}
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
            <Fact label="Latest proposal" value={accepted ? `${accepted.systemSizekW} kW · ${accepted.status}` : smartQuote ? `${smartQuote.system} · ${pdfArchive ? "PDF saved" : "Client submitted"}` : "None yet"} />
            <Fact label="Clearance" value={clearance} />
            <Fact label="Notes" value={visibleLeadNotes(lead.notes) || "No notes"} />
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
            {submissions.map(submission => {
              const smartQuote = parseSmartQuoteLeadNotes(submission.notes)!;
              const pdfArchive = parseSmartQuotePdfArchive(submission.notes);
              return <div key={submission.id} className="rounded-2xl border border-violet-400/40 bg-violet-500/10 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2"><FileText className="h-5 w-5 text-violet-300"/><strong className="text-white">{smartQuote.quoteNumber} · {smartQuote.system}</strong><span className="text-cyan-200">{formatLeadReceivedAt(submission.createdAt)}</span></div>
              <p className="text-sm text-violet-200">Client Smart Quote · PKR {smartQuote.estimatePkr.toLocaleString("en-PK")}</p>
              <div className="flex flex-wrap gap-3"><button className="rounded-xl bg-violet-500/20 border border-violet-400/40 px-3 py-2 text-violet-100" onClick={() => setPreviewLead(submission)}>View quotation</button>
                {pdfArchive && <a className="rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3 py-2 text-emerald-100" href={pdfArchive.fileUrl} target="_blank" rel="noopener noreferrer" download={pdfArchive.fileName}>Open / download saved client PDF</a>}
              </div>
              <p className="text-xs text-slate-300">{pdfArchive ? `Original client PDF archived ${formatLeadReceivedAt(pdfArchive.savedAt)}.` : "The quotation submission is saved. An original PDF appears here after the client uses Save PDF."}</p>
            </div>; })}
            <CustomerDocumentList staffUser={staffUser} customerId={customerId} quotationOnly />
            {quotes.length === 0 && submissions.length === 0 && <p className="text-sm text-slate-500">No saved quotations yet.</p>}
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
        {tab === "documents" && (customerId ? <ClientPortalStaffTools staffUser={staffUser} section="documents" initialCustomerId={customerId} /> : <div className="space-y-3"><p className="text-sm text-slate-300">Prepare this client's document wallet to upload files.</p><button type="button" disabled={preparing} onClick={() => void prepareDocuments()} className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-3 text-cyan-200">{preparing ? "Preparing…" : "Enable client documents"}</button>{prepareError && <p role="alert" className="text-red-300">{prepareError}</p>}</div>)}
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
