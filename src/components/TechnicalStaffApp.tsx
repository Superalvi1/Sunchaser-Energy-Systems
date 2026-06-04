import React, { useCallback, useEffect, useState } from "react";
import {
  Sun,
  LogOut,
  RefreshCw,
  Loader2,
  MapPin,
  Phone,
  Wrench,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
} from "lucide-react";
import { User } from "../types";
import {
  fetchTechnicalJobsMe,
  fetchTechnicalJobById,
  patchTechnicalJobStatus,
  postTechnicalJobUpdate,
  postTechnicalEquipment,
} from "../services/api";
import type { TechnicalJobCard, TechnicalJobsDashboard } from "../lib/technicalStaff";
import { SAFETY_CHECKLIST_ITEMS, EQUIPMENT_CAPTURE_TYPES } from "../lib/technicalStaff";
import TechnicalDeliveryPanel from "./TechnicalDeliveryPanel";

interface TechnicalStaffAppProps {
  user: User;
  onLogout: () => void;
  onShowWelcomeGuide?: () => void;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "En Route":
      return "bg-sky-500/20 text-sky-300 border-sky-700";
    case "Started":
      return "bg-amber-500/20 text-amber-300 border-amber-700";
    case "Completed":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-700";
    case "Needs Follow-up":
      return "bg-rose-500/20 text-rose-300 border-rose-700";
    default:
      return "bg-slate-700/50 text-slate-200 border-slate-600";
  }
}

export default function TechnicalStaffApp({
  user,
  onLogout,
  onShowWelcomeGuide,
}: TechnicalStaffAppProps) {
  const [workMode, setWorkMode] = useState<"jobs" | "deliveries">("jobs");
  const [dashboard, setDashboard] = useState<TechnicalJobsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [technicianNotes, setTechnicianNotes] = useState("");
  const [beforePhotoUrl, setBeforePhotoUrl] = useState("");
  const [afterPhotoUrl, setAfterPhotoUrl] = useState("");
  const [inverterPhotoUrl, setInverterPhotoUrl] = useState("");
  const [dbPhotoUrl, setDbPhotoUrl] = useState("");
  const [replacedComponents, setReplacedComponents] = useState("");
  const [customerSignatureUrl, setCustomerSignatureUrl] = useState("");
  const [safety, setSafety] = useState<Record<string, boolean>>({});

  const [eqType, setEqType] = useState("Panel");
  const [eqBrand, setEqBrand] = useState("");
  const [eqModel, setEqModel] = useState("");
  const [eqSerial, setEqSerial] = useState("");
  const [eqQty, setEqQty] = useState("1");

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setSyncError(null);
    try {
      const data = await fetchTechnicalJobsMe(user.id, user.username);
      setDashboard(data);
    } catch (err: any) {
      setSyncError("Internet required to sync job updates.");
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [user.id, user.username]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const selectedJob = dashboard?.jobs.find((j) => j.id === selectedJobId) || null;

  const openJob = async (job: TechnicalJobCard) => {
    setSelectedJobId(job.id);
    setDetailLoading(true);
    try {
      const detail = await fetchTechnicalJobById(user.id, user.username, job.id);
      const u = detail.latestUpdate;
      setTechnicianNotes(u?.technicianNotes || "");
      setBeforePhotoUrl(u?.beforePhotoUrl || "");
      setAfterPhotoUrl(u?.afterPhotoUrl || "");
      setInverterPhotoUrl(u?.inverterPhotoUrl || "");
      setDbPhotoUrl(u?.dbPhotoUrl || "");
      setReplacedComponents(u?.replacedComponentDetails || "");
      setCustomerSignatureUrl(u?.customerSignatureUrl || "");
      setSafety((u?.safetyChecklist as Record<string, boolean>) || {});
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setDetailLoading(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (!selectedJobId) return;
    setSaving(true);
    setSyncError(null);
    try {
      await patchTechnicalJobStatus(user.id, user.username, selectedJobId, status);
      await loadJobs();
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setSaving(false);
    }
  };

  const submitCompletion = async () => {
    if (!selectedJobId || !selectedJob) return;
    const allSafe = SAFETY_CHECKLIST_ITEMS.every((item) => safety[item.key]);
    if (!allSafe) {
      setSyncError("Complete the safety checklist before marking the job done.");
      return;
    }
    setSaving(true);
    setSyncError(null);
    try {
      await postTechnicalJobUpdate(user.id, user.username, selectedJobId, {
        status: "Completed",
        technicianNotes,
        beforePhotoUrl,
        afterPhotoUrl,
        inverterPhotoUrl,
        dbPhotoUrl,
        replacedComponentDetails: replacedComponents,
        customerSignatureUrl,
        safetyChecklist: safety,
      });
      setSelectedJobId(null);
      await loadJobs();
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setSaving(false);
    }
  };

  const addEquipment = async () => {
    if (!selectedJob?.customerId) return;
    setSaving(true);
    setSyncError(null);
    try {
      await postTechnicalEquipment(user.id, user.username, {
        customerId: selectedJob.customerId,
        projectId: selectedJob.projectId,
        equipmentType: eqType,
        brand: eqBrand,
        model: eqModel,
        serialNumber: eqSerial,
        quantity: Number(eqQty) || 1,
      });
      setEqBrand("");
      setEqModel("");
      setEqSerial("");
    } catch {
      setSyncError("Internet required to sync job updates.");
    } finally {
      setSaving(false);
    }
  };

  if (selectedJobId && selectedJob) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSelectedJobId(null)}
            className="text-amber-400 text-sm font-bold"
          >
            ← Jobs
          </button>
          <span className={`text-[10px] px-2 py-1 rounded-lg border font-bold ${statusBadgeClass(selectedJob.status)}`}>
            {selectedJob.status}
          </span>
        </header>

        <main className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-4 pb-24">
          {syncError && (
            <div className="bg-rose-950/40 border border-rose-800 text-rose-200 text-sm p-3 rounded-2xl flex gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {syncError}
            </div>
          )}

          {detailLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-xl font-extrabold">{selectedJob.customerName}</h2>
                <p className="text-amber-400 text-sm font-semibold">{selectedJob.jobType}</p>
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {selectedJob.customerPhone || "No phone"}
                </p>
                <p className="text-xs text-slate-400 flex items-start gap-1 mt-1">
                  <MapPin className="h-3 w-3 shrink-0 mt-0.5" /> {selectedJob.siteAddress || "Address on file"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(["En Route", "Started"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={saving}
                    onClick={() => changeStatus(s)}
                    className="py-3 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold hover:bg-slate-700 disabled:opacity-50"
                  >
                    Mark {s}
                  </button>
                ))}
              </div>

              <label className="block text-xs text-slate-400 font-semibold">Technician notes</label>
              <textarea
                value={technicianNotes}
                onChange={(e) => setTechnicianNotes(e.target.value)}
                rows={3}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm"
                placeholder="What you did on site..."
              />

              {[
                ["Before photo URL", beforePhotoUrl, setBeforePhotoUrl],
                ["After photo URL", afterPhotoUrl, setAfterPhotoUrl],
                ["Inverter screen photo URL", inverterPhotoUrl, setInverterPhotoUrl],
                ["DB / breaker photo URL", dbPhotoUrl, setDbPhotoUrl],
                ["Customer signature photo URL (optional)", customerSignatureUrl, setCustomerSignatureUrl],
              ].map(([label, val, setVal]) => (
                <div key={label as string}>
                  <label className="block text-xs text-slate-400 font-semibold mb-1">{label}</label>
                  <input
                    value={val as string}
                    onChange={(e) => (setVal as (v: string) => void)(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                    placeholder="https://..."
                  />
                </div>
              ))}

              <label className="block text-xs text-slate-400 font-semibold">Replaced components</label>
              <input
                value={replacedComponents}
                onChange={(e) => setReplacedComponents(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                placeholder="e.g. 63A AC breaker"
              />

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                <h3 className="font-bold text-sm">Safety checklist</h3>
                {SAFETY_CHECKLIST_ITEMS.map((item) => (
                  <label key={item.key} className="flex items-center gap-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!safety[item.key]}
                      onChange={(e) => setSafety((s) => ({ ...s, [item.key]: e.target.checked }))}
                      className="w-5 h-5 rounded accent-amber-500"
                    />
                    {item.label}
                  </label>
                ))}
              </div>

              {selectedJob.jobType === "Installation" && selectedJob.customerId && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-amber-400" /> Equipment capture
                  </h3>
                  <select
                    value={eqType}
                    onChange={(e) => setEqType(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                  >
                    {EQUIPMENT_CAPTURE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Brand"
                    value={eqBrand}
                    onChange={(e) => setEqBrand(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                  />
                  <input
                    placeholder="Model"
                    value={eqModel}
                    onChange={(e) => setEqModel(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                  />
                  <input
                    placeholder="Serial (if any)"
                    value={eqSerial}
                    onChange={(e) => setEqSerial(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                  />
                  <input
                    placeholder="Quantity"
                    value={eqQty}
                    onChange={(e) => setEqQty(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={addEquipment}
                    className="w-full py-3 rounded-xl bg-slate-800 font-bold text-sm"
                  >
                    Add to equipment registry
                  </button>
                </div>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={submitCompletion}
                className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-base flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                Mark job completed
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-tr from-amber-400 to-orange-500 p-2 rounded-xl">
              <Sun className="h-5 w-5 text-slate-950" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold">Field Portal</h1>
              <p className="text-[10px] text-slate-400">{user.role} · {user.name}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadJobs} className="p-2 rounded-xl bg-slate-800" title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </button>
            {onShowWelcomeGuide && (
              <button type="button" onClick={onShowWelcomeGuide} className="p-2 rounded-xl bg-slate-800" title="Guide">
                <BookOpen className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={onLogout} className="p-2 rounded-xl bg-red-950/50 text-red-400">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setWorkMode("jobs")}
            className={`py-2 rounded-xl text-xs font-bold ${workMode === "jobs" ? "bg-amber-500 text-slate-950" : "bg-slate-800"}`}
          >
            Field jobs
          </button>
          <button
            type="button"
            onClick={() => setWorkMode("deliveries")}
            className={`py-2 rounded-xl text-xs font-bold ${workMode === "deliveries" ? "bg-amber-500 text-slate-950" : "bg-slate-800"}`}
          >
            Deliveries
          </button>
        </div>
        {workMode === "deliveries" ? (
          <TechnicalDeliveryPanel user={user} />
        ) : (
          <>
        {syncError && (
          <div className="bg-rose-950/40 border border-rose-800 text-rose-200 text-sm p-3 rounded-2xl">
            {syncError}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-amber-500 mx-auto" />
            <p className="text-sm text-slate-400 mt-3">Loading your jobs...</p>
          </div>
        ) : dashboard ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
              {[
                ["Today", dashboard.todayAssigned],
                ["Surveys", dashboard.pendingSurveys],
                ["Install", dashboard.installationTasks],
                ["Service", dashboard.serviceVisits],
                ["Warranty", dashboard.warrantyVisits],
                ["Emergency", dashboard.emergencyTickets],
                ["Done", dashboard.completedJobs],
              ].map(([label, n]) => (
                <div key={label as string} className="bg-slate-900 border border-slate-800 rounded-xl py-3">
                  <div className="text-lg font-extrabold text-amber-400">{n}</div>
                  <div className="text-slate-400 font-mono uppercase">{label}</div>
                </div>
              ))}
            </div>

            <h2 className="text-sm font-bold text-slate-300">Your jobs</h2>
            {dashboard.jobs.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No jobs assigned yet. Pull to refresh.</p>
            ) : (
              <ul className="space-y-3">
                {dashboard.jobs.map((job) => (
                  <li
                    key={job.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-bold">{job.customerName}</p>
                        <p className="text-xs text-amber-400">{job.jobType}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-lg border font-bold shrink-0 ${statusBadgeClass(job.status)}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2">{job.siteAddress || "—"}</p>
                    <p className="text-[10px] text-slate-500">
                      {job.scheduledDate || "Unscheduled"}
                      {job.scheduledTime ? ` · ${job.scheduledTime}` : ""} · {job.priority}
                    </p>
                    <button
                      type="button"
                      onClick={() => openJob(job)}
                      className="w-full mt-2 py-3 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-1"
                    >
                      Open details <ChevronRight className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
          </>
        )}
      </main>
    </div>
  );
}
