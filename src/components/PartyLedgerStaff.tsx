import React, { useEffect, useState } from "react";
import {
  BookOpen,
  Download,
  Loader2,
  MessageCircle,
  Phone,
  Printer,
} from "lucide-react";
import { User } from "../types";
import {
  fetchAdminParties,
  fetchAdminPartyLedger,
  invoicePdfUrl,
} from "../services/api";
import { canCreateInvoice } from "../lib/invoices";
import WhatsAppActionButton from "./WhatsAppActionButton";
import AppLogo from "./AppLogo";

const statusClass: Record<string, string> = {
  Paid: "bg-emerald-500/20 text-emerald-300",
  Partial: "bg-amber-500/20 text-amber-300",
  Unpaid: "bg-slate-500/20 text-slate-300",
  Overdue: "bg-red-500/20 text-red-300",
};

export default function PartyLedgerStaff({ staffUser }: { staffUser: User }) {
  const allowed = canCreateInvoice(staffUser.username, staffUser.role);
  const [parties, setParties] = useState<any[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ party: any; transactions: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadParties = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminParties(staffUser);
      setParties(res.parties || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) loadParties();
  }, [staffUser.id, allowed]);

  const selectParty = async (key: string) => {
    setSelectedKey(key);
    setDetailLoading(true);
    try {
      const data = await fetchAdminPartyLedger(staffUser, key);
      setDetail(data);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!allowed) {
    return <p className="text-sm text-neutral-400 p-6">No permission to view party ledgers.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AppLogo className="h-9 w-auto" />
        <div>
          <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-violet-400" />
            Finance → Parties / Ledgers
          </h2>
          <p className="text-xs text-neutral-500">Client balances, invoices, WhatsApp &amp; PDF</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden max-h-[72vh] flex flex-col">
          <div className="px-3 py-2 border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
            Parties ({parties.length})
          </div>
          <div className="overflow-y-auto flex-1 p-2">
            {loading ? (
              <Loader2 className="animate-spin h-5 w-5 text-violet-400 mx-auto my-8" />
            ) : (
              parties.map((p) => (
                <button
                  key={p.partyKey}
                  type="button"
                  onClick={() => selectParty(p.partyKey)}
                  className={`w-full text-left p-3 rounded-lg mb-1 border transition ${
                    selectedKey === p.partyKey
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-transparent hover:bg-neutral-800"
                  }`}
                >
                  <div className="font-semibold text-sm text-neutral-100">{p.name}</div>
                  {p.phone && (
                    <div className="text-[10px] text-neutral-500 flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" /> {p.phone}
                    </div>
                  )}
                  <div className="text-[10px] mt-1 text-amber-400 font-bold">
                    Bal PKR {Number(p.balanceDue).toLocaleString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-neutral-900 border border-neutral-800 rounded-xl p-4 min-h-[320px]">
          {!selectedKey ? (
            <p className="text-sm text-neutral-500 text-center py-16">Select a party to view ledger</p>
          ) : detailLoading ? (
            <Loader2 className="animate-spin h-6 w-6 text-violet-400 mx-auto my-16" />
          ) : detail ? (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-xs">
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
                  <div className="text-neutral-500 text-[10px]">Total sales</div>
                  <div className="font-bold text-neutral-100">
                    PKR {Number(detail.party.totalSales).toLocaleString()}
                  </div>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
                  <div className="text-neutral-500 text-[10px]">Received</div>
                  <div className="font-bold text-emerald-400">
                    PKR {Number(detail.party.receivedAmount).toLocaleString()}
                  </div>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3">
                  <div className="text-neutral-500 text-[10px]">Balance due</div>
                  <div className="font-bold text-amber-400">
                    PKR {Number(detail.party.balanceDue).toLocaleString()}
                  </div>
                </div>
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 flex flex-wrap gap-2 items-end">
                  {detail.party.phone && (
                    <WhatsAppActionButton
                      staffUser={staffUser}
                      phone={detail.party.phone}
                      messageType="invoice_payment_reminder"
                      vars={{
                        customerName: detail.party.name,
                        balance: detail.party.balanceDue,
                      }}
                      label="WhatsApp"
                      customerId={detail.party.customerId || undefined}
                    />
                  )}
                </div>
              </div>
              {detail.party.billingAddress && (
                <p className="text-[10px] text-neutral-500 mb-3">{detail.party.billingAddress}</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-neutral-500 border-b border-neutral-800">
                      <th className="text-left py-2">Invoice</th>
                      <th>Date</th>
                      <th>Due</th>
                      <th>Total</th>
                      <th>Paid</th>
                      <th>Balance</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.transactions.map((tx) => (
                      <tr key={tx.invoiceId} className="border-b border-neutral-800/60">
                        <td className="py-2 font-semibold">{tx.invoiceNumber}</td>
                        <td className="text-center">{tx.invoiceDate}</td>
                        <td className="text-center">{tx.dueDate || "—"}</td>
                        <td className="text-right">PKR {Number(tx.grandTotal).toLocaleString()}</td>
                        <td className="text-right text-emerald-400">
                          PKR {Number(tx.paidAmount).toLocaleString()}
                        </td>
                        <td className="text-right text-amber-400">
                          PKR {Number(tx.balanceDue).toLocaleString()}
                        </td>
                        <td className="text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                              statusClass[tx.paymentStatus] || statusClass.Unpaid
                            }`}
                          >
                            {tx.paymentStatus}
                          </span>
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <a
                            href={invoicePdfUrl(tx.invoiceId, staffUser)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-700 text-[9px] font-bold"
                          >
                            <Download className="h-3 w-3" /> PDF
                          </a>
                          <a
                            href={invoicePdfUrl(tx.invoiceId, staffUser)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-[9px] font-bold ml-1"
                            onClick={(e) => {
                              e.preventDefault();
                              const w = window.open(invoicePdfUrl(tx.invoiceId, staffUser), "_blank");
                              w?.print();
                            }}
                          >
                            <Printer className="h-3 w-3" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
