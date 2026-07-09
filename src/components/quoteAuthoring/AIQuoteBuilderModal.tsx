import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Loader2, Sparkles } from "lucide-react";
import AppModal from "../ui/AppModal";
import {
  buildDraftApplyPayload,
  planSolarQuote,
  type SolarQuoteDraft,
  type SolarSystemType,
} from "../../lib/solarQuotePlannerClient";

export interface AIQuoteBuilderModalProps {
  open: boolean;
  onClose: () => void;
  /** Applies draft into BOQ builder state only — does not save to CRM. */
  onApplyDraft: (draft: SolarQuoteDraft) => void;
}

const SYSTEM_TYPE_OPTIONS: { id: SolarSystemType; label: string }[] = [
  { id: "on-grid", label: "On-grid" },
  { id: "hybrid", label: "Hybrid" },
  { id: "off-grid", label: "Off-grid" },
];

export default function AIQuoteBuilderModal({ open, onClose, onApplyDraft }: AIQuoteBuilderModalProps) {
  const [systemSizeKw, setSystemSizeKw] = useState("10");
  const [systemType, setSystemType] = useState<SolarSystemType>("on-grid");
  const [location, setLocation] = useState("");
  const [monthlyBill, setMonthlyBill] = useState("");
  const [backupRequirement, setBackupRequirement] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [draft, setDraft] = useState<SolarQuoteDraft | null>(null);
  const [generating, setGenerating] = useState(false);

  const applyPreview = useMemo(() => (draft?.valid ? buildDraftApplyPayload(draft) : null), [draft]);

  const handleGenerate = () => {
    setGenerating(true);
    try {
      const result = planSolarQuote({
        customerName: customerName.trim() || undefined,
        systemSizeKw: Number(systemSizeKw),
        systemType,
        location: location.trim() || undefined,
        monthlyBill: monthlyBill.trim() ? Number(monthlyBill) : undefined,
        backupRequirement: backupRequirement.trim() || undefined,
      });
      setDraft(result);
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = () => {
    if (!draft?.valid) return;
    onApplyDraft(draft);
    onClose();
  };

  return (
    <AppModal open={open} onClose={onClose} panelClassName="max-w-4xl">
      <div className="bg-slate-950 border border-slate-850 rounded-3xl p-5 md:p-6 text-left max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Draft only</p>
              <h2 className="text-lg font-bold text-white">AI Quote Builder</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Deterministic planner — no auto-save, no CRM mutation, no messaging.
              </p>
            </div>
          </div>
          <Bot className="h-5 w-5 text-slate-600 shrink-0" />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Customer name (optional, not stored)
              </label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Optional — used only while modal is open"
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">System size (kW)</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={0.1}
                  value={systemSizeKw}
                  onChange={(e) => setSystemSizeKw(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">System type</label>
                <select
                  value={systemType}
                  onChange={(e) => setSystemType(e.target.value as SolarSystemType)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  {SYSTEM_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Location</label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City or region"
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Monthly bill (PKR, optional)
                </label>
                <input
                  type="number"
                  value={monthlyBill}
                  onChange={(e) => setMonthlyBill(e.target.value)}
                  placeholder="e.g. 45000"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Backup requirement (optional)
                </label>
                <input
                  value={backupRequirement}
                  onChange={(e) => setBackupRequirement(e.target.value)}
                  placeholder="Partial / full / none"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate draft plan
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-4 min-h-[320px]">
            {!draft ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-slate-500">
                <Sparkles className="mb-2 h-8 w-8 text-slate-700" />
                <p className="text-sm">Generate a draft system plan and indicative BOQ.</p>
              </div>
            ) : !draft.valid ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-rose-400 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Input needs attention
                </div>
                <ul className="list-disc pl-5 text-sm text-rose-200/90 space-y-1">
                  {draft.errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Recommended system</p>
                  <p className="mt-1 text-sm text-white leading-relaxed">{draft.recommendedSystemSummary}</p>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                    <dt className="text-slate-500">Panels</dt>
                    <dd className="text-white font-semibold">
                      {draft.panelCountEstimate} × {draft.panelWattage}W
                    </dd>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                    <dt className="text-slate-500">Inverter</dt>
                    <dd className="text-white font-semibold">{draft.inverterSuggestion}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 col-span-2">
                    <dt className="text-slate-500">Battery</dt>
                    <dd className="text-white font-semibold">{draft.batterySuggestion ?? "None (on-grid base)"}</dd>
                  </div>
                </dl>

                {draft.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1">Warnings</p>
                    <ul className="text-xs text-amber-100/90 space-y-1 list-disc pl-4">
                      {draft.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Structure & protection</p>
                  <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4">
                    {draft.structureProtectionNotes.slice(0, 3).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">BOQ draft lines</p>
                  <ul className="max-h-28 overflow-y-auto space-y-1 text-xs text-slate-300">
                    {draft.boqDraft.map((line) => (
                      <li key={line.id} className="flex justify-between gap-2 border-b border-slate-800/80 py-1">
                        <span className="truncate">{line.name}</span>
                        <span className="shrink-0 text-slate-500">×{line.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <p className="text-[10px] text-slate-500">
            Draft only · apply fills BOQ builder · you must save manually
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-900"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!applyPreview}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Apply draft to BOQ
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
