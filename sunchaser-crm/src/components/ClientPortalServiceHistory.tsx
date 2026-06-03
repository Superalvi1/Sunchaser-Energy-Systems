import React, { useEffect, useState } from "react";
import {
  Loader2,
  History,
  Calendar,
  User,
  Shield,
  Banknote,
  TrendingUp,
  ImageIcon,
} from "lucide-react";
import { User as PortalUser } from "../types";
import { fetchCustomerServiceHistory } from "../services/api";
import type { MaintenanceRecord, ServiceHistoryDashboard } from "../lib/clientPortalServiceHistory";
import { NO_DATA } from "../lib/clientPortalDisplay";

interface ClientPortalServiceHistoryProps {
  user: PortalUser;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
      <p className="text-[10px] font-mono text-slate-500 uppercase">{label}</p>
      <p className="text-lg font-extrabold text-white mt-1">{value}</p>
    </div>
  );
}

function TimelineCard({ record }: { record: MaintenanceRecord }) {
  return (
    <article className="relative pl-6 pb-6 border-l border-slate-800 last:pb-0">
      <span className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-amber-500 ring-4 ring-slate-950" />
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-extrabold text-white">{record.serviceType}</p>
            <p className="text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
              <Calendar className="w-3 h-3" />
              {record.serviceDate}
            </p>
          </div>
          {record.performanceImprovementPct != null && record.performanceImprovementPct > 0 && (
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/50 border border-emerald-900/50 px-2 py-1 rounded-lg flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              +{record.performanceImprovementPct}%
            </span>
          )}
        </div>

        {record.technicianName && (
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            {record.technicianName}
          </p>
        )}

        {record.description && (
          <p className="text-xs text-slate-300 leading-relaxed">{record.description}</p>
        )}

        {record.replacementParts && (
          <p className="text-[11px] text-slate-500">
            Parts: <span className="text-slate-300">{record.replacementParts}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-2 text-[10px] font-bold">
          <span
            className={`px-2 py-1 rounded-lg border ${
              record.warrantyCovered
                ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                : "bg-slate-950 border-slate-700 text-slate-400"
            }`}
          >
            <Shield className="w-3 h-3 inline mr-1" />
            Warranty covered: {record.warrantyCovered ? "Yes" : "No"}
          </span>
          {!record.warrantyCovered && record.totalCost > 0 && (
            <span className="px-2 py-1 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-300">
              <Banknote className="w-3 h-3 inline mr-1" />
              PKR {record.totalCost.toLocaleString("en-PK")}
            </span>
          )}
        </div>

        {(record.beforePhotoUrl || record.afterPhotoUrl) && (
          <div className="grid grid-cols-2 gap-2">
            {record.beforePhotoUrl ? (
              <div>
                <img
                  src={record.beforePhotoUrl}
                  alt="Before"
                  className="w-full h-24 object-cover rounded-xl border border-slate-800"
                />
                <p className="text-[9px] text-slate-600 mt-1">Before</p>
              </div>
            ) : (
              <div className="h-24 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-slate-700" />
              </div>
            )}
            {record.afterPhotoUrl ? (
              <div>
                <img
                  src={record.afterPhotoUrl}
                  alt="After"
                  className="w-full h-24 object-cover rounded-xl border border-slate-800"
                />
                <p className="text-[9px] text-slate-600 mt-1">After</p>
              </div>
            ) : (
              <div className="h-24 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center">
                <ImageIcon className="w-6 h-6 text-slate-700" />
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export default function ClientPortalServiceHistory({ user }: ClientPortalServiceHistoryProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<MaintenanceRecord[]>([]);
  const [summary, setSummary] = useState<ServiceHistoryDashboard | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerServiceHistory(user.id, user.username);
      setTimeline(data.timeline || []);
      setSummary(data.summary || null);
    } catch (err: any) {
      setError(err.message || "Unable to load service history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.id, user.username]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-rose-400 text-center">
        {error}
        <button type="button" onClick={load} className="block mx-auto mt-2 text-amber-400 underline text-xs">
          Retry
        </button>
      </p>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-amber-500" />
        <h2 className="text-lg font-extrabold">Service History</h2>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2">
          <SummaryCard label="Total visits" value={summary.totalVisits} />
          <SummaryCard label="Total cleanings" value={summary.totalCleanings} />
          <SummaryCard label="Warranty repairs" value={summary.warrantyRepairs} />
          <SummaryCard label="Last service" value={summary.lastServiceDate || NO_DATA} />
          <div className="col-span-2">
            <SummaryCard
              label="Next recommended service"
              value={summary.nextRecommendedServiceDate || NO_DATA}
            />
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-4">Timeline</h3>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8 font-mono">{NO_DATA}</p>
        ) : (
          <div>{timeline.map((r) => (
            <TimelineCard key={r.id} record={r} />
          ))}</div>
        )}
      </div>
    </section>
  );
}
