/**
 * Super-Admin panel: CEO automatic supplier catalogue sync health.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Store } from "lucide-react";
import { isSuperAdmin } from "../lib/roles";
import {
  fetchMarketplaceAutoImportHealth,
  runMarketplaceAutoImport,
} from "../services/api";

type Props = {
  staffUser: { id: string; username: string; role: string };
};

type Health = {
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastRunId: string | null;
  kamalDiscovered: number;
  alladinDiscovered: number;
  acceptedVariants: number;
  rejectedVariants: number;
  exactMatches: number;
  conflictKeptSeparate: number;
  productsCreated: number;
  productsUpdated: number;
  lowestPriceSelections: number;
  rolledBackPrices: number;
  errors: string[];
  note: string;
};

export default function MarketplaceAutoImportStaff({ staffUser }: Props) {
  const allowed = isSuperAdmin(staffUser.username, staffUser.role);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    try {
      const data = await fetchMarketplaceAutoImportHealth(staffUser);
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sync health.");
    }
  }, [allowed, staffUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const runSync = async () => {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runMarketplaceAutoImport(staffUser);
      setHealth(result.health);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
        Marketplace supplier auto-import is restricted to Super Admin.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <Store className="h-6 w-6" />
            Supplier Catalogue Sync
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            CEO-authorized automatic import from Kamal Solar and Aladin.pk.
            Publishes the lowest valid public listed price. No purchasing
            discount. No manual mapping approval.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runSync()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? "Syncing…" : "Run sync now"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Last sync" value={health?.lastSyncAt ? new Date(health.lastSyncAt).toLocaleString() : "Never"} />
        <Stat label="Status" value={health?.lastSyncStatus || "never"} />
        <Stat label="Kamal discovered" value={String(health?.kamalDiscovered ?? 0)} />
        <Stat label="Aladin discovered" value={String(health?.alladinDiscovered ?? 0)} />
        <Stat label="Accepted variants" value={String(health?.acceptedVariants ?? 0)} />
        <Stat label="Rejected variants" value={String(health?.rejectedVariants ?? 0)} />
        <Stat label="Exact-match groups" value={String(health?.exactMatches ?? 0)} />
        <Stat label="Kept separate" value={String(health?.conflictKeptSeparate ?? 0)} />
        <Stat label="Products created" value={String(health?.productsCreated ?? 0)} />
        <Stat label="Products updated" value={String(health?.productsUpdated ?? 0)} />
        <Stat label="Lowest-price picks" value={String(health?.lowestPriceSelections ?? 0)} />
        <Stat label="Price rollbacks" value={String(health?.rolledBackPrices ?? 0)} />
      </div>

      {health?.note && (
        <p className="text-sm text-slate-600">{health.note}</p>
      )}
      {!!health?.errors?.length && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium">Sync warnings</div>
          <ul className="mt-1 list-disc pl-5">
            {health.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
