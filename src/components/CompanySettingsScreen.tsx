import React, { useCallback, useEffect, useState } from "react";
import { Building2, CreditCard, FileText, History, Loader2, Lock, Plus, Save, Tag, Trash2 } from "lucide-react";
import {
  fetchCompanySettings,
  fetchCompanySettingsHistory,
  refreshWorkspaceBrand,
  saveCompanySettingsSection,
  type CompanySettingsHistoryEntry,
  type CompanySettingsView,
} from "../services/api";
import { diffSettings, type SettingsSection } from "../lib/settingsDiff";

/**
 * The company administrator's settings screen (pilot companies): branding, bank accounts, terms, prices and the history of changes.
 * Anyone on the staff can read it; only a company administrator can change it (the server enforces this; the form is read-only here when
 * the server says the user cannot edit). Invoices and quotations already issued keep the values they were issued with, so a change here
 * affects later documents only.
 */
type Tab = "branding" | "bank" | "terms" | "prices" | "history";
type Bank = CompanySettingsView["bankAccounts"][number];

const inputCls = "w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100 disabled:opacity-60";
const btnCls = "inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-50";

const BRANDING_FIELDS: Array<[string, string]> = [
  ["companyName", "Company name"],
  ["officeAddress", "Address"],
  ["phoneNumbers", "Phone numbers"],
  ["billingEmail", "Billing e-mail"],
  ["websiteUrl", "Website"],
  ["logoUrl", "Logo (link to an image)"],
  ["invoiceLogoUrl", "Invoice logo (optional)"],
  ["signatureUrl", "Signature image (optional)"],
  ["googleReviewUrl", "Google review link (optional)"],
];

const emptyBank = (order: number): Bank => ({ bankName: "", accountTitle: "", accountNumber: "", iban: "", branchCode: "", isActive: true, showOnInvoice: true, sortOrder: order });

/** The values of one change, before and after (the server keeps both). Only what differs is listed; embedded images are never printed. */
function HistoryDetail({ entry }: { entry: CompanySettingsHistoryEntry }) {
  const rows = diffSettings(entry.section as SettingsSection, entry.before, entry.after);
  if (rows.length === 0) return <p className="mt-1 text-neutral-500" data-testid="history-detail">No value differs between before and after.</p>;
  return (
    <table className="mt-2 w-full text-left text-[11px]" data-testid="history-detail">
      <thead className="text-neutral-500"><tr><th className="pr-3 font-normal">What</th><th className="pr-3 font-normal">Before</th><th className="font-normal">After</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-neutral-800 align-top" data-testid="diff-row" data-kind={r.kind}>
            <td className="py-1 pr-3 text-neutral-300">{r.label}</td>
            <td className="pr-3 break-words text-red-200" data-testid="diff-before">{r.before}</td>
            <td className="break-words text-emerald-200" data-testid="diff-after">{r.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CompanySettingsScreen() {
  const [data, setData] = useState<CompanySettingsView | null>(null);
  const [tab, setTab] = useState<Tab>("branding");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState<Record<string, string>>({});
  const [banks, setBanks] = useState<Bank[]>([]);
  const [termsText, setTermsText] = useState("");
  const [prices, setPrices] = useState({ currencySettings: "", taxSettings: "", quoteValidityDays: "" });
  const [history, setHistory] = useState<CompanySettingsHistoryEntry[] | null>(null);
  const [historyAvailable, setHistoryAvailable] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null); // the bank row waiting for "Remove" to be confirmed
  const [openHistory, setOpenHistory] = useState<string | null>(null);     // the history entry whose before/after values are shown

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await fetchCompanySettings();
      setData(d);
      setBranding(Object.fromEntries(BRANDING_FIELDS.map(([k]) => [k, String(d.branding?.[k] ?? "")])));
      setBanks(d.bankAccounts.length ? d.bankAccounts : []);
      setTermsText((d.terms || []).join("\n"));
      setPrices({ currencySettings: d.priceSettings.currencySettings || "", taxSettings: d.priceSettings.taxSettings || "", quoteValidityDays: d.priceSettings.quoteValidityDays ? String(d.priceSettings.quoteValidityDays) : "" });
    } catch (e: any) {
      setError(e.message || "Could not load the company settings.");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const h = await fetchCompanySettingsHistory();
      setHistory(h.history);
      setHistoryAvailable(h.available);
    } catch (e: any) {
      setHistory([]);
      setError(e.message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === "history" && data?.permissions.canEdit) void loadHistory(); }, [tab, data?.permissions.canEdit, loadHistory]);

  if (!data) return error ? <p className="m-6 text-sm text-red-300" role="alert">{error}</p> : <Loader2 className="animate-spin h-6 w-6 text-amber-400 m-6" />;

  const canEdit = data.permissions.canEdit;
  const plain = (rows: Bank[]) => JSON.stringify(rows.map(({ id: _id, ...rest }, i) => ({ ...rest, sortOrder: i + 1 })));
  const banksDirty = plain(banks) !== plain(data.bankAccounts);

  const save = async (section: "branding" | "bank-accounts" | "terms" | "prices", body: Record<string, unknown>, done: string) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await saveCompanySettingsSection(section, body);
      // Re-read first, then say it is saved: the "unsaved changes" warning compares the edited list with the re-read one, and must not show beside "saved".
      await load();
      setNotice(res.auditRecorded === false ? `${done} (the change could not be written to the history; the operator has been logged an error).` : done);
      if (section === "branding") void refreshWorkspaceBrand(); // the header shows the new name and logo at once
      setHistory(null);
    } catch (e: any) {
      setError(e.message || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const tabBtn = (id: Tab, label: string, Icon: React.ElementType) => (
    <button
      key={id}
      type="button"
      onClick={() => { setTab(id); setNotice(null); setError(null); }}
      data-testid={`company-settings-tab-${id}`}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${tab === id ? "bg-amber-500 text-black" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <div className="space-y-5 p-2 max-w-3xl" data-testid="company-settings">
      <div>
        <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2"><Building2 className="h-5 w-5 text-amber-400" /> Company settings</h2>
        <p className="text-xs text-neutral-500">
          These values appear on your quotations and invoices. Documents you have already issued keep the values they were issued with; a change here applies to new documents.
        </p>
        {!canEdit && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-300" data-testid="company-settings-readonly">
            <Lock className="h-4 w-4" /> You can view these settings. Only a company administrator can change them.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabBtn("branding", "Branding", Building2)}
        {tabBtn("bank", "Bank accounts", CreditCard)}
        {tabBtn("terms", "Terms", FileText)}
        {tabBtn("prices", "Prices", Tag)}
        {canEdit && tabBtn("history", "History", History)}
      </div>

      {error && <p className="text-sm text-red-300" role="alert" data-testid="company-settings-error">{error}</p>}
      {notice && <p className="text-sm text-emerald-300" role="status" data-testid="company-settings-notice">{notice}</p>}

      {tab === "branding" && (
        <section className="grid gap-3">
          {BRANDING_FIELDS.map(([key, label]) => (
            <label key={key} className="block text-xs text-neutral-400">
              {label}
              <input className={inputCls} disabled={!canEdit} value={branding[key] || ""} data-testid={`branding-${key}`}
                onChange={(e) => setBranding((b) => ({ ...b, [key]: e.target.value }))} />
            </label>
          ))}
          {canEdit && <div><button type="button" className={btnCls} disabled={saving} data-testid="save-branding"
            onClick={() => save("branding", branding, "Branding saved.")}><Save className="h-4 w-4" /> Save branding</button></div>}
        </section>
      )}

      {tab === "bank" && (
        <section className="space-y-3">
          <p className="text-xs text-neutral-500">Accounts marked “show on invoice” are printed on new invoices. Existing invoices keep the accounts they were issued with.</p>
          {banks.length === 0 && <p className="text-sm text-neutral-400">No bank account yet.</p>}
          {banks.map((b, i) => (
            <div key={b.id || `new-${i}`} className="grid gap-2 rounded-xl border border-neutral-800 p-3 sm:grid-cols-2" data-testid={`bank-row-${i}`}>
              {([["bankName", "Bank"], ["accountTitle", "Account title"], ["accountNumber", "Account number"], ["iban", "IBAN"], ["branchCode", "Branch code"]] as const).map(([k, label]) => (
                <label key={k} className="block text-xs text-neutral-400">{label}
                  <input className={inputCls} disabled={!canEdit} value={String((b as any)[k] || "")} data-testid={`bank-${i}-${k}`}
                    onChange={(e) => setBanks((rows) => rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))} />
                </label>
              ))}
              <div className="flex items-center gap-4 text-xs text-neutral-300">
                <label className="inline-flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={b.showOnInvoice} data-testid={`bank-${i}-show`}
                  onChange={(e) => setBanks((rows) => rows.map((r, j) => (j === i ? { ...r, showOnInvoice: e.target.checked } : r)))} /> Show on invoice</label>
                <label className="inline-flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={b.isActive}
                  onChange={(e) => setBanks((rows) => rows.map((r, j) => (j === i ? { ...r, isActive: e.target.checked } : r)))} /> Active</label>
                {canEdit && confirmRemove !== i && <button type="button" className="ml-auto text-red-300" aria-label="Remove account" data-testid={`bank-${i}-remove`} onClick={() => setConfirmRemove(i)}><Trash2 className="h-4 w-4" /></button>}
              </div>
              {canEdit && confirmRemove === i && (
                <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-100" data-testid={`bank-${i}-confirm`}>
                  <span>Remove {b.bankName || "this account"}{b.accountNumber ? ` (${b.accountNumber})` : ""}? New invoices will not show it. Invoices already issued keep their copy. Nothing changes until you save.</span>
                  <button type="button" className="ml-auto rounded-md bg-red-500 px-3 py-1 font-bold text-black" data-testid={`bank-${i}-remove-confirm`}
                    onClick={() => { setBanks((rows) => rows.filter((_, j) => j !== i)); setConfirmRemove(null); }}>Remove</button>
                  <button type="button" className="rounded-md border border-neutral-600 px-3 py-1" data-testid={`bank-${i}-remove-cancel`} onClick={() => setConfirmRemove(null)}>Keep</button>
                </div>
              )}
            </div>
          ))}
          {canEdit && banksDirty && (
            <p className="text-xs text-amber-300" data-testid="banks-unsaved" role="status">
              Unsaved changes{banks.length === 0 ? ": with no account left, new invoices will print no bank details" : ""}. Click “Save bank accounts” to apply them.
            </p>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-3">
              <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200" data-testid="add-bank"
                onClick={() => setBanks((rows) => [...rows, emptyBank(rows.length + 1)])}><Plus className="h-4 w-4" /> Add account</button>
              <button type="button" className={btnCls} disabled={saving} data-testid="save-banks"
                onClick={() => save("bank-accounts", { accounts: banks.map((b, i) => ({ ...b, sortOrder: i + 1 })) }, "Bank accounts saved.")}><Save className="h-4 w-4" /> Save bank accounts</button>
              {banksDirty && <button type="button" className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200" data-testid="discard-banks"
                onClick={() => { setBanks(data.bankAccounts); setConfirmRemove(null); }}>Discard changes</button>}
            </div>
          )}
        </section>
      )}

      {tab === "terms" && (
        <section className="space-y-3">
          <label className="block text-xs text-neutral-400">Quotation terms: one clause per line
            <textarea className={`${inputCls} min-h-[220px]`} disabled={!canEdit} value={termsText} data-testid="terms-text" onChange={(e) => setTermsText(e.target.value)} />
          </label>
          {canEdit && <button type="button" className={btnCls} disabled={saving} data-testid="save-terms"
            onClick={() => save("terms", { terms: termsText.split("\n").map((t) => t.trim()).filter(Boolean) }, "Terms saved.")}><Save className="h-4 w-4" /> Save terms</button>}
        </section>
      )}

      {tab === "prices" && (
        <section className="grid gap-3">
          <p className="text-xs text-neutral-500">Equipment prices are the prices in your own product list and on each quotation. Here you set the currency wording, the tax note and how long a quotation stays valid.</p>
          <label className="block text-xs text-neutral-400">Currency
            <input className={inputCls} disabled={!canEdit} value={prices.currencySettings} data-testid="price-currency" onChange={(e) => setPrices((p) => ({ ...p, currencySettings: e.target.value }))} /></label>
          <label className="block text-xs text-neutral-400">Tax note
            <input className={inputCls} disabled={!canEdit} value={prices.taxSettings} data-testid="price-tax" onChange={(e) => setPrices((p) => ({ ...p, taxSettings: e.target.value }))} /></label>
          <label className="block text-xs text-neutral-400">Quotation validity (days)
            <input className={inputCls} type="number" min={1} max={365} disabled={!canEdit} value={prices.quoteValidityDays} data-testid="price-validity" onChange={(e) => setPrices((p) => ({ ...p, quoteValidityDays: e.target.value }))} /></label>
          {canEdit && <div><button type="button" className={btnCls} disabled={saving} data-testid="save-prices"
            onClick={() => save("prices", { currencySettings: prices.currencySettings, taxSettings: prices.taxSettings, ...(prices.quoteValidityDays ? { quoteValidityDays: Number(prices.quoteValidityDays) } : {}) }, "Price settings saved.")}><Save className="h-4 w-4" /> Save price settings</button></div>}
        </section>
      )}

      {tab === "history" && canEdit && (
        <section className="space-y-2" data-testid="company-settings-history">
          {history === null && <Loader2 className="animate-spin h-5 w-5 text-amber-400" />}
          {history !== null && !historyAvailable && <p className="text-sm text-neutral-400">The change history is not available yet on this system.</p>}
          {history !== null && historyAvailable && history.length === 0 && <p className="text-sm text-neutral-400">No changes recorded yet.</p>}
          {history !== null && history.length > 0 && (
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-400"><tr><th className="py-1 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">Section</th><th>What</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <React.Fragment key={h.id}>
                  <tr className="border-t border-neutral-800 align-top" data-testid="history-row">
                    <td className="py-1 pr-3 whitespace-nowrap text-neutral-300">{new Date(h.at).toLocaleString()}</td>
                    <td className="pr-3 text-neutral-200">{h.by}{h.role ? <span className="text-neutral-500"> ({h.role})</span> : null}</td>
                    <td className="pr-3 text-neutral-300">{h.section.replace("_", " ")}</td>
                    <td className="text-neutral-200">
                      {h.summary}
                      <button type="button" className="ml-2 text-amber-400 underline" data-testid="history-detail-toggle" aria-expanded={openHistory === h.id}
                        onClick={() => setOpenHistory(openHistory === h.id ? null : h.id)}>{openHistory === h.id ? "Hide values" : "Show values"}</button>
                    </td>
                  </tr>
                  {openHistory === h.id && <tr><td colSpan={4} className="pb-3 pl-2"><HistoryDetail entry={h} /></td></tr>}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
