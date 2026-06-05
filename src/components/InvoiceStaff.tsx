import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Lead, Product, User } from "../types";
import {
  createAdminInvoice,
  fetchAdminInvoices,
  fetchCustomerAccounts,
  invoicePdfUrl,
  recordAdminInvoicePayment,
  updateAdminInvoice,
} from "../services/api";
import { canCreateInvoice, computeInvoiceTotals, type InvoiceLineItem } from "../lib/invoices";
import { decodeInvoiceMeta, stripInvoiceMeta, type InvoiceProjectInfo } from "../lib/invoicePdfMeta";
import WhatsAppActionButton from "./WhatsAppActionButton";
import AppLogo from "./AppLogo";

interface InvoiceStaffProps {
  staffUser: User;
  products?: Product[];
  leads?: Lead[];
}

const PAYMENT_TERMS = ["Cash on delivery", "Net 7 days", "Net 15 days", "Net 30 days", "Advance"];
const PAYMENT_MODES = ["Cash", "Bank transfer", "Cheque", "Online", "Sunchaser Energy"];

const fieldClass =
  "w-full mt-0.5 bg-white border border-slate-200 rounded-md px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400";
const labelClass = "text-[10px] font-semibold text-slate-500 uppercase tracking-wide";

const emptyLine = (): InvoiceLineItem => ({
  itemName: "",
  description: "",
  qty: 1,
  unit: "NONE",
  rate: 0,
  taxPercent: 0,
  discountAmount: 0,
  lineTotal: 0,
  notes: "",
});

function nowTimeStr() {
  return new Date().toLocaleTimeString("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export default function InvoiceStaff({ staffUser, products = [], leads = [] }: InvoiceStaffProps) {
  const allowed = canCreateInvoice(staffUser.username, staffUser.role);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showList, setShowList] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ amount: "", method: "Cash", notes: "" });

  const [draft, setDraft] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    cnicNtn: "",
    customerId: "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    invoiceTime: nowTimeStr(),
    dueDate: "",
    poNumber: "",
    poDate: "",
    paymentTerms: "Cash on delivery",
    paymentMode: "Cash",
    leadId: "",
    quotationId: "",
    discountAmount: "0",
    paidAmount: "0",
    previousBalance: "0",
    notes: "",
    terms: "System booked in COD basis.",
    items: [emptyLine()] as InvoiceLineItem[],
    projectNumber: "",
    systemSize: "",
    systemType: "",
    panelBrand: "",
    inverterBrand: "",
    batteryBrand: "",
    structureType: "",
    netMeteringStatus: "",
    clientPhotoUrl: "",
  });

  const load = async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [invRes, accRes] = await Promise.all([
        fetchAdminInvoices(staffUser),
        fetchCustomerAccounts(staffUser),
      ]);
      setInvoices(invRes.invoices || []);
      setAccounts(accRes.accounts || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, allowed]);

  const totals = useMemo(
    () =>
      computeInvoiceTotals(
        draft.items.map((it) => ({
          ...it,
          description: it.itemName || it.description,
        })),
        Number(draft.discountAmount || 0)
      ),
    [draft.items, draft.discountAmount]
  );

  const balancePreview = Math.max(0, totals.grandTotal - Number(draft.paidAmount || 0));
  const pctPaid =
    totals.grandTotal > 0
      ? Math.min(100, Math.round((Number(draft.paidAmount || 0) / totals.grandTotal) * 100))
      : 0;

  const buildInvoiceMeta = () => {
    const project: InvoiceProjectInfo = {
      projectNumber: draft.projectNumber || undefined,
      systemSize: draft.systemSize || undefined,
      systemType: draft.systemType || undefined,
      panelBrand: draft.panelBrand || undefined,
      inverterBrand: draft.inverterBrand || undefined,
      batteryBrand: draft.batteryBrand || undefined,
      structureType: draft.structureType || undefined,
      netMeteringStatus: draft.netMeteringStatus || undefined,
    };
    const hasProject = Object.values(project).some(Boolean);
    return {
      project: hasProject ? project : undefined,
      clientPhotoUrl: draft.clientPhotoUrl?.trim() || undefined,
    };
  };

  const partyBalance = useMemo(() => {
    if (!draft.customerId && !draft.customerName) return null;
    return invoices
      .filter(
        (i) =>
          (draft.customerId && i.customerId === draft.customerId) ||
          (!draft.customerId &&
            String(i.customerName || "").toLowerCase() === draft.customerName.toLowerCase())
      )
      .reduce((s, i) => s + Number(i.balanceDue || 0), 0);
  }, [invoices, draft.customerId, draft.customerName]);

  const selectInvoice = (inv: any) => {
    const meta = decodeInvoiceMeta(inv.notes);
    setSelectedId(inv.id);
    setDraft({
      customerName: inv.customerName || "",
      customerPhone: inv.customerPhone || "",
      customerAddress: inv.customerAddress || "",
      cnicNtn: inv.cnicNtn || "",
      customerId: inv.customerId || "",
      invoiceNumber: inv.invoiceNumber || "",
      invoiceDate: inv.invoiceDate || "",
      invoiceTime: inv.invoiceTime || nowTimeStr(),
      dueDate: inv.dueDate || "",
      poNumber: inv.poNumber || "",
      poDate: inv.poDate || "",
      paymentTerms: inv.paymentTerms || "Cash on delivery",
      paymentMode: inv.paymentMode || "Cash",
      leadId: inv.leadId || "",
      quotationId: inv.quotationId || "",
      discountAmount: String(inv.discountAmount ?? 0),
      paidAmount: String(inv.paidAmount ?? 0),
      previousBalance: String(inv.previousBalance ?? 0),
      notes: stripInvoiceMeta(inv.notes) || "",
      terms: inv.terms || "",
      projectNumber: meta?.project?.projectNumber || inv.projectId || "",
      systemSize: meta?.project?.systemSize || "",
      systemType: meta?.project?.systemType || "",
      panelBrand: meta?.project?.panelBrand || "",
      inverterBrand: meta?.project?.inverterBrand || "",
      batteryBrand: meta?.project?.batteryBrand || "",
      structureType: meta?.project?.structureType || "",
      netMeteringStatus: meta?.project?.netMeteringStatus || "",
      clientPhotoUrl: meta?.clientPhotoUrl || "",
      items: (inv.items?.length ? inv.items : [emptyLine()]).map((it: any) => ({
        id: it.id,
        itemName: it.itemName || it.description,
        description: it.notes || "",
        qty: it.qty,
        unit: it.unit,
        rate: it.rate,
        taxPercent: it.taxPercent,
        discountAmount: it.discountAmount,
        lineTotal: it.lineTotal,
        productId: it.productId,
        notes: it.notes,
      })),
    });
    setShowList(false);
  };

  const newInvoice = () => {
    setSelectedId(null);
    setDraft({
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      cnicNtn: "",
      customerId: "",
      invoiceNumber: "",
      invoiceDate: new Date().toISOString().slice(0, 10),
      invoiceTime: nowTimeStr(),
      dueDate: "",
      poNumber: "",
      poDate: "",
      paymentTerms: "Cash on delivery",
      paymentMode: "Cash",
      leadId: "",
      quotationId: "",
      discountAmount: "0",
      paidAmount: "0",
      previousBalance: "0",
      notes: "",
      terms: "System booked in COD basis.",
      items: [emptyLine()],
      projectNumber: "",
      systemSize: "",
      systemType: "",
      panelBrand: "",
      inverterBrand: "",
      batteryBrand: "",
      structureType: "",
      netMeteringStatus: "",
      clientPhotoUrl: "",
    });
  };

  const updateLine = (idx: number, patch: Partial<InvoiceLineItem>) => {
    setDraft((d) => {
      const items = [...d.items];
      items[idx] = { ...items[idx], ...patch };
      return { ...d, items };
    });
  };

  const addLine = () => setDraft((d) => ({ ...d, items: [...d.items, emptyLine()] }));
  const removeLine = (idx: number) =>
    setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, i) => i !== idx) : d.items }));

  const applyProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateLine(idx, {
      itemName: p.name,
      description: p.description || "",
      unit: p.unit || "NONE",
      rate: Number(p.price || 0),
      productId: p.id,
    });
  };

  const fillFromLead = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const q = lead.quotes?.[lead.quotes.length - 1] || lead.quotes?.[0];
    setDraft((d) => ({
      ...d,
      customerName: lead.name,
      customerPhone: lead.phone || "",
      customerAddress: lead.address || "",
      leadId: lead.id,
      quotationId: q?.id || "",
      projectNumber: lead.id,
      systemSize: q?.systemSizekW ? `${q.systemSizekW} kW` : "",
      panelBrand: q?.panelBrand || q?.panelType || "",
      inverterBrand: q?.inverterBrand || q?.inverterType || "",
      batteryBrand: q?.batteryCapacity || "",
      items: q?.boqRows?.length
        ? q.boqRows
            .filter((r) => r.type === "item")
            .map((r) => ({
              itemName: r.name || r.description || "Item",
              description: r.description || "",
              qty: Number(r.qty || 1),
              unit: r.unit || "NONE",
              rate: Number(r.rate || 0),
              taxPercent: 0,
              discountAmount: 0,
              lineTotal: Number(r.total || r.qty * r.rate),
            }))
        : d.items,
    }));
  };

  const selectCustomer = (customerId: string) => {
    const acc = accounts.find((a) => a.customerId === customerId);
    if (!acc) {
      setDraft((d) => ({ ...d, customerId: "" }));
      return;
    }
    setDraft((d) => ({
      ...d,
      customerId,
      customerName: acc.name || d.customerName,
      customerPhone: acc.phone || d.customerPhone,
      customerAddress: acc.address || d.customerAddress,
    }));
  };

  const save = async () => {
    setMsg(null);
    setSaving(true);
    const body = {
      ...draft,
      invoiceMeta: buildInvoiceMeta(),
      discountAmount: Number(draft.discountAmount),
      paidAmount: Number(draft.paidAmount || 0),
      previousBalance: Number(draft.previousBalance || 0),
      items: totals.items.map((it, idx) => ({
        ...draft.items[idx],
        ...it,
        itemName: draft.items[idx]?.itemName || it.description,
        description: draft.items[idx]?.itemName || it.description,
        notes: draft.items[idx]?.description || "",
      })),
    };
    try {
      if (selectedId) {
        await updateAdminInvoice(staffUser, selectedId, body);
        setMsg("Invoice saved.");
      } else {
        const res = await createAdminInvoice(staffUser, body);
        setSelectedId(res.invoice?.id);
        setMsg("Invoice created.");
      }
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async () => {
    if (!selectedId) return;
    try {
      await recordAdminInvoicePayment(staffUser, selectedId, {
        amount: Number(paymentDraft.amount),
        paymentMethod: paymentDraft.method,
        notes: paymentDraft.notes,
      });
      setPaymentDraft({ amount: "", method: "Cash", notes: "" });
      setMsg("Payment recorded.");
      await load();
      const inv = invoices.find((i) => i.id === selectedId);
      if (inv) selectInvoice(inv);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const openPdf = () => {
    if (!selectedId) return;
    window.open(invoicePdfUrl(selectedId, staffUser), "_blank");
  };

  const selected = invoices.find((i) => i.id === selectedId);

  if (!allowed) {
    return <p className="text-sm text-slate-500 p-6">You do not have permission to manage invoices.</p>;
  }

  return (
    <div className="min-h-[80vh] bg-slate-100 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      {/* Vyapar-style header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-800">Sale</h2>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
            Premium Invoice v3
          </span>
          <button
            type="button"
            onClick={() => setShowList(!showList)}
            className="text-xs text-violet-600 font-semibold flex items-center gap-1"
          >
            Invoices ({invoices.length}) <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <AppLogo className="h-10 w-auto max-w-[140px]" />
          <span className="text-xs font-bold text-slate-700 hidden sm:inline">Sunchaser Energy Systems</span>
        </div>
        <button
          type="button"
          onClick={newInvoice}
          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-violet-600 text-white"
        >
          + New
        </button>
      </div>

      {showList && (
        <div className="bg-slate-50 border-b border-slate-200 max-h-40 overflow-y-auto p-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {loading ? (
            <Loader2 className="animate-spin h-5 w-5 text-violet-500" />
          ) : (
            invoices.map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => selectInvoice(inv)}
                className={`text-left p-2 rounded-lg border text-xs ${
                  selectedId === inv.id ? "border-violet-500 bg-violet-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="font-bold">{inv.invoiceNumber}</div>
                <div className="text-slate-500 truncate">{inv.customerName}</div>
                <div className="text-violet-700 font-semibold">
                  PKR {Number(inv.grandTotal).toLocaleString()} · {inv.paymentStatus}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {msg && (
        <p className="text-xs text-amber-800 bg-amber-50 border-b border-amber-200 px-4 py-2">{msg}</p>
      )}

      <div className="p-4 space-y-4">
        {/* Customer row */}
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-12 md:col-span-4">
            <label className={labelClass}>Customer</label>
            <select className={fieldClass} value={draft.customerId} onChange={(e) => selectCustomer(e.target.value)}>
              <option value="">— Select / manual —</option>
              {accounts.map((a) => (
                <option key={a.customerId} value={a.customerId}>
                  {a.name}
                </option>
              ))}
            </select>
            {partyBalance != null && partyBalance > 0 && (
              <div className="mt-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 inline-block px-2 py-0.5 rounded">
                BAL: {partyBalance.toLocaleString()}
              </div>
            )}
          </div>
          <div className="col-span-12 md:col-span-3">
            <label className={labelClass}>Billing name</label>
            <input
              className={fieldClass}
              value={draft.customerName}
              onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))}
            />
          </div>
          <div className="col-span-12 md:col-span-2">
            <label className={labelClass}>Phone</label>
            <input
              className={fieldClass}
              value={draft.customerPhone}
              onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
            />
          </div>
          <div className="col-span-12 md:col-span-3">
            <label className={labelClass}>Lead / quote</label>
            <select className={fieldClass} value={draft.leadId} onChange={(e) => fillFromLead(e.target.value)}>
              <option value="">—</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-12">
            <label className={labelClass}>Billing address</label>
            <textarea
              className={fieldClass + " min-h-[52px]"}
              value={draft.customerAddress}
              onChange={(e) => setDraft((d) => ({ ...d, customerAddress: e.target.value }))}
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <p className={labelClass}>Project information (PDF page 1)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(
              [
                ["projectNumber", "Project number"],
                ["systemSize", "System size"],
                ["systemType", "System type"],
                ["panelBrand", "Panel brand"],
                ["inverterBrand", "Inverter brand"],
                ["batteryBrand", "Battery brand"],
                ["structureType", "Structure type"],
                ["netMeteringStatus", "Net metering"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className={labelClass}>{label}</label>
                <input
                  className={fieldClass}
                  value={(draft as any)[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div>
            <label className={labelClass}>Client photo URL (optional)</label>
            <input
              className={fieldClass}
              placeholder="https://… or /uploads/…"
              value={draft.clientPhotoUrl}
              onChange={(e) => setDraft((d) => ({ ...d, clientPhotoUrl: e.target.value }))}
            />
          </div>
        </div>

        <div className="bg-gradient-to-r from-slate-800 to-violet-900 rounded-lg p-4 text-white">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300 mb-2">Payment progress (PDF)</p>
          <div className="grid grid-cols-4 gap-2 text-center text-xs mb-2">
            <div>
              <p className="text-slate-400">Total</p>
              <p className="font-bold">{totals.grandTotal.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-slate-400">Received</p>
              <p className="font-bold text-emerald-300">{Number(draft.paidAmount || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-slate-400">Balance</p>
              <p className="font-bold text-amber-300">{balancePreview.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-slate-400">% Paid</p>
              <p className="font-bold">{pctPaid}%</p>
            </div>
          </div>
          <div className="h-2 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pctPaid}%` }} />
          </div>
        </div>

        {/* Invoice meta row — aligned grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className={labelClass}>PO No.</label>
            <input
              className={fieldClass}
              value={draft.poNumber}
              onChange={(e) => setDraft((d) => ({ ...d, poNumber: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>PO Date</label>
            <input
              type="date"
              className={fieldClass}
              value={draft.poDate}
              onChange={(e) => setDraft((d) => ({ ...d, poDate: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>Invoice No.</label>
            <input
              className={fieldClass}
              placeholder="Auto"
              value={draft.invoiceNumber}
              onChange={(e) => setDraft((d) => ({ ...d, invoiceNumber: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>Invoice date</label>
            <input
              type="date"
              className={fieldClass}
              value={draft.invoiceDate}
              onChange={(e) => setDraft((d) => ({ ...d, invoiceDate: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>Time</label>
            <input
              className={fieldClass}
              value={draft.invoiceTime}
              onChange={(e) => setDraft((d) => ({ ...d, invoiceTime: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass}>Due date</label>
            <input
              type="date"
              className={fieldClass}
              value={draft.dueDate}
              onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
            />
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-6">
            <label className={labelClass}>Payment terms</label>
            <select
              className={fieldClass}
              value={draft.paymentTerms}
              onChange={(e) => setDraft((d) => ({ ...d, paymentTerms: e.target.value }))}
            >
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Items table */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-violet-600 text-white">
                <th className="w-8 py-2 px-2 text-left">#</th>
                <th className="py-2 px-2 text-left min-w-[120px]">Item</th>
                <th className="py-2 px-2 text-left min-w-[140px]">Description</th>
                <th className="w-14 py-2 px-1 text-center">Qty</th>
                <th className="w-16 py-2 px-1 text-center">Unit</th>
                <th className="w-24 py-2 px-2 text-right">Price/Unit</th>
                <th className="w-24 py-2 px-2 text-right">Amount</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {draft.items.map((line, idx) => {
                const lineTotal = computeInvoiceTotals([line]).items[0]?.lineTotal ?? 0;
                return (
                  <tr key={idx} className="border-t border-slate-100 align-top">
                    <td className="py-2 px-2 text-slate-500">{idx + 1}</td>
                    <td className="py-1 px-1">
                      <input
                        className={fieldClass}
                        placeholder="Item name"
                        value={line.itemName || ""}
                        onChange={(e) => updateLine(idx, { itemName: e.target.value })}
                      />
                      {products.length > 0 && (
                        <select
                          className="w-full mt-1 text-[9px] border border-slate-200 rounded px-1 py-0.5"
                          value={line.productId || ""}
                          onChange={(e) => applyProduct(idx, e.target.value)}
                        >
                          <option value="">From catalog…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-1 px-1">
                      <textarea
                        className={fieldClass + " min-h-[40px]"}
                        value={line.description || ""}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="number"
                        className={fieldClass + " text-center"}
                        value={line.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        className={fieldClass + " text-center"}
                        value={line.unit}
                        onChange={(e) => updateLine(idx, { unit: e.target.value })}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        type="number"
                        className={fieldClass + " text-right"}
                        value={line.rate}
                        onChange={(e) => updateLine(idx, { rate: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-slate-800 tabular-nums">
                      {lineTotal.toLocaleString()}
                    </td>
                    <td className="py-2">
                      <button type="button" onClick={() => removeLine(idx)} className="text-red-500 p-1">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold text-xs">
                <td colSpan={3} className="py-2 px-3">
                  <button type="button" onClick={addLine} className="text-violet-600 font-bold flex items-center gap-1">
                    <Plus className="h-3 w-3" /> ADD ROW
                  </button>
                </td>
                <td className="text-center py-2">
                  {draft.items.reduce((s, it) => s + Number(it.qty || 0), 0)}
                </td>
                <td colSpan={2}></td>
                <td className="text-right py-2 px-3 tabular-nums">{totals.grandTotal.toLocaleString()}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer 3 columns */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Terms &amp; conditions</label>
            <textarea
              className={fieldClass + " min-h-[100px]"}
              value={draft.terms}
              onChange={(e) => setDraft((d) => ({ ...d, terms: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <div>
              <label className={labelClass}>Payment mode</label>
              <select
                className={fieldClass}
                value={draft.paymentMode}
                onChange={(e) => setDraft((d) => ({ ...d, paymentMode: e.target.value }))}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                className={fieldClass + " min-h-[60px]"}
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Discount (PKR)</span>
              <input
                type="number"
                className="w-24 border border-slate-200 rounded px-2 py-1 text-right"
                value={draft.discountAmount}
                onChange={(e) => setDraft((d) => ({ ...d, discountAmount: e.target.value }))}
              />
            </div>
            <div className="flex justify-between font-bold text-sm border-t border-slate-100 pt-2">
              <span>Total</span>
              <span className="tabular-nums">PKR {totals.grandTotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <label className="flex items-center gap-2 text-slate-600">
                <input
                  type="checkbox"
                  checked={Number(draft.paidAmount) > 0}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      paidAmount: e.target.checked ? String(totals.grandTotal > 0 ? 5000 : 0) : "0",
                    }))
                  }
                />
                Received
              </label>
              <input
                type="number"
                className="w-28 border border-slate-200 rounded px-2 py-1 text-right font-semibold"
                value={draft.paidAmount}
                onChange={(e) => setDraft((d) => ({ ...d, paidAmount: e.target.value }))}
              />
            </div>
            <div className="flex justify-between font-bold text-violet-700 text-sm">
              <span>Balance</span>
              <span className="tabular-nums">PKR {balancePreview.toLocaleString()}</span>
            </div>
            {selected && (
              <div className="text-[10px] text-slate-500 pt-1 border-t">
                Saved status: {selected.paymentStatus}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200">
          {selectedId && (
            <>
              <WhatsAppActionButton
                staffUser={staffUser}
                phone={draft.customerPhone}
                messageType="invoice_sent"
                vars={{
                  customerName: draft.customerName,
                  invoiceNumber: selected?.invoiceNumber || draft.invoiceNumber,
                  amount: totals.grandTotal,
                }}
                label="Share"
                className="!bg-white !text-slate-800 border border-slate-300"
                customerId={draft.customerId || undefined}
              />
              <button
                type="button"
                onClick={openPdf}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700"
              >
                <Download className="h-4 w-4" /> PDF
              </button>
            </>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>

        {selectedId && (
          <div className="grid sm:grid-cols-4 gap-2 text-xs pt-2 border-t border-dashed border-slate-200">
            <input
              type="number"
              placeholder="Add payment amount"
              className={fieldClass}
              value={paymentDraft.amount}
              onChange={(e) => setPaymentDraft((p) => ({ ...p, amount: e.target.value }))}
            />
            <select
              className={fieldClass}
              value={paymentDraft.method}
              onChange={(e) => setPaymentDraft((p) => ({ ...p, method: e.target.value }))}
            >
              <option>Cash</option>
              <option>Bank transfer</option>
              <option>Cheque</option>
              <option>Online</option>
            </select>
            <input
              placeholder="Payment note"
              className={fieldClass + " sm:col-span-2"}
              value={paymentDraft.notes}
              onChange={(e) => setPaymentDraft((p) => ({ ...p, notes: e.target.value }))}
            />
            <button
              type="button"
              onClick={recordPayment}
              className="sm:col-span-4 py-2 rounded-lg bg-indigo-600 text-white font-bold text-xs"
            >
              Record additional payment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
