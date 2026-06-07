import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Receipt,
  Search,
  User,
  X,
} from "lucide-react";
import { User as StaffUser } from "../types";
import {
  fetchAdminParties,
  fetchAdminPartyLedger,
  invoicePdfUrl,
  recordAdminInvoicePayment,
} from "../services/api";
import { canCreateInvoice, PAYMENT_METHODS, type PartyLedgerSummary } from "../lib/invoices";
import WhatsAppActionButton from "./WhatsAppActionButton";
import AppLogo from "./AppLogo";
import AppModal from "./ui/AppModal";

type PartyFilter = "all" | "outstanding" | "paid" | "overdue";

const statusClass: Record<string, string> = {
  Paid: "bg-emerald-500/25 text-emerald-300 border-emerald-500/40",
  Partial: "bg-amber-500/25 text-amber-200 border-amber-500/40",
  Unpaid: "bg-red-500/20 text-red-300 border-red-500/40",
  Overdue: "bg-red-900/40 text-red-200 border-red-700/50",
};

function partyBalanceTone(p: PartyLedgerSummary) {
  const bal = Number(p.balanceDue || 0);
  if (bal <= 0) return "emerald";
  if (p.hasOverdue) return "red-dark";
  if (Number(p.receivedAmount || 0) > 0) return "amber";
  return "red";
}

function toneBorder(tone: string, selected: boolean) {
  if (selected) return "border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30";
  if (tone === "emerald") return "border-emerald-500/30 hover:bg-emerald-500/5";
  if (tone === "amber") return "border-amber-500/30 hover:bg-amber-500/5";
  if (tone === "red-dark") return "border-red-700/50 hover:bg-red-950/30";
  return "border-red-500/25 hover:bg-red-500/5";
}

function toneBalanceText(tone: string) {
  if (tone === "emerald") return "text-emerald-400";
  if (tone === "amber") return "text-amber-400";
  if (tone === "red-dark") return "text-red-400";
  return "text-red-400";
}

function matchesFilter(p: PartyLedgerSummary, filter: PartyFilter) {
  const bal = Number(p.balanceDue || 0);
  if (filter === "paid") return bal <= 0;
  if (filter === "outstanding") return bal > 0;
  if (filter === "overdue") return !!p.hasOverdue && bal > 0;
  return true;
}

type PaymentModalState = {
  invoiceId: string;
  invoiceNumber: string;
  balanceDue: number;
};

export default function PartyLedgerStaff({
  staffUser,
  onEditInvoice,
  initialPartyKey,
  onInitialPartyConsumed,
}: {
  staffUser: StaffUser;
  onEditInvoice?: (invoiceId: string) => void;
  initialPartyKey?: string | null;
  onInitialPartyConsumed?: () => void;
}) {
  const allowed = canCreateInvoice(staffUser.username, staffUser.role);
  const [parties, setParties] = useState<PartyLedgerSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    party: PartyLedgerSummary;
    transactions: any[];
    payments: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PartyFilter>("all");
  const [mobileShowList, setMobileShowList] = useState(true);
  const [paymentModal, setPaymentModal] = useState<PaymentModalState | null>(null);
  const [payForm, setPayForm] = useState({
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentMethod: "Cash",
    referenceNumber: "",
    notes: "",
    receiptFile: null as File | null,
  });
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [partiesError, setPartiesError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadParties = useCallback(async () => {
    setLoading(true);
    setPartiesError(null);
    try {
      const res = await fetchAdminParties(staffUser);
      setParties(res.parties || []);
    } catch (e: any) {
      setPartiesError(e.message || "Failed to load parties.");
      setParties([]);
    } finally {
      setLoading(false);
    }
  }, [staffUser]);

  const loadDetail = useCallback(
    async (key: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await fetchAdminPartyLedger(staffUser, key);
        setDetail({
          party: data.party,
          transactions: data.transactions || [],
          payments: data.payments || [],
        });
      } catch (e: any) {
        setDetailError(e.message || "Failed to load ledger.");
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [staffUser]
  );

  const refreshAll = useCallback(async () => {
    await loadParties();
    if (selectedKey) await loadDetail(selectedKey);
  }, [loadParties, loadDetail, selectedKey]);

  useEffect(() => {
    if (allowed) loadParties();
  }, [allowed, loadParties]);

  const selectParty = async (key: string) => {
    setSelectedKey(key);
    setMobileShowList(false);
    await loadDetail(key);
  };

  useEffect(() => {
    if (!initialPartyKey || loading) return;
    void selectParty(initialPartyKey);
    onInitialPartyConsumed?.();
  }, [initialPartyKey, loading, onInitialPartyConsumed]);

  const filteredParties = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parties
      .filter((p) => matchesFilter(p, filter))
      .filter((p) => {
        if (!q) return true;
        const name = String(p.name || "").toLowerCase();
        const phone = String(p.phone || "").replace(/\s/g, "");
        return name.includes(q) || phone.includes(q.replace(/\s/g, ""));
      });
  }, [parties, search, filter]);

  const openPaymentModal = (tx: { invoiceId: string; invoiceNumber: string; balanceDue: number }) => {
    setPaymentModal({
      invoiceId: tx.invoiceId,
      invoiceNumber: tx.invoiceNumber,
      balanceDue: tx.balanceDue,
    });
    setPayForm({
      amount: String(tx.balanceDue > 0 ? tx.balanceDue : ""),
      paymentDate: new Date().toISOString().slice(0, 10),
      paymentMethod: "Cash",
      referenceNumber: "",
      notes: "",
      receiptFile: null,
    });
    setPayError(null);
  };

  const submitPayment = async () => {
    if (!paymentModal) return;
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) {
      setPayError("Enter a valid amount.");
      return;
    }
    setPaySaving(true);
    setPayError(null);
    try {
      const body: Record<string, unknown> = {
        amount,
        paymentMethod: payForm.paymentMethod,
        paymentDate: payForm.paymentDate,
        notes: payForm.notes || undefined,
        referenceNumber: payForm.referenceNumber || undefined,
      };
      if (payForm.receiptFile) {
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const r = String(reader.result || "");
            resolve(r.includes(",") ? r.split(",")[1] : r);
          };
          reader.onerror = reject;
          reader.readAsDataURL(payForm.receiptFile!);
        });
        body.base64Receipt = b64;
        body.fileName = payForm.receiptFile.name;
        body.mimeType = payForm.receiptFile.type;
      }
      await recordAdminInvoicePayment(staffUser, paymentModal.invoiceId, body);
      setPaymentModal(null);
      await refreshAll();
    } catch (e: any) {
      setPayError(e.message || "Payment failed.");
    } finally {
      setPaySaving(false);
    }
  };

  if (!allowed) {
    return <p className="text-sm text-neutral-400 p-6">No permission to view party ledgers.</p>;
  }

  const party = detail?.party;

  return (
    <div className="space-y-4 min-h-[80vh]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AppLogo className="h-9 w-auto" />
          <div>
            <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-violet-400" />
              Accounts Receivable
            </h2>
            <p className="text-xs text-neutral-500">Vyapar-style party ledger · clients &amp; collections</p>
          </div>
        </div>
        {selectedKey && (
          <button
            type="button"
            className="lg:hidden text-xs font-bold text-violet-400 flex items-center gap-1"
            onClick={() => setMobileShowList(true)}
          >
            <ChevronLeft className="h-4 w-4" /> All parties
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* LEFT — Party list */}
        <div
          className={`lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden flex flex-col max-h-[78vh] ${
            mobileShowList || !selectedKey ? "flex" : "hidden lg:flex"
          }`}
        >
          <div className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800 p-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
              <input
                type="search"
                placeholder="Search name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(["all", "outstanding", "paid", "overdue"] as PartyFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide border transition ${
                    filter === f
                      ? "bg-violet-600/30 border-violet-500 text-violet-200"
                      : "border-neutral-700 text-neutral-500 hover:border-neutral-600"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-neutral-600 uppercase tracking-widest">
              {filteredParties.length} client{filteredParties.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-2">
            {loading ? (
              <Loader2 className="animate-spin h-6 w-6 text-violet-400 mx-auto my-12" />
            ) : partiesError ? (
              <p className="text-xs text-red-400 text-center py-12 px-3">{partiesError}</p>
            ) : parties.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-12">No parties yet</p>
            ) : filteredParties.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-12">No parties match</p>
            ) : (
              filteredParties.map((p) => {
                const tone = partyBalanceTone(p);
                const selected = selectedKey === p.partyKey;
                return (
                  <button
                    key={p.partyKey}
                    type="button"
                    onClick={() => selectParty(p.partyKey)}
                    className={`w-full text-left p-3 rounded-xl mb-2 border transition ${toneBorder(tone, selected)}`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="font-semibold text-sm text-neutral-100 leading-tight">{p.name}</div>
                      <span className={`text-[10px] font-black shrink-0 ${toneBalanceText(tone)}`}>
                        {Number(p.balanceDue) <= 0 ? "PAID" : p.hasOverdue ? "OVERDUE" : "DUE"}
                      </span>
                    </div>
                    {p.phone && (
                      <div className="text-[10px] text-neutral-500 flex items-center gap-1 mt-1">
                        <Phone className="h-3 w-3" /> {p.phone}
                      </div>
                    )}
                    <div className="flex justify-between mt-2 text-[10px]">
                      <span className={`font-bold ${toneBalanceText(tone)}`}>
                        PKR {Number(p.balanceDue).toLocaleString()}
                      </span>
                      <span className="text-neutral-600">{p.invoiceCount} inv.</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT — Ledger detail */}
        <div
          className={`lg:col-span-3 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 md:p-5 min-h-[320px] ${
            !mobileShowList || selectedKey ? "block" : "hidden lg:block"
          }`}
        >
          {!selectedKey ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-500">
              <User className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Select a client to view ledger</p>
            </div>
          ) : detailLoading ? (
            <Loader2 className="animate-spin h-8 w-8 text-violet-400 mx-auto my-20" />
          ) : detailError ? (
            <div className="flex flex-col items-center justify-center py-20 text-red-400">
              <p className="text-sm">{detailError}</p>
            </div>
          ) : party && detail ? (
            <div className="space-y-5">
              {/* Customer header */}
              <div className="border-b border-neutral-800 pb-4">
                <h3 className="text-lg font-bold text-neutral-50">{party.name}</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-neutral-400">
                  {party.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {party.phone}
                    </span>
                  )}
                  {party.billingAddress && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {party.billingAddress}
                    </span>
                  )}
                  {party.customerId && (
                    <span className="font-mono text-[10px] text-neutral-500">ID: {party.customerId}</span>
                  )}
                </div>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: "Total Sales", value: party.totalSales, color: "text-neutral-100" },
                  { label: "Total Received", value: party.receivedAmount, color: "text-emerald-400" },
                  { label: "Balance Due", value: party.balanceDue, color: "text-amber-400" },
                  { label: "Invoices", value: party.invoiceCount, color: "text-violet-300", fmt: false },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="bg-gradient-to-br from-neutral-950 to-neutral-900 border border-neutral-700/80 rounded-xl p-4 shadow-lg"
                  >
                    <div className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">{c.label}</div>
                    <div className={`text-lg font-black ${c.color}`}>
                      {c.fmt === false ? c.value : `PKR ${Number(c.value).toLocaleString()}`}
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {party.phone && (
                  <>
                    <WhatsAppActionButton
                      staffUser={staffUser}
                      phone={party.phone}
                      messageType="invoice_payment_reminder"
                      vars={{ customerName: party.name, balance: party.balanceDue }}
                      label="Payment Reminder"
                      customerId={party.customerId || undefined}
                    />
                    {detail.transactions[0] && (
                      <WhatsAppActionButton
                        staffUser={staffUser}
                        phone={party.phone}
                        messageType="invoice_sent"
                        vars={{
                          customerName: party.name,
                          invoiceNumber: detail.transactions[0].invoiceNumber,
                          amount: detail.transactions[0].grandTotal,
                        }}
                        label="Send Invoice"
                        customerId={party.customerId || undefined}
                      />
                    )}
                  </>
                )}
                {detail.transactions.some((t) => Number(t.balanceDue) > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      const tx = detail.transactions.find((t) => Number(t.balanceDue) > 0);
                      if (tx) openPaymentModal(tx);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-500"
                  >
                    <Plus className="h-3.5 w-3.5" /> Record Payment
                  </button>
                )}
              </div>

              {/* Invoice history */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5" /> Invoice History
                </h4>
                <div className="overflow-x-auto rounded-xl border border-neutral-800">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-neutral-950 text-neutral-500 border-b border-neutral-800">
                        <th className="text-left py-2.5 px-2">Invoice #</th>
                        <th className="text-center px-1">Date</th>
                        <th className="text-right px-1">Total</th>
                        <th className="text-right px-1">Paid</th>
                        <th className="text-right px-1">Balance</th>
                        <th className="text-center px-1">Status</th>
                        <th className="text-right px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.transactions.map((tx) => (
                        <tr key={tx.invoiceId} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                          <td className="py-2 px-2 font-semibold text-neutral-100">{tx.invoiceNumber}</td>
                          <td className="text-center text-neutral-400">{tx.invoiceDate}</td>
                          <td className="text-right px-1">PKR {Number(tx.grandTotal).toLocaleString()}</td>
                          <td className="text-right px-1 text-emerald-400">
                            PKR {Number(tx.paidAmount).toLocaleString()}
                          </td>
                          <td className="text-right px-1 text-amber-400">
                            PKR {Number(tx.balanceDue).toLocaleString()}
                          </td>
                          <td className="text-center px-1">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[8px] font-bold border ${
                                statusClass[tx.paymentStatus] || statusClass.Unpaid
                              }`}
                            >
                              {tx.paymentStatus}
                            </span>
                            {tx.invoiceStatus === "duplicate" && (
                              <span className="ml-1 px-1.5 py-0.5 rounded text-[7px] font-bold bg-neutral-700 text-neutral-300 border border-neutral-600">
                                DUPLICATE
                              </span>
                            )}
                          </td>
                          <td className="text-right px-2 whitespace-nowrap">
                            <a
                              href={invoicePdfUrl(tx.invoiceId, staffUser)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded bg-slate-700 text-[8px] font-bold mr-0.5"
                              title="View PDF"
                            >
                              <Download className="h-3 w-3" />
                            </a>
                            {onEditInvoice && (
                              <button
                                type="button"
                                onClick={() => onEditInvoice(tx.invoiceId)}
                                className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded bg-violet-900/50 text-violet-300 text-[8px] font-bold mr-0.5"
                                title="Edit invoice"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                            )}
                            {party.phone && Number(tx.balanceDue) > 0 && (
                              <WhatsAppActionButton
                                staffUser={staffUser}
                                phone={party.phone}
                                messageType="invoice_payment_reminder"
                                vars={{
                                  customerName: party.name,
                                  balance: tx.balanceDue,
                                  invoiceNumber: tx.invoiceNumber,
                                }}
                                label="WA"
                                customerId={party.customerId || undefined}
                                className="!px-1.5 !py-1 !text-[8px] !rounded"
                              />
                            )}
                            {Number(tx.balanceDue) > 0 && (
                              <button
                                type="button"
                                onClick={() => openPaymentModal(tx)}
                                className="inline-flex items-center px-1.5 py-1 rounded bg-emerald-900/40 text-emerald-300 text-[8px] font-bold"
                                title="Record payment"
                              >
                                <Receipt className="h-3 w-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payment history */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-2">
                  <Receipt className="h-3.5 w-3.5" /> Payment History
                </h4>
                <div className="overflow-x-auto rounded-xl border border-neutral-800">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-neutral-950 text-neutral-500 border-b border-neutral-800">
                        <th className="text-left py-2.5 px-2">Date</th>
                        <th className="text-left px-1">Method</th>
                        <th className="text-left px-1">Reference</th>
                        <th className="text-left px-1">Invoice</th>
                        <th className="text-right px-1">Amount</th>
                        <th className="text-left px-1">Recorded By</th>
                        <th className="text-center px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-neutral-600">
                            No payments recorded yet
                          </td>
                        </tr>
                      ) : (
                        detail.payments.map((p) => (
                          <tr key={p.id} className="border-b border-neutral-800/50">
                            <td className="py-2 px-2 text-neutral-300">{p.paymentDate}</td>
                            <td className="px-1 text-neutral-400">{p.paymentMethod}</td>
                            <td className="px-1 font-mono text-neutral-500">{p.referenceNumber || "—"}</td>
                            <td className="px-1 text-neutral-500">{p.invoiceNumber}</td>
                            <td className="text-right px-1 font-bold text-emerald-400">
                              PKR {Number(p.amount).toLocaleString()}
                            </td>
                            <td className="px-1 text-neutral-500">{p.recordedBy || "—"}</td>
                            <td className="text-center px-2">
                              {p.receiptUrl ? (
                                <a
                                  href={p.receiptUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex text-violet-400 hover:text-violet-300"
                                  title="Receipt"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Record payment modal */}
      {paymentModal && (
        <AppModal open onClose={() => setPaymentModal(null)} panelClassName="max-w-md">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl w-full shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <h3 className="font-bold text-neutral-100">Record Payment</h3>
              <button type="button" onClick={() => setPaymentModal(null)} className="text-neutral-500 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <p className="text-neutral-500">
                Invoice <strong className="text-neutral-200">{paymentModal.invoiceNumber}</strong> · Balance PKR{" "}
                {Number(paymentModal.balanceDue || 0).toLocaleString()}
              </p>
              <div>
                <label className="text-neutral-500 text-[10px] uppercase font-bold">Amount (PKR)</label>
                <input
                  type="number"
                  value={payForm.amount}
                  onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-500 text-[10px] uppercase font-bold">Date</label>
                <input
                  type="date"
                  value={payForm.paymentDate}
                  onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-500 text-[10px] uppercase font-bold">Method</label>
                <select
                  value={payForm.paymentMethod}
                  onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-neutral-500 text-[10px] uppercase font-bold">Reference Number</label>
                <input
                  type="text"
                  value={payForm.referenceNumber}
                  onChange={(e) => setPayForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="Cheque / transfer ref"
                  className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-500 text-[10px] uppercase font-bold">Notes</label>
                <textarea
                  value={payForm.notes}
                  onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full mt-1 bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
                />
              </div>
              <div>
                <label className="text-neutral-500 text-[10px] uppercase font-bold">Receipt Upload</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) =>
                    setPayForm((f) => ({ ...f, receiptFile: e.target.files?.[0] || null }))
                  }
                  className="w-full mt-1 text-neutral-400 text-[10px]"
                />
              </div>
              {payError && <p className="text-red-400 text-[10px]">{payError}</p>}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={() => setPaymentModal(null)}
                className="flex-1 py-2 rounded-lg border border-neutral-700 text-neutral-400 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={paySaving}
                onClick={submitPayment}
                className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {paySaving ? "Saving…" : "Save Payment"}
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
