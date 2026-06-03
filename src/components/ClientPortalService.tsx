import React, { useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Wrench,
  ChevronRight,
  ArrowLeft,
  Calendar,
  Clock,
} from "lucide-react";
import { User } from "../types";
import {
  fetchCustomerServicePortal,
  fetchCustomerServiceRequestById,
  createCustomerServiceRequest,
  fetchCustomerServiceHistory,
} from "../services/api";
import {
  SERVICE_TYPES,
  SERVICE_TIME_SLOTS,
  type ServiceRequestRecord,
  type ServiceMaintenanceSummary,
} from "../lib/clientPortalService";
import { NO_DATA, displayOrNoData } from "../lib/clientPortalDisplay";

interface ClientPortalServiceProps {
  user: User;
}

export default function ClientPortalService({ user }: ClientPortalServiceProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ServiceMaintenanceSummary | null>(null);
  const [requests, setRequests] = useState<ServiceRequestRecord[]>([]);
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [detail, setDetail] = useState<ServiceRequestRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [freeService, setFreeService] = useState<any>(null);

  const [serviceType, setServiceType] = useState<(typeof SERVICE_TYPES)[number]>("Cleaning");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState(SERVICE_TIME_SLOTS[0]);
  const [notes, setNotes] = useState("");

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, history] = await Promise.all([
        fetchCustomerServicePortal(user.id, user.username),
        fetchCustomerServiceHistory(user.id, user.username),
      ]);
      setSummary(data.summary);
      setRequests(data.requests || []);
      setHistoryLogs(history.logs || []);
      setFreeService(history.freeService || null);
    } catch (err: any) {
      setError(err.message || "Unable to load service data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === "list") loadList();
  }, [user.id, user.username, view]);

  const openDetail = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerServiceRequestById(user.id, user.username, id);
      setDetail(data.request);
      setView("detail");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createCustomerServiceRequest(user.id, user.username, {
        serviceType,
        preferredDate: preferredDate || undefined,
        preferredTime,
        notes: notes || undefined,
      });
      setPreferredDate("");
      setNotes("");
      setView("list");
      await loadList();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      Submitted: "bg-slate-800 text-slate-300",
      Assigned: "bg-blue-950 text-blue-300",
      Scheduled: "bg-amber-950 text-amber-300",
      "En Route": "bg-orange-950 text-orange-300",
      Completed: "bg-emerald-950 text-emerald-300",
      Cancelled: "bg-rose-950 text-rose-300",
    };
    return colors[status] || "bg-slate-800 text-slate-400";
  };

  if (view === "create") {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setView("list")}
          className="text-xs text-amber-400 font-bold flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to service
        </button>
        <h3 className="text-sm font-bold text-white">New service request</h3>
        <form
          onSubmit={handleCreate}
          className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3"
        >
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Service type</label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as typeof serviceType)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            >
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Preferred date</label>
            <input
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Preferred time</label>
            <select
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            >
              {SERVICE_TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={3}
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </form>
      </section>
    );
  }

  if (view === "detail" && detail) {
    return (
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setView("list")}
          className="text-xs text-amber-400 font-bold flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to service
        </button>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <p className="text-[10px] font-mono text-amber-500">{detail.requestNumber}</p>
          <h3 className="text-base font-bold text-white">{detail.serviceType}</h3>
          <span className={`inline-block text-[10px] font-bold px-2 py-1 rounded-lg ${statusBadge(detail.status)}`}>
            {detail.status}
          </span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800">
              <p className="text-slate-500 font-mono text-[9px] uppercase">Preferred</p>
              <p className="text-white mt-1">
                {displayOrNoData(detail.preferredDate)} · {displayOrNoData(detail.preferredTime)}
              </p>
            </div>
            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800">
              <p className="text-slate-500 font-mono text-[9px] uppercase">Scheduled visit</p>
              <p className="text-white mt-1">{displayOrNoData(detail.scheduledVisitDate)}</p>
            </div>
          </div>
          {detail.assignedTechnician && (
            <p className="text-xs text-slate-400">
              Technician: <span className="text-white">{detail.assignedTechnician}</span>
            </p>
          )}
          {detail.notes && (
            <p className="text-xs text-slate-400">
              Your notes: <span className="text-slate-200">{detail.notes}</span>
            </p>
          )}
          {detail.completionNotes && (
            <p className="text-xs text-emerald-400/90 border border-emerald-900/40 rounded-xl p-3 bg-emerald-950/20">
              {detail.completionNotes}
            </p>
          )}
          {(detail.beforePhotoUrl || detail.afterPhotoUrl) && (
            <div className="grid grid-cols-2 gap-2">
              {detail.beforePhotoUrl && (
                <a href={detail.beforePhotoUrl} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={detail.beforePhotoUrl}
                    alt="Before"
                    className="rounded-xl border border-slate-800 w-full h-24 object-cover"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Before</p>
                </a>
              )}
              {detail.afterPhotoUrl && (
                <a href={detail.afterPhotoUrl} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={detail.afterPhotoUrl}
                    alt="After"
                    className="rounded-xl border border-slate-800 w-full h-24 object-cover"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">After</p>
                </a>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Wrench className="w-4 h-4 text-amber-500" />
          Service & Maintenance
        </h3>
        <button
          type="button"
          onClick={() => setView("create")}
          className="text-xs font-bold bg-amber-500 text-slate-950 px-3 py-2 rounded-xl flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Request
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
          <Calendar className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-mono text-slate-500 uppercase">Last cleaning</p>
            <p className="text-sm font-semibold text-white">
              {summary?.lastCleaningDate || NO_DATA}
            </p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
          <Calendar className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-mono text-slate-500 uppercase">Next recommended cleaning</p>
            <p className="text-sm font-semibold text-white">
              {summary?.nextRecommendedCleaningDate || NO_DATA}
            </p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-mono text-slate-500 uppercase">Service status</p>
            <p className="text-sm font-semibold text-white">
              {summary?.status || summary?.serviceStatus || NO_DATA}
            </p>
          </div>
        </div>
      </div>

      {freeService && (
        <div className="bg-slate-900 border border-emerald-900/40 rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-mono text-emerald-500 uppercase">Free service status</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-slate-500">Status</p>
              <p className="font-bold text-white">{freeService.status}</p>
            </div>
            <div>
              <p className="text-slate-500">Covered until</p>
              <p className="font-bold text-white">{freeService.coveredUntil || NO_DATA}</p>
            </div>
            <div>
              <p className="text-slate-500">Services used</p>
              <p className="font-bold text-amber-400">{freeService.servicesUsed}</p>
            </div>
          </div>
          {freeService.usageBreakdown?.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-1 pt-1 border-t border-slate-800">
              {freeService.usageBreakdown.map((u: { serviceType: string; count: number }) => (
                <li key={u.serviceType}>
                  {u.serviceType}: {u.count} time{u.count !== 1 ? "s" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <h4 className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-2">Service history</h4>
        {historyLogs.length === 0 ? (
          <p className="text-xs text-slate-500 font-mono py-2">{NO_DATA}</p>
        ) : (
          <ul className="space-y-2">
            {historyLogs.map((log) => (
              <li key={log.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs space-y-2">
                <div className="flex justify-between gap-2">
                  <p className="font-bold text-white">{log.serviceType}</p>
                  <span className="text-slate-500">{log.serviceDate}</span>
                </div>
                {log.componentChanged && (
                  <p className="text-slate-400">Component: {log.componentChanged}</p>
                )}
                {log.newComponentDetails && <p className="text-slate-400">{log.newComponentDetails}</p>}
                {log.technicianName && <p className="text-slate-500">Technician: {log.technicianName}</p>}
                <p className={log.underFreeService ? "text-emerald-400" : "text-amber-400"}>
                  {log.underFreeService ? "Free service" : `Paid — PKR ${log.chargeAmount}`}
                </p>
                {log.customerVisibleNotes && (
                  <p className="text-slate-300 leading-relaxed">{log.customerVisibleNotes}</p>
                )}
                {(log.beforePhotoUrl || log.afterPhotoUrl) && (
                  <div className="grid grid-cols-2 gap-2">
                    {log.beforePhotoUrl && (
                      <img src={log.beforePhotoUrl} alt="Before" className="rounded-lg h-20 w-full object-cover border border-slate-800" />
                    )}
                    {log.afterPhotoUrl && (
                      <img src={log.afterPhotoUrl} alt="After" className="rounded-lg h-20 w-full object-cover border border-slate-800" />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-400 bg-rose-950/30 border border-rose-900 rounded-xl p-3">
          {error}
        </p>
      )}

      <h4 className="text-xs font-mono text-slate-500 uppercase tracking-wider">Your requests</h4>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto" />
      ) : requests.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">{NO_DATA}</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => openDetail(r.id)}
                className="w-full text-left bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-2 hover:border-amber-500/30"
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-mono text-amber-500">{r.requestNumber}</p>
                  <p className="text-sm font-semibold text-white truncate">{r.serviceType}</p>
                  <span
                    className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-lg ${statusBadge(r.status)}`}
                  >
                    {r.status}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
