import React, { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalPaymentsMe } from "../services/api";
import { portal } from "../lib/clientPortalUi";

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
      <div className="py-12 text-center">
        <Loader2 className="h-8 w-8 text-amber-400 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-400 text-center">{error}</p>;
  }

  const totals = data?.totals || {};
  const projects = data?.projects || [];
  const receipts = data?.receipts || [];
  const total = Number(totals.invoiceAmount || 0);
  const paid = Number(totals.amountPaid || 0);
  const balance = Number(totals.balanceRemaining || 0);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  return (
    <div className="space-y-5">
      <div className={`${portal.card} ${portal.cardPad}`}>
        <p className={portal.label}>Summary</p>
        <div className="grid grid-cols-3 gap-3 mt-4 text-center">
          <div>
            <p className="text-[10px] text-slate-500 uppercase">Project value</p>
            <p className="text-lg font-bold text-white mt-1">{total.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase">Paid</p>
            <p className="text-lg font-bold text-emerald-400 mt-1">{paid.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase">Balance</p>
            <p className="text-lg font-bold text-amber-400 mt-1">{balance.toLocaleString()}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-600 text-center mt-2">PKR</p>
        <div className="h-2 rounded-full bg-white/[0.06] mt-4 overflow-hidden">
          <div className="h-full bg-emerald-500/80 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {projects.map((p: any) => (
        <div key={p.projectFinanceId} className={`${portal.card} ${portal.cardPad}`}>
          <p className="text-base font-semibold text-white">{p.projectTitle || "Project"}</p>
          <p className="text-sm text-slate-500 mt-1">
            Paid PKR {(p.amountPaid || 0).toLocaleString()} of {(p.invoiceAmount || 0).toLocaleString()}
          </p>
          {(p.milestones || []).length > 0 && (
            <ul className="mt-4 space-y-2">
              {p.milestones.map((m: any) => (
                <li
                  key={m.name}
                  className="flex justify-between text-sm py-2 border-b border-white/[0.06] last:border-0"
                >
                  <span className="text-slate-400">{m.name}</span>
                  <span className={m.paid ? "text-emerald-400 font-medium" : "text-slate-500"}>
                    {m.paid ? "Paid" : "Due"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {receipts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-300">Receipts</p>
          {receipts.map((r: any) => (
            <a
              key={r.id}
              href={r.receiptUrl}
              target="_blank"
              rel="noreferrer"
              className={`${portal.card} ${portal.cardPad} flex items-center justify-between`}
            >
              <span className="text-sm text-slate-200">{r.label || "Receipt"}</span>
              <Download className="h-4 w-4 text-amber-400" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
