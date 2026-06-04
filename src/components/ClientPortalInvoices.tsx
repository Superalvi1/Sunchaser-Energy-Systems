import React, { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { User } from "../types";
import { customerInvoicePdfUrl, fetchCustomerPortalInvoicesMe } from "../services/api";
import { portal } from "../lib/clientPortalUi";

const statusStyle: Record<string, string> = {
  Paid: "bg-emerald-500/15 text-emerald-400",
  Partial: "bg-amber-500/15 text-amber-400",
  Unpaid: "bg-white/[0.06] text-slate-400",
  Overdue: "bg-red-500/15 text-red-400",
};

export default function ClientPortalInvoices({ user }: { user: User }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payableBalance, setPayableBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCustomerPortalInvoicesMe(user.id, user.username);
        if (!cancelled) {
          setInvoices(data.invoices || []);
          setPayableBalance(Number(data.payableBalance ?? 0));
        }
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
      <div className="flex justify-center py-8">
        <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className={`${portal.card} ${portal.cardPad}`}>
        <p className={portal.label}>Total payable</p>
        <p className={`${portal.heroMetric} text-amber-400 mt-1`}>PKR {payableBalance.toLocaleString()}</p>
      </div>

      {!invoices.length ? (
        <p className="text-sm text-slate-500 text-center py-6">No invoices yet.</p>
      ) : (
        invoices.map((inv) => (
          <div key={inv.id} className={`${portal.card} ${portal.cardPad}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">{inv.invoiceNumber}</p>
                <p className="text-sm text-slate-500 mt-0.5">{inv.invoiceDate}</p>
                <p className="text-sm text-slate-400 mt-2">
                  PKR {Number(inv.grandTotal).toLocaleString()} · Balance{" "}
                  <span className="font-semibold text-amber-400">
                    {Number(inv.balanceDue).toLocaleString()}
                  </span>
                </p>
                <span
                  className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    statusStyle[inv.paymentStatus] || statusStyle.Unpaid
                  }`}
                >
                  {inv.paymentStatus}
                </span>
              </div>
              <a
                href={customerInvoicePdfUrl(inv.id, user.id, user.username)}
                target="_blank"
                rel="noreferrer"
                className={portal.btnPrimary + " !py-2.5 !px-4 text-xs shrink-0"}
              >
                <Download className="w-4 h-4" />
                PDF
              </a>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
