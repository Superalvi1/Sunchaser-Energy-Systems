import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Shield } from "lucide-react";
import { User } from "../types";
import { fetchAdminCompletionGaps, warrantyHandoverPdfUrl } from "../services/api";

export default function ProjectCompletionGapsStaff({ staffUser }: { staffUser: User }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminCompletionGaps(staffUser)
      .then((d) => setRows(d.deliveries || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [staffUser.id]);

  if (loading) return <Loader2 className="h-6 w-6 animate-spin text-amber-400 m-4" />;
  if (error) return <p className="text-rose-400 text-sm p-4">{error}</p>;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-4">
      <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
        <Shield className="h-4 w-4 text-amber-400" />
        Missing installation evidence
      </h3>
      <p className="text-xs text-neutral-500">
        Projects awaiting completion photos or not yet marked Completed.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-emerald-400">All tracked deliveries have full proof on file.</p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.deliveryId} className="border border-neutral-800 rounded-xl p-3 text-xs">
              <div className="font-bold text-neutral-100">{r.projectTitle}</div>
              <div className="text-neutral-500 mt-1">
                Stage: {r.completionStage} · Status: {r.deliveryStatus}
              </div>
              {r.missingCount > 0 && (
                <div className="text-amber-400 mt-2 flex gap-1 items-start">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>Missing ({r.missingCount}): {r.missing?.join(", ")}</span>
                </div>
              )}
              {r.canComplete && (
                <a
                  href={warrantyHandoverPdfUrl(r.deliveryId, { staff: staffUser })}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-2 text-amber-400 font-bold underline"
                >
                  Warranty handover PDF
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
