import React, { useEffect, useState } from "react";
import { Download, Loader2, Receipt } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalPaymentsMe } from "../services/api";

interface ClientPortalPaymentsProps {
  user: User;
}

export default function ClientPortalPayments({ user }: ClientPortalPaymentsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchCustomerPortalPaymentsMe(user.id, user.username);
        if (!cancelled) setData(res);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Unable to load payments.");
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
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-400 text-center">{error}</p>;
  }

  const totals = data?.totals || {};
  const projects = data?.projects || [];
  const receipts = data?.receipts || [];

  return (
    <section className="space-y-4">
      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1">
        Project payments
      </h3>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] text-slate-500 uppercase">Project value</p>
          <p className="text-sm font-bold text-slate-100">
            PKR {(totals.invoiceAmount || 0).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase">Paid</p>
          <p className="text-sm font-bold text-emerald-400">
            PKR {(totals.amountPaid || 0).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase">Balance</p>
          <p className="text-sm font-bold text-amber-400">
            PKR {(totals.balanceRemaining || 0).toLocaleString()}
          </p>
        </div>
      </div>

      {projects.map((p: any) => (
        <div
          key={p.projectFinanceId}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4"
        >
          <p className="text-sm font-semibold text-slate-100">Payment status: {p.paymentStatus}</p>
          <p className="text-xs text-slate-400 mt-1">
            Value PKR {(p.invoiceAmount || 0).toLocaleString()} · Paid PKR{" "}
            {(p.amountPaid || 0).toLocaleString()} · Remaining PKR{" "}
            {(p.balanceRemaining || 0).toLocaleString()}
          </p>
        </div>
      ))}

      {projects.length === 0 && (
        <p className="text-xs text-slate-500 font-mono px-1">No payment records yet.</p>
      )}

      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1 pt-2">
        Invoices &amp; receipts
      </h3>
      {receipts.length === 0 ? (
        <p className="text-xs text-slate-500 font-mono px-1">No receipt documents uploaded.</p>
      ) : (
        receipts.map((doc: any) => (
          <div
            key={doc.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3"
          >
            <Receipt className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100">{doc.title}</p>
              {doc.fileUrl && (
                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-bold text-amber-400"
                >
                  <Download className="w-3.5 h-3.5" />
                  View / Download
                </a>
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
