import React, { useState } from "react";
import { Zap, Loader2 } from "lucide-react";
import { User } from "../types";
import { fetchAdminCustomerSavings, upsertAdminCustomerSavings } from "../services/api";
import { PERFORMANCE_STATUSES } from "../lib/clientPortalSavings";

interface CustomerSavingsStaffProps {
  staffUser: User;
}

export default function CustomerSavingsStaff({ staffUser }: CustomerSavingsStaffProps) {
  const [customerId, setCustomerId] = useState("");
  const [systemSizeKw, setSystemSizeKw] = useState("");
  const [unitRate, setUnitRate] = useState("55");
  const [manualToday, setManualToday] = useState("");
  const [manualMonth, setManualMonth] = useState("");
  const [lifetimeGen, setLifetimeGen] = useState("");
  const [performanceStatus, setPerformanceStatus] = useState(PERFORMANCE_STATUSES[0]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadProfile = async () => {
    if (!customerId.trim()) return;
    setLoading(true);
    setMsg(null);
    try {
      const data = await fetchAdminCustomerSavings(staffUser.id, staffUser.username, customerId.trim());
      const p = data.profile;
      if (p) {
        setSystemSizeKw(p.systemSizeKw != null ? String(p.systemSizeKw) : "");
        setUnitRate(p.unitRate != null ? String(p.unitRate) : "55");
        setManualToday(p.manualTodayGeneration != null ? String(p.manualTodayGeneration) : "");
        setManualMonth(p.manualMonthGeneration != null ? String(p.manualMonthGeneration) : "");
        setLifetimeGen(p.lifetimeGeneration != null ? String(p.lifetimeGeneration) : "");
        setPerformanceStatus((p.performanceStatus as typeof performanceStatus) || PERFORMANCE_STATUSES[0]);
        setNotes(p.notes || "");
      } else if (data.dashboard) {
        setSystemSizeKw(String(data.dashboard.systemSizeKw || ""));
        setUnitRate(String(data.dashboard.unitRate || 55));
      }
      setMsg("Profile loaded.");
    } catch (err: any) {
      setMsg(err.message || "Load failed.");
    } finally {
      setLoading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) {
      setMsg("Customer ID is required.");
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await upsertAdminCustomerSavings(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        systemSizeKw: systemSizeKw ? Number(systemSizeKw) : undefined,
        unitRate: unitRate ? Number(unitRate) : undefined,
        manualTodayGeneration: manualToday ? Number(manualToday) : undefined,
        manualMonthGeneration: manualMonth ? Number(manualMonth) : undefined,
        lifetimeGeneration: lifetimeGen ? Number(lifetimeGen) : undefined,
        performanceStatus,
        notes: notes || undefined,
      });
      setMsg("Savings profile saved. Customer portal will reflect updates.");
    } catch (err: any) {
      setMsg(err.message || "Save failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500" />
        Customer Solar Savings
      </h3>
      <form onSubmit={save} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex gap-2">
          <input
            required
            placeholder="Customer ID (e.g. cust-demo-portal)"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={loadProfile}
            disabled={loading}
            className="px-3 py-2 rounded-xl bg-slate-800 text-xs font-bold"
          >
            Load
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="0.1"
            placeholder="System size (kW)"
            value={systemSizeKw}
            onChange={(e) => setSystemSizeKw(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            placeholder="Unit rate PKR/kWh"
            value={unitRate}
            onChange={(e) => setUnitRate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.1"
            placeholder="Manual today (kWh)"
            value={manualToday}
            onChange={(e) => setManualToday(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.1"
            placeholder="Manual month (kWh)"
            value={manualMonth}
            onChange={(e) => setManualMonth(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="number"
            step="0.1"
            placeholder="Lifetime generation (kWh)"
            value={lifetimeGen}
            onChange={(e) => setLifetimeGen(e.target.value)}
            className="col-span-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <select
          value={performanceStatus}
          onChange={(e) => setPerformanceStatus(e.target.value as typeof performanceStatus)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        >
          {PERFORMANCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <textarea
          rows={2}
          placeholder="Staff notes (internal)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        {msg && <p className="text-xs text-amber-400">{msg}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save savings profile
        </button>
      </form>
    </div>
  );
}
