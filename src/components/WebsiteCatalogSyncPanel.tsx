import React, { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, RefreshCcw } from "lucide-react";
import { authorizedFetch, API_BASE_URL } from "../services/api";
import { canSyncWebsiteCatalog } from "../lib/websiteCatalog/auth";
import type { WebsiteCatalogSyncReport } from "../lib/websiteCatalog/sync";
import { emptyWebsiteCatalogReport } from "../lib/websiteCatalog/sync";

type Props = {
  staffUser: { username: string; role: string };
  onRefreshState?: () => void | Promise<void>;
};

export default function WebsiteCatalogSyncPanel({ staffUser, onRefreshState }: Props) {
  const canSync = canSyncWebsiteCatalog(staffUser.username, staffUser.role);
  const [report, setReport] = useState<WebsiteCatalogSyncReport>(emptyWebsiteCatalogReport());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authorizedFetch(`${API_BASE_URL}/api/admin/website-catalog-sync`, {
        method: "GET",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not load website catalog sync status.");
      if (payload.report) setReport(payload.report);
    } catch (err: any) {
      setError(err?.message || "Could not load sync status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncNow = async () => {
    if (!canSync || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authorizedFetch(`${API_BASE_URL}/api/admin/website-catalog-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Website catalog sync failed.");
      if (payload.report) setReport(payload.report);
      await onRefreshState?.();
    } catch (err: any) {
      setError(err?.message || "Website catalog sync failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-amber-400" />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">Sunchaser Website</h4>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              First-party catalog sync from sunchaserenergy.co into the CRM product library. Sales can read products; only admin/owner roles can run sync.
            </p>
          </div>
        </div>
        {canSync && (
          <button
            type="button"
            onClick={syncNow}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            SYNC NOW
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[11px]">
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <dt className="text-neutral-500">Last synchronized</dt>
          <dd className="text-neutral-100 font-semibold">{report.lastSyncedAt ? new Date(report.lastSyncedAt).toLocaleString() : "Never"}</dd>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <dt className="text-neutral-500">Discovered</dt>
          <dd className="text-neutral-100 font-semibold">{report.discovered}</dd>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <dt className="text-neutral-500">Added</dt>
          <dd className="text-emerald-400 font-semibold">{report.added}</dd>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <dt className="text-neutral-500">Updated</dt>
          <dd className="text-amber-400 font-semibold">{report.updated}</dd>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <dt className="text-neutral-500">Unchanged</dt>
          <dd className="text-neutral-100 font-semibold">{report.unchanged}</dd>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2">
          <dt className="text-neutral-500">Inactive</dt>
          <dd className="text-rose-300 font-semibold">{report.inactive}</dd>
        </div>
      </dl>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {report.errors?.length > 0 && (
        <ul className="text-[11px] text-rose-300 space-y-1 list-disc pl-4">
          {report.errors.slice(0, 6).map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-neutral-600">
        Source: Next.js shop catalog payload. Failed sync never wipes products. Website price is catalogue suggestion only.
      </p>
    </div>
  );
}
