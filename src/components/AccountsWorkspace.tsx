import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Plus,
  Search,
  Package,
  BarChart3,
  Loader2,
} from "lucide-react";
import type { Lead, Product, User } from "../types";
import { fetchAdminParties } from "../services/api";
import { canCreateInvoice, type PartyLedgerSummary } from "../lib/invoices";
import { canViewFinanceDashboard } from "../lib/financeDashboard";
import { isQualifiedCrmLead } from "../lib/crmLeadQualification";
import { normalizePakistanMobile } from "../lib/smartQuoteLead";
import { useOverlayBackClose } from "../lib/useOverlayBackClose";
import InvoiceStaff from "./InvoiceStaff";
import PartyLedgerStaff from "./PartyLedgerStaff";
import FinanceDashboardStaff from "./FinanceDashboardStaff";
import StaffClientWorkspace from "./StaffClientWorkspace";
import PublicQuotationBuilderPage from "./PublicQuotationBuilderPage";
import "./accountsWorkspace.css";

type View = "parties" | "sales" | "quotes" | "items" | "reports";
type Party = {
  id: string;
  name: string;
  phone: string;
  address: string;
  ledger?: PartyLedgerSummary;
  lead?: Lead;
};
const tabs = [
  { id: "parties", label: "Parties", icon: BookOpen },
  { id: "sales", label: "Sales", icon: FileText },
  { id: "quotes", label: "Quotations", icon: FileText },
  { id: "items", label: "Items", icon: Package },
  { id: "reports", label: "Reports", icon: BarChart3 },
] as const;
const money = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-PK")}`;

export default function AccountsWorkspace({
  staffUser,
  leads,
  products,
  onExit,
  onAddParty,
  initialView = "parties",
}: {
  staffUser: User;
  leads: Lead[];
  products: Product[];
  onExit: () => void;
  onAddParty: (data: Record<string, unknown>) => Promise<void>;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const [unsaved, setUnsaved] = useState(false);
  const canLeave = () =>
    !unsaved || window.confirm("Discard unsaved invoice changes?");
  const exit = () => {
    if (canLeave()) onExit();
  };
  const [ledger, setLedger] = useState<PartyLedgerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [party, setParty] = useState<Party | null>(null);
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);
  const [newQuote, setNewQuote] = useState(false);
  const [newParty, setNewParty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [saleParty, setSaleParty] = useState<Party | null>(null);
  const [saleKey, setSaleKey] = useState(0);
  const [draft, setDraft] = useState({
    name: "",
    phone: "",
    address: "",
    email: "",
  });
  const allowed = canCreateInvoice(staffUser.username, staffUser.role);
  const reportsAllowed = canViewFinanceDashboard(
    staffUser.username,
    staffUser.role,
  );
  const qualified = useMemo(() => leads.filter(isQualifiedCrmLead), [leads]);
  useEffect(() => {
    if (!allowed || view !== "parties") return;
    let active = true;
    setLoading(true);
    setError("");
    fetchAdminParties(staffUser)
      .then((r) => {
        if (active) setLedger(r.parties || []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [allowed, view, staffUser.id, staffUser.username, staffUser.role, leads]);
  const parties = useMemo(() => {
    const result: Party[] = ledger.map((p) => ({
      id: p.partyKey,
      name: p.name,
      phone: p.phone || "",
      address: p.billingAddress || "",
      ledger: p,
    }));
    for (const lead of qualified) {
      const phone = normalizePakistanMobile(lead.phone);
      const found = result.find(
        (p) =>
          (phone && normalizePakistanMobile(p.phone) === phone) ||
          (!phone && p.name.toLowerCase() === lead.name.toLowerCase()),
      );
      if (found) {
        found.lead = lead;
      } else
        result.push({
          id: lead.id,
          name: lead.name,
          phone: lead.phone || "",
          address: lead.address || "",
          lead,
        });
    }
    return result
      .filter((p) =>
        `${p.name} ${p.phone}`.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ledger, qualified, search]);
  const back = () => {
    if (!canLeave()) return;
    setUnsaved(false);
    if (newQuote) setNewQuote(false);
    else if (newParty) setNewParty(false);
    else if (quoteLead) setQuoteLead(null);
    else if (party) setParty(null);
    else if (view !== "parties") {
      setView("parties");
      setSaleParty(null);
    } else onExit();
  };
  useOverlayBackClose(true, back);
  const navigate = (next: View) => {
    if (!canLeave()) return;
    setUnsaved(false);
    setView(next);
    setParty(null);
    setQuoteLead(null);
    setNewQuote(false);
    setNewParty(false);
    setSearch("");
  };
  const addSale = (p?: Party) => {
    setSaleParty(p || null);
    setInvoiceId(null);
    setSaleKey((k) => k + 1);
    navigate("sales");
  };
  const openInvoice = (id: string) => {
    setInvoiceId(id);
    setSaleParty(null);
    setSaleKey((k) => k + 1);
    navigate("sales");
  };
  const addParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.phone.trim()) {
      setError("Party name and phone are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAddParty({
        ...draft,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        leadSource: "Direct/Referral",
        notes: "Manually added in Accounts workspace.",
        status: "New",
        location: "",
        monthlyBill: 0,
        monthlyUnits: 0,
      });
      setNewParty(false);
      setDraft({ name: "", phone: "", address: "", email: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save party.");
    } finally {
      setSaving(false);
    }
  };
  if (!allowed)
    return (
      <main className="p-6">
        <button onClick={exit}>Back to CRM</button>
        <p>Accounts access is not available for this staff role.</p>
      </main>
    );
  return (
    <main
      data-accounts
      className="accounts-workspace min-h-screen bg-sky-50 text-slate-800 pb-24"
    >
      <header
        className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-4 flex items-center gap-3"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={back}
          aria-label="Back"
          className="grid h-11 w-11 place-items-center rounded-full hover:bg-sky-50"
        >
          <ArrowLeft />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">
            {newParty
              ? "Add Party"
              : newQuote
                ? "New Quotation"
                : party?.name || "Sunchaser Accounts"}
          </h1>
          <p className="text-xs text-slate-500">Sunchaser Energy Systems</p>
        </div>
        <button
          type="button"
          onClick={exit}
          className="hidden sm:block rounded-lg border px-4 py-2 text-sm"
        >
          CRM home
        </button>
      </header>
      <div className="mx-auto max-w-[1600px] lg:grid lg:grid-cols-[200px_1fr]">
        <nav
          aria-label="Accounts navigation"
          className="hidden lg:flex flex-col gap-2 bg-slate-900 p-4 min-h-[90vh]"
        >
          {tabs
            .filter((t) => t.id !== "reports" || reportsAllowed)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(t.id)}
                aria-current={view === t.id ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left font-semibold ${view === t.id ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
              >
                <t.icon size={20} />
                {t.label}
              </button>
            ))}
        </nav>
        <section className="min-w-0 p-3 sm:p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
            >
              {error}
            </div>
          )}
          {newParty ? (
            <form
              onSubmit={addParty}
              className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-white p-5 border border-slate-200"
            >
              {(["name", "phone", "address", "email"] as const).map((key) => (
                <label
                  key={key}
                  className="block text-sm font-semibold capitalize"
                >
                  {key}
                  {["name", "phone"].includes(key) ? " *" : " (optional)"}
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-base"
                    type={
                      key === "email"
                        ? "email"
                        : key === "phone"
                          ? "tel"
                          : "text"
                    }
                    value={draft[key]}
                    disabled={saving}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <button
                disabled={saving}
                className="min-h-12 w-full rounded-full bg-rose-600 font-bold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Party"}
              </button>
            </form>
          ) : newQuote ? (
            <PublicQuotationBuilderPage mode="staff" />
          ) : view === "parties" ? (
            party ? (
              <>
                <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 flex flex-wrap justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{party.name}</h2>
                    <a className="text-blue-600" href={`tel:${party.phone}`}>
                      {party.phone}
                    </a>
                    <p className="text-sm text-slate-500">{party.address}</p>
                  </div>
                  <div className="text-right">
                    <button
                      onClick={() => addSale(party)}
                      className="mt-3 min-h-11 rounded-full bg-rose-600 px-6 font-semibold text-white"
                    >
                      + Add Sale
                    </button>
                  </div>
                </div>
                {party.ledger ? (
                  <PartyLedgerStaff
                    staffUser={staffUser}
                    fullPage
                    initialPartyKey={party.ledger.partyKey}
                    onEditInvoice={openInvoice}
                  />
                ) : (
                  <div className="rounded-2xl bg-white p-6 text-slate-500">
                    No invoices or payments yet. Add a sale to start this
                    party’s ledger.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">Party Details</h2>
                  <button
                    onClick={() => {
                      setError("");
                      setNewParty(true);
                    }}
                    className="min-h-11 rounded-full bg-rose-600 px-5 font-bold text-white"
                  >
                    + Add Party
                  </button>
                </div>
                <label className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <Search className="text-blue-500" />
                  <input
                    aria-label="Search parties"
                    placeholder="Search party name or phone"
                    className="w-full bg-transparent text-base outline-none"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {loading ? (
                  <p role="status" className="flex gap-2 p-4">
                    <Loader2 className="animate-spin" />
                    Loading party balances…
                  </p>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                    {parties.length ? (
                      parties.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setParty(p)}
                          className="flex w-full justify-between gap-4 border-b border-slate-100 p-4 text-left hover:bg-sky-50"
                        >
                          <span className="min-w-0">
                            <strong className="block">{p.name}</strong>
                            <span className="text-sm text-slate-400">
                              {p.phone || "No phone"}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <strong className="block text-emerald-600">
                              {money(p.ledger?.balanceDue || 0)}
                            </strong>
                            <span className="text-xs text-slate-500">
                              {p.ledger ? "You’ll get" : "No transactions"}
                            </span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="p-6 text-slate-500">
                        No parties match your search.
                      </p>
                    )}
                  </div>
                )}
              </>
            )
          ) : view === "sales" ? (
            <InvoiceStaff
              onDirtyChange={setUnsaved}
              key={saleKey}
              staffUser={staffUser}
              products={products}
              leads={qualified}
              fullPage
              initialParty={
                saleParty
                  ? {
                      name: saleParty.name,
                      phone: saleParty.phone,
                      address: saleParty.address,
                    }
                  : undefined
              }
              startNew={Boolean(saleParty)}
              openInvoiceId={invoiceId}
              onOpenInvoiceConsumed={() => setInvoiceId(null)}
            />
          ) : view === "quotes" ? (
            quoteLead ? (
              <>
                <button
                  onClick={() => setQuoteLead(null)}
                  className="mb-4 min-h-11 text-blue-600"
                >
                  ← All quotations
                </button>
                <StaffClientWorkspace
                  staffUser={staffUser}
                  lead={quoteLead}
                  relatedLeads={qualified}
                  initialTab="quotes"
                />
              </>
            ) : (
              <>
                <div className="mb-4 flex justify-between gap-3">
                  <h2 className="text-xl font-bold">Quotations</h2>
                  <button
                    onClick={() => setNewQuote(true)}
                    className="min-h-11 rounded-full bg-rose-600 px-5 font-bold text-white"
                  >
                    + New Quotation
                  </button>
                </div>
                <div className="space-y-3">
                  {qualified
                    .filter(
                      (l) => l.quotes?.length || l.leadSource === "Smart Quote",
                    )
                    .map((l) => (
                      <button
                        key={l.id}
                        onClick={() => setQuoteLead(l)}
                        className="block w-full rounded-2xl bg-white border border-slate-200 p-5 text-left"
                      >
                        <strong>{l.name}</strong>
                        <span className="block text-sm text-slate-500">
                          {l.phone} · {l.leadSource} · Open proposals and saved
                          PDFs
                        </span>
                      </button>
                    ))}
                </div>
              </>
            )
          ) : view === "reports" && reportsAllowed ? (
            <FinanceDashboardStaff
              staffUser={staffUser}
              onOpenLedger={(key) => {
                const l = ledger.find((p) => p.partyKey === key);
                navigate("parties");
                setParty({
                  id: key,
                  name: l?.name || "Party Ledger",
                  phone: l?.phone || "",
                  address: l?.billingAddress || "",
                  ledger: l || {
                    partyKey: key,
                    customerId: null,
                    name: "Party Ledger",
                    phone: null,
                    billingAddress: null,
                    totalSales: 0,
                    receivedAmount: 0,
                    balanceDue: 0,
                    invoiceCount: 0,
                  },
                });
              }}
              onEditInvoice={openInvoice}
            />
          ) : view === "items" ? (
            <>
              <h2 className="mb-4 text-xl font-bold">Items</h2>
              <p className="mb-4 text-sm text-slate-500">
                Catalogue items are available in Add Sale. Quantity, description
                and rates can be edited on the invoice.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {products.map((p) => (
                  <div key={p.id} className="rounded-xl border bg-white p-4">
                    <strong>{p.name}</strong>
                    <p className="text-sm text-slate-500">
                      {(p as any).category || ""}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
      <nav
        aria-label="Mobile accounts navigation"
        className="fixed bottom-0 inset-x-0 z-30 flex border-t border-slate-200 bg-white lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs
          .filter((t) => t.id !== "reports" || reportsAllowed)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(t.id)}
              aria-current={view === t.id ? "page" : undefined}
              className={`flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${view === t.id ? "text-blue-600" : "text-slate-400"}`}
            >
              <t.icon size={21} />
              {t.label}
            </button>
          ))}
      </nav>
    </main>
  );
}
