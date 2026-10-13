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
import { fetchLeadSmartQuoteVersions, issueLeadSmartQuoteLink, prepareLeadCustomerProfile, type SmartQuoteVersionView } from "../services/api";
import { parseSmartQuoteLeadNotes, parseSmartQuotePdfArchive, formatLeadReceivedAt, visibleLeadNotes, normalizePakistanMobile } from "../lib/smartQuoteLead";
import { namesPlausiblyMatch } from "../lib/clientIdentity";
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
  const [previewVersion, setPreviewVersion] = useState<SmartQuoteVersionView | null>(null);
  const [versions, setVersions] = useState<SmartQuoteVersionView[]>([]);
  const [versionsError, setVersionsError] = useState("");
  useEffect(() => {
    if (tab !== "quotes") return;
    let active = true;
    setVersionsError("");
    fetchLeadSmartQuoteVersions(lead.id)
      .then((result) => { if (active) setVersions(result.versions || []); })
      .catch((error) => { if (active) { setVersions([]); setVersionsError(error instanceof Error ? error.message : "Could not load saved quotation versions."); } });
    return () => { active = false; };
  }, [lead.id, tab]);
  const [linkState, setLinkState] = useState<{ url?: string; error?: string; busy?: boolean }>({});
  useEffect(() => setLinkState({}), [lead.id]);
  const createSmartQuoteLink = async () => {
    setLinkState({ busy: true });
    try {
      const issued = await issueLeadSmartQuoteLink(lead.id);
      try { await navigator.clipboard?.writeText(issued.url); } catch { /* the URL is shown below for manual copy */ }
      setLinkState({ url: issued.url });
    } catch (error) { setLinkState({ error: error instanceof Error ? error.message : "Could not create the link." }); }
  };
  const [preparedCustomerId, setPreparedCustomerId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  useEffect(() => { setPreparedCustomerId(""); setPrepareError(""); }, [lead.id]);
  const smartQuote = parseSmartQuoteLeadNotes(lead.notes);
  const pdfArchive = parseSmartQuotePdfArchive(lead.notes);
  const customerId = leadCustomerId(lead) || preparedCustomerId;
  const phone = normalizePakistanMobile(lead.phone);
  // Versioned leads list their history below. A public Smart Quote never joins an existing lead on name and phone alone, so
  // other leads that merely look like this client (same phone, similar name) are shown apart and marked unverified: staff
  // merge them deliberately. A lead that only shares the phone number belongs to another client and is not listed at all.
  const submissions = (versions.length ? [] : [lead]).filter(l => parseSmartQuoteLeadNotes(l.notes));
  const possibleDuplicates = relatedLeads.filter(l => l.id !== lead.id && phone && normalizePakistanMobile(l.phone) === phone && namesPlausiblyMatch(l.name, lead.name))
    .filter(l => parseSmartQuoteLeadNotes(l.notes)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const reviewNotes = String(lead.notes || "").split(/\r?\n/).filter(line => /^(Possible existing client|Shared phone number):/.test(line));
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
      {previewLead && <SmartQuotePreview lead={previewLead} version={previewVersion || undefined} onClose={() => { setPreviewLead(null); setPreviewVersion(null); }} />}
      <header className="px-4 py-4 border-b border-slate-800">
        <p className="text-[10px] uppercase tracking-wide font-mono text-slate-500">Manage client</p>
        <h3 className="text-lg font-bold text-white">{lead.name}</h3>
        <p className="text-xs text-slate-400 font-mono">
          Lead {lead.id}
          {customerId ? ` · Customer ${customerId}` : " · CRM profile pending"}
        </p>
      </header>
      {reviewNotes.length > 0 && (
        <div role="note" data-testid="smart-quote-review-note" className="px-4 py-2 border-b border-amber-500/40 bg-amber-500/10 text-xs text-amber-100 space-y-1">
          {reviewNotes.map(line => <p key={line}>{line}</p>)}
        </div>
      )}
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
            {versionsError && <p role="alert" className="text-sm text-red-300">{versionsError}</p>}
            {versions.map(version => (
              <div key={version.id} data-testid={`smart-quote-version-${version.versionNumber}`} className="rounded-2xl border border-violet-400/40 bg-violet-500/10 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2"><FileText className="h-5 w-5 text-violet-300"/><strong className="text-white">Version {version.versionNumber} · {version.quoteNumber} · {version.systemCapacityKw} kW</strong><span className="text-cyan-200">{formatLeadReceivedAt(version.createdAt)}</span>{version.versionNumber === versions[0].versionNumber && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">Latest</span>}</div>
                <p className="text-sm text-violet-200">{version.source} · PKR {version.totalPkr.toLocaleString("en-PK")}{version.discountPkr ? ` (discount PKR ${version.discountPkr.toLocaleString("en-PK")})` : ""}</p>
                <div className="flex flex-wrap gap-3"><button className="rounded-xl bg-violet-500/20 border border-violet-400/40 px-3 py-2 text-violet-100" onClick={() => { setPreviewVersion(version); setPreviewLead(lead); }}>View quotation</button>
                  {version.pdf && <a className="rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3 py-2 text-emerald-100" href={version.pdf.fileUrl} target="_blank" rel="noopener noreferrer" download={version.pdf.fileName}>Open / download saved client PDF</a>}
                </div>
                <p className="text-xs text-slate-300">{version.pdf ? `Client PDF archived ${formatLeadReceivedAt(version.pdf.savedAt)}.` : "Quotation details are saved. A PDF appears here after the client's copy is archived."}</p>
              </div>
            ))}
            {submissions.map(submission => {
              const smartQuote = parseSmartQuoteLeadNotes(submission.notes)!;
              const pdfArchive = parseSmartQuotePdfArchive(submission.notes);
              return <div key={submission.id} className="rounded-2xl border border-violet-400/40 bg-violet-500/10 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2"><FileText className="h-5 w-5 text-violet-300"/><strong className="text-white">{smartQuote.quoteNumber} · {smartQuote.system}</strong><span className="text-cyan-200">{formatLeadReceivedAt(submission.createdAt)}</span></div>
              <p className="text-sm text-violet-200">Client Smart Quote · PKR {smartQuote.estimatePkr.toLocaleString("en-PK")}</p>
              <div className="flex flex-wrap gap-3"><button className="rounded-xl bg-violet-500/20 border border-violet-400/40 px-3 py-2 text-violet-100" onClick={() => { setPreviewVersion(null); setPreviewLead(submission); }}>View quotation</button>
                {pdfArchive && <a className="rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3 py-2 text-emerald-100" href={pdfArchive.fileUrl} target="_blank" rel="noopener noreferrer" download={pdfArchive.fileName}>Open / download saved client PDF</a>}
              </div>
              <p className="text-xs text-slate-300">{pdfArchive ? `Original client PDF archived ${formatLeadReceivedAt(pdfArchive.savedAt)}.` : "The quotation submission is saved. An original PDF appears here after the client uses Save PDF."}</p>
            </div>; })}
            <div className="rounded-2xl border border-slate-800 p-3 text-xs text-slate-300 space-y-2">
              <p>Send this client a personal Smart Quote link so their next quotation is added to this lead as a new version. Without the link, a public quotation always creates its own lead.</p>
              <button type="button" disabled={linkState.busy} onClick={createSmartQuoteLink} className="rounded-xl border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-violet-100 disabled:opacity-60">Create client Smart Quote link</button>
              {linkState.url && <p data-testid="smart-quote-link-url" className="break-all font-mono text-emerald-200">{linkState.url}</p>}
              {linkState.error && <p role="alert" className="text-red-300">{linkState.error}</p>}
            </div>
            {possibleDuplicates.length > 0 && <p className="text-xs font-semibold text-amber-200">Possibly the same client (unverified, separate leads, not merged)</p>}
            {possibleDuplicates.map(submission => {
              const dup = parseSmartQuoteLeadNotes(submission.notes)!;
              return <div key={submission.id} data-testid="smart-quote-possible-duplicate" className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 space-y-2">
                <strong className="text-white">{dup.quoteNumber} · {dup.system} · PKR {dup.estimatePkr.toLocaleString("en-PK")}</strong>
                <p className="text-xs text-amber-100">Lead {submission.id} ({submission.name}). Submitted without verification; review before treating it as this client's quotation.</p>
                <button className="rounded-xl bg-amber-500/20 border border-amber-400/40 px-3 py-2 text-amber-100" onClick={() => { setPreviewVersion(null); setPreviewLead(submission); }}>View quotation</button>
              </div>;
            })}
            <CustomerDocumentList staffUser={staffUser} customerId={customerId} quotationOnly />
            {!customerId && quotes.length === 0 && submissions.length === 0 && possibleDuplicates.length === 0 && versions.length === 0 && <p className="text-sm text-slate-500">No saved quotations yet.</p>}
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
