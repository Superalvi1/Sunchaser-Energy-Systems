/**
 * Super-Admin panel: CEO automatic supplier catalogue sync health.
 */
import React, { useCallback, useEffect, useState } from "react";
import { RefreshCcw, Store } from "lucide-react";
import { isSuperAdmin } from "../lib/roles";
import {
  fetchMarketplaceAutoImportHealth,
  fetchMarketplaceAutoImportListings,
  fetchMarketplaceAutoImportPreflight,
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

type Preflight = Awaited<ReturnType<typeof fetchMarketplaceAutoImportPreflight>>;
type Stages = {
  observationFetched: boolean;
  catalogueProductCreated: boolean;
  variantPriceStored: boolean;
  ceoListingImported: boolean;
  publicWebsiteVisible: boolean;
};

export default function MarketplaceAutoImportStaff({ staffUser }: Props) {
  const allowed = isSuperAdmin(staffUser.username, staffUser.role);
  const [health, setHealth] = useState<Health | null>(null);
  const [listingCount, setListingCount] = useState<number | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [stages, setStages] = useState<Stages | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setError(null);
    try {
      const [data, listings] = await Promise.all([
        fetchMarketplaceAutoImportHealth(staffUser),
        fetchMarketplaceAutoImportListings(staffUser).catch(() => null),
      ]);
      setHealth(data);
      if (listings) setListingCount(listings.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sync health.");
    }
  }, [allowed, staffUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const runPreflight = async () => {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const report = await fetchMarketplaceAutoImportPreflight(staffUser);
      setPreflight(report);
      if (report.blockers.length) {
        setError(`Preflight blockers: ${report.blockers.join("; ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preflight failed.");
    } finally {
      setBusy(false);
    }
  };

  const runSync = async () => {
    if (!allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runMarketplaceAutoImport(staffUser);
      setHealth(result.health);
      if (result.stages) setStages(result.stages);
      if (result.status === "failed") {
        setError(
          result.health.errors?.[0] ||
            "Sync failed. Check sanitized warnings below.",
        );
      }
      await load();
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
            Writes the lowest valid public listed price when persistence is
            enabled. Sync success does not guarantee public website visibility
            unless the catalogue source is database.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            onClick={() => void runPreflight()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? "Working…" : "Run preflight"}
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
        <Stat label="Import listings" value={String(listingCount ?? "—")} />
        <Stat label="Lowest-price picks" value={String(health?.lowestPriceSelections ?? 0)} />
      </div>

      {stages && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <div className="font-medium text-slate-900">Pipeline stages</div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            <li>A Observation fetched: {stages.observationFetched ? "yes" : "no"}</li>
            <li>B Catalogue product created: {stages.catalogueProductCreated ? "yes" : "no"}</li>
            <li>C Variant/price stored: {stages.variantPriceStored ? "yes" : "no"}</li>
            <li>D CEO listing imported: {stages.ceoListingImported ? "yes" : "no"}</li>
            <li>E Public website visible: {stages.publicWebsiteVisible ? "yes" : "no"}</li>
          </ul>
        </div>
      )}

      {preflight && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <div className="font-medium text-slate-900">Preflight (read-only)</div>
          <ul className="mt-2 space-y-1">
            <li>Persistence enabled: {String(preflight.persistenceEnabled)}</li>
            <li>Catalogue source: {preflight.catalogueSource}</li>
            <li>
              RPC commit batch:{" "}
              {preflight.objects.rpcMpCeoAutoImportCommitBatch}
            </li>
            <li>
              RPC preflight (read-only):{" "}
              {preflight.objects.rpcMpCeoAutoImportPreflight}
            </li>
            <li>
              RPC upsert (legacy helper):{" "}
              {preflight.objects.rpcMpCeoAutoImportUpsertListing}
            </li>
            <li>
              Listings table: {preflight.objects.tableMpAutoImportListings}
            </li>
            <li>
              Sync runs table: {preflight.objects.tableMpAutoImportSyncRuns}
            </li>
            <li>
              Kamal feed: {preflight.suppliers.kamal.status}
              {preflight.suppliers.kamal.detail
                ? ` (${preflight.suppliers.kamal.detail})`
                : ""}
            </li>
            <li>
              Aladin feed: {preflight.suppliers.alladin.status}
              {preflight.suppliers.alladin.detail
                ? ` (${preflight.suppliers.alladin.detail})`
                : ""}
            </li>
            <li>
              Public would show synced products:{" "}
              {String(preflight.stages.publicWebsiteWouldShowSyncedProducts)}
            </li>
          </ul>
          {!!preflight.notes.length && (
            <ul className="mt-2 list-disc pl-5 text-slate-600">
              {preflight.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

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
