import React, { useEffect, useState } from "react";
import { Download, Loader2, Truck } from "lucide-react";
import { User } from "../types";
import { customerDeliveryCertificateUrl, fetchCustomerPortalDeliveries } from "../services/api";
import { portal } from "../lib/clientPortalUi";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  out_for_delivery: "Out for Delivery",
  delivered_pending_verification: "Pending Verification",
  verified_received: "Verified Received",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-white/[0.06] text-slate-400",
  out_for_delivery: "bg-blue-500/15 text-blue-400",
  delivered_pending_verification: "bg-amber-500/15 text-amber-400",
  verified_received: "bg-emerald-500/15 text-emerald-400",
  disputed: "bg-red-500/15 text-red-400",
  cancelled: "bg-white/[0.06] text-slate-500",
};

export default function ClientPortalDeliveries({ user }: { user: User }) {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCustomerPortalDeliveries(user.id, user.username);
        if (!cancelled) setDeliveries(data.deliveries || []);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Unable to load deliveries.");
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

  if (!deliveries.length) {
    return <p className="text-sm text-slate-500 text-center py-6">No material deliveries yet.</p>;
  }

  return (
    <div className="space-y-4">
      {deliveries.map((ch) => (
        <div key={ch.id} className={`${portal.card} ${portal.cardPad}`}>
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10">
              <Truck className="h-5 w-5 text-amber-400" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-white">{ch.challanNumber}</p>
                <span
                  className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    STATUS_STYLE[ch.status] || STATUS_STYLE.draft
                  }`}
                >
                  {STATUS_LABELS[ch.status] || ch.status}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">
                {ch.deliveryDate || ch.createdAt?.slice(0, 10) || "—"}
                {ch.deliveryTitle ? ` · ${ch.deliveryTitle}` : ""}
              </p>
              {ch.items?.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-slate-400">
                  {ch.items.map((it: any) => (
                    <li key={it.id}>
                      {it.itemName} — {it.deliverNowQty} of {it.invoiceQty}
                      {it.remainingQtyAfter > 0 ? ` (${it.remainingQtyAfter} remaining)` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {ch.status === "verified_received" && (
                <a
                  href={customerDeliveryCertificateUrl(ch.id, user.id, user.username)}
                  target="_blank"
                  rel="noreferrer"
                  className={`${portal.btnPrimary} !py-2 !px-3 !text-xs mt-4 inline-flex items-center gap-2`}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Certificate
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
