import React, { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Save,
  Loader2,
  Download,
  MessageCircle,
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
import WhatsAppActionButton from "./WhatsAppActionButton";

interface InvoiceStaffProps {
  staffUser: User;
  products?: Product[];
  leads?: Lead[];
}

const emptyLine = (): InvoiceLineItem => ({
  description: "",
  qty: 1,
  unit: "pcs",
  rate: 0,
  taxPercent: 0,
  discountAmount: 0,
  lineTotal: 0,
});

export default function InvoiceStaff({ staffUser, products = [], leads = [] }: InvoiceStaffProps) {
  const allowed = canCreateInvoice(staffUser.username, staffUser.role);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({ amount: "", method: "Cash", notes: "" });

  const [draft, setDraft] = useState({
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    cnicNtn: "",
    customerId: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    leadId: "",
    quotationId: "",
    discountAmount: "0",
    invoiceTaxPercent: "0",
    notes: "",
    terms: "",
    items: [emptyLine()] as InvoiceLineItem[],
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
        draft.items,
        Number(draft.discountAmount || 0),
        Number(draft.invoiceTaxPercent || 0)
      ),
    [draft.items, draft.discountAmount, draft.invoiceTaxPercent]
  );

  const selectInvoice = (inv: any) => {
    setSelectedId(inv.id);
    setDraft({
      customerName: inv.customerName || "",
      customerPhone: inv.customerPhone || "",
      customerAddress: inv.customerAddress || "",
      cnicNtn: inv.cnicNtn || "",
      customerId: inv.customerId || "",
      invoiceDate: inv.invoiceDate || "",
      dueDate: inv.dueDate || "",
      leadId: inv.leadId || "",
      quotationId: inv.quotationId || "",
      discountAmount: String(inv.discountAmount ?? 0),
      invoiceTaxPercent: "0",
      notes: inv.notes || "",
      terms: inv.terms || "",
      items: (inv.items?.length ? inv.items : [emptyLine()]).map((it: any) => ({
        id: it.id,
        description: it.description,
        qty: it.qty,
        unit: it.unit,
        rate: it.rate,
        taxPercent: it.taxPercent,
        discountAmount: it.discountAmount,
        lineTotal: it.lineTotal,
        productId: it.productId,
      })),
    });
  };

  const newInvoice = () => {
    setSelectedId(null);
    setDraft({
      customerName: "",
      customerPhone: "",
      customerAddress: "",
      cnicNtn: "",
      customerId: "",
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: "",
      leadId: "",
      quotationId: "",
      discountAmount: "0",
      invoiceTaxPercent: "0",
      notes: "",
      terms: "",
      items: [emptyLine()],
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
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));

  const applyProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    updateLine(idx, {
      description: p.name,
      unit: p.unit || "pcs",
      rate: Number(p.price || 0),
      productId: p.id,
    });
  };

  const fillFromLead = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const q = lead.quotes?.[0];
    setDraft((d) => ({
      ...d,
      customerName: lead.name,
      customerPhone: lead.phone || "",
      customerAddress: lead.address || "",
      leadId: lead.id,
      quotationId: q?.id || "",
      items: q?.boqRows?.length
        ? q.boqRows
            .filter((r) => r.type === "item")
            .map((r) => ({
              description: r.name || r.description || "Item",
              qty: Number(r.qty || 1),
              unit: r.unit || "pcs",
              rate: Number(r.rate || 0),
              taxPercent: 0,
              discountAmount: 0,
              lineTotal: Number(r.total || r.qty * r.rate),
            }))
        : d.items,
    }));
  };

  const save = async () => {
    setMsg(null);
    const body = {
      ...draft,
      discountAmount: Number(draft.discountAmount),
      invoiceTaxPercent: Number(draft.invoiceTaxPercent),
      items: totals.items,
    };
    try {
      if (selectedId) {
        await updateAdminInvoice(staffUser, selectedId, body);
        setMsg("Invoice updated.");
      } else {
        const res = await createAdminInvoice(staffUser, body);
        setSelectedId(res.invoice?.id);
        setMsg("Invoice created.");
      }
      await load();
    } catch (e: any) {
      setMsg(e.message);
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
    return (
      <p className="text-sm text-neutral-400 font-mono p-6">
        You do not have permission to manage invoices.
      </p>
    );
  }

  return (
    <div className="space-y-6 font-mono text-neutral-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-amber-400" />
            Finance → Invoices
          </h2>
          <p className="text-xs text-neutral-500">Vyapar-style billing · PKR · PDF export · WhatsApp</p>
        </div>
        <button
          type="button"
          onClick={newInvoice}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold"
        >
          <Plus className="h-4 w-4" /> New invoice
        </button>
      </div>

      {msg && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">{msg}</p>}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 max-h-[70vh] overflow-y-auto">
          <h3 className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Invoices</h3>
          {loading ? (
            <Loader2 className="animate-spin h-5 w-5 text-amber-400" />
          ) : (
            invoices.map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => selectInvoice(inv)}
                className={`w-full text-left p-3 rounded-xl mb-2 border ${
                  selectedId === inv.id
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-neutral-800 hover:bg-neutral-800"
                }`}
              >
                <div className="font-bold text-sm">{inv.invoiceNumber}</div>
                <div className="text-[10px] text-neutral-500">{inv.customerName}</div>
                <div className="text-[10px] mt-1">
                  PKR {Number(inv.grandTotal).toLocaleString()} · {inv.paymentStatus}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="lg:col-span-2 space-y-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <label className="block">
              Customer
              <select
                className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
                value={draft.customerId}
                onChange={(e) => {
                  const acc = accounts.find((a) => a.customerId === e.target.value);
                  setDraft((d) => ({
                    ...d,
                    customerId: e.target.value,
                    customerName: acc?.name || d.customerName,
                    customerPhone: acc?.phone || d.customerPhone,
                  }));
                }}
              >
                <option value="">— manual —</option>
                {accounts.map((a) => (
                  <option key={a.customerId} value={a.customerId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Lead / quote
              <select
                className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
                value={draft.leadId}
                onChange={(e) => fillFromLead(e.target.value)}
              >
                <option value="">—</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
              placeholder="Customer name"
              value={draft.customerName}
              onChange={(e) => setDraft((d) => ({ ...d, customerName: e.target.value }))}
            />
            <input
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
              placeholder="Phone"
              value={draft.customerPhone}
              onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
            />
            <input
              className="sm:col-span-2 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
              placeholder="Address"
              value={draft.customerAddress}
              onChange={(e) => setDraft((d) => ({ ...d, customerAddress: e.target.value }))}
            />
            <input
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
              placeholder="CNIC / NTN"
              value={draft.cnicNtn}
              onChange={(e) => setDraft((d) => ({ ...d, cnicNtn: e.target.value }))}
            />
            <input
              type="date"
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
              value={draft.invoiceDate}
              onChange={(e) => setDraft((d) => ({ ...d, invoiceDate: e.target.value }))}
            />
            <input
              type="date"
              className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
              title="Due date"
              value={draft.dueDate}
              onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-neutral-500 border-b border-neutral-800">
                  <th className="text-left py-2">Item</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Rate</th>
                  <th>Tax%</th>
                  <th>Disc</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.items.map((line, idx) => (
                  <tr key={idx} className="border-b border-neutral-800/50">
                    <td className="py-2 pr-2">
                      <input
                        className="w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 mb-1"
                        value={line.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                      />
                      {products.length > 0 && (
                        <select
                          className="w-full bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-[9px]"
                          value={line.productId || ""}
                          onChange={(e) => applyProduct(idx, e.target.value)}
                        >
                          <option value="">Product…</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="w-14 bg-neutral-950 border border-neutral-700 rounded px-1 py-1"
                        value={line.qty}
                        onChange={(e) => updateLine(idx, { qty: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        className="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-1"
                        value={line.unit}
                        onChange={(e) => updateLine(idx, { unit: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="w-20 bg-neutral-950 border border-neutral-700 rounded px-1 py-1"
                        value={line.rate}
                        onChange={(e) => updateLine(idx, { rate: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-1"
                        value={line.taxPercent}
                        onChange={(e) => updateLine(idx, { taxPercent: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="w-16 bg-neutral-950 border border-neutral-700 rounded px-1 py-1"
                        value={line.discountAmount}
                        onChange={(e) => updateLine(idx, { discountAmount: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => removeLine(idx)} className="text-red-400 p-1">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={addLine} className="text-[10px] text-amber-400 mt-2 font-bold">
              + Add row
            </button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <label>
              Invoice discount (PKR)
              <input
                type="number"
                className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
                value={draft.discountAmount}
                onChange={(e) => setDraft((d) => ({ ...d, discountAmount: e.target.value }))}
              />
            </label>
            <div className="sm:col-span-2 text-right space-y-1 pt-4">
              <div>Subtotal: PKR {totals.subtotal.toLocaleString()}</div>
              <div>Tax: PKR {totals.taxAmount.toLocaleString()}</div>
              <div className="text-amber-400 font-bold text-sm">
                Grand total: PKR {totals.grandTotal.toLocaleString()}
              </div>
              {selected && (
                <>
                  <div>Paid: PKR {Number(selected.paidAmount).toLocaleString()}</div>
                  <div>Balance: PKR {Number(selected.balanceDue).toLocaleString()}</div>
                  <div>Status: {selected.paymentStatus}</div>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold"
            >
              <Save className="h-4 w-4" /> Save
            </button>
            {selectedId && (
              <>
                <button
                  type="button"
                  onClick={openPdf}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-700 text-xs font-bold"
                >
                  <Download className="h-4 w-4" /> PDF
                </button>
                <WhatsAppActionButton
                  staffUser={staffUser}
                  phone={draft.customerPhone}
                  messageType="invoice_sent"
                  vars={{
                    customerName: draft.customerName,
                    invoiceNumber: selected?.invoiceNumber,
                    amount: selected?.grandTotal,
                  }}
                  label="Send invoice"
                  customerId={draft.customerId || undefined}
                />
                <WhatsAppActionButton
                  staffUser={staffUser}
                  phone={draft.customerPhone}
                  messageType="invoice_payment_reminder"
                  vars={{
                    customerName: draft.customerName,
                    invoiceNumber: selected?.invoiceNumber,
                    balance: selected?.balanceDue,
                  }}
                  label="Payment reminder"
                  className="!bg-amber-700"
                  customerId={draft.customerId || undefined}
                />
              </>
            )}
          </div>

          {selectedId && (
            <div className="border-t border-neutral-800 pt-4 grid sm:grid-cols-4 gap-2 text-xs">
              <input
                type="number"
                placeholder="Payment amount"
                className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
                value={paymentDraft.amount}
                onChange={(e) => setPaymentDraft((p) => ({ ...p, amount: e.target.value }))}
              />
              <select
                className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
                value={paymentDraft.method}
                onChange={(e) => setPaymentDraft((p) => ({ ...p, method: e.target.value }))}
              >
                <option>Cash</option>
                <option>Bank transfer</option>
                <option>Cheque</option>
                <option>Online</option>
              </select>
              <input
                placeholder="Note"
                className="sm:col-span-2 bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-2"
                value={paymentDraft.notes}
                onChange={(e) => setPaymentDraft((p) => ({ ...p, notes: e.target.value }))}
              />
              <button
                type="button"
                onClick={recordPayment}
                className="sm:col-span-4 py-2 rounded-xl bg-indigo-600 text-white font-bold"
              >
                Record payment
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
