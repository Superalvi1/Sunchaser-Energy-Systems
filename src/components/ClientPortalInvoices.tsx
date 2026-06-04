import React, { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { User } from "../types";
import { customerInvoicePdfUrl, fetchCustomerPortalInvoicesMe } from "../services/api";

export default function ClientPortalInvoices({ user }: { user: User }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCustomerPortalInvoicesMe(user.id, user.username);
        if (!cancelled) setInvoices(data.invoices || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, user.username]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400 p-4">{error}</p>;
  }

  if (!invoices.length) {
    return (
      <p className="text-sm text-slate-500 p-6 text-center">
        No invoices yet. Your account manager will share invoices here.
      </p>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
        <FileText className="w-4 h-4 text-amber-400" />
        My Invoices
      </h2>
      {invoices.map((inv) => (
        <div
          key={inv.id}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div>
            <div className="font-bold text-slate-100">{inv.invoiceNumber}</div>
            <div className="text-[10px] text-slate-500">{inv.invoiceDate}</div>
            <div className="text-xs mt-2">
              Total PKR {Number(inv.grandTotal).toLocaleString()} · Paid PKR{" "}
              {Number(inv.paidAmount).toLocaleString()}
            </div>
            <div className="text-xs text-amber-400 font-bold">
              Balance PKR {Number(inv.balanceDue).toLocaleString()} · {inv.paymentStatus}
            </div>
          </div>
          <a
            href={customerInvoicePdfUrl(inv.id, user.id, user.username)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </a>
        </div>
      ))}
    </div>
  );
}
