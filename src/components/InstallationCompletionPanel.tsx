import React, { useCallback, useEffect, useState } from "react";
import { Camera, ChevronRight, Loader2, Package, Shield, CheckCircle2, AlertTriangle } from "lucide-react";
import { User } from "../types";
import {
  fetchTechnicalProjectDeliveriesMe,
  fetchTechnicalCompletionStatus,
  postTechnicalCompletionMedia,
  patchTechnicalCompletionStage,
} from "../services/api";
import { COMPLETION_STAGES, COMPLETION_MEDIA_TYPES } from "../lib/projectCompletion";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function InstallationCompletionPanel({ user }: { user: User }) {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batteryApplicable, setBatteryApplicable] = useState(true);
  const [serialDraft, setSerialDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTechnicalProjectDeliveriesMe(user.id, user.username);
      setDeliveries(data.deliveries || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [user.id, user.username]);

  const open = async (id: string) => {
    setSelectedId(id);
    setStatus(null);
    setMsg(null);
    try {
      const s = await fetchTechnicalCompletionStatus(user.id, user.username, id);
      setStatus(s);
      setBatteryApplicable(s.batteryApplicable !== false);
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (mediaType: string, file: File) => {
    if (!selectedId) return;
    setBusy(true);
    setMsg(null);
    try {
      const base64Data = await fileToBase64(file);
      await postTechnicalCompletionMedia(user.id, user.username, selectedId, {
        mediaType,
        base64Data,
        fileName: file.name,
        serialNumber: serialDraft[mediaType] || undefined,
      });
      await open(selectedId);
      setMsg(`Uploaded ${mediaType.replace(/_/g, " ")}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setStage = async (stage: string) => {
    if (!selectedId) return;
    setBusy(true);
    setMsg(null);
    try {
      await patchTechnicalCompletionStage(user.id, user.username, selectedId, {
        completionStage: stage,
        batteryApplicable,
      });
      await open(selectedId);
      await load();
      setMsg(`Stage → ${stage}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const mediaTypes = COMPLETION_MEDIA_TYPES.filter((m) => !m.batteryOnly || batteryApplicable);

  if (selectedId && status) {
    return (
      <div className="space-y-4 pb-10">
        <button type="button" onClick={() => setSelectedId(null)} className="text-amber-400 text-sm font-bold">
          ← Deliveries
        </button>
        {msg && (
          <p className={`text-xs px-3 py-2 rounded-lg ${msg.includes("Missing") || msg.includes("Cannot") ? "bg-rose-950/40 text-rose-300" : "bg-amber-500/10 text-amber-200"}`}>
            {msg}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400" />
          <div>
            <h2 className="text-lg font-extrabold">Installation completion</h2>
            <p className="text-xs text-slate-400">Stage: {status.completionStage}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={batteryApplicable}
            onChange={(e) => setBatteryApplicable(e.target.checked)}
          />
          Battery applicable on this project
        </label>
        {!status.canComplete && (
          <div className="bg-amber-950/30 border border-amber-800 rounded-xl p-3 text-xs text-amber-200 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Cannot mark <strong>Completed</strong> until all required photos are uploaded.
              Missing: {status.missingLabels?.join(", ")}
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {COMPLETION_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              disabled={busy || (stage === "Completed" && !status.canComplete)}
              onClick={() => setStage(stage)}
              className={`py-2 px-2 rounded-xl text-[10px] font-bold ${
                status.completionStage === stage
                  ? "bg-amber-500 text-slate-950"
                  : "bg-slate-800 text-slate-300"
              } disabled:opacity-40`}
            >
              {stage}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {mediaTypes.map((m) => {
            const uploaded = status.required?.find((r: any) => r.key === m.key)?.uploaded;
            return (
              <div key={m.key} className="bg-slate-900 border border-slate-800 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-200">{m.label}</p>
                  {uploaded ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <span className="text-[9px] text-rose-400 font-bold">Required</span>
                  )}
                </div>
                {m.key.includes("serial") && (
                  <input
                    className="w-full mb-2 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs"
                    placeholder="Serial number (optional)"
                    value={serialDraft[m.key] || ""}
                    onChange={(e) => setSerialDraft((d) => ({ ...d, [m.key]: e.target.value }))}
                  />
                )}
                <label className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 cursor-pointer text-xs font-bold">
                  <Camera className="h-4 w-4" />
                  {uploaded ? "Replace photo" : "Take / upload photo"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(m.key, f);
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
        <Package className="h-4 w-4 text-amber-500" /> Installation &amp; handover
      </h2>
      <p className="text-[10px] text-slate-500">Upload all proof photos before marking project Completed.</p>
      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mx-auto" />
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-slate-500">No deliveries assigned.</p>
      ) : (
        <ul className="space-y-2">
          {deliveries.map((d) => (
            <li key={d.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="font-bold">{d.projectTitle}</p>
              <p className="text-xs text-amber-400">{d.completionStage || d.deliveryStatus}</p>
              <button
                type="button"
                onClick={() => open(d.id)}
                className="mt-2 w-full py-3 rounded-xl bg-amber-500 text-slate-950 font-extrabold text-sm flex justify-center gap-1"
              >
                Completion checklist <ChevronRight className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
